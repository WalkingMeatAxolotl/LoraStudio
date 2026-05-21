"""Optimizer utils 测试 — 重点覆盖 PPSF 接入。

- optimizer_eval_mode context manager 对 PPSF / 非 PPSF 行为
- create_prodigy_plus_schedulefree 工厂在依赖缺失时友好报错
- 工厂 lr 强制 1.0 + betas 默认覆盖逻辑
"""
from __future__ import annotations

import builtins
import importlib
import sys
from unittest.mock import MagicMock

import pytest
import torch
from torch import nn

from utils.optimizer_utils import (
    create_pion,
    create_prodigy_plus_schedulefree,
    optimizer_eval_mode,
)


# ---------------------------------------------------------------------------
# optimizer_eval_mode
# ---------------------------------------------------------------------------


def test_eval_mode_noop_for_plain_adamw() -> None:
    """AdamW 没有 .eval/.train 方法，ctx 静默 no-op，不抛错。"""
    model = nn.Linear(4, 4)
    optim = torch.optim.AdamW(model.parameters(), lr=1e-3)
    # AdamW 没有 .train / .eval 方法 — ctx 应该静默走过
    with optimizer_eval_mode(optim):
        # 还能正常调用 — 没有 side effect
        assert optim.param_groups[0]["lr"] == 1e-3


def test_eval_mode_calls_eval_and_train_on_schedulefree_like() -> None:
    """PPSF-like 优化器 ctx 进入调 .eval()，退出调 .train()。"""
    fake_opt = MagicMock(spec=["eval", "train"])
    with optimizer_eval_mode(fake_opt):
        fake_opt.eval.assert_called_once_with()
        fake_opt.train.assert_not_called()
    fake_opt.train.assert_called_once_with()


def test_eval_mode_restores_train_on_exception() -> None:
    """ctx 内部抛异常时也要保证切回 .train() —— 否则训练权重永远停在 averaged 状态。"""
    fake_opt = MagicMock(spec=["eval", "train"])

    class Boom(RuntimeError):
        pass

    with pytest.raises(Boom):
        with optimizer_eval_mode(fake_opt):
            raise Boom()

    fake_opt.eval.assert_called_once_with()
    fake_opt.train.assert_called_once_with()


def test_eval_mode_skips_if_only_partial_methods() -> None:
    """只有 .eval 没有 .train（或反过来）的优化器 — 视为非 PPSF，no-op。
    防止误调单边方法把内部状态搞坏。"""
    fake_opt = MagicMock(spec=["eval"])  # 只有 eval 没 train
    with optimizer_eval_mode(fake_opt):
        pass
    fake_opt.eval.assert_not_called()


# ---------------------------------------------------------------------------
# create_pion
# ---------------------------------------------------------------------------


def test_pion_preserves_singular_values_for_matrix_parameter() -> None:
    """Pion branch should update a matrix by orthogonal equivalence."""
    torch.manual_seed(0)
    param = nn.Parameter(torch.randn(4, 3))
    before = torch.linalg.svdvals(param.detach().float())

    optim = create_pion(
        [param],
        lr=1e-3,
        betas=(0.0, 0.0),
        use_second_moment=False,
        alternating=False,
        max_side=8,
    )
    param.grad = torch.randn_like(param)
    optim.step()

    after = torch.linalg.svdvals(param.detach().float())
    assert torch.allclose(after, before, atol=1e-5, rtol=1e-5)
    assert not torch.allclose(param.grad, torch.zeros_like(param.grad))


def test_pion_falls_back_to_adamw_for_zero_matrix() -> None:
    """LoRA/LoKr zero-init matrices must not be locked by spectrum preservation."""
    param = nn.Parameter(torch.zeros(4, 3))
    optim = create_pion(
        [param],
        lr=1e-2,
        betas=(0.0, 0.0),
        use_second_moment=False,
        max_side=8,
        fallback_zero=True,
    )
    param.grad = torch.ones_like(param)
    optim.step()

    assert torch.count_nonzero(param.detach()).item() == param.numel()


