"""loss_weighting 单元测试。

主要覆盖：
- detail_inv_t 默认 clamp 范围 [1, 5] —— 防 PR 把默认行为改坏
- detail_inv_t_min/max 自定义边界生效（PR：参数化原本写死的上下限）
- min > max 由 schema validator fail-fast 拒绝（替代历史的静默 swap）
- 新参数只影响 detail_inv_t，不影响 min_snr / cosmap / none
- weight_cap_ratio × detail_inv_t 联合作用（cap 在 detail_inv_t clamp 后再生效）

其他 scheme（min_snr 公式 / cosmap 公式）不在本 PR 范围内重测。
"""
from __future__ import annotations

import pytest
import torch
from pydantic import ValidationError

from studio.schema import TrainingConfig
from training.loss_weighting import compute_loss_weight


# ---------------------------------------------------------------------------
# detail_inv_t 默认行为回归
# ---------------------------------------------------------------------------


def test_detail_inv_t_default_matches_legacy_clamp():
    """默认参数下，clamp 行为应等价于历史 hardcode [1, 5]：
        t=0.5  → 1/t=2     → 未 clamp → w=2
        t=0.1  → 1/t=10    → 触上界 → w=5
        t=0.9  → 1/t≈1.11  → 未 clamp
        t=0.999→ 1/t≈1.001 → 未 clamp（默认下界 1.0 在 t∈(0,1) 下几乎不生效）
    """
    t = torch.tensor([0.5, 0.1, 0.9, 0.999])
    w = compute_loss_weight(t, scheme="detail_inv_t")
    expected = torch.tensor([2.0, 5.0, 1.0 / 0.9, 1.0 / 0.999])
    torch.testing.assert_close(w, expected, rtol=1e-4, atol=1e-4)


def test_detail_inv_t_extreme_low_t_clamps_to_max():
    """t 趋近 0 时 1/t 爆炸，必须被 max 截住（默认 5）。"""
    t = torch.tensor([1e-5, 1e-3, 0.0])  # 0.0 会被 eps 处理
    w = compute_loss_weight(t, scheme="detail_inv_t")
    assert torch.all(w <= 5.0 + 1e-6)
    assert torch.all(w == 5.0)


# ---------------------------------------------------------------------------
# 自定义 min/max 生效
# ---------------------------------------------------------------------------


def test_detail_inv_t_custom_max_hazy_profile():
    """雾蒙蒙画风用 [1, 3]：t=0.1 应该 clamp 到 3 而不是 5。"""
    t = torch.tensor([0.5, 0.1, 0.9])
    w = compute_loss_weight(t, scheme="detail_inv_t", detail_inv_t_min=1.0, detail_inv_t_max=3.0)
    expected = torch.tensor([2.0, 3.0, 1.0 / 0.9])
    torch.testing.assert_close(w, expected, rtol=1e-4, atol=1e-4)


def test_detail_inv_t_custom_max_aggressive_profile():
    """激进风用 [1, 8]：t=0.1 应该 clamp 到 8。"""
    t = torch.tensor([0.5, 0.1, 0.05])
    w = compute_loss_weight(t, scheme="detail_inv_t", detail_inv_t_min=1.0, detail_inv_t_max=8.0)
    # t=0.05 → 1/t=20 → clamp 到 8
    expected = torch.tensor([2.0, 8.0, 8.0])
    torch.testing.assert_close(w, expected, rtol=1e-4, atol=1e-4)


def test_detail_inv_t_custom_min_lifts_high_t():
    """提高下限到 1.5：t=0.9 (1/t≈1.11) 应被抬到 1.5。"""
    t = torch.tensor([0.9, 0.999])
    w = compute_loss_weight(t, scheme="detail_inv_t", detail_inv_t_min=1.5, detail_inv_t_max=5.0)
    assert torch.all(w >= 1.5 - 1e-6)


# ---------------------------------------------------------------------------
# 边界 / 健壮性
# ---------------------------------------------------------------------------


def test_detail_inv_t_min_equals_max_collapses_to_constant():
    """min == max 时 clamp 把所有权重压成一个常数（合法用例，schema 允许 min <= max）。"""
    t = torch.tensor([0.05, 0.5, 0.95])
    w = compute_loss_weight(t, scheme="detail_inv_t", detail_inv_t_min=2.5, detail_inv_t_max=2.5)
    expected = torch.full_like(t, 2.5)
    torch.testing.assert_close(w, expected)


# ---------------------------------------------------------------------------
# 不影响其他 scheme
# ---------------------------------------------------------------------------


def test_detail_inv_t_bounds_do_not_affect_min_snr():
    t = torch.tensor([0.1, 0.5, 0.9])
    w_a = compute_loss_weight(t, scheme="min_snr", detail_inv_t_min=99.0, detail_inv_t_max=0.5)
    w_b = compute_loss_weight(t, scheme="min_snr")
    torch.testing.assert_close(w_a, w_b)


