# PP6 — 训练配置 + 入队

**状态**：✅ 已完成（PP6.1 / PP6.2 / PP6.3 全部合）
**前置依赖**：PP5
**收尾环节**：流水线最后一步，把 version 的所有产物绑成一个训练任务

## 切片

| 子片 | 状态 | 范围 |
|---|---|---|
| PP6.1 | ✅ 8578fa4 | per-task monitor — 删 HTTP server，state 文件路径 per-version；Queue 行 +「📊 监控」按钮；`/api/state?task_id=` |
| PP6.2 | ✅ ac4ac6a | Preset 双向流 — `services/version_config.py` 私有 config + `services/presets.py` fork/save_as + 4 个端点；项目特定字段服务端强制覆盖 |
| PP6.3 | ✅（commit 待打）| Train 页 UI + 入队端点 (`POST /versions/{vid}/queue`) + db v4 (`tasks.config_path`) + supervisor 优先用 config_path + Stepper ⑥ 派生 done + 完成回填 `version.output_lora_path` + Queue 行「来源」列 |

## 目标

- Version ↔ Preset 双向流（fork from preset / save as preset）
- Train 页：选预设 → 编辑 config（项目特定字段自动填）→ 入队
- 入队的 task 带 `project_id` + `version_id`
- monitor_state.json 写到 `versions/{label}/`，per-version 独立
- Queue 任务行链回 project / version
- Stage 推进：configured → training → done

不在范围：训练中实时调参（不支持，一旦入队就锁定 config 副本）。

## 关键约定

- 「项目特定字段」常量（来自 `overview.md §8`）：
  ```python
  PROJECT_SPECIFIC_FIELDS = {
      "data_dir", "reg_data_dir", "output_dir",
      "output_name", "resume_lora", "resume_state",
  }
  ```
- Fork preset 时这几个字段从 preset 复制后**立即用项目数据覆盖**：
  - `data_dir = versions/{label}/train/`
  - `reg_data_dir = versions/{label}/reg/` (如果 reg 存在)
  - `output_dir = versions/{label}/output/`
  - `output_name = {project_slug}_{label}` (如 `cosmic_kaguya_baseline`)
  - `resume_lora = ""` `resume_state = ""`（除非用户显式接续训练）
- 推回 preset 时清空这几个字段为默认值
- 一个 version 同时只能有一个 active task（pending 或 running）；想再训练得新建 version 或等老的完成

## 后端

### A. `studio/presets.py`（新增模块）

```python
from copy import deepcopy
from typing import Any

from . import presets_io

PROJECT_SPECIFIC_FIELDS = {
    "data_dir", "reg_data_dir", "output_dir",
    "output_name", "resume_lora", "resume_state",
}

def fork_for_version(
    src_preset_name: str,
    target_preset_name: str,
    overrides: dict[str, Any],
) -> dict:
    """
    1. 读 src preset
    2. 应用 overrides（强制覆盖项目特定字段）
    3. 写回新 preset 名 target_preset_name
    返回新 preset dict。
    """
    src = presets_io.read_preset(src_preset_name)
    new_data = deepcopy(src)
    for k, v in overrides.items():
        new_data[k] = v
    presets_io.write_preset(target_preset_name, new_data)
    return new_data

def save_as_preset(
    src_preset_name: str,
    target_name: str,
) -> dict:
    """
    1. 读 src（version 当前用的 preset）
    2. 项目特定字段清回默认值
    3. 写回 target_name
    """
    src = presets_io.read_preset(src_preset_name)
    cleaned = deepcopy(src)
    defaults = TrainingConfig().model_dump()
    for f in PROJECT_SPECIFIC_FIELDS:
        cleaned[f] = defaults.get(f)
    presets_io.write_preset(target_name, cleaned)
    return cleaned
```

### B. `studio/projects.py` 增加 helper

