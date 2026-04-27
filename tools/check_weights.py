#!/usr/bin/env python
"""
检查模型权重与代码定义的差异
用法: python check_weights.py --config config/my_training.yaml
"""

import argparse
import importlib.util
import sys
from pathlib import Path

import torch
from safetensors import safe_open


def load_module_from_path(module_name, file_path):
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser(description="检查权重文件与模型定义的差异")
    parser.add_argument("--config", required=True, help="训练配置 YAML 路径")
    args = parser.parse_args()

    import yaml
    with open(args.config) as f:
        cfg = yaml.safe_load(f)

    transformer_path = cfg["transformer_path"]
    print(f"权重文件: {transformer_path}")

    # 加载权重 keys
    sd = {}
    with safe_open(transformer_path, framework="pt", device="cpu") as f:
        for k in f.keys():
            sd[k] = f.get_tensor(k)

    # 去掉常见前缀 (net.)
    sd_keys_raw = list(sd.keys())
    prefix = ""
    if all(k.startswith("net.") for k in sd_keys_raw):
        prefix = "net."
    sd_clean = {k[len(prefix):]: v for k, v in sd.items()}

    print(f"权重文件参数数: {len(sd_clean)}")

    # 构建模型
    repo_root = Path(__file__).parent / "models"
    cosmos_modeling = load_module_from_path(
        "cosmos_predict2_modeling",
        repo_root / "cosmos_predict2_modeling.py",
    )
    anima_modeling = load_module_from_path(
        "anima_modeling",
        repo_root / "anima_modeling.py",
    )

    # 从权重推断配置
    for k, v in sd_clean.items():
        if k.endswith("x_embedder.proj.1.weight"):
            w = v
            break

    in_channels = (w.shape[1] // 4) - 1
    model_channels = w.shape[0]

    if model_channels == 2048:
        num_blocks, num_heads = 28, 16
    elif model_channels == 5120:
        num_blocks, num_heads = 36, 40
    else:
        print(f"未知 model_channels={model_channels}")
        return

    print(f"推断配置: in_channels={in_channels}, model_channels={model_channels}, "
          f"num_blocks={num_blocks}, num_heads={num_heads}")

    config = dict(
        max_img_h=240, max_img_w=240, max_frames=128,
        in_channels=in_channels, out_channels=16,
        patch_spatial=2, patch_temporal=1,
        concat_padding_mask=True,
        model_channels=model_channels,
        num_blocks=num_blocks, num_heads=num_heads,
        crossattn_emb_channels=1024,
        pos_emb_cls="rope3d", pos_emb_learnable=True,
        pos_emb_interpolation="crop",
        use_adaln_lora=True, adaln_lora_dim=256,
        rope_h_extrapolation_ratio=4.0 if in_channels == 16 else 3.0,
        rope_w_extrapolation_ratio=4.0 if in_channels == 16 else 3.0,
        rope_t_extrapolation_ratio=1.0,
    )

    model = anima_modeling.Anima(**config)
    model_keys = set(model.state_dict().keys())

    print(f"模型定义参数数: {len(model_keys)}")
    print()

    # 对比
    missing = sorted(model_keys - set(sd_clean.keys()))
    unexpected = sorted(set(sd_clean.keys()) - model_keys)

    if missing:
        print(f"=== Missing ({len(missing)}) ===")
        print("模型定义中有，但权重文件中没有（会用随机初始化）:")
        for k in missing:
            shape = tuple(model.state_dict()[k].shape)
            print(f"  {k}  {shape}")
    else:
        print("无 missing keys")

    print()

    if unexpected:
        print(f"=== Unexpected ({len(unexpected)}) ===")
        print("权重文件中有，但模型定义中没有（会被忽略）:")
        for k in unexpected:
            shape = tuple(sd_clean[k].shape)
            print(f"  {k}  {shape}")
    else:
        print("无 unexpected keys")

    print()
    matched = len(model_keys & set(sd_clean.keys()))
    print(f"匹配: {matched}/{len(model_keys)} ({matched/len(model_keys):.1%})")


if __name__ == "__main__":
    main()
