# PP5 — 正则集生成

**状态**：计划中
**前置依赖**：PP4
**预估工作量**：2 工作日
**外部脚本来源**：`C:\Users\Mei\Desktop\SD\danbooru\dev\regex_dataset_builder.py`

## 目标

- 把现有 `regex_dataset_builder.py` 库化为 `studio/services/reg_builder.py`
- 基于 train 的 tag 分布，从 booru 拉一组「相似但不同」的图作正则集
- 落到 `versions/{label}/reg/1_general/`，附 `meta.json`
- 前端 Regularization 页：参数 + 进度 + meta 展示

不在范围：reg 集合手动筛选（当前只支持「重新生成覆盖」）；离线生成（如从用户已有图库挑）。

## 关键约定

- **每个 version 一份 reg**（与 user 之前确认一致）；切 version 看到对应 reg
- 触发条件：版本必须先有 train 数据 + 至少跑过一次打标（不然没 tag 分布可分析）
- 生成器逻辑（沿用现脚本）：
  1. 扫 train/ 下所有 caption 文件，统计 tag 频率
  2. 排除项目特定 tag（角色名等高频独占 tag）和黑名单
  3. 用剩余 tag 做 K-means 聚类，挑代表 tag 组
  4. 调 booru API 按这些 tag 拉图
  5. 落到 `versions/{label}/reg/1_general/`
  6. 写 `meta.json` 记录基于哪个 version、哪些 tag、拉了多少张
- 默认 `1_general/` 里 repeat=1，与 train 的 5_concept 形成对比
- 可选自动打标：触发 reg 生成时同时跑 WD14 打标产 reg 集的 caption

## 后端

### A. `studio/services/reg_builder.py`

```python
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

from .tagger import ProgressFn

ProgressLog = Callable[[str], None]


@dataclass
class RegBuildOptions:
    # 输入
    train_dir: Path                         # versions/{label}/train/
    output_dir: Path                        # versions/{label}/reg/1_general/
    # 配置
    target_count: int = 100                 # 目标拉多少张
    batch_size: int = 5                     # 每批拉几张后重评估 tag
    cluster_k: Optional[int] = None         # None = 自动选 K（silhouette）
    excluded_tags: list[str] = field(default_factory=list)  # 项目特定，UI 选
    blacklist_tags: list[str] = field(default_factory=list) # 全局黑名单
    auto_tag: bool = True                   # 拉完后是否跑 WD14 标签
    # 来源
    api_source: str = "gelbooru"
    user_id: str = ""
    api_key: str = ""


@dataclass
class RegMeta:
    generated_at: float
    based_on_version: str
    target_count: int
    actual_count: int
    source_tags: list[str]                  # 用于搜索的 tag 列表
    excluded_tags: list[str]
    train_tag_distribution: dict[str, int]  # 训练集 tag 频率（top 20）
    auto_tagged: bool


def collect_train_tags(train_dir: Path) -> Counter[str]:
    """扫 train/*/<image>.txt|.json，统计 tag 频率。"""

def select_search_tags(
    counter: Counter, k: Optional[int],
    excluded: set[str], blacklist: set[str],
) -> list[str]:
    """K-means 聚类挑代表 tag。复用脚本里的 silhouette 选 K 逻辑。"""

def build(
    opts: RegBuildOptions,
    on_progress: ProgressLog = print,
    cancel_event: Optional[threading.Event] = None,
) -> RegMeta:
    """
    1. collect_train_tags
    2. select_search_tags
    3. 循环：每批拉 batch_size 张 → 检查停止条件 → 重新挑 tag
    4. 写文件 + meta.json
    返回最终 meta。
    """
```

### B. `studio/workers/reg_worker.py`

```python
# python -m studio.workers.reg_worker --job-id N
# 同 download_worker / tag_worker 模式
# 完成后选项：自动跑一遍 WD14 给 reg 集打标
```

### C. 端点

```python
class RegBuildRequest(BaseModel):
    target_count: int = Field(100, ge=1, le=10000)
    cluster_k: Optional[int] = None
    excluded_tags: list[str] = []           # 用户从 train tag 频率里勾选
    auto_tag: bool = True

@app.post("/api/projects/{pid}/versions/{vid}/reg/build")
def start_reg(pid, vid, body): ...

@app.get("/api/projects/{pid}/versions/{vid}/reg")
def get_reg(pid, vid):
    """返回 meta.json + 当前文件列表。"""
    return {
        "exists": ...,
        "meta": ...,
        "image_count": ...,
        "files": [...],
    }

@app.delete("/api/projects/{pid}/versions/{vid}/reg")
def delete_reg(pid, vid):
    """清空 reg/ 下所有内容（含 meta）。"""

@app.get("/api/projects/{pid}/versions/{vid}/reg/preview-tags")
def preview_reg_tags(pid, vid, top: int = 20):
    """不真生成，只返回当前 train 的 tag 分布 top N，给 UI 选「排除项」用。"""
```