```python
def compute_project_overrides(project_id: int, version_id: int) -> dict:
    """根据 project + version 算出项目特定字段的值。"""
    p = get_project(...)
    v = get_version(...)
    pdir = project_dir(p["id"], p["slug"])
    vdir = version_dir(p["id"], p["slug"], v["label"])
    overrides = {
        "data_dir": str(vdir / "train"),
        "reg_data_dir": str(vdir / "reg") if (vdir / "reg").exists() else "",
        "output_dir": str(vdir / "output"),
        "output_name": f"{p['slug']}_{v['label']}",
    }
    return overrides
```

### C. 端点

```python
class FromPresetRequest(BaseModel):
    name: str

class SaveAsPresetRequest(BaseModel):
    name: str

@app.post("/api/projects/{pid}/versions/{vid}/config/from_preset")
def fork_preset(pid, vid, body: FromPresetRequest):
    """
    1. 校验 preset 存在
    2. 计算 overrides
    3. 创建新 preset 名: f"proj_{pid}_{version.label}"
    4. fork_for_version → 写新 preset
    5. version.config_name = 新 preset 名
    返回新 preset 内容 + version 更新。
    """

@app.post("/api/projects/{pid}/versions/{vid}/config/save_as_preset")
def to_preset(pid, vid, body: SaveAsPresetRequest):
    """把 version 当前 config 推回 presets/{body.name}。"""

@app.get("/api/projects/{pid}/versions/{vid}/config")
def get_version_config(pid, vid):
    """返回 version.config_name 对应的 preset 内容（即 yaml 解析后的 dict）。"""

@app.put("/api/projects/{pid}/versions/{vid}/config")
def put_version_config(pid, vid, body: dict):
    """直接编辑 version 关联的 preset。"""
    # 同 PUT /api/presets/{config_name}，但禁止改项目特定字段（自动从 project 算）
```

### D. 入队端点

```python
@app.post("/api/projects/{pid}/versions/{vid}/queue")
def enqueue_version(pid, vid):
    """
    1. 校验 version.config_name 已设
    2. 校验该 version 没在跑（无 pending/running task）
    3. 创建 task：name=project_slug+label，config_name=version.config_name，
       project_id=pid，version_id=vid
    4. version.stage → training（task 启动后由 supervisor 推到 training，结束后到 done）
    5. project.stage → training
    """
```

### E. supervisor 改动

训练 worker 启动时增加：
- `--monitor-state-file versions/{label}/monitor_state.json`
- 推送 `task_state_changed` 事件时携带 `project_id` + `version_id`
- 完成（status=done）时回填 `version.output_lora_path` = output/lora_final.safetensors

monitor 端点改动：

```python
@app.get("/api/state")
def get_state(project_id: Optional[int] = None, version_id: Optional[int] = None,
              task_id: Optional[int] = None):
    """
    优先级：task_id > (project_id, version_id) > 默认（当前在跑的）。
    显式给 ids：读对应 version 的状态。
    都没找到：返回空状态。
    """
```

`Monitor.tsx` 工具页加个下拉选 project + version（缺省 = 当前在跑的）。

### E.1 监控持久化 + Queue 行嵌监控（**用户要求**）

**问题**：当前 `monitor_data/state.json` 是全局单文件，每个训练任务启动时
覆盖写。任务一换，旧 loss/lr 曲线就丢，已 done/failed 的历史任务无法回看
训练曲线。

**目标**：
1. 每个训练任务（task）写**自己的** monitor 状态，跑完保留，可回看。
2. Queue 页每行任务可以点开看「那个任务」的 monitor 曲线，无论 status。
3. `/tools/monitor` 工具页改为：默认锁定当前 running 的 task；没有则显示
   最近一次完成的；提供下拉切到任意历史任务。

**落地方式**：本 PP（PP6）已经把 `monitor_state.json` 拆到
`versions/{label}/`，所以「per-version 持久化」自然带过来 —— 等价于
「per-task 持久化」（一个 version 同时只能有一个 active task）。在 PP6
完成时同时实现：

- `tasks` 表加 `monitor_state_path TEXT`（任务结束时定位 state 文件）。
  （PP1 已加 `version_id`；从 version 即可推 path，但 task 级 column
  让查询更直接，且兼容历史「无 version_id」的旧任务。）
