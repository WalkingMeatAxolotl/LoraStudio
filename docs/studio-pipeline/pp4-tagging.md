# PP4 — 打标（WD14 + JoyCaption）+ 标签编辑

**状态**：计划中
**前置依赖**：PP3
**预估工作量**：3 工作日（最大的一个 PP）
**外部脚本来源**：`C:\Users\Mei\Desktop\SD\danbooru\dev\joycaption_tagger.py`

## 目标

- 抽象 Tagger 协议
- 实现 WD14 打标器（onnxruntime 本地，HF 自动下载模型）
- 集成 JoyCaption 打标器（vLLM 服务）
- 通过 supervisor + project_jobs 异步执行
- 单图标签编辑：左图右标签 chip 列表
- 批量操作：增/删/去重/统计/替换
- 标签格式：默认 `.txt` 逗号分隔；可选 `.json`（JSON caption format，参考 `docs/json-caption-format.md`）

不在范围：自定义打标 prompt 模板编辑器（用户改 secrets.json 即可）；多 tagger 链式（先 WD14 再 JoyCaption 合并）。

## Tagger 抽象

### A. `studio/services/tagger.py`

```python
from pathlib import Path
from typing import Callable, Iterator, Protocol, TypedDict


class TagResult(TypedDict, total=False):
    image: Path
    tags: list[str]                      # 排序好的（按概率降）
    raw_scores: dict[str, float]         # 可选：每 tag 的概率
    error: str                           # 失败时填


ProgressFn = Callable[[int, int], None]   # (done, total)


class Tagger(Protocol):
    name: str
    requires_service: bool

    def is_available(self) -> tuple[bool, str]:
        ...

    def prepare(self) -> None:
        """耗时初始化（加载 ONNX / 调 /v1/models 验证）。worker 启动一次。"""

    def tag(
        self,
        image_paths: list[Path],
        on_progress: ProgressFn = lambda d, t: None,
    ) -> Iterator[TagResult]:
        """流式返回。每张图 yield 一次。"""


def get_tagger(name: str) -> Tagger:
    """工厂；name=wd14 / joycaption。"""
    if name == "wd14":
        from .wd14_tagger import WD14Tagger
        return WD14Tagger()
    if name == "joycaption":
        from .joycaption_tagger import JoyCaptionTagger
        return JoyCaptionTagger()
    raise ValueError(f"unknown tagger: {name}")
```

### B. `studio/services/wd14_tagger.py`

