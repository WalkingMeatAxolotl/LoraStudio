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

    `installed` 来自 dist-info（pip 视角）；`providers` 是 import 后实际可用 EP（已加载
    的 native 模块视角）。两者**可能不一致** —— 装完包不重启 → dist-info 显示新包，
    providers 仍是旧包的。`restart_required` 表示这种状态。
    """
    installed_pkg, installed_ver = _query_dist_info()
    process_version: Optional[str] = None
    providers: list[str] = []
    try:
        import onnxruntime as ort  # type: ignore[import-not-found]
        providers = list(ort.get_available_providers())
        process_version = getattr(ort, "__version__", None)
    except ImportError:
        pass

    # 检测「pip 装的包名/版本」 vs 「进程里 import 的版本」不一致
    # （onnxruntime 是 C extension，pip 重装不会热替换已 import 的 .pyd）
    restart_required = False
    if installed_pkg is not None and process_version is not None:
        # 版本号不一致直接判定 stale
        if installed_ver != process_version:
            restart_required = True
        # 包名: GPU 包应该有 CUDA EP，CPU 包不会有
        elif installed_pkg == GPU_PACKAGE and "CUDAExecutionProvider" not in providers:
            restart_required = True

    return {
        "installed": installed_pkg,
        "version": installed_ver or process_version,
        "providers": providers,
        "cuda_available": "CUDAExecutionProvider" in providers,
        "restart_required": restart_required,
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
    返回 {"target", "installed_pkg", "installed_version", "restart_required": True, "stdout"}
    失败抛 RuntimeError。

    **重要**：onnxruntime 是 C extension，pip 卸装重装后**当前进程**里已 import 的
    .pyd/.so 不会被热替换 —— 必须重启 Studio 才能切换 EP。所以本函数不再尝试 reload；
    返回 `restart_required=True` 让 UI 提示用户重启。
    """
    spec = _decide_target(target)
    rc1, log1 = _pip(["uninstall", "-y", GPU_PACKAGE, CPU_PACKAGE])
    rc2, log2 = _pip(["install", "--upgrade", spec])
    if rc2 != 0:
        raise RuntimeError(f"安装 {spec} 失败（rc={rc2}）:\n{log2}")

    # 直接读 dist-info 拿新装的版本（不 import；进程里仍是旧的 native 模块）
    new_pkg, new_ver = _query_dist_info()
    return {
        "target": spec,
        "installed_pkg": new_pkg,
        "installed_version": new_ver,
        "restart_required": True,
        "stdout": log1 + log2,
    }


def _query_dist_info() -> tuple[Optional[str], Optional[str]]:
    """从 dist-info 读两个互斥包的安装状态。返回 (pkg_name, version)。"""
    try:
        from importlib.metadata import PackageNotFoundError, version as _ver
        for pkg in (GPU_PACKAGE, CPU_PACKAGE):
            try:
                return pkg, _ver(pkg)
            except PackageNotFoundError:
                continue
    except Exception:  # noqa: BLE001
        pass
    return None, None


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
            install_runtime(target)
            # bootstrap 在 cli.py 起 server 子进程前跑；server 是新进程会 fresh import → 装完直接重读
            state.update(current_runtime())
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
