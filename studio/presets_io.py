"""预设文件 I/O —— 用 pydantic 验证、用 PyYAML 落盘。

存储位置：`studio_data/presets/{name}.yaml`
名字白名单：`[A-Za-z0-9_-]+`，防止路径穿越和 Windows 非法字符。

历史：PP0 之前叫 configs_io / studio_data/configs/。`configs_io` 现在是
本模块的薄壳。
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml
from pydantic import ValidationError

from .paths import USER_PRESETS_DIR
from .schema import TrainingConfig

NAME_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


class PresetError(Exception):
    """预设 I/O 错误。"""


def _validate_name(name: str) -> None:
    if not NAME_PATTERN.fullmatch(name):
        raise PresetError(f"非法预设名: {name!r}（只允许字母/数字/下划线/连字符）")


def _preset_path(name: str, base: Path | None = None) -> Path:
    _validate_name(name)
    return (base or USER_PRESETS_DIR) / f"{name}.yaml"


def list_presets(base: Path | None = None) -> list[dict[str, Any]]:
    """返回 `[{name, path, updated_at}]`，按修改时间倒序。"""
    base = base or USER_PRESETS_DIR
    if not base.exists():
        return []
    items: list[dict[str, Any]] = []
    for p in base.glob("*.yaml"):
        items.append({
            "name": p.stem,
            "path": str(p),
            "updated_at": p.stat().st_mtime,
        })
    items.sort(key=lambda x: x["updated_at"], reverse=True)
    return items


def read_preset(name: str, base: Path | None = None) -> dict[str, Any]:
    """读取并校验预设；返回校验后的 dict（未知字段会被 forbid）。"""
    path = _preset_path(name, base)
    if not path.exists():
        raise PresetError(f"预设不存在: {name}")
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(raw, dict):
        raise PresetError(f"预设格式错误（顶层不是 mapping）: {name}")
    try:
        cfg = TrainingConfig.model_validate(raw)
    except ValidationError as exc:
        raise PresetError(f"预设校验失败: {exc}") from exc
    return cfg.model_dump(mode="python")


def write_preset(name: str, data: dict[str, Any], base: Path | None = None) -> Path:
    """先校验后写盘；任何未知字段或类型不匹配都会拒绝。"""
    path = _preset_path(name, base)
    try:
        cfg = TrainingConfig.model_validate(data)
    except ValidationError as exc:
        raise PresetError(f"预设校验失败: {exc}") from exc
    dumped = cfg.model_dump(mode="python")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        yaml.safe_dump(dumped, allow_unicode=True, sort_keys=False, default_flow_style=False),
        encoding="utf-8",
    )
    return path


def delete_preset(name: str, base: Path | None = None) -> None:
    path = _preset_path(name, base)
    if not path.exists():
        raise PresetError(f"预设不存在: {name}")
    path.unlink()


def duplicate_preset(src: str, dst: str, base: Path | None = None) -> Path:
    src_path = _preset_path(src, base)
    dst_path = _preset_path(dst, base)
    if not src_path.exists():
        raise PresetError(f"源预设不存在: {src}")
    if dst_path.exists():
        raise PresetError(f"目标已存在: {dst}")
    dst_path.write_bytes(src_path.read_bytes())
    return dst_path
