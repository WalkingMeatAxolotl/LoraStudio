"""LossProtocol：所有训练 loss 的统一接口（ADR 0003 plugin registry）。

设计模仿 training/timestep_samplers/protocol.py 和 training/adapters/protocol.py：
- 必需 1 个方法：compute(pred, target, t) -> Tensor

加新 loss 步骤（参考 ADR 0003 PR-C registry 模式）：
1. 写 training/losses/{name}.py 含 `build(args) -> LossProtocol`
2. losses/__init__.py 的 BUILDERS 字典加一行
3. studio/schema.py 的 `loss_type: Literal[...]` 加枚举值 + 该 loss 专属字段
4. 完。phases/optimizer.py / loop.py / TrainingContext 0 改动。
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

import torch


@runtime_checkable
class LossProtocol(Protocol):
    """训练 loss 统一接口。

    用 Protocol 而不是 ABC：mse 用纯函数包装 / huber 用 class 实现，
    不想强制继承。runtime_checkable 让单测 `isinstance` 校验仍能用。

    **签名稳定性约定**：当前 compute(pred, target, t) 是 v1 签名。未来若引入
    LPIPS / SNR-aware / classifier-free guidance 等需要额外上下文的 loss，
    会以 keyword-only `*, ctx=None` 形式追加（向后兼容；不传时旧实现继续工作）。
    新写的 loss 实现建议提前预留 `def compute(self, pred, target, t, *, ctx=None)`
    签名以避免未来 break；调用方（loop.py）目前不传 ctx，传时机另行公告。
    """

    def compute(
        self,
        pred: torch.Tensor,
        target: torch.Tensor,
        t: torch.Tensor,
    ) -> torch.Tensor:
        """返回 per-element loss tensor，shape 与 pred/target 一致（不做 reduction）。

        pred / target — Flow Matching velocity 预测 vs 目标，shape (B, C, *spatial)
        t              — 当前 batch 的时间步 (B,)，仅 t-dependent loss 需要；
                         mse / constant-δ huber 可忽略
        """
        ...
