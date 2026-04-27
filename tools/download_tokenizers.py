#!/usr/bin/env python
"""
下载训练所需的 tokenizer 文件

使用方法:
    python download_tokenizers.py              # 默认使用 hf-mirror.com 镜像
    python download_tokenizers.py --no-mirror  # 使用 HuggingFace 官方源
    
手动下载（如脚本无法使用）:
    1. T5 Tokenizer (放到 models/t5_tokenizer/):
       - https://huggingface.co/google/t5-v1_1-xxl/resolve/main/spiece.model
       - https://huggingface.co/google/t5-v1_1-xxl/resolve/main/tokenizer_config.json
       - https://huggingface.co/google/t5-v1_1-xxl/resolve/main/special_tokens_map.json
       
    2. Qwen3 Tokenizer (放到 models/text_encoders/):
       - https://huggingface.co/Qwen/Qwen3-0.6B-Base/resolve/main/tokenizer.json
       - https://huggingface.co/Qwen/Qwen3-0.6B-Base/resolve/main/vocab.json
       - https://huggingface.co/Qwen/Qwen3-0.6B-Base/resolve/main/merges.txt
       - https://huggingface.co/Qwen/Qwen3-0.6B-Base/resolve/main/tokenizer_config.json
       - https://huggingface.co/Qwen/Qwen3-0.6B-Base/resolve/main/special_tokens_map.json
       
    3. Qwen3 模型权重 (放到 models/text_encoders/):
       - https://huggingface.co/Qwen/Qwen3-0.6B-Base/resolve/main/model.safetensors
       
    国内镜像: 把 huggingface.co 替换为 hf-mirror.com
"""
import os
import argparse
from pathlib import Path

def setup_mirror(use_mirror: bool = True):
    """设置 HuggingFace 镜像"""
    if use_mirror:
        os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
        print("使用镜像: https://hf-mirror.com")
    else:
        print("使用官方源: https://huggingface.co")

def download_t5_tokenizer(output_dir: str):
    """下载 T5-XXL tokenizer 文件"""
    from huggingface_hub import hf_hub_download
    
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    repo_id = "google/t5-v1_1-xxl"
    files = [
        "spiece.model",
        "tokenizer_config.json",
        "special_tokens_map.json",
    ]
    
    print(f"\n📥 下载 T5 tokenizer 到 {output_dir}...")
    print(f"   来源: {repo_id}")
    for filename in files:
        try:
            path = hf_hub_download(
                repo_id=repo_id,
                filename=filename,
                local_dir=str(output_dir),
                local_dir_use_symlinks=False,
            )
            print(f"   ✅ {filename}")
        except Exception as e:
            print(f"   ❌ {filename}: {e}")


def download_qwen3_tokenizer(output_dir: str):
    """下载 Qwen3 tokenizer 文件"""
    from huggingface_hub import hf_hub_download
    
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    repo_id = "Qwen/Qwen3-0.6B-Base"
    files = [
        "tokenizer.json",
        "tokenizer_config.json",
        "special_tokens_map.json",
        "vocab.json",
        "merges.txt",
    ]
    
    print(f"\n📥 下载 Qwen3 tokenizer 到 {output_dir}...")
    print(f"   来源: {repo_id}")
    for filename in files:
        try:
            path = hf_hub_download(
                repo_id=repo_id,
                filename=filename,
                local_dir=str(output_dir),
                local_dir_use_symlinks=False,
            )
            print(f"   ✅ {filename}")
        except Exception as e:
            print(f"   ⚠️  {filename}: 跳过 ({e})")


def main():
    parser = argparse.ArgumentParser(
        description="下载训练所需的 tokenizer 文件",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
手动下载说明:
  如果脚本无法使用，可以手动从以下地址下载文件：
  
  T5 Tokenizer → models/t5_tokenizer/
    https://huggingface.co/google/t5-v1_1-xxl
    
  Qwen3 Tokenizer → models/text_encoders/  
    https://huggingface.co/Qwen/Qwen3-0.6B-Base
    
  国内用户: 把 huggingface.co 替换为 hf-mirror.com
""")
    parser.add_argument("--no-mirror", action="store_true", 
                        help="不使用镜像，直接访问 HuggingFace 官方源")
    parser.add_argument("--output", type=str, default="",
                        help="输出目录（默认: ./models）")
    args = parser.parse_args()
    
    # 设置镜像
    setup_mirror(use_mirror=not args.no_mirror)
    
    # 确定输出目录
    if args.output:
        base_dir = Path(args.output)
    else:
        base_dir = Path(__file__).parent / "models"
    
    print(f"\n📁 模型目录: {base_dir.absolute()}")
    
    # 1. 下载 T5 tokenizer
    download_t5_tokenizer(base_dir / "t5_tokenizer")
    
    # 2. 下载 Qwen3 tokenizer
    download_qwen3_tokenizer(base_dir / "text_encoders")
    
    print("\n" + "="*50)
    print("✅ Tokenizer 下载完成！")
    print()
    print("⚠️  注意: 还需要手动下载以下大文件:")
    print()
    print("  1. Anima 主模型 → models/transformers/anima-preview.safetensors")
    print("     https://huggingface.co/circlestone-labs/Anima")
    print()
    print("  2. VAE → models/vae/qwen_image_vae.safetensors")
    print("     https://huggingface.co/circlestone-labs/Anima")
    print()
    print("  3. Qwen3 权重 → models/text_encoders/model.safetensors")
    print("     https://huggingface.co/Qwen/Qwen3-0.6B-Base")
    print()
    print("  国内镜像: 把 huggingface.co 替换为 hf-mirror.com")
    print("="*50)


if __name__ == "__main__":
    main()
