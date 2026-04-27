import os
from pathlib import Path

from safetensors import safe_open
from safetensors.torch import save_file


def convert_lokr_prefix(in_path: Path, out_path: Path, backup_path: Path) -> None:
    if not in_path.exists():
        raise FileNotFoundError(f"Input file not found: {in_path}")

    if not backup_path.exists():
        backup_path.parent.mkdir(parents=True, exist_ok=True)
        backup_path.write_bytes(in_path.read_bytes())

    with safe_open(in_path, framework="pt", device="cpu") as f:
        metadata = f.metadata()
        keys = list(f.keys())
        sd = {k: f.get_tensor(k) for k in keys}

    renamed = {}
    new_sd = {}
    for k, v in sd.items():
        if k.startswith("lycoris_"):
            nk = "lora_unet_" + k[len("lycoris_"):]
        else:
            nk = k

        if nk in new_sd:
            raise RuntimeError(f"Key collision after rename: {k} -> {nk}")
        new_sd[nk] = v
        if nk != k:
            renamed[k] = nk

    print(f"[convert] total keys: {len(sd)} | renamed: {len(renamed)}")
    print(f"[convert] output: {out_path}")

    if metadata is None:
        save_file(new_sd, out_path)
    else:
        save_file(new_sd, out_path, metadata=metadata)


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="将 LoKr 权重前缀转换为 ComfyUI 兼容格式")
    parser.add_argument("input", help="输入 .safetensors 路径（LoKr/lycoris_ 前缀）")
    parser.add_argument("--output", default=None, help="输出路径（默认：在输入文件名后加 _comfyui）")
    parser.add_argument("--backup", default=None, help="备份路径（默认：在输入文件名后加 .BAK）")
    args = parser.parse_args()

    in_path = Path(args.input).expanduser()
    out_path = Path(args.output).expanduser() if args.output else in_path.with_name(in_path.stem + "_comfyui.safetensors")
    backup_path = Path(args.backup).expanduser() if args.backup else in_path.with_name(in_path.stem + ".BAK.safetensors")

    convert_lokr_prefix(in_path, out_path, backup_path)


if __name__ == "__main__":
    main()
