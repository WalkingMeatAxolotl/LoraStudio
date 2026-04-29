# PP8 — GPU 打标 + WD14 batch 推理

**状态**：✅ 已完成（代码就绪，等手测后 commit）
**前置依赖**：PP4（WD14 / JoyCaption）
**收尾环节**：让 WD14 真正在 GPU 上跑（之前装的是 CPU 包，5090 闲着）

## 背景

PP4 实现 WD14 时只在 requirements.txt 写了 `onnxruntime>=1.16.0`（CPU 版）。代码 `wd14_tagger.py:107-110` 写的是「优先 GPU 回退 CPU」，但因为装错了包：

```
$ python -c "import onnxruntime as ort; print(ort.get_available_providers())"
['AzureExecutionProvider', 'CPUExecutionProvider']
```

实测 RTX 5090 上 CPU vs GPU 推理速度差 30-50x。另外 `tag()` 是单图循环，即使切到 GPU 也只有 10-20% 利用率 — 没用 batch。

## 范围

1. **运行时检测装包**：第一次启动检测 `nvidia-smi` → 自动装 `onnxruntime-gpu` 或 `onnxruntime`（CPU 兜底）。requirements.txt 拿掉硬依赖避免 CUDA 版本踩坑。
2. **WD14 batch 推理**：累积 N=8 一次推理，`secrets.WD14Config.batch_size` 暴露调节。
3. **Settings 页**：显示当前 EP（CUDA / CPU）+ batch_size + 「重装为 GPU/CPU」按钮。

## 设计决定

| # | 决定 | 备注 |
|---|---|---|
| 1 | requirements.txt **不写** onnxruntime | 默认装会跟用户 CUDA 版本冲突；启动期检测装更稳 |
| 2 | 启动检测：`nvidia-smi` 跑得通 → 装 `onnxruntime-gpu`；跑不通 → 装 `onnxruntime` (CPU) | nvidia-smi 不需要 root，最低代价的 GPU 探针；且驱动版本判定本来就在它输出里 |
| 3 | onnxruntime-gpu 1.19+ PyPI 默认 CUDA 12，覆盖 RTX 30/40/50 全系 | 5090 Blackwell sm_120 需要 1.20+；锁 `onnxruntime-gpu>=1.20` |
| 4 | 启动期已装但 EP 不匹配（例如装了 CPU 包但有 GPU）→ 日志 warn，不自动重装 | 自动重装风险大（用户可能故意装 CPU 版）；让 Settings 页给手动按钮 |
| 5 | WD14 batch 默认 8 | RTX 5090 显存富余；用户可调；CPU 兜底时自动降到 1 |
| 6 | batch 推理用 `np.stack([...])` 一次塞进 session.run | 简单；图数 < batch_size 时用尾批 |
| 7 | EP / 装包状态 API 单独走 `/api/wd14/runtime` + `/api/wd14/install` | 不混进 secrets 端点；Settings 页用同一个 hook |
| 8 | 「重装为 X」是危险操作，前端 confirm；后端**长 timeout**（pip install 几分钟） | 装包用 `subprocess.run(check=True)` + capture_output；UI 显示「装包中...」spinner |

## 实施清单

### 1. requirements.txt
- 删 `onnxruntime>=1.16.0`
- 加注释说明：「onnxruntime 由 studio 启动期按 GPU 检测自动安装；用户也可在 Settings → WD14 手动切换」

### 2. `studio/services/onnxruntime_setup.py`（新）

```python
def detect_cuda() -> tuple[bool, str]:
    """运行 nvidia-smi；返回 (有 nvidia gpu, 描述/驱动版本)。"""

def current_runtime() -> dict:
    """{"installed": "onnxruntime-gpu"|"onnxruntime"|None,
        "providers": [...], "version": str|None,
        "cuda_available": bool}"""

def install_runtime(target: str) -> dict:
    """target: "auto"|"gpu"|"cpu"
    1. pip uninstall -y onnxruntime onnxruntime-gpu（两者都卸）
    2. 按 target / detect 决定装哪个
    3. 重装当前进程的 onnxruntime 模块（importlib.reload）
    返回 {"installed": ..., "providers": ...}"""

def bootstrap() -> None:
    """启动期调用：未装 → install_runtime("auto")；已装但 EP 不全 → log.warn"""
```

### 3. `studio/cli.py`
- `cmd_run` / `cmd_dev` 起前先 `onnxruntime_setup.bootstrap()`
- 失败不致命：log warn + 继续起服务（让用户从 Settings 页手动修）

### 4. `studio/services/wd14_tagger.py`
- `tag()` 改 batch：维持公开签名（`Iterator[TagResult]`），内部分批
- `_cfg().batch_size` 决定 N；GPU 不可用 → 强制 1
- 保留 prepare 的 EP 解析逻辑

### 5. `studio/secrets.py`
- `WD14Config` 加 `batch_size: int = 8`
- migration：旧 secrets.json 没这字段 → pydantic 默认值兜底（已有机制）

### 6. `studio/server.py`
- `GET /api/wd14/runtime` → `current_runtime()` + `detect_cuda()` 合并 dict
- `POST /api/wd14/install` body `{"target": "auto"|"gpu"|"cpu"}` → `install_runtime(...)`，return 新 runtime 状态
- 端点要 long timeout（同步 subprocess pip install）

### 7. 前端 Settings → WD14 卡片
- 加一段「runtime 状态」区：显示 `installed package` / `version` / `providers` + nvidia-smi 检测结果
- 「重装为 GPU 版」/「重装为 CPU 版」/「自动检测」三按钮，confirm 后调端点；loading 显示「装包中（几分钟）...」
- batch_size 数字字段（已用 SchemaForm 模式 / 直接复用 secrets PUT）

## 验收手测剧本

1. 全新 venv 起 studio → 启动日志看到「检测到 NVIDIA GPU，安装 onnxruntime-gpu」+ 完成
2. 进项目 → 跑 ③ 打标 → 看日志 `providers: ['CUDAExecutionProvider', ...]` 而不是 `CPUExecutionProvider only`
3. 实测速度对比：50 张图 WD14，应从「分钟级」降到「秒级」
4. Settings 页 → WD14 卡片应显示 `installed: onnxruntime-gpu / providers: CUDA, CPU / cuda_available: True`
5. 点「重装为 CPU 版」→ confirm → 装包中... → 完成 → providers 变 `CPU only`
6. 改 batch_size = 16，再跑打标 → 速度应该更快或相当
7. 边界：故意把 nvidia-smi PATH 屏蔽 → bootstrap 应装 CPU 包不报错
