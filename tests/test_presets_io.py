"""PP0 — presets_io 等价于 PP0 之前的 configs_io（更名 + 异常类换名）。

复用原 test_studio_configs.py 的 IO 用例集，把字眼从 config 切换到 preset，
确保所有原有行为（命名校验、roundtrip、duplicate 冲突等）继续保持。
"""
from __future__ import annotations

from pathlib import Path

import pytest

from studio import presets_io
from studio.schema import TrainingConfig


@pytest.fixture
def presets_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    pdir = tmp_path / "presets"
    pdir.mkdir()
    monkeypatch.setattr(presets_io, "USER_PRESETS_DIR", pdir)
    return pdir


def _payload() -> dict:
    return TrainingConfig().model_dump(mode="python")


def test_write_then_read_roundtrip(presets_dir: Path) -> None:
    payload = _payload()
    payload["lora_rank"] = 64
    presets_io.write_preset("alpha", payload)
    assert (presets_dir / "alpha.yaml").exists()
    got = presets_io.read_preset("alpha")
    assert got["lora_rank"] == 64


def test_write_invalid_rejected(presets_dir: Path) -> None:
    with pytest.raises(presets_io.PresetError):
        presets_io.write_preset("bad", {"lora_rank": "not-an-int"})
    assert not list(presets_dir.glob("*.yaml"))


def test_name_validation(presets_dir: Path) -> None:
    for bad in ("../escape", "name with space", "name/sub", "name.dot"):
        with pytest.raises(presets_io.PresetError, match="非法预设名"):
            presets_io.write_preset(bad, _payload())


def test_list_sorted_by_mtime(presets_dir: Path) -> None:
    import time
    presets_io.write_preset("first", _payload())
    time.sleep(0.05)
    presets_io.write_preset("second", _payload())
    items = presets_io.list_presets()
    assert [x["name"] for x in items[:2]] == ["second", "first"]


def test_delete(presets_dir: Path) -> None:
    presets_io.write_preset("to_delete", _payload())
    presets_io.delete_preset("to_delete")
    assert not (presets_dir / "to_delete.yaml").exists()


def test_delete_missing_raises(presets_dir: Path) -> None:
    with pytest.raises(presets_io.PresetError, match="不存在"):
        presets_io.delete_preset("ghost")


def test_duplicate(presets_dir: Path) -> None:
    payload = _payload()
    payload["lora_rank"] = 16
    presets_io.write_preset("src", payload)
    presets_io.duplicate_preset("src", "src_copy")
    assert (presets_dir / "src_copy.yaml").exists()
    assert presets_io.read_preset("src_copy")["lora_rank"] == 16


def test_duplicate_conflict(presets_dir: Path) -> None:
    presets_io.write_preset("a", _payload())
    presets_io.write_preset("b", _payload())
    with pytest.raises(presets_io.PresetError, match="已存在"):
        presets_io.duplicate_preset("a", "b")