```python
import csv
from pathlib import Path
from typing import Iterator

import numpy as np
from PIL import Image

from .. import secrets
from ..paths import REPO_ROOT
from .tagger import TagResult


class WD14Tagger:
    name = "wd14"
    requires_service = False

    def __init__(self):
        self._session = None
        self._tags: list[str] = []
        self._tag_categories: list[int] = []   # 0=general, 4=character

    def _resolve_model_dir(self) -> Path:
        cfg = secrets.load().wd14
        if cfg.local_dir:
            d = Path(cfg.local_dir)
            if not (d / "model.onnx").exists() or not (d / "selected_tags.csv").exists():
                raise FileNotFoundError(
                    f"local_dir 缺少 model.onnx 或 selected_tags.csv: {d}")
            return d
        default_dir = REPO_ROOT / "models" / "wd14" / cfg.model_id.replace("/", "_")
        if (default_dir / "model.onnx").exists():
            return default_dir
        # 自动下载
        return self._download_model(cfg.model_id, default_dir)

    def _download_model(self, model_id: str, target: Path) -> Path:
        from huggingface_hub import snapshot_download
        token = secrets.load().huggingface.token or None
        snapshot_download(
            repo_id=model_id,
            local_dir=str(target),
            allow_patterns=["model.onnx", "selected_tags.csv"],
            token=token,
        )
        return target

    def is_available(self) -> tuple[bool, str]:
        cfg = secrets.load().wd14
        try:
            d = self._resolve_model_dir()
            return True, f"模型: {d.name}"
        except Exception as e:
            return False, str(e)

    def prepare(self) -> None:
        import onnxruntime as ort
        d = self._resolve_model_dir()
        providers = ["CPUExecutionProvider"]
        # 用户可在 secrets 加 use_gpu，但默认 CPU 跑得动
        self._session = ort.InferenceSession(str(d / "model.onnx"), providers=providers)
        with open(d / "selected_tags.csv", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                self._tags.append(row["name"].replace("_", " "))
                self._tag_categories.append(int(row["category"]))
        # 输入尺寸（一般 448）
        self._input_size = self._session.get_inputs()[0].shape[1]

    def _preprocess(self, img: Image.Image) -> np.ndarray:
        size = self._input_size
        img = img.convert("RGB")
        # padding 到正方形
        w, h = img.size
        s = max(w, h)
        canvas = Image.new("RGB", (s, s), (255, 255, 255))
        canvas.paste(img, ((s - w) // 2, (s - h) // 2))
        canvas = canvas.resize((size, size), Image.BICUBIC)
        arr = np.asarray(canvas, dtype=np.float32)
        # WD14 输入通常 BGR
        arr = arr[..., ::-1]
        return np.expand_dims(arr, 0)

    def _postprocess(self, logits: np.ndarray) -> tuple[list[str], dict[str, float]]:
        cfg = secrets.load().wd14
        scores = logits[0]
        out_tags: list[str] = []
        raw: dict[str, float] = {}
        for i, p in enumerate(scores):
            tag, cat = self._tags[i], self._tag_categories[i]
            if tag in cfg.blacklist_tags:
                continue
            thr = cfg.threshold_character if cat == 4 else cfg.threshold_general
            if p >= thr:
                out_tags.append(tag)
                raw[tag] = float(p)
        # 按 score 降序
        out_tags.sort(key=lambda t: -raw[t])
        return out_tags, raw

    def tag(self, image_paths, on_progress=lambda d, t: None) -> Iterator[TagResult]:
        if self._session is None:
            self.prepare()
        total = len(image_paths)
        for i, p in enumerate(image_paths):
            try:
                img = Image.open(p)
                arr = self._preprocess(img)
                out = self._session.run(None, {self._session.get_inputs()[0].name: arr})
                tags, raw = self._postprocess(out[0])
                yield {"image": p, "tags": tags, "raw_scores": raw}
            except Exception as e:
                yield {"image": p, "tags": [], "error": str(e)}
            on_progress(i + 1, total)
```

依赖：`onnxruntime`（CPU 即可）、`huggingface_hub`、`pillow`、`numpy`。`requirements.txt` 加上。

### C. `studio/services/joycaption_tagger.py`

```python
import base64
import time
from pathlib import Path
from typing import Iterator

import requests

from .. import secrets
from .tagger import TagResult

class JoyCaptionTagger:
    name = "joycaption"
    requires_service = True

    def is_available(self) -> tuple[bool, str]:
        cfg = secrets.load().joycaption
        if not cfg.base_url:
            return False, "未配置 base_url（去 Settings）"
        try:
            r = requests.get(cfg.base_url.rstrip("/") + "/models", timeout=5)
            if r.ok:
                return True, f"在线: {cfg.model}"
            return False, f"服务返回 {r.status_code}"
        except Exception as e:
            return False, f"连接失败: {e}"

    def prepare(self) -> None:
        ok, msg = self.is_available()
        if not ok:
            raise RuntimeError(msg)

    def tag(self, image_paths, on_progress=lambda d, t: None) -> Iterator[TagResult]:
        cfg = secrets.load().joycaption
        url = cfg.base_url.rstrip("/") + "/chat/completions"
        total = len(image_paths)
        for i, p in enumerate(image_paths):
            try:
                with open(p, "rb") as f:
                    b64 = base64.b64encode(f.read()).decode()
                ext = p.suffix.lower().lstrip(".")
                payload = {
                    "model": cfg.model,
                    "messages": [{
                        "role": "user",
                        "content": [
                            {"type": "text", "text": cfg.prompt_template},
                            {"type": "image_url", "image_url": {"url": f"data:image/{ext};base64,{b64}"}}
                        ]
                    }],
                    "temperature": 0.6, "max_tokens": 300
                }
                r = requests.post(url, json=payload, timeout=60)
                r.raise_for_status()
                text = r.json()["choices"][0]["message"]["content"].strip()
                # JoyCaption 返回自然语言，作为单个 tag
                yield {"image": p, "tags": [text]}
            except Exception as e:
                yield {"image": p, "tags": [], "error": str(e)}
            on_progress(i + 1, total)
```

