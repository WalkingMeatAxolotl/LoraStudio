"""commit: versions.list_lora_ckpts —— 扫 version output/ 列所有 ckpt 文件。"""
from __future__ import annotations

from pathlib import Path

import pytest

from studio.versions import list_lora_ckpts


@pytest.fixture
def vdir(tmp_path: Path) -> Path:
    out = tmp_path / "output"
    out.mkdir()
    return tmp_path


def test_empty_dir_returns_empty_list(tmp_path: Path) -> None:
    """没 output/ 目录 → 空列表，不抛错。"""
    assert list_lora_ckpts(tmp_path) == []


def test_scans_step_epoch_final(vdir: Path) -> None:
    out = vdir / "output"
    (out / "myproj_step1500.safetensors").touch()
    (out / "myproj_step2000.safetensors").touch()
    (out / "myproj_step2476.safetensors").touch()
    (out / "myproj_epoch5.safetensors").touch()
    (out / "myproj_final.safetensors").touch()

    items = list_lora_ckpts(vdir)
    kinds = [(it["kind"], it["value"]) for it in items]
    # final 第一；step 按 value 降序；epoch 按 value 降序
    assert kinds[0] == ("final", 0)
    assert kinds[1:4] == [("step", 2476), ("step", 2000), ("step", 1500)]
    assert kinds[4] == ("epoch", 5)


def test_label_format(vdir: Path) -> None:
    out = vdir / "output"
    (out / "p_step100.safetensors").touch()
    (out / "p_epoch3.safetensors").touch()
    (out / "p_final.safetensors").touch()

    by_label = {it["label"]: it for it in list_lora_ckpts(vdir)}
    assert "step 100" in by_label
    assert "epoch 3" in by_label
    assert "final" in by_label


def test_unrecognized_filename_kind_other(vdir: Path) -> None:
    """非约定命名归为 other，不丢弃（用户 manually 放进 output 也能选）。"""
    out = vdir / "output"
    (out / "weird_name_v9.safetensors").touch()
    items = list_lora_ckpts(vdir)
    assert len(items) == 1
    assert items[0]["kind"] == "other"
    assert items[0]["label"] == "weird_name_v9"


def test_path_is_absolute_string(vdir: Path) -> None:
    out = vdir / "output"
    (out / "p_step10.safetensors").touch()
    items = list_lora_ckpts(vdir)
    assert items[0]["path"].endswith("p_step10.safetensors")


def test_ignores_non_safetensors(vdir: Path) -> None:
    out = vdir / "output"
    (out / "p_step10.safetensors").touch()
    (out / "training_state_step10.pt").touch()  # 训练状态，不是 LoRA
    (out / "readme.txt").touch()
    items = list_lora_ckpts(vdir)
    assert len(items) == 1
    assert items[0]["kind"] == "step"
