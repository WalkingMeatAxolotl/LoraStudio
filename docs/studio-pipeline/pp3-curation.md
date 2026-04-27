# PP3 — Curation 双面板（download / train）

**状态**：已完成
**前置依赖**：PP2
**预估工作量**：2 工作日

## 目标

- 实现 download / train 双面板筛选 UI
- 后端：列文件、复制、移除、子文件夹管理
- 前端：通用 ImageGrid 组件（多选 + 大图预览 + 缩略图）
- 文件名做差集：左侧 `download − train`，右侧 train 按子文件夹分组

不在范围：打标（PP4）、跨版本对比（暂不支持）。

## 关键约定

- `download/` 永远全量；前端展示时减去 train 已用文件名
- 「→ 复制到 train」：从 download 复制到 `versions/{label}/train/{folder}/`，**保留备份**
- 「← 从 train 移除」：仅删 train 里的副本；download 文件不动
- 比对依据：纯文件名（不含路径）。同名 `12345.png` 必然来自同一来源
- 子文件夹遵守 Kohya 风格 `N_xxx`（PP1 的 `dataset.parse_repeat` 已在 P4 用过）

## 后端

### A. `studio/curation.py`

```python
from pathlib import Path
from typing import Iterable

from . import db, projects, versions
from .paths import IMAGE_EXTS  # 从 datasets.py 导出


def list_download(project_id: int, slug: str) -> list[str]:
    """返回 download/ 下所有图片文件名（不含路径）。"""
    d = projects.project_dir(project_id, slug) / "download"
    if not d.exists():
        return []
    return sorted(p.name for p in d.iterdir()
                  if p.suffix.lower() in IMAGE_EXTS)


def list_train(project_id: int, slug: str, version_label: str) -> dict[str, list[str]]:
    """返回 {folder_name: [filename, ...]}。"""
    vdir = versions.version_dir(project_id, slug, version_label)
    train = vdir / "train"
    if not train.exists():
        return {}
    out: dict[str, list[str]] = {}
    for sub in sorted(train.iterdir()):
        if sub.is_dir():
            out[sub.name] = sorted(p.name for p in sub.iterdir()
                                   if p.suffix.lower() in IMAGE_EXTS)
    return out


def curation_view(project_id: int, slug: str, version_label: str) -> dict:
    """前端用：left = download − train，right = train 按文件夹分组。"""
    download = list_download(project_id, slug)
    train = list_train(project_id, slug, version_label)
    used = set()
    for files in train.values():
        used.update(files)
    return {
        "left": [f for f in download if f not in used],
        "right": train,
        "download_total": len(download),
        "train_total": sum(len(v) for v in train.values()),
    }


def copy_to_train(
    project_id: int, slug: str, version_label: str,
    files: list[str], dest_folder: str,
) -> dict:
    """把 download 里的文件复制到 train/{dest_folder}/，已存在则跳过。
    同时复制 .json / .txt 同名 metadata（如果存在）。"""
    src_dir = projects.project_dir(project_id, slug) / "download"
    dst_dir = versions.version_dir(project_id, slug, version_label) / "train" / dest_folder
    dst_dir.mkdir(parents=True, exist_ok=True)

    copied: list[str] = []
    skipped: list[str] = []
    missing: list[str] = []
    for name in files:
        s = src_dir / name
        if not s.exists():
            missing.append(name)
            continue
        d = dst_dir / name
        if d.exists():
            skipped.append(name)
            continue
        # 复制图片 + 同名 metadata
        d.write_bytes(s.read_bytes())
        for ext in (".json", ".txt"):
            sm = s.with_suffix(ext)
            if sm.exists():
                (dst_dir / sm.name).write_bytes(sm.read_bytes())
        copied.append(name)
    return {"copied": copied, "skipped": skipped, "missing": missing}


def remove_from_train(
    project_id: int, slug: str, version_label: str,
    folder: str, files: list[str],
) -> dict:
    """从 train/{folder}/ 删除文件（含同名 metadata）；download 不动。"""
    dst = versions.version_dir(project_id, slug, version_label) / "train" / folder
    removed, missing = [], []
    for name in files:
        p = dst / name
        if not p.exists():
            missing.append(name)
            continue
        p.unlink()
        for ext in (".json", ".txt"):
            mp = p.with_suffix(ext)
            if mp.exists():
                mp.unlink()
        removed.append(name)
    return {"removed": removed, "missing": missing}


def create_folder(project_id, slug, version_label, name: str) -> Path:
    """创建子文件夹，校验 Kohya 命名（N_xxx 或纯名）。"""
    if not _valid_folder_name(name):
        raise CurationError(...)
    train = versions.version_dir(project_id, slug, version_label) / "train"
    p = train / name
    p.mkdir(parents=True, exist_ok=False)
    return p


def rename_folder(...) -> Path: ...
def delete_folder(...) -> None:
    """整个子文件夹连同里面的 train 副本一起删；download 不动。"""


_FOLDER_PATTERN = re.compile(r"^([0-9]+_)?[A-Za-z0-9_-]+$")
def _valid_folder_name(name: str) -> bool:
    return bool(_FOLDER_PATTERN.match(name))
```