注意：JoyCaption 返回的是自然语言 caption（一句话），不是分类 tag 列表。前端 TagEditor 需要兼容这种「单 caption」格式 —— 显示为可编辑 textarea 而非 chip。

## Worker

`studio/workers/tag_worker.py`：

```python
# python -m studio.workers.tag_worker --job-id N
import argparse
import json
import sys
from pathlib import Path

from studio import db
from studio.services.tagger import get_tagger
from studio.versions import get_version, version_dir

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--job-id", type=int, required=True)
    args = p.parse_args()

    with db.connection_for() as conn:
        job = dict(conn.execute("SELECT * FROM project_jobs WHERE id=?", (args.job_id,)).fetchone())
    params = json.loads(job["params"])
    # params: {tagger, version_id, folders: list[str] | None, output_format: 'txt'|'json'}

    version = get_version(...)
    project = ...
    train_dir = version_dir(...) / "train"
    folders = params.get("folders") or [d.name for d in train_dir.iterdir() if d.is_dir()]
    images = []
    for f in folders:
        for ext in IMAGE_EXTS:
            images.extend((train_dir / f).glob(f"*{ext}"))

    tagger = get_tagger(params["tagger"])
    tagger.prepare()

    log = Path(job["log_path"])
    with open(log, "a", encoding="utf-8") as fp:
        fp.write(f"[start] tagger={params['tagger']} images={len(images)}\n"); fp.flush()

        def on_progress(done, total):
            fp.write(f"[progress] {done}/{total}\n"); fp.flush()

        ok = 0
        for r in tagger.tag(images, on_progress=on_progress):
            if r.get("error"):
                fp.write(f"[err] {r['image'].name}: {r['error']}\n"); fp.flush()
                continue
            _write_caption(r["image"], r["tags"], r.get("raw_scores"), params.get("output_format", "txt"))
            ok += 1
        fp.write(f"[done] tagged {ok}/{len(images)}\n"); fp.flush()
    sys.exit(0 if ok > 0 else 1)


def _write_caption(image: Path, tags: list[str], scores: dict | None, fmt: str):
    if fmt == "json":
        # 参考 docs/json-caption-format.md
        data = {"tags": tags, "scores": scores} if scores else {"tags": tags}
        image.with_suffix(".json").write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        image.with_suffix(".txt").write_text(", ".join(tags), encoding="utf-8")
```

## 标签批量编辑（纯文件操作，无外部依赖）

### `studio/services/tagedit.py`

```python
from collections import Counter
from pathlib import Path
from typing import Iterable, Literal

def _scope_files(scope: dict, train_dir: Path) -> list[Path]:
    """scope = {kind:'all'} | {kind:'folder', name:'5_concept'} | {kind:'files', folder, names:[...]}。
    返回所有 caption 文件 (.txt 优先，没有 .txt 看 .json)。"""
    ...

def stats(scope, train_dir, top: int = 50) -> list[tuple[str, int]]:
    """统计 tag 频率，返回 top N。"""
    counter = Counter()
    for caption_file in _scope_files(scope, train_dir):
        for tag in _read_tags(caption_file):
            counter[tag] += 1
    return counter.most_common(top)

def add_tags(scope, train_dir, tags: list[str], position: Literal["front", "back"] = "back") -> int:
    """所有匹配文件加 tags（去重）。返回受影响文件数。"""

def remove_tags(scope, train_dir, tags: list[str]) -> int: ...

def replace_tag(scope, train_dir, old: str, new: str) -> int: ...

def dedupe(scope, train_dir) -> int:
    """每个文件里去重（保持顺序，首次出现保留）。"""

def _read_tags(path: Path) -> list[str]:
    """统一读 txt / json caption。"""
    if path.suffix == ".txt":
        return [t.strip() for t in path.read_text(encoding="utf-8").split(",") if t.strip()]
    if path.suffix == ".json":
        return json.loads(path.read_text(encoding="utf-8")).get("tags", [])
    return []

def _write_tags(path: Path, tags: list[str]) -> None: ...
```