- supervisor 启动 worker 时：
  - 有 `version_id` → `--monitor-state-file versions/{label}/monitor_state.json`
  - 无 `version_id`（兼容老任务路径）→
    `--monitor-state-file studio_data/monitors/task_{id}/state.json`
  - 写 `tasks.monitor_state_path` 入 db
- samples 也按任务隔离：`versions/{label}/samples/` 或
  `studio_data/monitors/task_{id}/samples/`（PP6 已规划进 version dir）
- Queue 页加「监控」按钮：跳 `/queue/:id/monitor`，嵌 monitor HTML +
  `?task_id={id}` query → monitor 页向 `/api/state?task_id={id}` 拉 state
- `/api/state` 加 `task_id` query 优先级最高
- 全局 `monitor_data/state.json` **保留兼容**：无 `--monitor-state-file`
  参数时仍写它（旧脚本 / 用户手动跑 `anima_train.py` 时仍可见）

**前端改动**：
- `pages/Queue.tsx`：每行加「📊 监控」按钮（已结束任务也能点）
- `pages/QueueMonitor.tsx`（新）：iframe + `?task_id=...`
- `pages/tools/Monitor.tsx`：加任务下拉（拉 `/api/queue` 列表，按
  `started_at` desc），缺省锁定 running 的；切换时改 iframe `src`
- `monitor_smooth.html`：从 `URLSearchParams` 读 `task_id`，传给所有
  `/api/state` 与 `/samples/*` 调用

**测试**：
- supervisor: `--monitor-state-file` 路径正确 + db 回填
- `/api/state?task_id=X` 端到端
- Queue 行点监控跳转

写在 PP6 一起做，不单独开 PR。

### F. 删除 Preset 时的反向引用

某 version 关联的 preset 不能直接删（保护性）。`DELETE /api/presets/{name}` 应先查：

```python
in_use = conn.execute(
    "SELECT count(*) FROM versions WHERE config_name=?", (name,)
).fetchone()[0]
if in_use > 0:
    raise HTTPException(409, f"preset 被 {in_use} 个版本引用")
```

## 前端

### A. `pages/Project/steps/Train.tsx`

布局：

```
┌────────────────────────────────────────────┐
│ 训练配置                                     │
│                                            │
│ 当前预设: [proj_42_baseline ▾]               │
│   [换一个预设] [保存为新预设...] [打开 Presets]│
│                                            │
│ ─ 配置编辑（来自 preset 的字段）─               │
│ <SchemaForm values={config} ... />          │
│ （项目特定字段 disabled，显示自动填的值）       │
│                                            │
│ ─ 入队 ─                                     │
│ [开始训练]    队列状态: 0 等待，0 运行中        │
└────────────────────────────────────────────┘
```

```tsx
function TrainPage() {
  const { pid, vid } = useParams()
  const [version, setVersion] = useState<Version>()
  const [presets, setPresets] = useState<PresetSummary[]>([])
  const [config, setConfig] = useState<ConfigData>()
  const [schema, setSchema] = useState<SchemaResponse>()

  // 流程：
  //   - 进页：拉 version + version 关联的 config（如 config_name 为 null，提示「先选预设」）
  //   - 选预设 → POST .../config/from_preset → 拉新 config
  //   - 编辑 → PUT 保存
  //   - 入队 → POST .../queue → toast 成功，跳到 /queue 页

  return (
    <>
      <PresetPicker presets={presets} value={version?.config_name} onChange={...} />
      <SchemaForm
        schema={schema}
        values={config}
        onChange={setConfig}
        disabledFields={PROJECT_SPECIFIC_FIELDS}
      />
      <button onClick={save}>保存配置</button>
      <button onClick={enqueue} disabled={!version?.config_name}>开始训练</button>
    </>
  )
}
```

`SchemaForm` (PP2-C 已实现) 加 `disabledFields` prop 把项目特定字段置灰。

### B. Queue 行 + Project 反向链

`pages/Queue.tsx` 表格里加一列「来源」：

```tsx
{task.project_id && task.version_id && (
  <Link to={`/projects/${task.project_id}/v/${task.version_id}/train`}>
    项目 #{task.project_id} / {versionLabel}
  </Link>
)}
```