### B. 缩略图端点

```python
@app.get("/api/projects/{pid}/thumb")
def project_thumb(pid: int, bucket: str, name: str):
    """bucket: download。"""
    # 校验名字 + bucket
    # 返回 FileResponse
    # 可选：缩略图缓存到 .thumb_cache/，PIL.thumbnail 256x256，第一次稍慢

@app.get("/api/projects/{pid}/versions/{vid}/thumb")
def version_thumb(pid: int, vid: int, bucket: str, name: str, folder: str = ""):
    """bucket: train | reg | samples。train/reg 必须给 folder。"""
```

为减少首次扫描压力，缩略图缓存推到 `studio_data/thumb_cache/`，PIL `thumbnail((256, 256))` 并 JPG 保存。文件名做 hash 即可。可放 polish 阶段做。

### C. 端点

```python
@app.get("/api/projects/{pid}/versions/{vid}/curation")
def get_curation(pid: int, vid: int) -> dict:
    return curation.curation_view(...)

class CopyRequest(BaseModel):
    files: list[str]
    dest_folder: str

@app.post("/api/projects/{pid}/versions/{vid}/curation/copy")
def copy(pid, vid, body: CopyRequest):
    return curation.copy_to_train(..., body.files, body.dest_folder)

class RemoveRequest(BaseModel):
    folder: str
    files: list[str]

@app.post("/api/projects/{pid}/versions/{vid}/curation/remove")
def remove(pid, vid, body: RemoveRequest):
    return curation.remove_from_train(...)

class FolderOp(BaseModel):
    op: Literal["create", "rename", "delete"]
    name: str
    new_name: Optional[str] = None      # rename 用

@app.post("/api/projects/{pid}/versions/{vid}/curation/folder")
def folder_op(pid, vid, body: FolderOp): ...
```

每次 copy / remove 后推送 `version_state_changed`（stage 可能从 curating 推进；当前不强制，PP6 可以收尾）。

## 前端

### A. `pages/Project/steps/Curation.tsx`

布局：

```
┌────────────────────────────────┬─────────────────────────────────┐
│ Download 全量 (50 张, 36 未用) │ Train (14 张, 1 个文件夹)        │
│ [全选] [+ 新建文件夹]           │ [+ 新建子文件夹]                  │
│ [→ 复制到 train ▾]              │ [← 从 train 移除]                 │
│                                │                                  │
│ ┌──┐┌──┐┌──┐┌──┐               │ 📁 5_concept (14)                │
│ │  ││  ││  ││  │ ...缩略图     │   ┌──┐┌──┐┌──┐                  │
│ └──┘└──┘└──┘└──┘               │   │  ││  ││  │ ...               │
│                                │   └──┘└──┘└──┘                  │
└────────────────────────────────┴─────────────────────────────────┘
```