## 前端

### A. `pages/Project/steps/Regularization.tsx`

布局：

```
┌────────────────────────────────────────────────────┐
│ 正则集生成                                           │
│ ─ 当前 reg 集状态 ─                                  │
│   存在: 是 (95 张, 基于 baseline, 5 分钟前)          │
│   [查看图片] [重新生成] [清空]                       │
├────────────────────────────────────────────────────┤
│ ─ 生成参数 ─                                         │
│   目标数量: [100 ▾]                                  │
│   聚类 K：(自动) / 手动 [3 ▾]                        │
│   排除 train 的 top tag (用户勾选):                  │
│     ☑ character_x (89 occurrences)                 │
│     ☑ specific_outfit (45)                         │
│     ☐ 1girl (88)                                   │
│   ☑ 拉完后自动 WD14 打标                             │
│   [开始生成]                                          │
├────────────────────────────────────────────────────┤
│ ─ 进度面板 ─                                         │
│   日志 + 实时拉取数                                  │
└────────────────────────────────────────────────────┘
```

```tsx
function RegPage() {
  const { pid, vid } = useParams()
  const [reg, setReg] = useState<RegStatus>()
  const [trainTags, setTrainTags] = useState<TagCount[]>([])
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [params, setParams] = useState({ target_count: 100, cluster_k: null, auto_tag: true })
  const [job, setJob] = useState<Job|null>(null)

  // 进入页：拉 reg 状态 + train tag top 20
  // SSE 跟进 job
}
```

### B. 文件预览复用 ImageGrid（PP3 已抽出）

```tsx
<ImageGrid
  items={regFiles.map(name => ({
    name,
    thumbUrl: api.versionThumbUrl(pid, vid, 'reg', '1_general', name)
  }))}
  selected={new Set()}
  onSelect={() => {}}
  onPreview={...}
/>
```

### C. API client

```tsx
api.getReg(pid, vid)
api.previewRegTags(pid, vid, top?)
api.startRegBuild(pid, vid, body)
api.deleteReg(pid, vid)
```

## 测试

### 后端 pytest

- `tests/test_reg_builder.py`：
  - `collect_train_tags` 从假 train 目录读 .txt 和 .json
  - `select_search_tags` mock K-means → 确认输出与 K 选择
  - `build` mock booru API → 验证落盘 + meta.json
- `tests/test_reg_endpoints.py`：HTTP 路径
- `tests/test_reg_worker.py`：worker 退出码

### 手测剧本（接 PP4 测过的标签数据）

1. 项目 A → v1 baseline（已有 train + tag）→ 「④ 正则集」
2. 看到当前 reg 状态：「不存在」
3. 看到 train tag 分布 top 20，勾选 `character_x`、`specific_outfit` 排除
4. 目标 100 张，自动 K，启用 auto_tag
5. 开始生成 → 进度日志：
   ```
   [analyze] 抽到 8 个搜索 tag 组
   [batch 1/20] cluster=cute,1girl → got 5
   [batch 2/20] cluster=outdoor,sky → got 5
   ...
   [done] saved 92 / target 100 (8 失败)
   [auto-tag] WD14 打标中 ... 92/92
   ```
6. 完成后切到 reg/1_general/ 浏览，95 张图 + 每张 .txt
7. 切到 v2 high-lr → 看到自己的 reg 状态独立（空）
8. 在 v2 重新生成（不同参数）→ v1 reg 不动

## 风险

| 风险 | 应对 |
|---|---|
| K-means 在小样本上不稳定 | 自动 K 时降级到 K=1（即用全 train tag 频率挑） |
| booru 拉到的图与 train 撞车 | 下载时 skip 文件名重名（download/ + reg/ 都查） |
| 用户勾选排除 tag 太多导致没法搜 | UI 校验：至少剩下 3 个 tag |
| 目标数量没拉够 | meta 里 actual_count < target_count，UI 显示「不足」并给「补足」按钮（增量再跑） |
| Auto-tag 失败 | reg 集仍保留，meta 标 `auto_tagged: false`，UI 提示去 PP4 手动 |
