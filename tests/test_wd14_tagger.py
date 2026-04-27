"""PP4 — WD14 tagger：mock onnx + filesystem 验证模型解析、preprocess、postprocess。"""
from __future__ import annotations

import csv
from pathlib import Path
from unittest.mock import MagicMock

import numpy as np
import pytest
from PIL import Image

from studio import secrets
from studio.services import wd14_tagger


@pytest.fixture
def isolated_secrets(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    sf = tmp_path / "secrets.json"
    monkeypatch.setattr(secrets, "SECRETS_FILE", sf)
    return tmp_path


def _make_local_model(model_dir: Path, tags: list[tuple[str, int]]) -> None:
    model_dir.mkdir(parents=True, exist_ok=True)
    (model_dir / "model.onnx").write_bytes(b"fake-onnx")
    with open(model_dir / "selected_tags.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["tag_id", "name", "category"])
        for i, (n, c) in enumerate(tags):
            w.writerow([i, n, c])


def test_resolve_local_dir(isolated_secrets: Path) -> None:
    model_dir = isolated_secrets / "models" / "x"
    _make_local_model(model_dir, [("a", 0)])
    secrets.update({"wd14": {"local_dir": str(model_dir)}})
    t = wd14_tagger.WD14Tagger()
    resolved = t._resolve_model_dir()
    assert resolved == model_dir


def test_resolve_local_dir_missing_files_raises(isolated_secrets: Path) -> None:
    bad = isolated_secrets / "bad"
    bad.mkdir()
    secrets.update({"wd14": {"local_dir": str(bad)}})
    t = wd14_tagger.WD14Tagger()
    with pytest.raises(FileNotFoundError, match="缺少"):
        t._resolve_model_dir()


def test_postprocess_filters_by_threshold(isolated_secrets: Path) -> None:
    secrets.update({
        "wd14": {
            "threshold_general": 0.5,
            "threshold_character": 0.85,
            "blacklist_tags": ["banned"],
        }
    })
    t = wd14_tagger.WD14Tagger()
    t._tags = ["1girl", "solo", "banned", "char_a", "rating"]
    t._tag_categories = [0, 0, 0, 4, 9]  # 9 = rating, 4 = character
    logits = np.array([[0.9, 0.4, 0.99, 0.7, 0.95]])
    tags, scores = t._postprocess(logits)
    # 1girl (0.9 > 0.5 ✓), solo (0.4 < 0.5 ✗), banned (blacklist),
    # char_a (0.7 < 0.85 ✗), rating (cat=9 → drop)
    assert tags == ["1girl"]
    assert scores == {"1girl": pytest.approx(0.9)}


def test_postprocess_sorts_by_score_desc(isolated_secrets: Path) -> None:
    secrets.update({"wd14": {"threshold_general": 0.1, "threshold_character": 0.1}})
    t = wd14_tagger.WD14Tagger()
    t._tags = ["a", "b", "c"]
    t._tag_categories = [0, 0, 0]
    logits = np.array([[0.3, 0.9, 0.5]])
    tags, _ = t._postprocess(logits)
    assert tags == ["b", "c", "a"]


def test_preprocess_pads_to_square(isolated_secrets: Path) -> None:
    t = wd14_tagger.WD14Tagger()
    t._input_size = 16  # 小尺寸方便看
    img = Image.new("RGB", (10, 4), (255, 0, 0))
    arr = t._preprocess(img)
    assert arr.shape == (1, 16, 16, 3)
    # BGR：第三通道是 R（值 255）
    assert arr[0, 8, 8, 2] == pytest.approx(255.0, abs=1.0)


def test_tag_iterator_handles_io_error(
    isolated_secrets: Path, tmp_path: Path
) -> None:
    """传入不存在的文件 → yield error，不抛错。"""
    t = wd14_tagger.WD14Tagger()
    # mock prepare 不真做
    t._session = MagicMock()
    t._session.run.return_value = (np.array([[0.9]]),)
    t._tags = ["x"]
    t._tag_categories = [0]
    t._input_name = "input"
    t._input_size = 4

    secrets.update({"wd14": {"threshold_general": 0.1, "threshold_character": 0.1}})

    # 一张存在，一张不存在
    good = tmp_path / "good.png"
    Image.new("RGB", (8, 8)).save(good)
    bad = tmp_path / "ghost.png"

    results = list(t.tag([good, bad]))
    assert len(results) == 2
    assert results[0]["tags"] == ["x"]
    assert "error" in results[1]