```tsx
function CurationPage() {
  const { pid, vid } = useParams()
  const [view, setView] = useState<CurationView>()
  const [leftSel, setLeftSel] = useState<Set<string>>(new Set())
  const [rightSel, setRightSel] = useState<{folder: string, files: Set<string>}>(...)
  const [destFolder, setDestFolder] = useState<string>("")

  // 拉数据
  // 多选交互：单击切换；shift+click 区间；点击图片放大预览模态
  // 复制：禁用条件 = leftSel 空 / destFolder 空
  // 移除：禁用条件 = rightSel.files 空

  return (
    <div className="grid grid-cols-2 gap-4 h-full">
      <DownloadPanel ... />
      <TrainPanel ... />
    </div>
  )
}
```

### B. `components/ImageGrid.tsx`

通用组件，PP3 抽出，PP4 / PP5 都用：

```tsx
interface Props {
  items: Array<{ name: string; thumbUrl: string; meta?: string }>
  selected: Set<string>
  onSelect: (name: string, e: React.MouseEvent) => void   // shift / ctrl 多选交给 caller
  onPreview?: (name: string) => void                       // 双击或点放大图标
}
```

样式：grid 自适应列数，aspect-ratio square，hover 显示选择圆角、文件名 tooltip。

### C. `components/ImagePreviewModal.tsx`

点缩略图打开，全屏显示原图 + 左右键切换 + ESC 关闭。

### D. API client

```tsx
api.getCuration(pid, vid)
api.copyToTrain(pid, vid, { files, dest_folder })
api.removeFromTrain(pid, vid, { folder, files })
api.folderOp(pid, vid, { op, name, new_name? })
```

## 测试

### 后端 pytest

- `tests/test_curation.py`：
  - `curation_view` 差集正确（download 5 张，train 2 张同名 → left 3，right 2）
  - `copy_to_train`：跳过已存在；缺失文件返回 missing；同时复制 .txt / .json
  - `remove_from_train`：仅删 train 副本，download 不动
  - `create_folder`：合法名通过；非法名报错（`abc/def`、`5_` 空 label、含空格）
  - `delete_folder`：连带删所有副本

### 前端 Vitest

- `ImageGrid.test.tsx`：
  - 渲染 N 个缩略图
  - 单击选中；ctrl+click 多选；shift+click 区间
  - 双击触发 onPreview
- `Curation.test.tsx`：
  - mock API → 按钮禁用条件正确
  - 点复制 → 调对的 API
  - 移除后乐观更新 UI

### 手测剧本（接 PP2 测过的 download 数据）

1. 项目 A → 切到「② 筛选」步
2. 看到左侧 download 缩略图（PP2 下的 20 张），右侧 train 空
3. 在右侧创建子文件夹 `5_concept`
4. 左侧多选 15 张（shift+click 一片）→ 选目标 `5_concept` → 点「→ 复制到 train」
5. 右侧 5_concept 出现 15 张；左侧自动减为 5 张（差集）
6. 双击左侧某图 → 大图预览，左右键切换
7. 右侧选 3 张 → 点「← 从 train 移除」 → 右侧减为 12，左侧增为 8
8. 重启 Studio → 状态保持
9. 在另一个 version 重复步骤 3-5 → 互不影响

## 风险

| 风险 | 应对 |
|---|---|
| 图片很多（>2000）渲染卡 | ImageGrid 用 `react-window` 虚拟滚动；初版可不做，先限 500 张 + 「下一页」 |
| 用户手动改磁盘 | 每次进页重拉 curation_view |
| 复制 metadata 文件丢失 | 先复制图，metadata 失败仅 log 不报错 |
| 文件名重复（不同图同 ID） | 不可能：来源都是 booru post id |
| 同时进行 train 复制和 reg_build | reg_build 不读 train 写，纯读；并发安全 |
