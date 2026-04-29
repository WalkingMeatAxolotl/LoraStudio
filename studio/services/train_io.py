"""PP7 — 训练集（打标后的 train/）导出 / 导入。

云上 Studio 实例易丢；用户在 ④ 标签编辑那一步往往要花数小时手工调 caption，
真正怕丢的是「打标后的 train/」。本模块把它打成可下载的 zip，并支持导回新建项目。

zip 结构：
    {slug}-{label}.train.zip
    ├── manifest.json    # source / stats
    └── train/
        └── {N}_data/    # 原样保留 N
            ├── *.png/...
            └── *.txt    # 可选

导入语义：永远新建 project + v1（不合并到现有），slug 冲突自动加 -imported-{ts}。
"""
from __future__ import annotations

import json
import sqlite3
import time
import zipfile
from pathlib import Path
from typing import Any, Optional

from .. import projects, versions
from ..datasets import IMAGE_EXTS

SCHEMA_VERSION = 1
MANIFEST_NAME = "manifest.json"
TRAIN_PREFIX = "train/"
CAPTION_EXTS = {".txt"}


class TrainIOError(Exception):
    """导出 / 导入过程的业务错误。"""


# ---------------------------------------------------------------------------
# export
# ---------------------------------------------------------------------------


def export_train(
    conn: sqlite3.Connection, version_id: int, dest: Path
) -> dict[str, Any]:
    """打包 version 的 train/ + manifest.json 到 dest（zip 路径）。

    dest 父目录必须已存在；用 ZIP_STORED（PNG/jpg 已是压缩态）。
    返回 {"manifest": {...}, "size_bytes": int}。
    """
    v = versions.get_version(conn, version_id)
    if not v:
        raise TrainIOError(f"版本不存在: id={version_id}")
    p = projects.get_project(conn, v["project_id"])
    if not p:
        raise TrainIOError(f"项目不存在: id={v['project_id']}")

    train_dir = versions.version_dir(p["id"], p["slug"], v["label"]) / "train"
    if not train_dir.exists():
        raise TrainIOError("train/ 目录不存在")

    concepts: list[dict[str, Any]] = []
    image_count = 0
    tagged_count = 0
    payload: list[tuple[Path, str]] = []  # (abs_path, arcname)

    for sub in sorted(train_dir.iterdir()):
        if not sub.is_dir():
            continue
        cnt = 0
        for f in sorted(sub.iterdir()):
            if not f.is_file():
                continue
            ext = f.suffix.lower()
            if ext in IMAGE_EXTS:
                cnt += 1
                arc = f"{TRAIN_PREFIX}{sub.name}/{f.name}"
                payload.append((f, arc))
                if f.with_suffix(".txt").exists():
                    tagged_count += 1
            elif ext in CAPTION_EXTS:
                arc = f"{TRAIN_PREFIX}{sub.name}/{f.name}"
                payload.append((f, arc))
        if cnt > 0:
            concepts.append({"folder": sub.name, "image_count": cnt})
            image_count += cnt

    if image_count == 0:
        raise TrainIOError("train/ 下无图片，无可导出内容")

    manifest = {
        "schema_version": SCHEMA_VERSION,
        "exported_at": time.time(),
        "source": {
            "title": p["title"],
            "version_label": v["label"],
            "slug": p["slug"],
        },
        "stats": {
            "image_count": image_count,
            "tagged_count": tagged_count,
            "untagged_count": image_count - tagged_count,
            "concepts": concepts,
        },
    }

    with zipfile.ZipFile(
        dest, "w", compression=zipfile.ZIP_STORED, allowZip64=True
    ) as zf:
        zf.writestr(MANIFEST_NAME, json.dumps(manifest, ensure_ascii=False, indent=2))
        for src, arc in payload:
            zf.write(src, arcname=arc)

    return {"manifest": manifest, "size_bytes": dest.stat().st_size}


# ---------------------------------------------------------------------------
# import
# ---------------------------------------------------------------------------


def _safe_arc(name: str) -> Optional[str]:
    """zip slip 防护：拒绝绝对路径 / .. 段 / 非 train/ 前缀。

    返回去掉 train/ 前缀后的 「{folder}/{filename}」相对部分；
    不合法返回 None。空目录条目（以 / 结尾）也返回 None。
    """
    if not name or name.endswith("/"):
        return None
    norm = name.replace("\\", "/")
    if norm.startswith("/") or ".." in norm.split("/"):
        return None
    if not norm.startswith(TRAIN_PREFIX):
        return None
    inner = norm[len(TRAIN_PREFIX) :]
    parts = inner.split("/")
    # 至少 {folder}/{filename}，再深的层级（{folder}/sub/x.png）拒绝
    if len(parts) != 2 or not parts[0] or not parts[1]:
        return None
    return inner


