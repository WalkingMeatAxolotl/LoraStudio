"""LycorisNetwork 的 Anima-friendly 封装。

替换 anima_train.py 中的 LoRAInjector / LoRALayer / LoKrLayer / LoRALinear。

API 与原 LoRAInjector 等价（drop-in），并保留 w1 排除 weight_decay 的优化。
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import torch
import torch.nn as nn
from safetensors.torch import save_file
from safetensors import safe_open

from utils.lokr_preset import apply as apply_anima_preset

logger = logging.getLogger(__name__)


class AnimaLycorisAdapter:
    """对 LycorisNetwork 的等价封装，对外接口对齐原 LoRAInjector。

    对比原 LoRAInjector：
    - inject()/get_params()/get_param_groups()/state_dict()/save()/load() 等价
    - 多支持 algo: lora/lokr/loha + DoRA/dropout/rs_lora 等 LyCORIS 原生参数
    - 保留 w1 排除 weight_decay 的优化
    - 保存键名前缀 lora_unet_*，与现 ComfyUI workflow 完全兼容
    """

    def __init__(
        self,
        algo: str = "lokr",
        rank: int = 32,
        alpha: float = 16.0,
        factor: int = 8,
        dropout: float = 0.0,
        rank_dropout: float = 0.0,
        module_dropout: float = 0.0,
        weight_decompose: bool = False,
        rs_lora: bool = False,
    ):
        self.algo = algo
        self.rank = rank
        self.alpha = alpha
        self.factor = factor
        self.dropout = dropout
        self.rank_dropout = rank_dropout
        self.module_dropout = module_dropout
        self.weight_decompose = weight_decompose
        self.rs_lora = rs_lora

        # use_lokr 是原 LoRAInjector 的字段，anima_train.py 多处用它做分支判断；
        # 保留此字段以避免改动太多调用点。
        self.use_lokr = (algo == "lokr")
        self.network = None  # lazy init in inject()

    # --------------------------------------------------------------- inject
    def inject(self, model: nn.Module) -> dict[str, nn.Module]:
        """注入 lycoris 适配器到模型。"""
        from lycoris import LycorisNetwork

        apply_anima_preset(LycorisNetwork)

        # algo 名映射：anima_train 用 'lora'，lycoris 用 'locon'（with conv 关闭即等价 lora）
        net_module = self.algo
        if net_module == "lora":
            net_module = "locon"

        # extra kwargs: 仅在该算法支持时传入对应字段
        extra: dict[str, Any] = {}
        if self.algo == "lokr":
            extra["factor"] = self.factor
        if self.weight_decompose:
            extra["weight_decompose"] = True
        if self.rs_lora:
            extra["rs_lora"] = True

        self.network = LycorisNetwork(
            model,
            multiplier=1.0,
            lora_dim=self.rank,
            alpha=self.alpha,
            dropout=self.dropout,
            rank_dropout=self.rank_dropout,
            module_dropout=self.module_dropout,
            network_module=net_module,
            **extra,
        )
        self.network.apply_to()

        n = len(self.network.loras)
        logger.info(f"注入 {self.algo.upper()} 到 {n} 层（lycoris-lora）")
        return {lora.lora_name: lora for lora in self.network.loras}

    # --------------------------------------------------------------- params
    def get_params(self) -> list[nn.Parameter]:
        """所有可训练参数（与原 LoRAInjector.get_params 等价）"""
        if self.network is None:
            return []
        return [p for p in self.network.parameters() if p.requires_grad]

    def get_param_groups(self, weight_decay: float) -> list[dict]:
        """LoKr 模式下 w1 排除 weight_decay（与原 LoRAInjector 等价）。

        其他算法下不分组，所有参数共用 weight_decay。
        """
        if self.network is None:
            return [{"params": [], "weight_decay": weight_decay}]

        if not self.use_lokr or weight_decay == 0:
            return [{"params": self.get_params(), "weight_decay": weight_decay}]

        no_decay = []  # lokr_w1（满矩阵分支）/ lokr_w1_a/b（如果开 decompose_both）
        decay = []
        for lora in self.network.loras:
            for n, p in lora.named_parameters():
                if not p.requires_grad:
                    continue
                # 'lokr_w1' / 'lokr_w1_a' / 'lokr_w1_b' 都视为 w1 系
                if "lokr_w1" in n:
                    no_decay.append(p)
                else:
                    decay.append(p)
        return [
            {"params": decay, "weight_decay": weight_decay},
            {"params": no_decay, "weight_decay": 0.0},
        ]

    # --------------------------------------------------------------- state I/O
    def state_dict(self) -> dict[str, torch.Tensor]:
        """LoRA 权重 state_dict（带 lora_unet_* 前缀，ComfyUI 兼容）。

        lycoris 已经按 LORA_PREFIX (preset 中 'lora_prefix=lora_unet') 输出正确前缀。
        """
        if self.network is None:
            return {}
        return self.network.state_dict()

    def load_state_dict(self, sd: dict[str, torch.Tensor], strict: bool = True) -> Any:
        if self.network is None:
            raise RuntimeError("AnimaLycorisAdapter.inject() 必须先调用")
        return self.network.load_state_dict(sd, strict=strict)

    # --------------------------------------------------------------- safetensors
    def save(self, path: str | Path) -> None:
        """保存为 safetensors（带 ss_* metadata，ComfyUI/sd-scripts 兼容）"""
        sd = self.state_dict()
        meta = {
            "ss_network_dim": str(self.rank),
            "ss_network_alpha": str(self.alpha),
            "ss_network_module": "lycoris.kohya",
            "ss_network_args": json.dumps({
                "algo": self.algo,
                "factor": self.factor,
                "preset": "anima_full",
                "dropout": self.dropout,
                "rank_dropout": self.rank_dropout,
                "module_dropout": self.module_dropout,
                "weight_decompose": self.weight_decompose,
                "rs_lora": self.rs_lora,
            }),
        }
        save_file(sd, str(path), metadata=meta)
        logger.info(f"LoRA 保存到: {path}")

    def load(self, path: str | Path) -> None:
        """从 safetensors 加载已有 LoRA 权重（用于继续训练）"""
        logger.info(f"加载已有 LoRA 权重: {path}")
        sd: dict[str, torch.Tensor] = {}
        with safe_open(str(path), framework="pt", device="cpu") as f:
            for k in f.keys():
                sd[k] = f.get_tensor(k)

        # 旧自实现格式（lora_unet_*.lokr_w2_a/b 低秩 vs lokr_w2 全矩阵）的 fallback：
        # lycoris 期望的是它自己写出来的格式（同样 lora_unet_* 前缀，但内部
        # 可能因 dim 太大走 full_matrix 模式产 lokr_w2 而非 lokr_w2_a/b）。
        # 直接用 strict=False 让 lycoris 容忍键缺失，并打印缺失数。
        result = self.load_state_dict(sd, strict=False)
        missing = len(getattr(result, "missing_keys", [])) if hasattr(result, "missing_keys") else 0
        unexpected = len(getattr(result, "unexpected_keys", [])) if hasattr(result, "unexpected_keys") else 0
        logger.info(
            f"加载 {len(sd)} 个权重张量，"
            f"missing={missing}, unexpected={unexpected}"
        )
