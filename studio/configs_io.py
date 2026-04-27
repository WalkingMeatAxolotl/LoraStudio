"""DEPRECATED — 兼容层，请改用 studio.presets_io。

PP0 把 `studio_data/configs/` 重命名为 `studio_data/presets/`，函数与异常
也统一加 `preset` 字眼。本模块保留旧名字给外部调用方（anima_train.py、
queue_io、用户脚本）做平滑过渡，下一个 minor 版本删除。
"""
from __future__ import annotations

import warnings
from pathlib import Path  # noqa: F401  (re-exported indirectly)

from .paths import USER_PRESETS_DIR
from .presets_io import (  # noqa: F401
    NAME_PATTERN,
    PresetError as ConfigError,
    delete_preset as delete_config,
    duplicate_preset as duplicate_config,
    list_presets as list_configs,
    read_preset as read_config,
    write_preset as write_config,
)

# 兼容旧别名，避免外部 `from studio.configs_io import USER_CONFIGS_DIR` 断裂。
USER_CONFIGS_DIR = USER_PRESETS_DIR

warnings.warn(
    "studio.configs_io 已弃用，请改用 studio.presets_io（"
    "ConfigError → PresetError, *_config → *_preset, USER_CONFIGS_DIR → USER_PRESETS_DIR）",
    DeprecationWarning,
    stacklevel=2,
)
