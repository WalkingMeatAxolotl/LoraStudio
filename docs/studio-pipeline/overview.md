# Studio Pipeline 架构总览

本文档面向「跨 PP 复用」的横切关注点：数据模型、目录布局、SQLite schema、secrets、Sidebar、SSE 事件、Tagger 抽象、Preset 关系。每个 PP 文档里只描述自己阶段的差异。

---

## 1. Pipeline 流程

```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌────────────┐   ┌──────────┐
│ 创建项目 │ → │ 下载数据 │ → │ 筛选数据 │ → │ 标签生成 │ → │ 正则集生成 │ → │ 配置/入队 │
│ Project  │   │ Download │   │ Curation │   │ Tagging  │   │ Reg-build  │   │ Train     │
│ 含 v1    │   │ 项目级   │   │ 版本级   │   │ 版本级   │   │ 版本级     │   │ 版本级    │
└──────────┘   └──────────┘   └──────────┘   └──────────┘   └────────────┘   └──────────┘
                                       ↓ 可循环（新建 v2 重新筛选/打标）
```

每个版本（version）独立维护 `train/` `reg/` `output/` `samples/` `monitor_state.json`；`download/` 在项目级共享，永远不删（永远是「全量来源」）。

---

## 2. 物理目录布局

```
studio_data/
├── secrets.json                          ★ 全局服务配置（gelbooru token 等）
│                                         studio_data/ 已被 .gitignore，自然安全
├── presets/                              ★ 全局预设池（原 configs/，PP0 重命名）
│   ├── train_baseline.yaml
│   └── proj_42_baseline.yaml             从某 version 推回的预设
├── projects/{id}-{slug}/
│   ├── project.json                      title / stage / active_version_id / ts
│   ├── download/                         project 级共享，全量备份
│   │   ├── 12345.png
│   │   └── 12345.json                    Gelbooru 元数据，可选
│   └── versions/
│       └── {label}/                      ★ label 用户填："baseline" / "high-lr"
│           ├── version.json              config_name / stage / note
│           ├── train/
│           │   └── 5_concept/            Kohya 风格 N_xxx
│           │       ├── 12345.png         复制自 ../../../download/
│           │       ├── 12345.txt         打标产物
│           │       └── 12345.json        分类 caption（可选）
│           ├── reg/                      ★ version 级（train 变就重生）
│           │   ├── meta.json             {generated_at, source_version, target_count, source_tags}
│           │   └── 1_general/
│           │       ├── reg_001.png
│           │       └── reg_001.txt
│           ├── output/                   训练产物
│           │   ├── lora_step500.safetensors
│           │   ├── lora_final.safetensors
│           │   └── state_step1000.pt
│           ├── samples/
│           │   └── step500_p0.png
│           └── monitor_state.json        该 version 训练 loss/lr 曲线
└── _trash/projects/{id}-{slug}/          软删；UI 提供「清空 trash」按钮
```

**slug 规则**：title 转 ASCII 小写 + 连字符；冲突时加 `-2` `-3` 后缀。
**id**：自增，与 slug 一起组成目录名 `{id}-{slug}`。

---

## 3. SQLite Schema（迁移到 `studio_data/studio.db`）

```sql
-- 已有，PP1 扩字段
CREATE TABLE projects (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    slug                TEXT UNIQUE NOT NULL,
    title               TEXT NOT NULL,
    stage               TEXT NOT NULL DEFAULT 'created',
                        -- created | downloading | curating | tagging | regularizing | configured | training | done
    active_version_id   INTEGER REFERENCES versions(id) ON DELETE SET NULL,
    created_at          REAL NOT NULL,
    updated_at          REAL NOT NULL,
    note                TEXT
);
CREATE INDEX idx_projects_slug ON projects(slug);

CREATE TABLE versions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label               TEXT NOT NULL,             -- 用户填：baseline / high-lr / ...
    config_name         TEXT,                       -- 引用 presets/{config_name}.yaml
    stage               TEXT NOT NULL DEFAULT 'curating',
                        -- curating | tagging | regularizing | ready | training | done
    created_at          REAL NOT NULL,
    output_lora_path    TEXT,                       -- 训练完回填主产物
    note                TEXT,
    UNIQUE(project_id, label)
);
CREATE INDEX idx_versions_project ON versions(project_id);

CREATE TABLE project_jobs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version_id          INTEGER REFERENCES versions(id) ON DELETE CASCADE,
                        -- NULL = project 级（download）
                        -- 非 NULL = version 级（tag, reg_build）
    kind                TEXT NOT NULL,             -- download | tag | reg_build
    params              TEXT NOT NULL,             -- JSON 序列化的输入参数
    status              TEXT NOT NULL,             -- pending | running | done | failed | canceled
    started_at          REAL,
    finished_at         REAL,
    pid                 INTEGER,
    log_path            TEXT,                       -- studio_data/jobs/{job_id}.log
    error_msg           TEXT
);
CREATE INDEX idx_jobs_project ON project_jobs(project_id);
CREATE INDEX idx_jobs_status ON project_jobs(status);

-- 已有 tasks 表，PP1 扩字段
ALTER TABLE tasks ADD COLUMN project_id INTEGER REFERENCES projects(id);
ALTER TABLE tasks ADD COLUMN version_id INTEGER REFERENCES versions(id);
```