def _read_manifest(zf: zipfile.ZipFile) -> dict[str, Any]:
    try:
        with zf.open(MANIFEST_NAME) as fh:
            return json.loads(fh.read().decode("utf-8"))
    except KeyError as exc:
        raise TrainIOError("zip 缺少 manifest.json") from exc
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise TrainIOError(f"manifest.json 解析失败: {exc}") from exc


def _resolve_slug_conflict(
    conn: sqlite3.Connection, base: str
) -> str:
    """slug 冲突 → 加 -imported-{ts} 后缀；仍冲突再加 -{n}。"""
    if not conn.execute(
        "SELECT 1 FROM projects WHERE slug = ?", (base,)
    ).fetchone():
        return base
    candidate = f"{base}-imported-{int(time.time())}"
    n = 1
    final = candidate
    while conn.execute(
        "SELECT 1 FROM projects WHERE slug = ?", (final,)
    ).fetchone():
        n += 1
        final = f"{candidate}-{n}"
    return final


def import_train(
    conn: sqlite3.Connection, zip_path: Path
) -> dict[str, Any]:
    """从 zip 解出新建 project + v1，stage=tagging。

    返回 {"project": {...}, "version": {...}, "stats": {...}}。
    """
    if not zip_path.exists():
        raise TrainIOError(f"zip 不存在: {zip_path}")

    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            manifest = _read_manifest(zf)
            source = manifest.get("source") or {}
            title = (source.get("title") or "imported").strip() or "imported"
            base_slug = projects.slugify(source.get("slug") or title)

            # 先扫一遍合法 entry；空内容直接报错避免建空项目
            entries: list[tuple[zipfile.ZipInfo, str]] = []
            for info in zf.infolist():
                if info.is_dir():
                    continue
                if info.filename == MANIFEST_NAME:
                    continue
                inner = _safe_arc(info.filename)
                if inner is None:
                    raise TrainIOError(
                        f"非法路径: {info.filename!r}（仅允许 train/{{folder}}/{{file}}）"
                    )
                entries.append((info, inner))

            if not entries:
                raise TrainIOError("zip 中无可导入内容")

            # 建 project + v1（用 DAO，自动建目录树）
            slug = _resolve_slug_conflict(conn, base_slug)
            note = f"imported from {title!r}"
            p = projects.create_project(conn, title=title, slug=slug, note=note)
            v = versions.create_version(
                conn, project_id=p["id"], label="v1"
            )

            vdir = versions.version_dir(p["id"], p["slug"], v["label"])
            train_dir = vdir / "train"
            seen_folders: set[str] = set()

            for info, inner in entries:
                folder, filename = inner.split("/", 1)
                # 文件名再保险一层
                if "/" in filename or "\\" in filename or filename.startswith("."):
                    raise TrainIOError(f"非法文件名: {filename!r}")
                target_dir = train_dir / folder
                target_dir.mkdir(parents=True, exist_ok=True)
                seen_folders.add(folder)
                target = target_dir / filename
                with zf.open(info) as src, target.open("wb") as dst:
                    while True:
                        chunk = src.read(64 * 1024)
                        if not chunk:
                            break
                        dst.write(chunk)

            # 写完后再统计 tagged_count —— zip 顺序不定，边写边数会漏（先 .png 后 .txt 时拿到 0）
            image_count = 0
            tagged_count = 0
            for folder in seen_folders:
                fdir = train_dir / folder
                if not fdir.exists():
                    continue
                for f in fdir.iterdir():
                    if f.is_file() and f.suffix.lower() in IMAGE_EXTS:
                        image_count += 1
                        if f.with_suffix(".txt").exists():
                            tagged_count += 1

            # stage 推到 tagging（用户可能还想继续打标 / 或直接编辑）
            versions.advance_stage(conn, v["id"], "tagging")
            projects.advance_stage(conn, p["id"], "tagging")

            v = versions.get_version(conn, v["id"])
            p = projects.get_project(conn, p["id"])
            assert v is not None and p is not None

    except zipfile.BadZipFile as exc:
        raise TrainIOError(f"zip 损坏: {exc}") from exc

    stats = {
        "image_count": image_count,
        "tagged_count": tagged_count,
        "untagged_count": image_count - tagged_count,
        "concepts": sorted(seen_folders),
    }
    return {"project": p, "version": v, "stats": stats}
