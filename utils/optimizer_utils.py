"""
Optimizer Utils Module - 优化器创建
===================================
支持多种优化器：
1. 标准 AdamW - PyTorch 内置
2. 8-bit AdamW (bitsandbytes) - 内存高效
3. Prodigy (prodigyopt) - 无需调 lr 的自适应优化器
"""

from typing import List, Dict, Any, Optional, Iterator

import torch
from torch import nn
from torch.optim import Optimizer, AdamW

# 尝试导入 bitsandbytes
try:
    import bitsandbytes as bnb
    BITSANDBYTES_AVAILABLE = True
except ImportError:
    BITSANDBYTES_AVAILABLE = False


def create_optimizer(
    optimizer_type: str,
    params: Iterator[nn.Parameter],
    learning_rate: float,
    betas: tuple = (0.9, 0.999),
    weight_decay: float = 0.01,
    eps: float = 1e-8,
    **kwargs
) -> Optimizer:
    """
    创建优化器

    根据配置创建不同类型的优化器。这是工厂模式的应用，
    将优化器创建逻辑集中管理，便于维护和扩展。

    Args:
        optimizer_type: 优化器类型 ("adamw", "adamw8bit", "prodigy")
        params: 模型参数迭代器
        learning_rate: 学习率
        betas: Adam beta 参数 (beta1, beta2)
        weight_decay: 权重衰减系数
        eps: 数值稳定性 epsilon
        **kwargs: 其他优化器特定参数

    Returns:
        Optimizer: 创建的优化器实例

    Raises:
        ValueError: 如果优化器类型不支持
        ImportError: 如果需要的库未安装
    """
    optimizer_type = optimizer_type.lower()

    if optimizer_type == "adamw8bit":
        return create_8bit_adamw(
            params=params,
            lr=learning_rate,
            betas=betas,
            weight_decay=weight_decay,
            eps=eps,
            **kwargs
        )

    elif optimizer_type == "adamw":
        return create_standard_adamw(
            params=params,
            lr=learning_rate,
            betas=betas,
            weight_decay=weight_decay,
            eps=eps,
            **kwargs
        )

    elif optimizer_type == "prodigy":
        return create_prodigy(
            params=params,
            lr=learning_rate,
            betas=betas,
            weight_decay=weight_decay,
            eps=eps,
            **kwargs
        )

    else:
        raise ValueError(
            f"Unknown optimizer type: {optimizer_type}. "
            f"Choose from: adamw, adamw8bit, prodigy"
        )


def create_8bit_adamw(
    params: Iterator[nn.Parameter],
    lr: float,
    betas: tuple = (0.9, 0.999),
    weight_decay: float = 0.01,
    eps: float = 1e-8,
    min_8bit_size: int = 4096,
    **kwargs
) -> Optimizer:
    """
    创建 8-bit AdamW 优化器
    
    8-bit AdamW 是 bitsandbytes 库提供的内存高效优化器。
    它将优化器状态（动量、二阶矩）量化为 8-bit，可以
    减少约 50% 的优化器显存占用。
    
    原理：
    - 大多数深度学习参数不需要完整的 32-bit 精度来存储优化器状态
    - 通过分块量化和动态范围调整，8-bit 可以保持良好的优化性能
    
    适用场景：
    - 显存受限的训练（如单卡 RTX 3090 训练大模型）
    - LoRA 训练（虽然 LoRA 参数少，但 8-bit 可以进一步节省内存）
    
    参数说明：
    - min_8bit_size: 小于此大小的张量将保持 32-bit
      这是因为小张量的 8-bit 量化收益不大，反而可能损失精度
    
    Args:
        params: 模型参数
        lr: 学习率
        betas: Adam beta 参数
        weight_decay: 权重衰减
        eps: epsilon
        min_8bit_size: 8-bit 量化的最小张量大小
        
    Returns:
        bnb.optim.AdamW8bit: 8-bit AdamW 优化器
    """
    if not BITSANDBYTES_AVAILABLE:
        raise ImportError(
            "bitsandbytes is required for 8-bit AdamW. "
            "Install with: pip install bitsandbytes"
        )
    
    print(f"Creating 8-bit AdamW optimizer (lr={lr}, weight_decay={weight_decay})")
    print(f"  min_8bit_size: {min_8bit_size}")
    
    # 将参数转换为列表（bitsandbytes 需要可索引的参数）
    param_list = list(params)
    
    # 创建优化器
    optimizer = bnb.optim.AdamW8bit(
        param_list,
        lr=lr,
        betas=betas,
        eps=eps,
        weight_decay=weight_decay,
        min_8bit_size=min_8bit_size,
        **kwargs
    )
    
    # 计算内存节省
    total_params = sum(p.numel() for p in param_list)
    # 8-bit 优化器状态：约 2 bytes per parameter (vs 8 bytes for 32-bit)
    # 节省约 75% 的优化器状态内存
    estimated_savings_gb = (total_params * 6) / (1024 ** 3)  # 节省 6 bytes per param
    print(f"  [OK] 8-bit AdamW created (estimated memory savings: {estimated_savings_gb:.2f} GB)")
    
    return optimizer