**Stage 推进规则**（前端只读，后端权威；写在 `studio/projects.py:advance_stage()` 里）：

| 当前 stage | 触发条件 | 下一个 stage |
|---|---|---|
| `created` | download job 启动 | `downloading` |
| `downloading` | download job 完成 | `curating` |
| `curating` | version 的 train/ 有图 | `tagging` (active version) |
| `tagging` | tag job 完成 | `regularizing`（如果用户跳过则进 `configured`） |
| `regularizing` | reg job 完成 / 用户跳过 | `configured` |
| `configured` | task 入队 | `training` |
| `training` | task done | `done` |

stage 只是「展示性」字段——前端 Stepper 高亮用，跳步骤不强制。

---

## 4. 全局服务配置 `studio_data/secrets.json`

```jsonc
{
  "gelbooru": {
    "user_id": "",
    "api_key": "",
    "save_tags": false,                   // 是否同时保存 booru 自带标签
    "convert_to_png": true,
    "remove_alpha_channel": false
  },
  "huggingface": {
    "token": ""                            // WD14 公开模型不强制；私有/限速时填
  },
  "joycaption": {
    "base_url": "http://localhost:8000/v1",
    "model": "fancyfeast/llama-joycaption-beta-one-hf-llava",
    "prompt_template": "Descriptive Caption"
  },
  "wd14": {
    "model_id": "SmilingWolf/wd-vit-tagger-v3",
    "local_dir": null,                    // null = models/wd14/{model_id}/
    "threshold_general": 0.35,
    "threshold_character": 0.85,
    "blacklist_tags": []
  }
}
```

### 服务端 `studio/secrets.py`

```python
class GelbooruConfig(BaseModel):
    user_id: str = ""
    api_key: str = ""
    save_tags: bool = False
    convert_to_png: bool = True
    remove_alpha_channel: bool = False

class HuggingFaceConfig(BaseModel):
    token: str = ""

class JoyCaptionConfig(BaseModel):
    base_url: str = "http://localhost:8000/v1"
    model: str = "fancyfeast/llama-joycaption-beta-one-hf-llava"
    prompt_template: str = "Descriptive Caption"

class WD14Config(BaseModel):
    model_id: str = "SmilingWolf/wd-vit-tagger-v3"
    local_dir: Optional[str] = None
    threshold_general: float = 0.35
    threshold_character: float = 0.85
    blacklist_tags: list[str] = []

class Secrets(BaseModel):
    gelbooru: GelbooruConfig = GelbooruConfig()
    huggingface: HuggingFaceConfig = HuggingFaceConfig()
    joycaption: JoyCaptionConfig = JoyCaptionConfig()
    wd14: WD14Config = WD14Config()

# 函数
def load() -> Secrets: ...
def save(s: Secrets) -> None: ...
def get(path: str) -> Any: ...           # "wd14.threshold_general"
def update(partial: dict) -> Secrets: ...# deep-merge 写回
```

### API

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/secrets` | 返回 Secrets，敏感字段（含 `token` `api_key`）显示为 `"***"` 字符串 |
| PUT | `/api/secrets` | body 是部分 dict，deep-merge 进现有；客户端发 `"***"` 表示「保持不变」 |

### 前端 Settings 页（PP0）

`/tools/settings` 路由。表单分四段（Gelbooru / HuggingFace / JoyCaption / WD14），密码字段用 `<input type="password">`。「测试连接」按钮：
- Gelbooru：拉一张 sample 图验证
- JoyCaption：调 `/v1/models` 验证
- WD14：检查模型文件是否存在 / 自动下载

---

## 5. Sidebar 与路由

```
┌──────────────────────┐
│  AnimaStudio  v0.2   │
├──────────────────────┤
│ ▶ 项目 (Projects)    │ /
│   队列 (Queue)       │ /queue
├──────────────────────┤
│   工具               │
│ ──────               │
│   预设 (Presets)     │ /tools/presets
│   监控 (Monitor)     │ /tools/monitor
│   设置 (Settings)    │ /tools/settings
└──────────────────────┘