def test_detail_inv_t_bounds_do_not_affect_cosmap():
    t = torch.tensor([0.1, 0.5, 0.9])
    w_a = compute_loss_weight(t, scheme="cosmap", detail_inv_t_min=99.0, detail_inv_t_max=0.5)
    w_b = compute_loss_weight(t, scheme="cosmap")
    torch.testing.assert_close(w_a, w_b)


def test_detail_inv_t_bounds_do_not_affect_none():
    t = torch.tensor([0.1, 0.5, 0.9])
    w = compute_loss_weight(t, scheme="none", detail_inv_t_min=99.0, detail_inv_t_max=0.5)
    torch.testing.assert_close(w, torch.ones_like(t))


# ---------------------------------------------------------------------------
# Schema validator：边界 fail-fast（替代历史 swap）
# ---------------------------------------------------------------------------


def _minimal_cfg(**overrides) -> dict:
    """构造能通过 schema 必填校验的最小 dict（detail_inv_t 字段默认值已在 schema 里）。"""
    base = {
        "data_dir": "./dataset",
        "transformer_path": "x.safetensors",
        "vae_path": "x.safetensors",
        "text_encoder_path": "x",
        "t5_tokenizer_path": "x",
    }
    base.update(overrides)
    return base


def test_schema_rejects_detail_inv_t_min_above_max():
    """min > max 在 schema validator 直接抛错（替代 compute_loss_weight 内的 swap）。"""
    with pytest.raises(ValidationError, match="detail_inv_t_min"):
        TrainingConfig(**_minimal_cfg(detail_inv_t_min=5.0, detail_inv_t_max=1.0))


def test_schema_rejects_detail_inv_t_min_below_one():
    """PR #72 follow-up：detail_inv_t_min < 1.0 是死区，schema ge=1.0 拒绝。"""
    with pytest.raises(ValidationError):
        TrainingConfig(**_minimal_cfg(detail_inv_t_min=0.5))


def test_schema_rejects_detail_inv_t_min_zero():
    """边界：完全 0 也应被拒（ge=1.0）。"""
    with pytest.raises(ValidationError):
        TrainingConfig(**_minimal_cfg(detail_inv_t_min=0.0))


def test_schema_rejects_detail_inv_t_min_above_upper_bound():
    """边界上界：detail_inv_t_min 上限是 20，21 应被拒。"""
    with pytest.raises(ValidationError):
        TrainingConfig(**_minimal_cfg(detail_inv_t_min=21.0))


def test_schema_rejects_detail_inv_t_max_above_upper_bound():
    """边界上界：detail_inv_t_max 上限是 50，51 应被拒。"""
    with pytest.raises(ValidationError):
        TrainingConfig(**_minimal_cfg(detail_inv_t_max=51.0))


def test_schema_rejects_weight_cap_ratio_above_upper_bound():
    """边界上界：weight_cap_ratio 上限是 50，51 应被拒。"""
    with pytest.raises(ValidationError):
        TrainingConfig(**_minimal_cfg(weight_cap_ratio=51.0))


def test_schema_accepts_min_equals_max():
    """min == max 是合法配置（清单的边界值），不应触发 validator。"""
    cfg = TrainingConfig(**_minimal_cfg(detail_inv_t_min=3.0, detail_inv_t_max=3.0))
    assert cfg.detail_inv_t_min == 3.0 and cfg.detail_inv_t_max == 3.0


# ---------------------------------------------------------------------------
# weight_cap_ratio × detail_inv_t_* 联合作用
# ---------------------------------------------------------------------------


def test_weight_cap_constrains_detail_inv_t_spread():
    """detail_inv_t 默认 [1, 5] 时 max/min 比 5；开 weight_cap_ratio=2 应把 max 压到 min*2。"""
    # t=[0.1, 0.5, 0.9] → 1/t clamp=[5, 2, 1.111]，max/min=4.5
    # 加 cap=2 → max 应被压到 min*2=2.222（其中 min=1.111）
    t = torch.tensor([0.1, 0.5, 0.9])
    w = compute_loss_weight(t, scheme="detail_inv_t", weight_cap_ratio=2.0)
    w_min = float(w.min())
    w_max = float(w.max())
    assert w_max <= w_min * 2.0 + 1e-5, f"max/min={w_max/w_min:.3f} > cap 2.0"


def test_weight_cap_disabled_preserves_detail_inv_t_spread():
    """cap=0（禁用）时 detail_inv_t 完整 [1, 5] 跨度都保留。"""
    t = torch.tensor([0.1, 0.5, 0.9])
    w_no_cap = compute_loss_weight(t, scheme="detail_inv_t", weight_cap_ratio=0.0)
    # max 应该达到 5（来自 t=0.1）
    assert abs(float(w_no_cap.max()) - 5.0) < 1e-4
