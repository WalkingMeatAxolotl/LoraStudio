"""PP8 — onnxruntime 运行时检测 / 安装。

由于 onnxruntime（CPU 包）和 onnxruntime-gpu 共享同一个 import 名 `onnxruntime`，
两者**互斥**（同 PyPI 包名），不能同装。requirements.txt 不写死它，由本模块在
启动期检测 GPU 后决定装哪一个，避免用户机器 CUDA 与硬编码包不匹配的踩坑。

主路径：
    bootstrap()   — cli.cmd_run / cmd_dev 启动前调；未装 → install("auto")
    install_runtime(target) — Settings 页「重装为 X」按钮调；同步 pip
    current_runtime()       — Settings 页展示当前状态
    detect_cuda()           — nvidia-smi 探针

约定：
- 「装错了 cuda 版本」体现为 `import onnxruntime` 成功但 `CUDAExecutionProvider`
  不在 providers 里；不自动重装（用户可能故意），UI 给手动按钮 + 警告
- 装包用 `subprocess.run([sys.executable, "-m", "pip", ...])`，不调内部 pip API
"""
from __future__ import annotations

import importlib
import logging
import shutil
import subprocess
import sys
from typing import Any, Optional

logger = logging.getLogger(__name__)

GPU_PACKAGE = "onnxruntime-gpu"
CPU_PACKAGE = "onnxruntime"
# onnxruntime-gpu 1.19+ PyPI 默认 CUDA 12.x，覆盖 RTX 30/40/50（5090 Blackwell 需 1.20+）
GPU_VERSION_SPEC = ">=1.20"
CPU_VERSION_SPEC = ">=1.16"


# ---------------------------------------------------------------------------
# detection
# ---------------------------------------------------------------------------