def test_pion_falls_back_to_adamw_for_bias_parameter() -> None:
    """Non-matrix trainables use the AdamW-compatible fallback path."""
    param = nn.Parameter(torch.zeros(4))
    optim = create_pion([param], lr=1e-2, betas=(0.0, 0.0))
    param.grad = torch.ones_like(param)
    optim.step()

    assert torch.all(param.detach() < 0)


# ---------------------------------------------------------------------------
# create_prodigy_plus_schedulefree
# ---------------------------------------------------------------------------


def _has_ppsf() -> bool:
    try:
        importlib.import_module("prodigyplus")
        return True
    except ImportError:
        return False


def test_create_ppsf_import_error_message(monkeypatch: pytest.MonkeyPatch) -> None:
    """没装 PPSF 时报错信息要包含安装提示，而不是裸 ImportError。

    用 builtins.__import__ 强制让 `from prodigyplus import ...` 抛 ImportError，
    不依赖运行环境是否真装了 PPSF（CI / dev / 本地 venv 都能跑）。
    """
    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "prodigyplus" or name.startswith("prodigyplus."):
            raise ImportError("simulated: no prodigyplus")
        return real_import(name, *args, **kwargs)

    monkeypatch.delitem(sys.modules, "prodigyplus", raising=False)
    monkeypatch.setattr(builtins, "__import__", fake_import)

    model = nn.Linear(4, 4)
    with pytest.raises(ImportError, match="prodigy-plus-schedule-free"):
        create_prodigy_plus_schedulefree(model.parameters(), lr=1.0)


@pytest.mark.skipif(not _has_ppsf(), reason="PPSF 未安装")
def test_create_ppsf_forces_lr_to_one(caplog: pytest.LogCaptureFixture) -> None:
    """传非 1.0 的 lr 时强制覆盖并 WARN（PPSF 要求 lr=1.0）。"""
    import logging
    model = nn.Linear(4, 4)
    with caplog.at_level(logging.WARNING, logger="utils.optimizer_utils"):
        optim = create_prodigy_plus_schedulefree(model.parameters(), lr=1e-4)
    assert any(
        "lr=1.0" in r.getMessage() and r.levelno >= logging.WARNING
        for r in caplog.records
    ), f"expected WARNING with 'lr=1.0', got: {[r.getMessage() for r in caplog.records]}"
    assert optim.param_groups[0]["lr"] == 1.0


@pytest.mark.skipif(not _has_ppsf(), reason="PPSF 未安装")
def test_create_ppsf_overrides_pytorch_default_betas() -> None:
    """上层 create_optimizer 默认 betas=(0.9, 0.999) 时，工厂内部覆盖为 PPSF 推荐 (0.9, 0.99)。
    用户显式传别的值就尊重。"""
    model = nn.Linear(4, 4)
    # 不显式传 betas — 应被工厂覆盖
    optim = create_prodigy_plus_schedulefree(model.parameters(), lr=1.0, betas=(0.9, 0.999))
    assert optim.param_groups[0]["betas"] == (0.9, 0.99)

    # 显式传则尊重
    model2 = nn.Linear(4, 4)
    optim2 = create_prodigy_plus_schedulefree(model2.parameters(), lr=1.0, betas=(0.95, 0.98))
    assert optim2.param_groups[0]["betas"] == (0.95, 0.98)


@pytest.mark.skipif(not _has_ppsf(), reason="PPSF 未安装")
def test_create_ppsf_exposes_train_eval_methods() -> None:
    """实例化后必须有 .train / .eval 方法 — 否则 optimizer_eval_mode 永远 no-op。"""
    model = nn.Linear(4, 4)
    optim = create_prodigy_plus_schedulefree(model.parameters(), lr=1.0)
    assert hasattr(optim, "train") and callable(optim.train)
    assert hasattr(optim, "eval") and callable(optim.eval)