def create_standard_adamw(
    params: Iterator[nn.Parameter],
    lr: float,
    betas: tuple = (0.9, 0.999),
    weight_decay: float = 0.01,
    eps: float = 1e-8,
    **kwargs
) -> Optimizer:
    """
    创建标准 AdamW 优化器
    
    标准的 PyTorch AdamW 实现。作为后备选项，当其他
    优化器不可用时使用。
    
    AdamW 特点：
    - 将权重衰减与梯度更新解耦（decoupled weight decay）
    - 比 Adam + L2 正则化效果更好
    - 现代深度学习的事实标准优化器
    
    Args:
        params: 模型参数
        lr: 学习率
        betas: Adam beta 参数
        weight_decay: 权重衰减
        eps: epsilon
        
    Returns:
        AdamW: 标准 AdamW 优化器
    """
    print(f"Creating standard AdamW optimizer (lr={lr}, weight_decay={weight_decay})")
    
    # 将参数转换为列表
    param_list = list(params)
    
    optimizer = AdamW(
        param_list,
        lr=lr,
        betas=betas,
        eps=eps,
        weight_decay=weight_decay,
        **kwargs
    )
    
    print("  [OK] AdamW optimizer created")

    return optimizer


def create_prodigy(
    params: Iterator[nn.Parameter],
    lr: float,
    betas: tuple = (0.9, 0.999),
    weight_decay: float = 0.01,
    eps: float = 1e-8,
    d_coef: float = 1.0,
    safeguard_warmup: bool = True,
    use_bias_correction: bool = True,
    **kwargs,
) -> Optimizer:
    """
    创建 Prodigy 优化器 (https://github.com/konstmish/prodigy)

    Prodigy 自适应估计学习率，lr 应设为 1.0（这里的 lr 是 d 的放大系数）。
    如果传入的 lr != 1.0，会强制覆盖为 1.0 并打印警告。

    推荐默认：safeguard_warmup=True, use_bias_correction=True, d_coef=1.0。
    使用 constant 或 cosine scheduler 即可，不建议叠 restart。

    Args:
        params: 模型参数
        lr: 学习率（Prodigy 要求 1.0）
        betas: Adam beta 参数
        weight_decay: 权重衰减
        eps: epsilon
        d_coef: d 的初始缩放系数
        safeguard_warmup: warmup 期间保护 d 不过快增长
        use_bias_correction: 是否使用偏差修正

    Returns:
        Prodigy: Prodigy 优化器
    """
    try:
        from prodigyopt import Prodigy
    except ImportError as e:
        raise ImportError(
            "prodigyopt is required for Prodigy optimizer. "
            "Install with: pip install prodigyopt"
        ) from e

    if abs(lr - 1.0) > 1e-9:
        print(
            f"[WARN] Prodigy requires lr=1.0 (received {lr}); forcing lr=1.0. "
            f"Tune d_coef/weight_decay instead of lr."
        )
        lr = 1.0

    print(
        f"Creating Prodigy optimizer (lr={lr}, weight_decay={weight_decay}, "
        f"d_coef={d_coef}, safeguard_warmup={safeguard_warmup})"
    )

    param_list = list(params)

    optimizer = Prodigy(
        param_list,
        lr=lr,
        betas=betas,
        eps=eps,
        weight_decay=weight_decay,
        d_coef=d_coef,
        safeguard_warmup=safeguard_warmup,
        use_bias_correction=use_bias_correction,
        **kwargs,
    )

    print("  [OK] Prodigy optimizer created")

    return optimizer