### 端点

```python
class TagJobRequest(BaseModel):
    tagger: Literal["wd14", "joycaption"]
    folders: Optional[list[str]] = None        # None = 全部 train 子目录
    output_format: Literal["txt", "json"] = "txt"

@app.post("/api/projects/{pid}/versions/{vid}/tag")
def start_tag(pid, vid, body): ...                # 创建 project_jobs

class CaptionEdit(BaseModel):
    tags: list[str]                              # 整体覆盖

@app.get("/api/projects/{pid}/versions/{vid}/captions")
def list_captions(pid, vid, folder: str): ...    # 列文件 + tags 预览（前 5 个）

@app.get("/api/projects/{pid}/versions/{vid}/captions/{folder}/{filename}")
def get_caption(pid, vid, folder, filename): ...

@app.put("/api/projects/{pid}/versions/{vid}/captions/{folder}/{filename}")
def put_caption(pid, vid, folder, filename, body: CaptionEdit): ...

class BatchOp(BaseModel):
    op: Literal["add", "remove", "replace", "dedupe", "stats"]
    scope: dict                                  # {kind: all/folder/files, ...}
    tags: Optional[list[str]] = None
    old: Optional[str] = None                    # replace 用
    new: Optional[str] = None
    top: int = 50                                # stats 用

@app.post("/api/projects/{pid}/versions/{vid}/captions/batch")
def batch(pid, vid, body): ...
```

## 前端

### A. `pages/Project/steps/Tagging.tsx`

布局：

```
┌──────────────────────────────────────────────┐
│ Tagger: [WD14 ▾]  状态: ✓ 模型: wd-vit-tagger-v3 │
│ [打标设置 ▸]  [开始打标]                       │
│ ─── 进度面板（job 中显示）─── ─── 日志（折叠）── │
├──────────────────────────────────────────────┤
│ 文件夹: [5_concept ▾]                          │
│ ┌────────────┐ ┌──────────────────────────┐  │
│ │ 缩略图     │ │ 标签编辑                  │  │
│ │ + 文件名    │ │ [tag1 ×] [tag2 ×] ...    │  │
│ │ 列表       │ │ + 添加标签               │  │
│ └────────────┘ └──────────────────────────┘  │
├──────────────────────────────────────────────┤
│ 批量操作 [▸]                                   │
│   范围: [全部 ▾] / [当前文件夹] / [选中文件]   │
│   操作: [增加][删除][替换][去重][统计]         │
└──────────────────────────────────────────────┘
```

```tsx
function TaggingPage() {
  const { pid, vid } = useParams()
  const [tagger, setTagger] = useState<'wd14' | 'joycaption'>('wd14')
  const [taggerStatus, setTaggerStatus] = useState<{ok:boolean, msg:string}>()
  const [folders, setFolders] = useState<string[]>([])
  const [activeFolder, setActiveFolder] = useState<string>("")
  const [activeImage, setActiveImage] = useState<string>("")
  const [activeTags, setActiveTags] = useState<string[]>([])
  const [job, setJob] = useState<Job|null>(null)

  // SSE: job_log_appended / job_state_changed
  // 切 tagger → check is_available
  // 切图 → 拉对应 caption
}
```

### B. `components/TagEditor.tsx`

