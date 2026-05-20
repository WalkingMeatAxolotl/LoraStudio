"""
Manual partial / scheduled OrthoGrad for LoRA / LoKr training.

背景
====
OrthoGrad 来自 Prieto et al. 2025 (arXiv 2501.04697)。原意是在分类模型 grokking
场景下，去掉梯度中"沿当前权重方向、只放大权重 scale 而不改变预测"的 NLM 漂移。

ProdigyPlusScheduleFree 内置的 ``use_orthograd`` 实现（core_optimiser.py::orthograd_）
把整个参数张量按 view(-1) 视为一个向量，做：

    proj   = <w, g> / (<w, w> + 1e-30)
    g_orth = g - proj * w
    g_orth_scaled = g_orth * (||g|| / (||g_orth|| + 1e-30))

注意第三步：把 g_orth 的范数 *重新拉回到原始 ||g||*，这意味着每一步的梯度
量级不变，但完全没有沿 w 方向的分量。

在 LoKr / LoRA 这种从近零初始化的低秩适配器上的副作用
=====================================================
LoKr 的 forward 是 ``ΔW ≈ scaling · w1 ⊗ (w2_a · w2_b)``，其中：
  * ``lokr_w1``  initialized normal(0, 0.1)  ——  小但非零
  * ``lokr_w2_a`` initialized kaiming        ——  中等 scale
  * ``lokr_w2_b`` initialized **zeros**       ——  从零开始

整个适配器的"幅度"几乎全部来自 ``w2_b`` 从零向上的增长。在 SGD 视角下，
``||p||²`` 的增长来自梯度的"径向分量"  -2·lr·<p, g>。OrthoGrad 把这个分量
精确地置零（且通过重缩放确保张量分量不漂移）：

  * ``w2_b`` 在 ``||w2_b|| ≤ 1e-30`` 时被 OrthoGrad 跳过 → 第一步可以增长一点
  * 此后 ``||w2_b||`` 立刻被锁定在初次增长的微小尺度 → 整个 ΔW 的有效幅度
    被永久压制在接近零的水平，模型只能调整"调谁"，无法调整"调多少"

这与用户在 Anima 上观察到的现象完全一致：开 OrthoGrad 后**全局结构性
特征（脸部、构图大色块）拟合下降，而仅需小幅 ΔW 即可携带的高频局部
模式（笔触、材质）相对反而更明显**。

修复策略
========
1. **参数类排除**：从零起步的 ``lora_B`` / ``lokr_w2_b``、以及 LoKr 的整体
   缩放矩阵 ``lokr_w1``，**永不**应用 OrthoGrad；只在方向为主的
   ``lokr_w2_a`` / ``lora_A`` 上应用。
2. **模块级排除**：cross_attn / output_proj / mlp.layer2 等"幅度承载点"
   可选额外排除。
3. **延迟启用**：在 ``enable_after_step`` 之前不做任何投影 → 让前期结构
   学习以全梯度进行，到步数后再用 OrthoGrad 抑制后期向纹理飘移。
4. **强度混合**：``strength ∈ (0, 1]`` 时返回 ``s·g_orth + (1-s)·g``，给出
   "部分 OrthoGrad"；``ramp_steps>0`` 时在启用步附近线性 ramp。

使用方法
========
1) 在 yaml 顶层加 ``orthograd_mode: "manual"`` 等参数（见 build_config）。
2) 同时把 ``optimizer_args.use_orthograd: false``，避免与 ProdigyPlus 内置
   双重应用。
3) 训练循环里：``apply_partial_orthograd_(named_grad_params, step, cfg)``
   在 ``optimizer.step()`` 之前调用即可。
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Iterable, List, Optional, Tuple

import torch

logger = logging.getLogger(__name__)


# 默认排除：从零或小尺度初始化的"幅度承载"参数。
# 这些子串只要出现在参数完整名字中就会被排除。
DEFAULT_EXCLUDE_PARAM_KEYWORDS: Tuple[str, ...] = (
    "lokr_w1",
    "lokr_w2_b",
    "lora_B",
)

# 默认空：模块级排除是可选的额外保护层，由用户按需开启。
DEFAULT_EXCLUDE_MODULE_KEYWORDS: Tuple[str, ...] = ()


@dataclass
class OrthoGradConfig:
    enable: bool = False
    enable_after_step: int = 0
    ramp_steps: int = 0
    strength: float = 1.0
    rescale_to_original_norm: bool = True   # 与 ProdigyPlus 内置一致；False 则不重缩放
    exclude_param_keywords: Tuple[str, ...] = DEFAULT_EXCLUDE_PARAM_KEYWORDS
    exclude_module_keywords: Tuple[str, ...] = DEFAULT_EXCLUDE_MODULE_KEYWORDS

    # 运行期统计（debug 用）
    _logged_excluded: bool = field(default=False, repr=False)
    _logged_first_apply: bool = field(default=False, repr=False)


def _normalize_keywords(value) -> Tuple[str, ...]:
    if value is None:
        return tuple()
    if isinstance(value, str):
        return (value,) if value else tuple()
    return tuple(str(v) for v in value if str(v))


def build_orthograd_config(args) -> OrthoGradConfig:
    """从 argparse Namespace / dict-like 构建配置。

    支持的 yaml 顶层键：
      orthograd_mode: "off" | "manual"        # "manual" 才启用本模块
      orthograd_enable_after: int             # 0 = 全程，>0 = 该步之后才启用
      orthograd_ramp_steps:   int             # >0 时在启用步开始线性 ramp 到 strength
      orthograd_strength:     float           # 0..1，<1 则部分 OrthoGrad
      orthograd_rescale:      bool            # 是否把 ||g_orth|| 拉回 ||g||（默认 True）
      orthograd_exclude_param_keywords: list  # 默认 ['lokr_w1','lokr_w2_b','lora_B']
      orthograd_exclude_module_keywords: list # 默认 []
    """
    mode = str(getattr(args, "orthograd_mode", "off") or "off").lower()
    if mode != "manual":
        return OrthoGradConfig(enable=False)

    excl_param = getattr(args, "orthograd_exclude_param_keywords", None)
    excl_param = _normalize_keywords(excl_param) if excl_param is not None else DEFAULT_EXCLUDE_PARAM_KEYWORDS
    excl_module = _normalize_keywords(getattr(args, "orthograd_exclude_module_keywords", None) or [])

    cfg = OrthoGradConfig(
        enable=True,
        enable_after_step=int(getattr(args, "orthograd_enable_after", 0) or 0),
        ramp_steps=max(int(getattr(args, "orthograd_ramp_steps", 0) or 0), 0),
        strength=float(getattr(args, "orthograd_strength", 1.0) or 1.0),
        rescale_to_original_norm=bool(getattr(args, "orthograd_rescale", True)),
        exclude_param_keywords=excl_param,
        exclude_module_keywords=excl_module,
    )
    cfg.strength = max(0.0, min(1.0, cfg.strength))
    logger.info(
        "[orthograd] manual mode ON  enable_after=%d ramp=%d strength=%.3f rescale=%s "
        "exclude_param=%s exclude_module=%s",
        cfg.enable_after_step, cfg.ramp_steps, cfg.strength, cfg.rescale_to_original_norm,
        cfg.exclude_param_keywords, cfg.exclude_module_keywords,
    )
    return cfg


def _should_apply(name: str, cfg: OrthoGradConfig) -> bool:
    for kw in cfg.exclude_param_keywords:
        if kw in name:
            return False
    for kw in cfg.exclude_module_keywords:
        if kw in name:
            return False
    return True


def _current_strength(step: int, cfg: OrthoGradConfig) -> float:
    if step < cfg.enable_after_step:
        return 0.0
    if cfg.ramp_steps <= 0:
        return cfg.strength
    progress = (step - cfg.enable_after_step) / float(cfg.ramp_steps)
    return cfg.strength * max(0.0, min(1.0, progress))


@torch.no_grad()
def apply_partial_orthograd_(
    named_params: Iterable[Tuple[str, torch.nn.Parameter]],
    step: int,
    cfg: OrthoGradConfig,
    eps: float = 1e-30,
) -> None:
    """In-place 修改 ``p.grad``，对未被排除且当前步已启用的参数应用 OrthoGrad。

    Args:
        named_params: 可迭代的 (full_name, parameter) 序对，通常来自
            ``[(n, p) for n, p in model.named_parameters() if p.requires_grad]``
        step: 当前 optimizer step（注意应是 step 而不是 micro-batch idx）
        cfg: 由 build_orthograd_config 构造的配置
        eps: 数值稳定项；与 ProdigyPlus 内置一致取 1e-30
    """
    if not cfg.enable:
        return
    s = _current_strength(step, cfg)
    if s <= 0.0:
        return

    excluded_for_log: List[str] = []
    applied_count = 0

    for name, p in named_params:
        if p.grad is None:
            continue
        if not _should_apply(name, cfg):
            if not cfg._logged_excluded:
                excluded_for_log.append(name)
            continue

        g = p.grad
        w = p.data

        # 与 ProdigyPlus 一致：先做整张量 view(-1) 的 dot 运算
        w_flat = w.view(-1)
        g_flat = g.view(-1)

        w_norm_sq = torch.dot(w_flat, w_flat)
        if float(w_norm_sq) <= eps:
            # 权重还几乎在零附近（典型为 lokr_w2_b 第一步），不能投影 → 跳过
            continue

        proj_coef = torch.dot(w_flat, g_flat) / (w_norm_sq + eps)
        # g_orth = g - proj * w，做在 flat view 上同步修改
        g_orth_flat = g_flat - proj_coef * w_flat

        if cfg.rescale_to_original_norm:
            g_norm = g_flat.norm(2)
            g_orth_norm = g_orth_flat.norm(2)
            g_orth_flat = g_orth_flat * (g_norm / (g_orth_norm + eps))

        # blended：s * g_orth + (1-s) * g_orig
        if s < 1.0:
            new_grad_flat = s * g_orth_flat + (1.0 - s) * g_flat
        else:
            new_grad_flat = g_orth_flat

        # 写回原 grad（保留原 dtype/shape）
        p.grad.copy_(new_grad_flat.view_as(g))
        applied_count += 1

    if not cfg._logged_excluded and excluded_for_log:
        # 仅打印前若干条，避免刷屏
        sample = ", ".join(excluded_for_log[:6])
        more = "" if len(excluded_for_log) <= 6 else f" 等 {len(excluded_for_log)} 个"
        logger.info("[orthograd] excluded params (sample): %s%s", sample, more)
        cfg._logged_excluded = True

    if not cfg._logged_first_apply and applied_count > 0:
        logger.info(
            "[orthograd] first applied at step=%d strength=%.3f, applied to %d params",
            step, s, applied_count,
        )
        cfg._logged_first_apply = True


def assert_no_double_orthograd(args) -> None:
    """如果手动 OrthoGrad 已启用，强烈建议把 ProdigyPlus 内置的关掉，否则会被
    应用两次。这里只 warn，不强制覆盖。"""
    mode = str(getattr(args, "orthograd_mode", "off") or "off").lower()
    if mode != "manual":
        return
    opt_args = getattr(args, "optimizer_args", None) or {}
    if isinstance(opt_args, dict) and bool(opt_args.get("use_orthograd", False)):
        logger.warning(
            "[orthograd] orthograd_mode=manual 同时 optimizer_args.use_orthograd=true："
            "OrthoGrad 会被应用两次（先在 trainer 里，再在 ProdigyPlus 里），通常会让"
            "训练几乎不动。建议把 optimizer_args.use_orthograd 改为 false。"
        )