def create_optimizer_grouped_parameters(
    model: nn.Module,
    weight_decay: float,
    no_decay_modules: Optional[List[str]] = None
) -> List[Dict[str, Any]]:
    """
    创建分组的优化器参数
    
    某些参数（如偏置和 LayerNorm 的权重）通常不应该应用
    权重衰减。这个函数将参数分为两组：
    1. 需要权重衰减的参数（权重矩阵）
    2. 不需要权重衰减的参数（偏置、LayerNorm）
    
    这是 Transformer 训练的最佳实践。
    
    Args:
        model: 模型
        weight_decay: 权重衰减系数
        no_decay_modules: 不应用权重衰减的模块名称列表
        
    Returns:
        List[Dict]: 分组后的参数列表
    """
    if no_decay_modules is None:
        # 默认：偏置和 LayerNorm 参数不应用权重衰减
        no_decay_modules = ["bias", "LayerNorm.weight", "layernorm.weight", "norm.weight"]
    
    # 分组参数
    decay_params = []
    no_decay_params = []
    
    for name, param in model.named_parameters():
        if not param.requires_grad:
            continue
            
        # 检查是否需要权重衰减
        needs_decay = True
        for no_decay_pattern in no_decay_modules:
            if no_decay_pattern in name:
                needs_decay = False
                break
        
        if needs_decay:
            decay_params.append(param)
        else:
            no_decay_params.append(param)
    
    # 构建参数组
    optimizer_grouped_parameters = [
        {
            "params": decay_params,
            "weight_decay": weight_decay,
        },
        {
            "params": no_decay_params,
            "weight_decay": 0.0,
        },
    ]
    
    # 打印统计信息
    num_decay_params = sum(p.numel() for p in decay_params)
    num_no_decay_params = sum(p.numel() for p in no_decay_params)
    print(f"Parameter groups:")
    print(f"  With weight decay: {len(decay_params)} params, {num_decay_params:,} elements")
    print(f"  Without weight decay: {len(no_decay_params)} params, {num_no_decay_params:,} elements")
    
    return optimizer_grouped_parameters


def get_optimizer_info(optimizer: Optimizer) -> Dict[str, Any]:
    """
    获取优化器信息
    
    用于日志记录和调试
    
    Args:
        optimizer: 优化器实例
        
    Returns:
        Dict: 优化器信息字典
    """
    info = {
        "type": type(optimizer).__name__,
        "learning_rate": optimizer.param_groups[0]["lr"],
        "num_param_groups": len(optimizer.param_groups),
    }
    
    # 获取总参数数
    total_params = 0
    for group in optimizer.param_groups:
        for p in group["params"]:
            total_params += p.numel()
    
    info["total_trainable_params"] = total_params
    
    # 添加优化器特定信息
    if isinstance(optimizer, (AdamW,)) or (BITSANDBYTES_AVAILABLE and isinstance(optimizer, bnb.optim.AdamW8bit)):
        info["betas"] = optimizer.param_groups[0].get("betas", (0.9, 0.999))
        info["weight_decay"] = optimizer.param_groups[0].get("weight_decay", 0.0)
        info["eps"] = optimizer.param_groups[0].get("eps", 1e-8)
    
    return info
