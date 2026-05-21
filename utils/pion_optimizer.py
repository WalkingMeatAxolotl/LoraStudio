"""Pion-style spectrum-preserving optimizer.

This implementation follows the core Pion update for matrix parameters:

    W <- exp(-lr * A_out) W exp(-lr * A_in)

where A_out and A_in are skew-symmetric Lie-algebra directions derived from
the weight gradient.  Non-matrix parameters and unsafe matrix cases fall back
to AdamW so existing LoRA/LoKr training can still move zero-initialized factors.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any, Optional

import torch
from torch import Tensor
from torch.optim import Optimizer


class Pion(Optimizer):
    """Experimental Pion optimizer with AdamW fallback.

    Pion updates only matrix sides whose square generator is at most
    ``max_side``.  This keeps DiT LoRA/LoKr practical: skinny factors rotate on
    their low-rank side instead of allocating a huge hidden-size square state.
    """

    def __init__(
        self,
        params: Iterable[Tensor] | Iterable[dict[str, Any]],
        lr: float = 1e-4,
        betas: tuple[float, float] = (0.9, 0.99),
        eps: float = 1e-8,
        weight_decay: float = 0.0,
        rms_scale: float = 1.0,
        max_side: int = 256,
        min_dim: int = 2,
        fallback_zero: bool = True,
        zero_norm_eps: float = 1e-12,
        use_second_moment: bool = True,
        alternating: bool = True,
        exp: str = "exact",
    ) -> None:
        if lr <= 0:
            raise ValueError(f"Invalid lr: {lr}")
        if eps <= 0:
            raise ValueError(f"Invalid eps: {eps}")
        if not 0 <= betas[0] < 1:
            raise ValueError(f"Invalid beta1: {betas[0]}")
        if not 0 <= betas[1] < 1:
            raise ValueError(f"Invalid beta2: {betas[1]}")
        if rms_scale <= 0:
            raise ValueError(f"Invalid rms_scale: {rms_scale}")
        if max_side < 1:
            raise ValueError(f"Invalid max_side: {max_side}")
        if min_dim < 1:
            raise ValueError(f"Invalid min_dim: {min_dim}")
        if exp not in {"exact", "second_order"}:
            raise ValueError("exp must be 'exact' or 'second_order'")

        defaults = dict(
            lr=lr,
            betas=tuple(betas),
            eps=eps,
            weight_decay=weight_decay,
            rms_scale=rms_scale,
            max_side=max_side,
            min_dim=min_dim,
            fallback_zero=fallback_zero,
            zero_norm_eps=zero_norm_eps,
            use_second_moment=use_second_moment,
            alternating=alternating,
            exp=exp,
        )
        super().__init__(params, defaults)

    @torch.no_grad()
    def step(self, closure: Optional[Any] = None):
        loss = None
        if closure is not None:
            with torch.enable_grad():
                loss = closure()

        for group in self.param_groups:
            for p in group["params"]:
                if p.grad is None:
                    continue
                if not self._pion_step(p, p.grad, group):
                    self._adamw_step(p, p.grad, group)
        return loss

    def _compute_dtype(self, p: Tensor) -> torch.dtype:
        return torch.float64 if p.dtype == torch.float64 else torch.float32

    def _eligible_sides(self, p: Tensor, group: dict[str, Any]) -> list[str]:
        if p.ndim != 2:
            return []
        rows, cols = p.shape
        min_dim = int(group["min_dim"])
        if rows < min_dim or cols < min_dim:
            return []

        max_side = int(group["max_side"])
        sides: list[str] = []
        if rows <= max_side:
            sides.append("out")
        if cols <= max_side:
            sides.append("in")
        return sides

    def _select_sides(
        self,
        sides: list[str],
        step: int,
        alternating: bool,
    ) -> list[str]:
        if not sides:
            return []
        if not alternating or len(sides) == 1:
            return sides
        # Match the paper's alternating spirit: input side on odd steps, output
        # side on even steps, falling back if one side is unavailable.
        preferred = "in" if step % 2 == 1 else "out"
        return [preferred] if preferred in sides else [sides[0]]

    def _pion_step(self, p: Tensor, grad: Tensor, group: dict[str, Any]) -> bool:
        sides = self._eligible_sides(p, group)
        if not sides:
            return False

        compute_dtype = self._compute_dtype(p)
        weight = p.detach().to(dtype=compute_dtype)
        if bool(group["fallback_zero"]):
            norm = torch.linalg.vector_norm(weight)
            if not torch.isfinite(norm) or float(norm) <= float(group["zero_norm_eps"]):
                return False

        grad_f = grad.detach().to(dtype=compute_dtype)
        state = self.state[p]
        state["step"] = int(state.get("step", 0)) + 1
        pion_step = int(state.get("pion_step", 0)) + 1
        state["pion_step"] = pion_step

        selected = self._select_sides(sides, state["step"], bool(group["alternating"]))
        if not selected:
            return False

        directions: dict[str, Tensor] = {}
        tangent = torch.zeros_like(weight)

        if "out" in selected:
            raw_out = grad_f @ weight.T
            gen_out = raw_out - raw_out.T
            direction_out = self._precondition_generator(
                state, "out", gen_out, pion_step, group
            )
            directions["out"] = direction_out
            tangent.add_(direction_out @ weight, alpha=-1.0)

        if "in" in selected:
            raw_in = weight.T @ grad_f
            gen_in = raw_in - raw_in.T
            direction_in = self._precondition_generator(
                state, "in", gen_in, pion_step, group
            )
            directions["in"] = direction_in
            tangent.add_(weight @ direction_in, alpha=-1.0)

        tangent_rms = torch.sqrt(torch.mean(tangent.square()))
        if not torch.isfinite(tangent_rms) or float(tangent_rms) <= float(group["eps"]):
            return True

        lr = float(group["lr"])
        alpha = float(group["rms_scale"]) / (float(tangent_rms) + float(group["eps"]))
        next_weight = weight

        if "out" in directions:
            out_map = self._orthogonal_map(-lr * alpha * directions["out"], group)
            next_weight = out_map @ next_weight
        if "in" in directions:
            in_map = self._orthogonal_map(-lr * alpha * directions["in"], group)
            next_weight = next_weight @ in_map

        p.copy_(next_weight.to(dtype=p.dtype))
        return True

    def _precondition_generator(
        self,
        state: dict[str, Any],
        side: str,
        generator: Tensor,
        step: int,
        group: dict[str, Any],
    ) -> Tensor:
        beta1, beta2 = group["betas"]
        exp_avg_key = f"pion_exp_avg_{side}"
        exp_avg = self._state_tensor(state, exp_avg_key, generator)
        exp_avg.mul_(beta1).add_(generator, alpha=1.0 - beta1)
        direction = exp_avg / (1.0 - beta1**step)

        if bool(group["use_second_moment"]):
            exp_avg_sq_key = f"pion_exp_avg_sq_{side}"
            exp_avg_sq = self._state_tensor(state, exp_avg_sq_key, generator)
            exp_avg_sq.mul_(beta2).addcmul_(generator, generator, value=1.0 - beta2)
            denom = (exp_avg_sq / (1.0 - beta2**step)).sqrt().add_(group["eps"])
            direction = direction / denom

        # Elementwise second-moment preconditioning should preserve skew symmetry
        # in exact arithmetic; re-project to the Lie algebra to absorb roundoff.
        return 0.5 * (direction - direction.T)

    def _orthogonal_map(self, skew_step: Tensor, group: dict[str, Any]) -> Tensor:
        if group["exp"] == "second_order":
            eye = torch.eye(
                skew_step.shape[0],
                dtype=skew_step.dtype,
                device=skew_step.device,
            )
            return eye + skew_step + 0.5 * (skew_step @ skew_step)
        return torch.linalg.matrix_exp(skew_step)

    def _adamw_step(self, p: Tensor, grad: Tensor, group: dict[str, Any]) -> None:
        compute_dtype = self._compute_dtype(p)
        grad_f = grad.detach().to(dtype=compute_dtype)
        param = p.detach().to(dtype=compute_dtype)
        state = self.state[p]
        state["step"] = int(state.get("step", 0)) + 1
        adam_step = int(state.get("adam_step", 0)) + 1
        state["adam_step"] = adam_step

        if group["weight_decay"] != 0:
            param = param.mul(1.0 - float(group["lr"]) * float(group["weight_decay"]))

        exp_avg = self._state_tensor(state, "adam_exp_avg", grad_f)
        exp_avg_sq = self._state_tensor(state, "adam_exp_avg_sq", grad_f)
        beta1, beta2 = group["betas"]
        exp_avg.mul_(beta1).add_(grad_f, alpha=1.0 - beta1)
        exp_avg_sq.mul_(beta2).addcmul_(grad_f, grad_f, value=1.0 - beta2)

        bias_correction1 = 1.0 - beta1**adam_step
        bias_correction2 = 1.0 - beta2**adam_step
        denom = (exp_avg_sq / bias_correction2).sqrt().add_(group["eps"])
        update = (exp_avg / bias_correction1) / denom
        param.add_(update, alpha=-float(group["lr"]))
        p.copy_(param.to(dtype=p.dtype))

    def _state_tensor(
        self,
        state: dict[str, Any],
        key: str,
        like: Tensor,
    ) -> Tensor:
        existing = state.get(key)
        if (
            existing is None
            or existing.shape != like.shape
            or existing.dtype != like.dtype
            or existing.device != like.device
        ):
            existing = torch.zeros_like(like)
            state[key] = existing
        return existing