def detect_cuda() -> dict[str, Any]:
    """运行 nvidia-smi 探针。返回 {"available": bool, "driver_version": str|None, "gpu_name": str|None}。

    nvidia-smi 不需要 root，是最低成本的 GPU 检测；找不到 / 跑失败都视作无 GPU。
    """
    nv = shutil.which("nvidia-smi")
    if not nv:
        return {"available": False, "driver_version": None, "gpu_name": None}
    try:
        out = subprocess.run(
            [
                nv,
                "--query-gpu=driver_version,name",
                "--format=csv,noheader",
            ],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (subprocess.SubprocessError, OSError) as exc:
        logger.debug("nvidia-smi exec failed: %s", exc)
        return {"available": False, "driver_version": None, "gpu_name": None}
    if out.returncode != 0:
        return {"available": False, "driver_version": None, "gpu_name": None}
    line = (out.stdout or "").strip().splitlines()
    if not line:
        return {"available": False, "driver_version": None, "gpu_name": None}
    parts = [p.strip() for p in line[0].split(",", 1)]
    driver = parts[0] if parts else None
    name = parts[1] if len(parts) > 1 else None
    return {"available": True, "driver_version": driver, "gpu_name": name}


def current_runtime() -> dict[str, Any]:
    """返回当前进程视角的 onnxruntime 信息。

    `installed` 是按 dist-info 反查的（onnxruntime / onnxruntime-gpu / None）；
    `providers` 是 import 后的实际可用 EP；`cuda_available` 是 CUDA EP 是否在列表里。
    """
    installed: Optional[str] = None
    version: Optional[str] = None
    try:
        from importlib.metadata import PackageNotFoundError, version as _ver
        for pkg in (GPU_PACKAGE, CPU_PACKAGE):
            try:
                version = _ver(pkg)
                installed = pkg
                break
            except PackageNotFoundError:
                continue
    except Exception:  # noqa: BLE001
        pass

    providers: list[str] = []
    try:
        import onnxruntime as ort  # type: ignore[import-not-found]
        providers = list(ort.get_available_providers())
        if version is None:
            version = getattr(ort, "__version__", None)
    except ImportError:
        pass

    return {
        "installed": installed,
        "version": version,
        "providers": providers,
        "cuda_available": "CUDAExecutionProvider" in providers,
    }


# ---------------------------------------------------------------------------
# install
# ---------------------------------------------------------------------------


def _pip(args: list[str]) -> tuple[int, str]:
    """跑 `<sys.executable> -m pip <args>`；返回 (rc, combined_output)。"""
    cmd = [sys.executable, "-m", "pip", *args]
    logger.info("[onnx_setup] %s", " ".join(cmd))
    try:
        out = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600,  # pip install 几分钟级别
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        return 1, f"pip 超时（10 分钟）: {exc}"
    except Exception as exc:  # noqa: BLE001
        return 1, f"pip 调用失败: {exc}"
    text = (out.stdout or "") + (out.stderr or "")
    return out.returncode, text


def _decide_target(target: str) -> str:
    """auto/gpu/cpu → 实际包名（带版本约束）。"""
    if target == "gpu":
        return f"{GPU_PACKAGE}{GPU_VERSION_SPEC}"
    if target == "cpu":
        return f"{CPU_PACKAGE}{CPU_VERSION_SPEC}"
    if target == "auto":
        cuda = detect_cuda()
        if cuda["available"]:
            return f"{GPU_PACKAGE}{GPU_VERSION_SPEC}"
        return f"{CPU_PACKAGE}{CPU_VERSION_SPEC}"
    raise ValueError(f"非法 target: {target!r}（应为 auto/gpu/cpu）")


def install_runtime(target: str = "auto") -> dict[str, Any]:
    """先 uninstall 两个互斥包再装目标。

    target: "auto" | "gpu" | "cpu"
    返回 {"target": resolved_pkg, "installed": ..., "providers": [...], "stdout": ...}
    失败抛 RuntimeError。
    """
    spec = _decide_target(target)
    # 先卸两个互斥包（即使没装也无害，pip 会说 not installed）
    rc1, log1 = _pip(["uninstall", "-y", GPU_PACKAGE, CPU_PACKAGE])
    rc2, log2 = _pip(["install", "--upgrade", spec])
    if rc2 != 0:
        raise RuntimeError(f"安装 {spec} 失败（rc={rc2}）:\n{log2}")
    # 重置 import 缓存让 current_runtime 看到新包
    if "onnxruntime" in sys.modules:
        try:
            importlib.reload(sys.modules["onnxruntime"])
        except Exception:  # noqa: BLE001
            # reload 失败不致命；下次 import 时会重新加载
            sys.modules.pop("onnxruntime", None)
    rt = current_runtime()
    return {
        "target": spec,
        "installed": rt["installed"],
        "version": rt["version"],
        "providers": rt["providers"],
        "cuda_available": rt["cuda_available"],
        "stdout": log1 + log2,
    }


# ---------------------------------------------------------------------------
# bootstrap
# ---------------------------------------------------------------------------


def bootstrap() -> dict[str, Any]:
    """启动期一次性检查：

    - 未装 → 自动 install_runtime("auto")
    - 装了但 EP 不匹配机器（有 GPU 但只有 CPU EP）→ 仅 log warn，不动
    - 装了且 EP 匹配 → 静默

    始终返回 current_runtime()（含 detect_cuda 信息），失败不抛出（仅 log）。
    """
    cuda = detect_cuda()
    rt = current_runtime()
    state = {**rt, "cuda_detect": cuda}

    if rt["installed"] is None:
        target = "gpu" if cuda["available"] else "cpu"
        logger.info(
            "[onnx_setup] onnxruntime 未安装，按检测自动装 (target=%s, gpu=%s, driver=%s)",
            target,
            cuda["available"],
            cuda.get("driver_version"),
        )
        try:
            res = install_runtime(target)
            state.update(
                installed=res["installed"],
                version=res["version"],
                providers=res["providers"],
                cuda_available=res["cuda_available"],
            )
        except RuntimeError as exc:
            logger.error("[onnx_setup] 自动安装失败: %s", exc)
            state["error"] = str(exc)
        return state

    # 已装 - 检查 GPU/EP 是否匹配
    if cuda["available"] and not rt["cuda_available"]:
        logger.warning(
            "[onnx_setup] 检测到 NVIDIA GPU 但 onnxruntime 只有 CPU EP "
            "(installed=%s, providers=%s)。WD14 打标会跑在 CPU 上（很慢）。"
            "可在 Settings → WD14 点「重装为 GPU 版」。",
            rt["installed"],
            rt["providers"],
        )
    return state
