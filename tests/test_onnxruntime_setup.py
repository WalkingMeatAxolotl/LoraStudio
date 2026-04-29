"""PP8 — onnxruntime 启动期检测 / 装包逻辑（mock subprocess）。

不真跑 pip / 真启 nvidia-smi；用 monkeypatch 替 subprocess.run + shutil.which
覆盖装包决策表。
"""
from __future__ import annotations

import subprocess
from unittest.mock import MagicMock, patch

import pytest

from studio.services import onnxruntime_setup as ors


# ---------------------------------------------------------------------------
# detect_cuda
# ---------------------------------------------------------------------------


def test_detect_cuda_no_nvidia_smi(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ors.shutil, "which", lambda _: None)
    res = ors.detect_cuda()
    assert res == {"available": False, "driver_version": None, "gpu_name": None}


def test_detect_cuda_present(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ors.shutil, "which", lambda _: "/usr/bin/nvidia-smi")
    fake = MagicMock(returncode=0, stdout="551.86, NVIDIA GeForce RTX 5090\n", stderr="")
    monkeypatch.setattr(ors.subprocess, "run", lambda *a, **k: fake)
    res = ors.detect_cuda()
    assert res == {
        "available": True,
        "driver_version": "551.86",
        "gpu_name": "NVIDIA GeForce RTX 5090",
    }


def test_detect_cuda_returncode_nonzero(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ors.shutil, "which", lambda _: "/usr/bin/nvidia-smi")
    fake = MagicMock(returncode=9, stdout="", stderr="error")
    monkeypatch.setattr(ors.subprocess, "run", lambda *a, **k: fake)
    res = ors.detect_cuda()
    assert res["available"] is False


def test_detect_cuda_subprocess_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ors.shutil, "which", lambda _: "/usr/bin/nvidia-smi")

    def _raise(*_a, **_k):
        raise OSError("permission denied")

    monkeypatch.setattr(ors.subprocess, "run", _raise)
    res = ors.detect_cuda()
    assert res["available"] is False


# ---------------------------------------------------------------------------
# _decide_target
# ---------------------------------------------------------------------------


def test_decide_target_explicit() -> None:
    assert ors._decide_target("gpu").startswith("onnxruntime-gpu")
    assert ors._decide_target("cpu").startswith("onnxruntime")
    assert "gpu" not in ors._decide_target("cpu")


def test_decide_target_auto_with_gpu(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        ors, "detect_cuda",
        lambda: {"available": True, "driver_version": "551.86", "gpu_name": "RTX 5090"},
    )
    assert ors._decide_target("auto").startswith("onnxruntime-gpu")


def test_decide_target_auto_without_gpu(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        ors, "detect_cuda",
        lambda: {"available": False, "driver_version": None, "gpu_name": None},
    )
    res = ors._decide_target("auto")
    assert res.startswith("onnxruntime")
    assert "gpu" not in res


def test_decide_target_invalid() -> None:
    with pytest.raises(ValueError):
        ors._decide_target("xpu")


# ---------------------------------------------------------------------------
# install_runtime — mock pip
# ---------------------------------------------------------------------------


def test_install_runtime_runs_uninstall_then_install(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[list[str]] = []

    def fake_pip(args):
        calls.append(args)
        return 0, "ok"

    monkeypatch.setattr(ors, "_pip", fake_pip)
    monkeypatch.setattr(
        ors, "current_runtime",
        lambda: {
            "installed": "onnxruntime-gpu",
            "version": "1.20.0",
            "providers": ["CUDAExecutionProvider", "CPUExecutionProvider"],
            "cuda_available": True,
        },
    )
    res = ors.install_runtime("gpu")
    assert len(calls) == 2
    assert calls[0][0] == "uninstall"
    assert "onnxruntime-gpu" in calls[0]
    assert "onnxruntime" in calls[0]
    assert calls[1][0] == "install"
    assert any("onnxruntime-gpu" in a for a in calls[1])
    assert res["installed"] == "onnxruntime-gpu"
    assert res["cuda_available"] is True


def test_install_runtime_install_failure_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_pip(args):
        if args[0] == "install":
            return 1, "ERROR: no matching distribution"
        return 0, ""

    monkeypatch.setattr(ors, "_pip", fake_pip)
    with pytest.raises(RuntimeError, match="安装"):
        ors.install_runtime("gpu")


# ---------------------------------------------------------------------------
# bootstrap
# ---------------------------------------------------------------------------


def test_bootstrap_installs_when_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        ors, "detect_cuda",
        lambda: {"available": True, "driver_version": "551.86", "gpu_name": "RTX 5090"},
    )
    monkeypatch.setattr(
        ors, "current_runtime",
        lambda: {"installed": None, "version": None, "providers": [], "cuda_available": False},
    )
    captured: dict = {}

    def fake_install(target):
        captured["target"] = target
        return {
            "target": "onnxruntime-gpu>=1.20",
            "installed": "onnxruntime-gpu",
            "version": "1.20.0",
            "providers": ["CUDAExecutionProvider", "CPUExecutionProvider"],
            "cuda_available": True,
            "stdout": "",
        }

    monkeypatch.setattr(ors, "install_runtime", fake_install)
    state = ors.bootstrap()
    assert captured["target"] == "gpu"
    assert state["installed"] == "onnxruntime-gpu"
    assert state["cuda_available"] is True


def test_bootstrap_warns_on_cpu_pkg_with_gpu_present(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """有 GPU 但只装了 CPU 包 → 不自动重装，仅 warn。"""
    monkeypatch.setattr(
        ors, "detect_cuda",
        lambda: {"available": True, "driver_version": "551.86", "gpu_name": "RTX 5090"},
    )
    monkeypatch.setattr(
        ors, "current_runtime",
        lambda: {
            "installed": "onnxruntime",
            "version": "1.18.0",
            "providers": ["CPUExecutionProvider"],
            "cuda_available": False,
        },
    )
    install_called = []
    monkeypatch.setattr(
        ors, "install_runtime",
        lambda *a: install_called.append(a) or {},
    )
    with caplog.at_level("WARNING"):
        state = ors.bootstrap()
    assert install_called == []
    assert state["installed"] == "onnxruntime"
    assert any("CPU EP" in r.message for r in caplog.records)


def test_bootstrap_silent_when_already_correct(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        ors, "detect_cuda",
        lambda: {"available": True, "driver_version": "551.86", "gpu_name": "RTX 5090"},
    )
    monkeypatch.setattr(
        ors, "current_runtime",
        lambda: {
            "installed": "onnxruntime-gpu",
            "version": "1.20.0",
            "providers": ["CUDAExecutionProvider", "CPUExecutionProvider"],
            "cuda_available": True,
        },
    )
    install_called = []
    monkeypatch.setattr(ors, "install_runtime", lambda *a: install_called.append(a) or {})
    state = ors.bootstrap()
    assert install_called == []
    assert state["cuda_available"] is True


def test_bootstrap_install_failure_returns_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        ors, "detect_cuda",
        lambda: {"available": False, "driver_version": None, "gpu_name": None},
    )
    monkeypatch.setattr(
        ors, "current_runtime",
        lambda: {"installed": None, "version": None, "providers": [], "cuda_available": False},
    )

    def _raise(_):
        raise RuntimeError("pip exploded")

    monkeypatch.setattr(ors, "install_runtime", _raise)
    state = ors.bootstrap()
    assert "error" in state
    assert "pip exploded" in state["error"]