进入项目后侧栏切换为 Stepper（仅当处于 /projects/:pid/* 下）：

┌──────────────────────┐
│ ← 返回项目列表        │
│ 项目: Cosmic Kaguya  │
│ 版本: [baseline ▾]   │ ← VersionTabs
├──────────────────────┤
│ ① 下载  ✓            │ /projects/:pid/download
│ ② 筛选  ✓            │ /projects/:pid/v/:vid/curate
│ ③ 打标  ●            │ /projects/:pid/v/:vid/tag        ← 当前
│ ④ 正则集 ○           │ /projects/:pid/v/:vid/reg
│ ⑤ 训练  ○            │ /projects/:pid/v/:vid/train
└──────────────────────┘
```

状态符号：✓ 完成 / ● 进行中 / ○ 未开始（按 stage 显示）。

---

## 6. SSE 事件目录

复用 `studio.event_bus.bus`，扩展事件类型：

| type | 字段 | 触发 |
|---|---|---|
| `task_state_changed` (已有) | `task_id`, `status`, `project_id?`, `version_id?` | 训练任务状态变 |
| `project_state_changed` | `project_id`, `stage` | 项目 stage 推进 |
| `version_state_changed` | `project_id`, `version_id`, `stage` | 版本 stage 推进 |
| `job_state_changed` | `job_id`, `project_id`, `version_id?`, `kind`, `status` | download / tag / reg_build job |
| `job_log_appended` | `job_id`, `text`, `seq` | worker 写日志 → 推增量到前端 |

`job_log_appended` 实现方案：worker 用 line-buffered 写 `studio_data/jobs/{id}.log`，supervisor 在轮询子进程时同时 tail 文件，新增字节通过 bus.publish 出去。也可以让 worker 直接通过 stdin/socket 推给 supervisor。最简实现：supervisor 维护 `tell()` 偏移，每秒 read 增量 publish。

---

## 7. Tagger 抽象

```python
# studio/services/tagger.py
class TagResult(TypedDict):
    image: Path
    tags: list[str]                       # 排序好的（按概率降）
    raw_scores: dict[str, float]          # 可选：每 tag 的概率

class Tagger(Protocol):
    name: str                              # "wd14" / "joycaption"
    requires_service: bool                 # WD14=False (本地)，JoyCaption=True (vLLM)

    def is_available(self) -> tuple[bool, str]:
        """返回 (是否可用, 状态描述)。前端调来显示绿/黄/红状态条。"""

    def prepare(self) -> None:
        """耗时初始化（如 WD14 加载 ONNX；JoyCaption 调 /models 验证）。
        worker 启动时调一次。"""

    def tag(
        self,
        image_paths: list[Path],
        on_progress: Callable[[int, int], None] = None,  # (done, total)
    ) -> Iterator[TagResult]:
        """流式返回，便于 worker 边 tag 边写文件 + 推送 SSE。"""
```

### `studio/services/wd14_tagger.py`

- 依赖：`onnxruntime`, `huggingface_hub`, `pandas`, `pillow`
- 模型解析顺序：
  1. `secrets.wd14.local_dir` 给了 → 必须有 `model.onnx` + `selected_tags.csv`
  2. `models/wd14/{model_id}/` 存在 → 用本地
  3. 否则 `huggingface_hub.snapshot_download(model_id, local_dir=models/wd14/{model_id}, token=secrets.huggingface.token or None)`
- 预处理：448×448 BGR；模型对应文档参考 SmilingWolf/wd-tagger
- 输出：按 `threshold_general` 阈值过滤 general tags，`threshold_character` 过滤 character tags，合并；应用 `blacklist_tags` 黑名单
- 写回：`<image>.txt`（逗号分隔）+ 可选 `<image>.json`（含 raw_scores）

### `studio/services/joycaption_tagger.py`

- 复用现有脚本逻辑（`C:\Users\Mei\Desktop\SD\danbooru\dev\joycaption_tagger.py`）
- HTTP POST 到 `secrets.joycaption.base_url + /chat/completions`
- 失败重试 3 次，timeout 60s
- 写回：`<image>.txt`（自然语言描述）

### UI 选择器（Tagging 页）

下拉框列出 `[ WD14 (本地) ✓ | JoyCaption (远程) ⚠ ]`，状态从 `is_available()` 来。参数表单按所选 tagger 切换。

---

## 8. Preset 池关系

```
                  ┌──── presets/ (全局池) ────┐
                  │  train_baseline.yaml      │
                  │  high-lr.yaml             │
                  │  proj_42_baseline.yaml    │  ← 项目推回的命名
                  └──────────────────────────┘
                         ↑               ↓
                   save_as_preset    from_preset
                         │               │
                  ┌──────┴───────────────┴────────┐
                  │  versions/baseline/           │
                  │    config_name = "..."        │
                  └──────────────────────────────┘
```

| 操作 | 流程 |
|---|---|
| 创建版本 | 用户选「从预设 fork」或「从空白开始」 |
| Fork preset | 复制 `presets/{name}.yaml` → 自动重命名为 `proj_{pid}_{label}.yaml` 写回 `presets/` → version.config_name 指向它 |
| 编辑 config | 走原 `/api/presets/{name}` PUT；version 共享所引用的 yaml |
| 推回预设 | `save_as_preset {target_name}` → 复制 yaml，**清空项目特定字段**：`data_dir` `reg_data_dir` `output_dir` `output_name` `resume_lora` `resume_state` |
| 切到另一预设 | `from_preset` 覆盖 version.config_name；旧的 `proj_*` 不删，可手动清理 |

「项目特定字段」清单要在 `studio/presets.py` 里定义为常量 `PROJECT_SPECIFIC_FIELDS`。

---

## 9. 复用现有积木

不要重写，直接用：

| 组件 | 路径 | 复用方式 |
|---|---|---|
| `TrainingConfig` schema | `studio/schema.py` | 不动；presets 仍是它的实例化 |
| Configs CRUD | `studio/configs_io.py` | 改名 `presets_io.py`（PP0），逻辑不变 |
| Argparse bridge | `studio/argparse_bridge.py` | 不动 |
| Task DB + DAO | `studio/db.py` | 扩 versions / project_jobs 表，DAO 复用模式 |
| Supervisor | `studio/supervisor.py` | 扩展，能调度 project_jobs（不只是 tasks） |
| Event bus | `studio/event_bus.py` | 不动 |
| ProcGroup launcher | `studio/cli.py` | 不动；project worker 也跑得起 |
| SchemaForm | `studio/web/src/components/SchemaForm.tsx` | Train 页直接复用 |
| ImageGrid 雏形 | `studio/web/src/pages/Datasets.tsx` 缩略图 | 抽出 `components/ImageGrid.tsx` 通用化 |
| PathPicker | `studio/web/src/components/PathPicker.tsx` | Settings 页用 |
| Toast | `studio/web/src/components/Toast.tsx` | 全局复用 |
| useEventStream | `studio/web/src/lib/useEventStream.ts` | 全局复用，区分事件 type 即可 |

---

## 10. 测试策略

| 类型 | 工具 | 范围 |
|---|---|---|
| 后端单元 | pytest | `projects.py` `versions.py` `project_jobs` `services/*` `secrets.py` |
| 后端集成 | pytest + TestClient | 每个 PP 的端点全覆盖（200/4xx 路径） |
| 后端进程 | pytest + 假 cmd_builder | supervisor 调度 project_jobs（参考现有 test_supervisor.py 模式） |
| 前端单元 | Vitest | 纯函数 lib/* |
| 前端组件 | Vitest + RTL | 关键交互组件（ImageGrid 多选、TagEditor、Stepper） |
| 端到端 | 手测剧本 | 每个 PP 文档末尾给出，用真实 Gelbooru / WD14 走通 |

每个 PP 完成后跑：

```bash
python -m studio test    # pytest + vitest
```

---

## 11. 开放风险（持续跟踪）

| 风险 | 应对 |
|---|---|
| Gelbooru / HF 网络不稳 | 全异步化进 project_jobs，UI 看进度，失败可重试；可选「使用代理」字段 |
| WD14 模型大（~400 MB） | 首次下载有进度提示；放 `models/wd14/{model_id}/`，可被 PathPicker 看到便于手放 |
| JoyCaption 服务地址变了 | 每次 tagging 启动前调 `is_available()`，失败时给「检查配置」按钮跳到 Settings |
| 用户手动改磁盘 | 每次进 step 重扫，以磁盘为准 |
| 项目目录搬迁（重命名 slug） | 不允许 slug 改；title 可改，slug 一旦确定写死 |
| 版本删除时 train 还引用 download | 软删 version 移到 `_trash`；download 不动；恢复用 `mv` |
| Studio 升级数据库 | `studio/migrations/` 加 SQL 脚本，启动时按 `PRAGMA user_version` 顺序应用 |
