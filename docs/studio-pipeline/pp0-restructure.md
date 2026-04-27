# PP0 — Sidebar 重构 + Presets 改名 + Settings 页

**状态**：计划中
**前置依赖**：当前 master（含 P1-P5 全部已落地）
**预估工作量**：1-1.5 工作日

## 目标

- 把现有 `Configs` 重命名为 `Presets`（语义对齐 pipeline 设计）
- Sidebar 改造：项目 / 队列 同顶级；预设 / 监控 / 设置 在工具组
- 删除现有 `Datasets` 页面（PP3 之后由 Curation 页替代）
- 新增 `Settings` 页：编辑 `studio_data/secrets.json`
- 保留所有现有功能（Configs API 别名向后兼容一段时间）

不在本 PP 范围：Project / Version 数据模型（PP1）。

## 后端改动

### A. `studio_data/configs/` → `studio_data/presets/` 迁移

`studio/paths.py` 增加：

```python
USER_PRESETS_DIR = STUDIO_DATA / "presets"

def migrate_configs_to_presets() -> None:
    old = STUDIO_DATA / "configs"
    if old.exists() and not USER_PRESETS_DIR.exists():
        old.rename(USER_PRESETS_DIR)
        # 留空 configs/ 软链或目录，避免外部脚本破裂（仅 Win 下 mklink 需要管理员，跳过软链）
```

`ensure_dirs()` 启动时调用一次。

### B. 改名 `configs_io.py` → `presets_io.py`

文件内部把变量、函数从 `*config*` 改成 `*preset*`：

```python
# studio/presets_io.py（原 configs_io.py 重命名 + 改字眼）
USER_PRESETS_DIR = ...                  # 替换 USER_CONFIGS_DIR
def list_presets(base=None) -> list[dict]: ...
def read_preset(name: str, base=None) -> dict: ...
def write_preset(name: str, data: dict, base=None) -> Path: ...
def delete_preset(name: str, base=None) -> None: ...
def duplicate_preset(src: str, dst: str, base=None) -> Path: ...
class PresetError(Exception): ...
```

为兼容 `anima_train.py` 等老引用，保留 `configs_io.py` 作为薄壳：

```python
# studio/configs_io.py (兼容层；下个版本删)
import warnings
from .presets_io import (
    list_presets as list_configs,
    read_preset as read_config,
    write_preset as write_config,
    delete_preset as delete_config,
    duplicate_preset as duplicate_config,
    PresetError as ConfigError,
)
warnings.warn("studio.configs_io is deprecated, use studio.presets_io", DeprecationWarning)
```

### C. `secrets.py`

按 `overview.md §4` 实现：

```python
# studio/secrets.py
from pathlib import Path
from pydantic import BaseModel
from .paths import STUDIO_DATA

SECRETS_FILE = STUDIO_DATA / "secrets.json"
MASK = "***"
SENSITIVE_FIELDS = {"gelbooru.api_key", "huggingface.token"}  # GET 时掩码

class GelbooruConfig(BaseModel):
    user_id: str = ""
    api_key: str = ""
    save_tags: bool = False
    convert_to_png: bool = True
    remove_alpha_channel: bool = False

# ... HuggingFaceConfig / JoyCaptionConfig / WD14Config ...

class Secrets(BaseModel):
    gelbooru: GelbooruConfig = GelbooruConfig()
    huggingface: HuggingFaceConfig = HuggingFaceConfig()
    joycaption: JoyCaptionConfig = JoyCaptionConfig()
    wd14: WD14Config = WD14Config()

def load() -> Secrets:
    if not SECRETS_FILE.exists():
        return Secrets()
    return Secrets.model_validate_json(SECRETS_FILE.read_text(encoding="utf-8"))

def save(s: Secrets) -> None:
    SECRETS_FILE.write_text(s.model_dump_json(indent=2), encoding="utf-8")

def get(path: str) -> Any:
    """点路径访问：'wd14.threshold_general'"""
    cur: Any = load()
    for seg in path.split("."):
        cur = getattr(cur, seg)
    return cur

def update(partial: dict) -> Secrets:
    """deep-merge partial 进当前；返回更新后的 Secrets。
    收到的 '***' 表示「保持原值不变」。"""
    current = load()
    merged = _deep_merge(current.model_dump(), partial, preserve_mask=True, original=current.model_dump())
    new = Secrets.model_validate(merged)
    save(new)
    return new

def to_masked_dict(s: Secrets) -> dict:
    """GET /api/secrets 返回此结构。"""
    d = s.model_dump()
    for path in SENSITIVE_FIELDS:
        segs = path.split(".")
        cur = d
        for seg in segs[:-1]:
            cur = cur[seg]
        if cur[segs[-1]]:
            cur[segs[-1]] = MASK
    return d
```

### D. `server.py` 端点改动

```python
# 新增
@app.get("/api/secrets")
def get_secrets() -> dict[str, Any]:
    return secrets.to_masked_dict(secrets.load())

@app.put("/api/secrets")
def put_secrets(body: dict[str, Any]) -> dict[str, Any]:
    new = secrets.update(body)
    return secrets.to_masked_dict(new)

# 改名（保留旧端点 deprecated 转发）
@app.get("/api/presets")
@app.get("/api/presets/{name}")
@app.put("/api/presets/{name}")
@app.delete("/api/presets/{name}")
@app.post("/api/presets/{name}/duplicate")
# ... 实现同原 /api/configs/* ...

# 旧端点：保留并做 308 redirect
@app.api_route("/api/configs", methods=["GET", "POST"])
@app.api_route("/api/configs/{rest:path}", methods=["GET", "PUT", "DELETE", "POST"])
def _configs_redirect(rest: str = ""):
    return RedirectResponse(f"/api/presets/{rest}", status_code=308)
```

