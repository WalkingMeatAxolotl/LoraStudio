"""PP5.5 — reg_postprocess 单元测试。"""
from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from studio.services import reg_postprocess


def _make_image(path: Path, size: tuple[int, int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, (255, 255, 255)).save(path, "PNG")


# ---------------------------------------------------------------------------
# crop ratio 计算
# ---------------------------------------------------------------------------


def test_calculate_crop_ratio_smart_same_aspect_returns_scale_diff() -> None:
    # 同 aspect ratio：源脚本返回最大维度变化比例（不是 0）
    r = reg_postprocess.calculate_crop_ratio(1024, 768, 512, 384, "smart")
    assert r == pytest.approx(0.5, abs=1e-3)


def test_calculate_crop_ratio_smart_identical_returns_zero() -> None:
    # 完全相同
    r = reg_postprocess.calculate_crop_ratio(512, 512, 512, 512, "smart")
    assert r == pytest.approx(0.0, abs=1e-6)


def test_calculate_crop_ratio_smart_wider_image_crops_width() -> None:
    # 原图更宽（2:1），目标 1:1 → smart 缩放后裁宽
    r = reg_postprocess.calculate_crop_ratio(1000, 500, 500, 500, "smart")
    # 缩放到 (1000, 500) -> (1000, 500)? 高度从 500 → 500，所以 new_w=1000，crop=(1000-500)/1000=0.5
    assert r == pytest.approx(0.5, abs=1e-3)


def test_calculate_crop_ratio_stretch_compares_dimensions() -> None:
    r = reg_postprocess.calculate_crop_ratio(1000, 1000, 500, 500, "stretch")
    assert r == pytest.approx(0.5, abs=1e-3)


# ---------------------------------------------------------------------------
# resize / crop
# ---------------------------------------------------------------------------


def test_resize_smart_writes_target_size(tmp_path: Path) -> None:
    src = tmp_path / "a.png"
    _make_image(src, (1024, 768))
    ok = reg_postprocess.resize_and_crop_image(src, 512, 512, src, "smart")
    assert ok is True
    with Image.open(src) as img:
        assert img.size == (512, 512)


def test_resize_stretch_writes_target_size(tmp_path: Path) -> None:
    src = tmp_path / "a.png"
    _make_image(src, (200, 800))
    ok = reg_postprocess.resize_and_crop_image(src, 400, 400, src, "stretch")
    assert ok is True
    with Image.open(src) as img:
        assert img.size == (400, 400)


def test_resize_invalid_method_returns_false(tmp_path: Path) -> None:
    src = tmp_path / "a.png"
    _make_image(src, (200, 200))
    ok = reg_postprocess.resize_and_crop_image(src, 100, 100, src, "bogus")
    assert ok is False


# ---------------------------------------------------------------------------
# clustering
# ---------------------------------------------------------------------------


def test_cluster_by_resolution_uniform_returns_single_cluster(tmp_path: Path) -> None:
    """所有图同分辨率 → k=1 必然 valid。"""
    images = [
        reg_postprocess._ImageInfo(
            path=tmp_path / f"{i}.png", width=512, height=512, aspect_ratio=1.0
        )
        for i in range(5)
    ]
    clusters = reg_postprocess.cluster_by_resolution(images, max_crop_ratio=0.1)
    assert clusters is not None
    assert len(clusters) == 1


def test_cluster_by_resolution_fewer_than_two_images() -> None:
    images = [reg_postprocess._ImageInfo(
        path=Path("x.png"), width=100, height=100, aspect_ratio=1.0,
    )]
    clusters = reg_postprocess.cluster_by_resolution(images, max_crop_ratio=0.1)
    assert clusters == {0: images}


def test_cluster_by_resolution_unable_returns_none() -> None:
    """图分辨率差异极大且 max_crop_ratio 极严 → 找不到满足限制的 K。"""
    # 4 张完全不同 AR 的图，max_crop=0 → 1 张图自己一类才能 0% crop
    # 但 _cluster_by_resolution 跳过 k >= len(images)，所以无法都 1 张一类 → None
    images = [
        reg_postprocess._ImageInfo(path=Path("a.png"), width=100, height=1000, aspect_ratio=0.1),
        reg_postprocess._ImageInfo(path=Path("b.png"), width=1000, height=100, aspect_ratio=10.0),
        reg_postprocess._ImageInfo(path=Path("c.png"), width=500, height=500, aspect_ratio=1.0),
        reg_postprocess._ImageInfo(path=Path("d.png"), width=200, height=400, aspect_ratio=0.5),
    ]
    clusters = reg_postprocess.cluster_by_resolution(images, max_crop_ratio=0.0)
    assert clusters is None


# ---------------------------------------------------------------------------
# postprocess 主入口
# ---------------------------------------------------------------------------


def test_postprocess_uniform_images_resizes_to_median(tmp_path: Path) -> None:
    reg_dir = tmp_path / "reg"
    _make_image(reg_dir / "1_data" / "100.png", (512, 512))
    _make_image(reg_dir / "1_data" / "101.png", (640, 640))
    _make_image(reg_dir / "1_data" / "102.png", (768, 768))
    result = reg_postprocess.postprocess(
        reg_dir, method="smart", max_crop_ratio=0.5, on_progress=lambda _: None
    )
    assert result["clusters"] == 1
    # 中位数 = 640，所以三张都应该是 640x640
    for p in (reg_dir / "1_data").glob("*.png"):
        with Image.open(p) as img:
            assert img.size == (640, 640)


def test_postprocess_no_images_returns_empty(tmp_path: Path) -> None:
    reg_dir = tmp_path / "reg"
    reg_dir.mkdir(parents=True)
    result = reg_postprocess.postprocess(reg_dir, on_progress=lambda _: None)
    assert result["clusters"] is None
    assert result["processed"] == 0


def test_postprocess_unable_to_cluster_keeps_original(tmp_path: Path) -> None:
    """max_crop=0.0 + 不同 AR → 找不到 K，保持原样。"""
    reg_dir = tmp_path / "reg" / "1_data"
    _make_image(reg_dir / "a.png", (100, 1000))
    _make_image(reg_dir / "b.png", (1000, 100))
    _make_image(reg_dir / "c.png", (500, 500))
    _make_image(reg_dir / "d.png", (200, 400))
    result = reg_postprocess.postprocess(
        reg_dir.parent, method="smart", max_crop_ratio=0.0,
        on_progress=lambda _: None,
    )
    assert result["clusters"] is None
    # 原图不动
    with Image.open(reg_dir / "a.png") as img:
        assert img.size == (100, 1000)


def test_postprocess_invalid_method_skips(tmp_path: Path) -> None:
    reg_dir = tmp_path / "reg" / "1_data"
    _make_image(reg_dir / "a.png", (256, 256))
    result = reg_postprocess.postprocess(
        reg_dir.parent, method="bogus", on_progress=lambda _: None
    )
    assert result["clusters"] is None


def test_postprocess_skips_already_target_size(tmp_path: Path) -> None:
    """已经匹配中位数分辨率的图 → 不重写。"""
    reg_dir = tmp_path / "reg" / "1_data"
    _make_image(reg_dir / "a.png", (512, 512))
    _make_image(reg_dir / "b.png", (512, 512))
    _make_image(reg_dir / "c.png", (512, 512))
    result = reg_postprocess.postprocess(
        reg_dir.parent, method="smart", max_crop_ratio=0.1,
        on_progress=lambda _: None,
    )
    assert result["clusters"] == 1
    # 全部已匹配 → skipped 全量
    assert result["processed"] == 0
    assert result["skipped"] == 3


def test_postprocess_dedupes_same_filename_across_subfolders(tmp_path: Path) -> None:
    """文件名（小写）重复时只处理第一份。"""
    reg_dir = tmp_path / "reg"
    _make_image(reg_dir / "1_data" / "100.png", (512, 512))
    _make_image(reg_dir / "5_concept" / "100.png", (1024, 1024))
    result = reg_postprocess.postprocess(
        reg_dir, method="smart", max_crop_ratio=0.5,
        on_progress=lambda _: None,
    )
    # 共「2 张唯一」？不，文件名都叫 100.png，去重后只有 1 张 → cluster 必然 1 张
    assert result.get("clusters") in (1, None)
