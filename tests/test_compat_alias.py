"""PP0 — studio.configs_io 是兼容壳，必须仍可调用，但发 DeprecationWarning。"""
from __future__ import annotations

import importlib
import warnings
from pathlib import Path

import pytest


def test_import_emits_deprecation_warning() -> None:
    # importlib.reload 才能保证 warning 触发（已 import 过会被缓存）
    import studio.configs_io as ci  # noqa: F401

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        importlib.reload(ci)
    msgs = [str(w.message) for w in caught if issubclass(w.category, DeprecationWarning)]
    assert any("studio.configs_io" in m for m in msgs), msgs


def test_old_function_names_still_work(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """旧名 read_config / write_config / ConfigError / USER_CONFIGS_DIR 都得在。"""
    from studio import configs_io, presets_io
    from studio.schema import TrainingConfig

    pdir = tmp_path / "presets"
    pdir.mkdir()
    monkeypatch.setattr(presets_io, "USER_PRESETS_DIR", pdir)

    payload = TrainingConfig().model_dump(mode="python")
    payload["lora_rank"] = 8

    # 直接走 configs_io 旧 API（实际转发到 presets_io）
    configs_io.write_config("legacy", payload, base=pdir)
    assert (pdir / "legacy.yaml").exists()
    got = configs_io.read_config("legacy", base=pdir)
    assert got["lora_rank"] == 8

    with pytest.raises(configs_io.ConfigError):
        configs_io.read_config("nope", base=pdir)


def test_user_configs_dir_alias_points_to_presets() -> None:
    from studio import configs_io
    from studio.paths import USER_PRESETS_DIR

    assert configs_io.USER_CONFIGS_DIR == USER_PRESETS_DIR
