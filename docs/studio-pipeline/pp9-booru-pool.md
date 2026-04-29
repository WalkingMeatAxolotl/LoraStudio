# PP9 — Booru API 池子（统一并发 + 限速）

**状态**：✅ 已完成（代码就绪，commit + 推云手测）
**前置依赖**：PP2（downloader）、PP5（reg_builder）— 二者都用 `booru_api.py` 的 search/download
**收尾环节**：解决「云上下载比本地慢 5-10x」的痛点

## 背景

`downloader.py` 现状：
- 完全同步串行：每图 → 拉 → 强制 `cancel_event.wait(0.5)` 半秒 sleep
- 分页之间 `page_delay=1.0s` sleep
- 没用 `requests.Session`（worker 没传 `session=`） → 每图都重开 TCP/TLS
- 没并发：N 张图 = N × (RTT + 0.5s 间隔) ≈ N 秒

云上 RTT 比家庭宽带高 2-3x，串行模型下 RTT 直接乘 N 张。

`reg_builder.py` 同问题：每图 `time.sleep(0.5)` + 每批 `time.sleep(1.0)`。

## 范围

把所有 booru API / CDN 访问统一走一个 `BooruClient`：
- 共享 `requests.Session`（HTTP keepalive）
- 双 token bucket：API host 2 req/s + CDN host **5 req/s**（用户拍板）
- 拉图阶段并发 worker（默认 4）
- 429 / 503 自适应：sticky backoff 60s + 速率减半（永久到任务结束）
- `secrets.download` 暴露三字段调速

## Gelbooru rate limit 调研

官方 wiki 只说「occasionally throttle，patreon 用户不限」，没列具体 req/s 数字。
社区参考：gallery-dl 的 gelbooru extractor `request_interval = 0.0`（无强制 sleep），429 后退 60s。
错误信号是 `exceeded maximum queries per day`（带 api_key 显著放宽）。

API host (`gelbooru.com`) 和 CDN host (`img*.gelbooru.com`) 是分离的；CDN 限频要松得多。
**默认值 API 2 / CDN 5 req/s** 比 gallery-dl 默认（无 sleep）保守很多，比当前 0.5s/图（= 2 req/s 串行总量）快 2.5-3x。

## 设计决定

| # | 决定 | 备注 |
|---|---|---|
| 1 | 新文件 `services/booru_pool.py`，`booru_api.py` 保留为纯 HTTP 函数 | 池子是上层关注点；纯函数 `search_posts/download_image` 仍可单独用，便于测试 |
| 2 | 双 token bucket：API 2 req/s + CDN 5 req/s | API 限制更严；CDN 并发拉图主战场。host 按 URL netloc 区分 |
| 3 | TokenBucket 用 `threading.Lock` + 时间窗算 | 简单、跨线程安全；`acquire()` 阻塞直到拿到 token |
| 4 | 429/503 → sticky backoff 60s + rate halving，**永久到 client 销毁** | 用户拍板；不做反弹回升（保守） |
| 5 | `parallel_workers` 默认 4 | 与 CDN bucket 5 req/s 匹配，pipeline 不会被 worker 数卡瓶颈 |
| 6 | 删 `image_delay=0.5` 硬 sleep | 全由 token bucket 控；让 CDN 拉满 5 req/s |
| 7 | 保留 `page_delay`（默认 1.0s）| API 分页本质串行；保持礼貌 |
| 8 | cancel_event 双检：submit 前 + future result 后 | 秒级响应；不等 worker 自然结束 |
| 9 | `session=` 参数保留（向后兼容旧 test） | downloader/reg_builder 公开 API 不变；内部默认建 BooruClient |
| 10 | reg_builder 也走 client | 用户拍板「同时优化」；reg 的 search-heavy 阶段也受益于 keepalive + token bucket |

## API（`services/booru_pool.py`）

```python
@dataclass
class BooruPoolConfig:
    parallel_workers: int = 4
    api_rate_per_sec: float = 2.0
    cdn_rate_per_sec: float = 5.0
    backoff_on_429: float = 60.0  # 收到 429/503 后整客户端休息 60s

class BooruClient:
    """池子：Session + ThreadPoolExecutor + 双 token bucket + 429 sticky 退避。

    线程安全；同实例可被 downloader / reg_builder 同时并发调用。"""

    def __init__(self, cfg: BooruPoolConfig | None = None) -> None: ...

    def search_posts(self, ...) -> list[dict]: ...   # 走 API bucket
    def download_image(self, ...) -> Path: ...        # 走 CDN bucket
    def parallel_download(self, items: list, fn) -> list: ...  # ThreadPoolExecutor 包装

    def close(self) -> None: ...                      # 关 Session + shutdown 池子
    def __enter__(self) -> "BooruClient": ...
    def __exit__(self, *exc) -> None: ...
```

## 实施清单

### 1. `services/booru_pool.py`（新）
- `TokenBucket` 类（线程安全）
- `BooruClient` 类（包 search_posts / download_image / parallel_download）
- 429/503 检测与 sticky backoff

### 2. `services/booru_api.py`
- 不动；`BooruClient` 内部仍调它的 `search_posts(session=...)` / `download_image(session=...)`
- 新增小帮手：`is_api_host(url)` / `is_cdn_host(url)`（按 netloc 判定）

### 3. `services/downloader.py`
- 函数签名不动（`session=` 仍接受外部 session 用于测试 mock）
- 内部建 `BooruClient(session=session, cfg=...)` 或 reuse 外部
- 拉图阶段：把当前页面所有候选 post 收集成 `(post, target)` 列表 → `client.parallel_download(...)`
- 删 `cancel_event.wait(image_delay)`；保留 `cancel_event.wait(page_delay)` 在分页之间
- cancel 双检（submit 前 / result 后）

### 4. `services/reg_builder.py`
- 接受可选 `client: BooruClient | None`；不传则内建
- 把直接调 `booru_api.X` 改为 `client.X`
- 删每图 `time.sleep(0.5)`；保留每批 `time.sleep(1.0)`
- 注意：reg 的核心循环是「每张图独立选 best_post」，并发拉图后顺序处理 → 保持「先选→再批量拉」两步走

### 5. `secrets.DownloadConfig`
```python
parallel_workers: int = 4
api_rate_per_sec: float = 2.0
cdn_rate_per_sec: float = 5.0
```

### 6. Settings → 下载（全局）
- 加 3 个数字字段，附 tooltip 解释 API/CDN 区别
- 显示当前生效值，防止用户瞎调到 100 req/s 被 ban

### 7. pytest
- `test_booru_client.py` — mock requests + 时间，验证：
  - API/CDN 桶分离（API 调用不消耗 CDN token）
  - 并发 worker 数受 `parallel_workers` 约束
  - 429 → 整 client 进入 backoff
  - 关闭 client 时 ThreadPool shutdown
- `test_downloader.py` 现有 case — `FakeSession` 注入仍要过（兼容性）
- `test_reg_build_worker.py` 同上

## 验收手测剧本

1. 设置 → 下载 → 看到 3 个新字段（默认 4 / 2 / 5）
2. 跑一个新项目下载 100 张 → 时间应从「分钟级」降到「20-30 秒」
3. 看下载日志 → 没有「[skip 0.5s]」之类等待行；图陆续涌入
4. 跑 reg_build 50 张 → 同样观察速度提升
5. 边界：把 cdn_rate_per_sec 调到 1.0 → 应观察到明显变慢（验证 token bucket 真生效）
6. cancel：下载途中按取消 → 应在 1-2 秒内停（不是 4 worker 各自跑完才停）