### C. Monitor 工具页加 version 选择

```tsx
function MonitorPage() {
  const [projectId, setProjectId] = useState<number|null>(null)
  const [versionId, setVersionId] = useState<number|null>(null)
  // 缺省自动锁定当前 running task 的 version
}
```

iframe URL 拼接 query：`/?project_id=...&version_id=...`，老 monitor HTML 读这两个 query 决定调哪个 state.json。

### D. API client

```tsx
api.forkPreset(pid, vid, { name })
api.saveAsPreset(pid, vid, { name })
api.getVersionConfig(pid, vid)
api.putVersionConfig(pid, vid, data)
api.enqueueVersion(pid, vid)
```

## 测试

### 后端 pytest

- `tests/test_presets_fork.py`：
  - `fork_for_version` overrides 强制覆盖
  - `save_as_preset` 清掉项目特定字段
  - 项目特定字段常量与 schema 字段一致（防漂移）
- `tests/test_train_endpoints.py`：
  - from_preset → version.config_name 设上
  - save_as_preset → preset 池新出现
  - enqueue_version → tasks 表插入 + 携带 project_id/version_id
  - 重复 enqueue 同 version：第二次 409
  - 删 preset 被引用 → 409
- `tests/test_monitor_per_version.py`：训练 worker 写 versions/{label}/monitor_state.json，端点正确读

### 前端 Vitest

- `Train.test.tsx`：
  - 缺 config_name 时 enqueue 按钮禁用
  - 切换预设触发 from_preset
  - SchemaForm 项目特定字段 readonly

### 手测剧本（接 PP5）

1. 项目 A → v1 baseline → 「⑤ 训练」
2. 当前预设：未设。点「换一个预设」→ 弹出 preset 列表，选 `train_baseline`
3. 后端 fork → 命名 `proj_42_baseline` → 表单展示，data_dir 自动填到 `versions/baseline/train`，灰显
4. 编辑 lora_rank=64 → 保存
5. 点「开始训练」→ 跳到 /queue
6. Queue 里看到新任务，状态 pending → running，「来源」列点进去回到 Train 页
7. 训练中切到工具 → 监控，下拉锁定到该 project/version，看到 loss 曲线（来自 versions/baseline/monitor_state.json）
8. 训练完 → version.stage = done，project.stage = done
9. version.output_lora_path 指向 `versions/baseline/output/lora_final.safetensors`
10. 在 v1 上点「保存为新预设」→ 命名 `my-tuned`，preset 池里出现 `my-tuned.yaml`，data_dir 等字段已清空
11. 新建 v2 → 从 `my-tuned` fork → data_dir 自动指向 `versions/v2-label/train`
12. v2 的 train 还没准备好，stepper 该步「未就绪」提示

## 风险

| 风险 | 应对 |
|---|---|
| 用户改了项目特定字段（绕过前端 disabled） | server.py 的 PUT preset 端点对**当前被 version 引用的**预设强制覆盖项目特定字段 |
| version 关联的 preset 被删 | 反向引用检查，409 拒绝 |
| 旧 monitor_state.json (P1 的全局位置 monitor_data/state.json) | 保留兼容：当 query 没给 ids 时降级读全局；新训练总是写到 version 路径 |
| 多 version 并发训练 | supervisor 仍单进程串行，无问题；UI 提示「上一个 version 在跑，本任务排队」 |
| 训练中删项目 | supervisor.cancel(task) → version.stage 回到 ready；项目软删 |
| output_lora_path 多个文件（step 中间产物） | output_lora_path 只指向 `*_final.safetensors`；中间产物在 output/ 自然展示 |

## 出口标准（PP6 完成 = AnimaStudio Pipeline 全链路上线）

- [ ] PP1-PP6 全部 PR 合入 master
- [ ] 全部 pytest + vitest 通过
- [ ] 文档「PP{n} 已完成」更新
- [ ] README_STUDIO 里加完整流程截图（可选）
- [ ] 一个真实 LoRA 项目从建项到拿到 .safetensors 完整跑通