### E. anima_train.py / studio.cli.py 引用

- `anima_train.py` 仍 `from studio.configs_io import ...` → 透过兼容层不动
- 文档里把 `studio_data/configs/` 全替换成 `studio_data/presets/`

## 前端改动

### 路由调整

```tsx
// App.tsx
<Routes>
  <Route path="/" element={<Projects />} />              {/* 占位：本 PP 仅放空白页 */}
  <Route path="/queue" element={<QueuePage />} />
  <Route path="/queue/:id/log" element={<LogPage />} />
  <Route path="/tools/presets" element={<PresetsPage />} />
  <Route path="/tools/monitor" element={<MonitorPage />} />
  <Route path="/tools/settings" element={<SettingsPage />} />
</Routes>
```

旧路由 308 重定向（前端用 `<Navigate>`）：

```tsx
<Route path="/configs" element={<Navigate to="/tools/presets" replace />} />
<Route path="/datasets" element={<Navigate to="/" replace />} />
<Route path="/monitor" element={<Navigate to="/tools/monitor" replace />} />
```

### 文件操作

- 重命名：
  - `pages/Configs.tsx` → `pages/tools/Presets.tsx`
  - `pages/Monitor.tsx` → `pages/tools/Monitor.tsx`
- 新增：
  - `pages/Projects.tsx` → 占位「Coming in PP1」
  - `pages/tools/Settings.tsx` → secrets 表单（详见下）
- 删除：
  - `pages/Datasets.tsx`
- 更新：
  - `components/Sidebar.tsx` 改链接结构
  - `App.tsx` 路由表

### `Sidebar.tsx`

```tsx
const main: Link[] = [
  { to: '/', label: '项目', icon: '📁' },
  { to: '/queue', label: '队列', icon: '🚦' },
]
const tools: Link[] = [
  { to: '/tools/presets', label: '预设', icon: '🎚' },
  { to: '/tools/monitor', label: '监控', icon: '📊' },
  { to: '/tools/settings', label: '设置', icon: '⚙️' },
]
```

侧栏分两段，中间细分隔线 + 「工具」小标题。

### `Settings.tsx` 表单（最小可用）

```tsx
// 4 个 fieldset：Gelbooru / HuggingFace / JoyCaption / WD14
// 文本框 + 密码框（type=password）
// 字段对应 Secrets 结构
// 保存按钮 → PUT /api/secrets
// 「测试连接」按钮（可选，留作 polish）

interface FormState {
  gelbooru: { user_id: string; api_key: string; ... }
  huggingface: { token: string }
  joycaption: { base_url: string; model: string; prompt_template: string }
  wd14: { model_id: string; local_dir: string | null; threshold_general: number; threshold_character: number; blacklist_tags: string[] }
}
// 收到 '***' 字段，placeholder 显示 「已保存（不显示）」，输入新值才覆盖
```

### API client (`api/client.ts`)

```tsx
api.getSecrets()             → GET /api/secrets
api.updateSecrets(partial)   → PUT /api/secrets

api.listPresets()            → 调 /api/presets
api.getPreset(name)
api.savePreset(name, data)
api.deletePreset(name)
api.duplicatePreset(src, dst)
// 老 listConfigs 等改成调 listPresets，保留 alias 不破坏 PresetsPage / Train.tsx 引用
```

`Presets.tsx` 内部所有「config」字眼也改为「preset」（UI 文案）。

## 测试

### 后端 pytest 新增

- `tests/test_secrets.py`：
  - `Secrets()` 默认值正确
  - `update()` deep-merge，`"***"` 保持原值
  - `to_masked_dict()` 把敏感字段替换
  - `GET/PUT /api/secrets` 端到端
- `tests/test_presets_io.py`：拷贝原 `test_studio_configs.py`，全文 sed `config` → `preset`，确认仍过
- `tests/test_compat_alias.py`：旧 `studio.configs_io.read_config` 仍可调用，发 DeprecationWarning

### 前端 Vitest

- `Sidebar.test.tsx`：渲染后包含 5 个链接，点击触发路由
- `Settings.test.tsx`：填表 + 保存 → 调用了正确的 API

### 手测剧本

1. `python -m studio dev` 启动
2. 浏览器开 `/studio/`
3. 点「项目」看到占位页
4. 点「队列」看到原队列功能正常（含已有任务）
5. 点「预设」看到原 Configs 列表（数据没丢）
6. 点「设置」填入 `gelbooru.user_id` `gelbooru.api_key`，保存
7. 退出重启，再开「设置」看到字段被掩码为「已保存」
8. 浏览器访问 `/configs` 自动跳到 `/tools/presets`（兼容）
9. `studio_data/configs/` 不存在了，`studio_data/presets/` 有 yaml；`studio_data/secrets.json` 有内容（API key 实际值）

## 风险与开放问题

| 风险 | 应对 |
|---|---|
| 用户已有 `studio_data/configs/` 包含一些 yaml | 启动时一次性 rename，原地迁移，不会丢 |
| 老 anima_train.py / 用户脚本引用 `studio.configs_io` | 兼容层保留至少一个 minor 版本 |
| 用户在多设备同步 | git-ignore 已含 `studio_data/`，不会同步 |

无外部依赖；不需要新加 Python / Node 包。

## 出口标准

- [ ] 所有 PP0 文件改完
- [ ] pytest 全过（含新测）
- [ ] 手测剧本走完
- [ ] 提交后 plan 文档同步更新「PP0 已完成」
