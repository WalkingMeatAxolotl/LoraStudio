"""数据集扫描 + /api/datasets 端点测试。"""
from __future__ import annotations

from pathlib import Path

import pytest

from studio import datasets


def _touch_image(folder: Path, name: str, size: int = 8) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    p = folder / name
    p.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * size)  # 假 PNG header
    return p


def test_parse_repeat_kohya_prefix() -> None:
    assert datasets.parse_repeat("5_concept") == (5, "concept")
    assert datasets.parse_repeat("12_a_long_name") == (12, "a_long_name")
    assert datasets.parse_repeat("noprefix") == (1, "noprefix")
    assert datasets.parse_repeat("0_zero") == (0, "zero")


def test_caption_kind_priority(tmp_path: Path) -> None:
    img = _touch_image(tmp_path, "a.png")
    assert datasets.caption_kind(img) == "none"
    img.with_suffix(".txt").write_text("tag1, tag2", encoding="utf-8")
    assert datasets.caption_kind(img) == "txt"
    img.with_suffix(".json").write_text("{}", encoding="utf-8")
    assert datasets.caption_kind(img) == "json"  # json 优先于 txt


def test_scan_folder_counts_and_samples(tmp_path: Path) -> None:
    folder = tmp_path / "5_concept"
    for i in range(3):
        img = _touch_image(folder, f"{i:02d}.png")
        if i == 0:
            img.with_suffix(".json").write_text("{}", encoding="utf-8")
        elif i == 1:
            img.with_suffix(".txt").write_text("tag", encoding="utf-8")
        # 第 3 张没 caption
    # 一个非图片文件不应被计数
    (folder / "notes.md").write_text("ignore me", encoding="utf-8")

    result = datasets.scan_folder(folder)
    assert result["repeat"] == 5
    assert result["label"] == "concept"
    assert result["image_count"] == 3
    assert result["caption_types"] == {"json": 1, "txt": 1, "none": 1}
    assert len(result["samples"]) == 3


def test_scan_folder_sample_limit(tmp_path: Path) -> None:
    folder = tmp_path / "1_x"
    for i in range(10):
        _touch_image(folder, f"{i:02d}.png")
    result = datasets.scan_folder(folder, sample_limit=4)
    assert len(result["samples"]) == 4


def test_scan_root_with_subfolders(tmp_path: Path) -> None:
    _touch_image(tmp_path / "1_old", "a.png")
    _touch_image(tmp_path / "5_new", "b.png")
    _touch_image(tmp_path / "5_new", "c.png")
    result = datasets.scan_dataset_root(tmp_path)
    assert result["exists"] is True
    assert result["total_images"] == 3
    # 1_old × 1 + 5_new × 2 × 5 = 11
    assert result["weighted_steps_per_epoch"] == 11
    names = {f["name"] for f in result["folders"]}
    assert names == {"1_old", "5_new"}


def test_scan_root_includes_loose_root_images(tmp_path: Path) -> None:
    """根目录直接放的图也算一个 repeat=1 的虚拟项。"""
    _touch_image(tmp_path, "loose1.png")
    _touch_image(tmp_path / "5_x", "real.png")
    result = datasets.scan_dataset_root(tmp_path)
    assert result["total_images"] == 2
    folders = result["folders"]
    # 第一项应该是根散图
    assert folders[0]["name"] == "(根目录)"
    assert folders[0]["repeat"] == 1


def test_scan_missing_root(tmp_path: Path) -> None:
    result = datasets.scan_dataset_root(tmp_path / "nonexistent")
    assert result["exists"] is False
    assert result["folders"] == []


# ---------------------------------------------------------------------------
# /api/datasets HTTP
# ---------------------------------------------------------------------------


@pytest.fixture
def client_with_dataset(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """为端点测试构造一个临时 dataset，并把 server 的 REPO_ROOT 指过去。"""
    from fastapi.testclient import TestClient
    from studio import server

    fake_root = tmp_path / "repo"
    fake_root.mkdir()
    ds = fake_root / "dataset"
    _touch_image(ds / "5_concept", "a.png")
    _touch_image(ds / "5_concept", "b.png")

    monkeypatch.setattr(server, "REPO_ROOT", fake_root)
    return TestClient(server.app), fake_root


def test_api_datasets_default_path(client_with_dataset) -> None:
    client, _ = client_with_dataset
    resp = client.get("/api/datasets")
    assert resp.status_code == 200
    data = resp.json()
    assert data["exists"] is True
    assert data["total_images"] == 2
    assert data["folders"][0]["name"] == "5_concept"
    assert data["folders"][0]["repeat"] == 5


def test_api_datasets_custom_relative_path(client_with_dataset) -> None:
    client, _ = client_with_dataset
    resp = client.get("/api/datasets?path=dataset")
    assert resp.status_code == 200


def test_api_datasets_missing_path_returns_exists_false(client_with_dataset) -> None:
    client, _ = client_with_dataset
    resp = client.get("/api/datasets?path=nonexistent")
    assert resp.status_code == 200
    assert resp.json()["exists"] is False


def test_thumbnail_serves_image(client_with_dataset) -> None:
    client, root = client_with_dataset
    folder = root / "dataset" / "5_concept"
    resp = client.get(
        "/api/datasets/thumbnail",
        params={"folder": str(folder), "name": "a.png"},
    )
    assert resp.status_code == 200


def test_thumbnail_blocks_traversal(client_with_dataset) -> None:
    client, _ = client_with_dataset
    resp = client.get(
        "/api/datasets/thumbnail",
        params={"folder": "../etc", "name": "passwd"},
    )
    assert resp.status_code in (400, 403, 404)


def test_thumbnail_blocks_outside_repo(client_with_dataset, tmp_path: Path) -> None:
    """文件实际存在但不在 REPO_ROOT 下时拒绝。"""
    client, _ = client_with_dataset
    outside_dir = tmp_path / "outside"
    outside_img = _touch_image(outside_dir, "x.png")
    resp = client.get(
        "/api/datasets/thumbnail",
        params={"folder": str(outside_dir), "name": outside_img.name},
    )
    assert resp.status_code == 403
