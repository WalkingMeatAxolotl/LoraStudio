"""Pion optimizer build wrapper."""

from __future__ import annotations


def build(args, params, lr: float, weight_decay: float):
    """Instantiate Pion with AdamW fallback for non-matrix parameters."""
    from utils.optimizer_utils import create_optimizer

    return create_optimizer(
        optimizer_type="pion",
        params=params,
        learning_rate=lr,
        weight_decay=weight_decay,
        betas=(
            float(getattr(args, "pion_beta1", 0.9)),
            float(getattr(args, "pion_beta2", 0.99)),
        ),
        rms_scale=float(getattr(args, "pion_rms_scale", 1.0)),
        max_side=int(getattr(args, "pion_max_side", 256)),
        fallback_zero=bool(getattr(args, "pion_fallback_zero", True)),
        use_second_moment=bool(getattr(args, "pion_use_second_moment", True)),
        alternating=bool(getattr(args, "pion_alternating", True)),
        exp=str(getattr(args, "pion_exp", "exact")),
    )
