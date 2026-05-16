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


# ---------------------------------------------------------------------------
# parse_preset_bytes（端到端文件导入用）
# ---------------------------------------------------------------------------


def test_parse_yaml_returns_config_and_suggested_name() -> None:
    import yaml
    payload = _payload()
    payload["epochs"] = 12
    raw = yaml.safe_dump(payload, allow_unicode=True).encode("utf-8")
    config, suggested = presets_io.parse_preset_bytes(raw, "my-run.yaml")
    assert config["epochs"] == 12
    assert suggested == "my-run"


def test_parse_json_works_via_yaml_superset() -> None:
    """yaml.safe_load 同时吃 JSON —— 旧 .json 导出能直接导入回来。"""
    import json
    raw = json.dumps(_payload()).encode("utf-8")
    config, suggested = presets_io.parse_preset_bytes(raw, "old.json")
    assert config["lora_type"] == "lokr"
    assert suggested == "old"


def test_parse_rejects_unknown_field() -> None:
    import yaml
    bad = _payload()
    bad["nonexistent_field"] = 123
    raw = yaml.safe_dump(bad).encode("utf-8")
    with pytest.raises(presets_io.PresetError, match="校验失败"):
        presets_io.parse_preset_bytes(raw, "bad.yaml")


def test_parse_rejects_non_mapping() -> None:
    # 顶层是 list 不是 dict
    raw = b"- foo\n- bar\n"
    with pytest.raises(presets_io.PresetError, match="不是 mapping"):
        presets_io.parse_preset_bytes(raw, "list.yaml")


def test_parse_rejects_invalid_utf8() -> None:
    raw = b"\xff\xfe\x00\x00bogus"
    with pytest.raises(presets_io.PresetError, match="UTF-8"):
        presets_io.parse_preset_bytes(raw, "binary.yaml")


def test_parse_sanitizes_suggested_name() -> None:
    """文件名带空格 / 中文 / 特殊字符 → suggested 走 [A-Za-z0-9_-] 白名单。"""
    import yaml
    raw = yaml.safe_dump(_payload()).encode("utf-8")
    _, suggested = presets_io.parse_preset_bytes(raw, "我的 preset (v2).yaml")
    assert all(c.isalnum() or c in "_-" for c in suggested)
    assert "v2" in suggested


def test_parse_empty_filename_fallback() -> None:
    import yaml
    raw = yaml.safe_dump(_payload()).encode("utf-8")
    _, suggested = presets_io.parse_preset_bytes(raw, "")
    assert suggested == "imported"


def test_preset_path_is_public_alias() -> None:
    assert presets_io.preset_path("foo").name == "foo.yaml"
    with pytest.raises(presets_io.PresetError, match="非法预设名"):
        presets_io.preset_path("bad/name")
