#!/usr/bin/env python3
"""测试出图 — 独立运行推理，复用 anima_train.sample_image 推理链路 + inference_core 多 LoRA。

用法：
    python tools/anima_generate.py --config generate_config.json [--monitor-state-file state.json]

JSON 配置字段见 studio.schema.GenerateConfig。

关键：
  - 多 LoRA 加载走 studio.services.inference_core.apply_loras —— 每份 LoRA 独立
    inject 一份 AnimaLycorisAdapter，rank/alpha 从 ss_network_args 读，用
    multiplier=scale 控制贡献权重。**修复 PR #17 作者的 P0 bug**：硬编码
    rank=32 + tensor 直加 LoKr 子矩阵会出错图。
  - 输出图写到 cfg.output_dir（Studio 模式由 server 填 tempfile.gettempdir() /
    anima_gen_{task_id}，task 结束清掉 —— 用户视角"不保存"）。
  - 进度通过 train_monitor 推 SSE，前端按 sample_path 拉单图显示。
"""
from __future__ import annotations

import argparse
import json
import logging
import random
import sys
from pathlib import Path

import torch

# anima_train 在 scripts/，train_monitor 在同一 tools/ 目录
_THIS_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _THIS_DIR.parent
_SCRIPTS_DIR = _REPO_ROOT / "scripts"
for _p in (_THIS_DIR, _SCRIPTS_DIR, _REPO_ROOT):
    s = str(_p)
    if s not in sys.path:
        sys.path.insert(0, s)

import anima_train as _T  # noqa: E402

from studio.services.inference_core import LoRASpec, apply_loras  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("anima_generate")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Anima 测试出图")
    p.add_argument("--config", required=True, help="JSON 配置文件路径")
    p.add_argument("--monitor-state-file", default="", help="进度状态文件路径")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    cfg_path = Path(args.config)
    if not cfg_path.exists():
        logger.error(f"配置文件不存在: {cfg_path}")
        sys.exit(1)

    with open(cfg_path, encoding="utf-8") as f:
        cfg = json.load(f)

    output_dir = Path(cfg.get("output_dir", "./generate_output"))
    output_dir.mkdir(parents=True, exist_ok=True)

    prompts: list[str] = cfg.get("prompts") or ["newest, safe, 1girl, masterpiece, best quality"]
    negative_prompt: str = cfg.get("negative_prompt", "")
    width: int = int(cfg.get("width", 1024))
    height: int = int(cfg.get("height", 1024))
    steps: int = int(cfg.get("steps", 25))
    cfg_scale: float = float(cfg.get("cfg_scale", 4.0))
    sampler_name: str = cfg.get("sampler_name", "er_sde")
    scheduler: str = cfg.get("scheduler", "simple")
    count: int = max(1, int(cfg.get("count", 1)))
    base_seed: int = int(cfg.get("seed", 0))
    lora_configs: list[dict] = cfg.get("lora_configs", [])
    mixed_precision: str = cfg.get("mixed_precision", "bf16")
    # 兼容老 cfg 的 xformers/flash_attn 双 bool（migrate_legacy_attention 默认值与
    # schema.GenerateConfig.attention_backend 默认 "flash_attn" 一致）
    from studio.schema import migrate_legacy_attention
    cfg = migrate_legacy_attention(cfg)
    backend: str = cfg.get("attention_backend", "flash_attn")
    use_flash = (backend == "flash_attn")
    use_xformers = (backend == "xformers")

    transformer_path: str = cfg["transformer_path"]
    vae_path: str = cfg["vae_path"]
    text_encoder_path: str = cfg["text_encoder_path"]
    t5_tokenizer_path: str = cfg.get("t5_tokenizer_path", "")

    # monitor
    state_file = args.monitor_state_file or str(output_dir / "monitor_state.json")
    _update_monitor = None
    try:
        from train_monitor import set_state_file, update_monitor
        set_state_file(state_file)
        update_monitor(config={
            "type": "generate",
            "prompts": len(prompts),
            "count": count,
            "steps": steps,
            "cfg_scale": cfg_scale,
        })
        _update_monitor = update_monitor
    except Exception as e:
        logger.warning(f"monitor 初始化失败: {e}")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.bfloat16 if mixed_precision == "bf16" else torch.float32

    # 路径解析
    repo_root = _T.find_diffusion_pipe_root()
    bases = [Path.cwd(), _THIS_DIR, repo_root]
    transformer_path = _T.resolve_path_best_effort(transformer_path, bases)
    vae_path = _T.resolve_path_best_effort(vae_path, bases)
    text_encoder_path = _T.resolve_path_best_effort(text_encoder_path, bases)
    if t5_tokenizer_path:
        t5_tokenizer_path = _T.resolve_path_best_effort(t5_tokenizer_path, bases)

    logger.info("加载 Transformer...")
    model = _T.load_anima_model(transformer_path, device, dtype, repo_root, flash_attn=use_flash)
    if use_xformers:
        _T.enable_xformers(model)

    logger.info("加载 VAE...")
    vae = _T.load_vae(vae_path, device, dtype, repo_root)

    logger.info("加载文本编码器...")
    qwen_model, qwen_tok, t5_tok = _T.load_text_encoders(
        text_encoder_path, t5_tokenizer_path or None, device, dtype,
    )

    # 多 LoRA：每份独立 inject + multiplier=scale。adapters 必须保持引用，否则
    # 被 GC 后 forward hook 失效（lycoris 通过 closure 持有 network）。
    specs = [
        LoRASpec(path=str(lc.get("path", "")), scale=float(lc.get("scale", 1.0)))
        for lc in lora_configs
    ]
    _adapters = apply_loras(model, specs, device, dtype)  # noqa: F841 — 保持引用

    model.eval()

    # 生成循环
    total = count * len(prompts)
    logger.info(f"开始生成：{len(prompts)} 个 prompt × {count} 次 = {total} 张")

    img_idx = 0
    for pi, prompt in enumerate(prompts):
        for ci in range(count):
            seed = (base_seed + img_idx) if base_seed != 0 else random.randint(0, 2**31 - 1)
            torch.manual_seed(seed)
            random.seed(seed)

            logger.info(f"[{img_idx + 1}/{total}] seed={seed}  prompt={prompt[:60]}...")
            try:
                img = _T.sample_image(
                    model, vae, qwen_model, qwen_tok, t5_tok,
                    prompt=prompt,
                    height=height,
                    width=width,
                    steps=steps,
                    cfg_scale=cfg_scale,
                    negative_prompt=negative_prompt or None,
                    sampler_name=sampler_name,
                    scheduler=scheduler,
                    device=device,
                    dtype=dtype,
                )
                fname = f"gen_{img_idx:04d}_p{pi}_c{ci}_s{seed}.png"
                out_path = output_dir / fname
                img.save(out_path)
                logger.info(f"已保存: {out_path}")
                if _update_monitor:
                    _update_monitor(sample_path=str(out_path), step=img_idx + 1)
            except Exception as e:
                logger.error(f"生成失败 [{img_idx + 1}/{total}]: {e}")

            img_idx += 1

    logger.info("生成完成")


if __name__ == "__main__":
    main()