```tsx
interface Props {
  tags: string[]
  onChange: (tags: string[]) => void
  natural?: boolean   // 自然语言 caption (JoyCaption) → textarea；否则 chip
}

function TagEditor({ tags, onChange, natural }: Props) {
  if (natural) {
    return <textarea value={tags[0] || ""} onChange={...} />
  }
  return (
    <div>
      {tags.map(t => <Chip key={t} onRemove={...}>{t}</Chip>)}
      <input onKeyDown={e => e.key==='Enter' && addTag(...)} />
    </div>
  )
}
```

### C. `components/BulkTagPanel.tsx`

```tsx
function BulkTagPanel({ pid, vid }: Props) {
  // 范围：all / folder / files (从 Tagging 页传入选中)
  // 操作：5 个按钮，按操作展开输入
  // 统计：显示 top N tag 表格
  // 调 /api/.../captions/batch
}
```

### D. `components/TaggerForm.tsx`

```tsx
// 按 tagger 名动态渲染参数表单
// WD14: 阈值 / 黑名单（链到 Settings 编辑 secrets）
// JoyCaption: prompt_template 选择 / base_url 状态展示
```

### E. API client

```tsx
api.checkTagger(name)              // 调 is_available 端点
api.startTag(pid, vid, body)
api.listCaptions(pid, vid, folder)
api.getCaption(pid, vid, folder, filename)
api.putCaption(pid, vid, folder, filename, tags)
api.batchTag(pid, vid, body)
```

## 测试

### 后端 pytest

- `tests/test_wd14_tagger.py`：
  - 用 mock onnxruntime InferenceSession（返回固定 logits）→ 验证 tag 输出
  - 模型解析顺序：local_dir > 默认目录 > HF 下载（mock snapshot_download）
- `tests/test_joycaption_tagger.py`：mock requests，验证请求 payload 与解析
- `tests/test_tagedit.py`：add/remove/replace/dedupe/stats 端到端，含 txt 与 json 两种格式
- `tests/test_tag_endpoints.py`：HTTP 路径
- `tests/test_tag_worker.py`：构造假 job，验证全流程退出码

### 前端 Vitest

- `TagEditor.test.tsx`：chip 增删；Enter 加；natural 模式 textarea
- `BulkTagPanel.test.tsx`：参数表单切换；调用正确 API

### 手测剧本

1. 设置页确认 secrets.wd14.threshold_general=0.35
2. 项目 A → v1 baseline → 「③ 打标」
3. 选 WD14 → 状态条显示「需下载模型」（首次）
4. 点「开始打标」→ 后台触发 HF 下载 → 看到日志「[hf] downloading...」→ 模型就位 → 开始打标
5. 进度从 0/15 推到 15/15，每行 `[progress]` 增量显示
6. 完成后切到「5_concept」文件夹，点单张图 → 右侧 chip 列表出现 tag
7. 删 1 个 chip + 加 1 个 → 保存（自动 PUT）
8. 批量：选范围「当前文件夹」+ 操作「统计」→ 看 top 20
9. 批量：操作「替换」 `1girl → solo`，确认所有文件中替换
10. 切到 JoyCaption（先确保 vLLM 在 WSL 跑着）→ 状态条「在线」→ 跑 5 张 → caption 是自然语言段落

## 风险

| 风险 | 应对 |
|---|---|
| WD14 模型 ~400 MB 下载慢 | UI 显示「下载中」+ 进度（HF snapshot_download 可注入 callback） |
| onnxruntime 在 Win 装不上 | requirements 加 `onnxruntime`（CPU），提供 troubleshoot |
| JoyCaption 服务没起 | is_available 显示原因，给「跳到 Settings」按钮 |
| 用户在打标中改 train 文件 | worker 启动时快照文件列表，新加的图本轮不打 |
| 标签格式混乱（有些 .txt 有些 .json） | tagedit 模块统一读写抽象；写时按文件已有格式优先 |
| 标签里的逗号 | txt 用逗号分隔，本身的逗号转义 `\,`（实际很少出现，先不处理） |
