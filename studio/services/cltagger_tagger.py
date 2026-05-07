"""CLTagger ONNX 打标。

CLTagger 与 WD14 都走本地 onnxruntime，但模型资产和后处理不同：
CLTagger 使用 `tag_mapping.json`，输出 logits 需 sigmoid，角色标签有单独阈值。
"""
from __future__ import annotations

import contextlib
import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Optional

import numpy as np
from PIL import Image, ImageOps

from .. import secrets
from . import model_downloader, onnxruntime_setup
from .tagger import ProgressFn, TagResult
from .wd14_tagger import _safe_dir_name, _silenced_fd_stderr

logger = logging.getLogger(__name__)


@dataclass
class _LabelData:
    names: list[str | None]
    categories: list[str]


class CLTagger:
    name = "cltagger"
    requires_service = False

    def __init__(self, overrides: dict | None = None) -> None:
        self._overrides = {k: v for k, v in (overrides or {}).items() if v is not None}
        self._session = None
        self._labels: _LabelData | None = None
        self._input_name: str | None = None
        self._output_names: list[str] | None = None
        self._input_size: int = 448
        self._input_layout: str = "nchw"

    def _cfg(self) -> "secrets.CLTaggerConfig":
        base = secrets.load().cltagger.model_dump()
        for k, v in self._overrides.items():
            if k in base:
                base[k] = v
        return secrets.CLTaggerConfig(**base)

    def _local_model_files_status(self) -> tuple[Path, Path, bool]:
        cfg = self._cfg()
        base = (
            Path(cfg.local_dir)
            if cfg.local_dir
            else model_downloader.models_root() / "cltagger" / _safe_dir_name(cfg.model_id)
        )
        model_path = base / cfg.model_path
        mapping_path = base / cfg.tag_mapping_path
        if model_path.exists() and mapping_path.exists():
            return model_path, mapping_path, True
        if cfg.local_dir:
            flat_model = base / Path(cfg.model_path).name
            flat_mapping = base / Path(cfg.tag_mapping_path).name
            if flat_model.exists() and flat_mapping.exists():
                return flat_model, flat_mapping, True
        return model_path, mapping_path, False

    def _resolve_model_files(self) -> tuple[Path, Path]:
        cfg = self._cfg()
        model_path, mapping_path, ok = self._local_model_files_status()
        if ok:
            return model_path, mapping_path
        if cfg.local_dir:
            raise FileNotFoundError(
                "local_dir 缺少 CLTagger 模型文件或 tag_mapping.json: "
                f"{model_path} / {mapping_path}"
            )
        base = model_path.parents[len(Path(cfg.model_path).parts) - 1]
        model_downloader.download_cltagger(base, cfg, on_log=logger.info)
        if not model_path.exists() or not mapping_path.exists():
            raise FileNotFoundError(
                "CLTagger 下载后仍缺少模型文件或 tag_mapping.json: "
                f"{model_path} / {mapping_path}"
            )
        return model_path, mapping_path

    def is_available(self) -> tuple[bool, str]:
        try:
            model_path, mapping_path, ok = self._local_model_files_status()
        except Exception as exc:  # noqa: BLE001
            return False, str(exc)
        if not ok:
            if self._cfg().local_dir:
                return False, (
                    "local_dir 缺少 CLTagger 模型文件或 tag_mapping.json: "
                    f"{model_path} / {mapping_path}"
                )
            return False, f"需下载模型: {model_path.parent.name}"
        return True, f"模型: {model_path.parent.name}"

    def prepare(self) -> None:
        if self._session is not None:
            return
        try:
            import onnxruntime as ort
        except ImportError as exc:  # pragma: no cover - install hint
            raise RuntimeError(
                "未安装 onnxruntime；请安装 onnxruntime 或 onnxruntime-gpu"
            ) from exc

        model_path, mapping_path = self._resolve_model_files()
        providers = ["CPUExecutionProvider"]
        avail = ort.get_available_providers()
        if "CUDAExecutionProvider" in avail:
            providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        cuda_attempt = "CUDAExecutionProvider" in providers
        ctx = _silenced_fd_stderr() if cuda_attempt else contextlib.nullcontext()
        try:
            with ctx:
                self._session = ort.InferenceSession(str(model_path), providers=providers)
        except Exception as exc:  # noqa: BLE001
            if not cuda_attempt:
                raise
            err = str(exc)
            logger.warning("CLTagger CUDA session 创建失败，降级 CPU 重试: %s", err)
            onnxruntime_setup.record_cuda_load_error(err)
            self._session = ort.InferenceSession(
                str(model_path), providers=["CPUExecutionProvider"]
            )
        input_meta = self._session.get_inputs()[0]
        self._input_name = input_meta.name
        self._output_names = [o.name for o in self._session.get_outputs()]
        self._input_layout = self._infer_input_layout(input_meta.shape)
        self._input_size = self._infer_input_size(input_meta.shape, self._input_layout)
        self._labels = self._load_tag_mapping(mapping_path)

    @staticmethod
    def _infer_input_layout(shape: list[object]) -> str:
        if len(shape) >= 4:
            if shape[1] == 3:
                return "nchw"
            if shape[-1] == 3:
                return "nhwc"
        return "nchw"

    @staticmethod
    def _infer_input_size(shape: list[object], layout: str) -> int:
        dims = list(shape)
        if len(dims) >= 4:
            if layout == "nchw":
                for dim in (dims[2], dims[3]):
                    if isinstance(dim, int) and dim > 0:
                        return dim
            else:
                for dim in (dims[1], dims[2]):
                    if isinstance(dim, int) and dim > 0:
                        return dim
        for dim in reversed(dims):
            if isinstance(dim, int) and dim > 0 and dim != 3:
                return dim
        return 448

    @staticmethod
    def _load_tag_mapping(mapping_path: Path) -> _LabelData:
        raw = json.loads(mapping_path.read_text(encoding="utf-8"))
        if isinstance(raw, dict) and "idx_to_tag" in raw:
            idx_to_tag = {int(k): str(v) for k, v in raw["idx_to_tag"].items()}
            tag_to_category = {str(k): str(v) for k, v in raw.get("tag_to_category", {}).items()}
        elif isinstance(raw, dict):
            idx_to_tag = {}
            tag_to_category = {}
            for k, v in raw.items():
                if not isinstance(v, dict):
                    raise ValueError("Unsupported CLTagger tag_mapping.json format")
                tag = str(v["tag"])
                idx_to_tag[int(k)] = tag
                tag_to_category[tag] = str(v.get("category", "General"))
        else:
            raise ValueError("Unsupported CLTagger tag_mapping.json format")

        size = max(idx_to_tag.keys(), default=-1) + 1
        names: list[str | None] = [None] * size
        categories = ["General"] * size
        for idx, tag in idx_to_tag.items():
            names[idx] = tag
            categories[idx] = tag_to_category.get(tag, "General")
        return _LabelData(names=names, categories=categories)

    def _preprocess(self, img: Image.Image) -> np.ndarray:
        size = self._input_size
        img = ImageOps.exif_transpose(img) or img
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA") if "transparency" in img.info else img.convert("RGB")
        if img.mode == "RGBA":
            canvas = Image.new("RGB", img.size, (255, 255, 255))
            canvas.paste(img, mask=img.split()[3])
            img = canvas
        if img.width != img.height:
            side = max(img.width, img.height)
            canvas = Image.new("RGB", (side, side), (255, 255, 255))
            canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
            img = canvas
        img = img.resize((size, size), Image.Resampling.BICUBIC)
        arr = np.asarray(img, dtype=np.float32) / 255.0
        arr = arr[..., ::-1]  # RGB -> BGR
        if self._input_layout == "nchw":
            arr = arr.transpose(2, 0, 1)
            mean = np.array([0.5, 0.5, 0.5], dtype=np.float32).reshape(3, 1, 1)
            std = np.array([0.5, 0.5, 0.5], dtype=np.float32).reshape(3, 1, 1)
        else:
            mean = np.array([0.5, 0.5, 0.5], dtype=np.float32).reshape(1, 1, 3)
            std = np.array([0.5, 0.5, 0.5], dtype=np.float32).reshape(1, 1, 3)
        return (arr - mean) / std

    @staticmethod
    def _sigmoid(x: np.ndarray) -> np.ndarray:
        return 1.0 / (1.0 + np.exp(-np.clip(x, -30, 30)))

    def _postprocess_one(
        self, logits: np.ndarray
    ) -> tuple[list[str], dict[str, float]]:
        cfg = self._cfg()
        assert self._labels is not None
        scores = self._sigmoid(logits)
        out: list[tuple[str, float]] = []
        blacklist = set(cfg.blacklist_tags)
        for i, p in enumerate(scores):
            if i >= len(self._labels.names):
                break
            tag = self._labels.names[i]
            if not tag or tag in blacklist:
                continue
            cat = self._labels.categories[i]
            if cat == "Rating" and not cfg.add_rating_tag:
                continue
            if cat == "Model" and not cfg.add_model_tag:
                continue
            thr = cfg.threshold_character if cat == "Character" else cfg.threshold_general
            p_f = float(p)
            if p_f >= thr:
                out.append((tag.replace("_", " "), p_f))
        out.sort(key=lambda x: -x[1])
        return [t for t, _ in out], dict(out)

    def _effective_batch_size(self) -> int:
        cfg = self._cfg()
        n = max(1, int(cfg.batch_size or 1))
        if self._session is not None:
            providers = list(self._session.get_providers())
            if "CUDAExecutionProvider" not in providers:
                return 1
        return n

    def _preprocess_one_safe(
        self, indexed: tuple[int, Path]
    ) -> tuple[int, Optional[np.ndarray], Optional[str]]:
        j, p = indexed
        try:
            with Image.open(p) as raw:
                return j, self._preprocess(raw), None
        except Exception as exc:  # noqa: BLE001
            return j, None, str(exc)

    def tag(
        self,
        image_paths: list[Path],
        on_progress: ProgressFn = lambda d, t: None,
    ) -> Iterator[TagResult]:
        if self._session is None:
            self.prepare()
        assert self._session is not None
        assert self._input_name is not None
        total = len(image_paths)
        batch_n = self._effective_batch_size()
        done = 0
        i = 0
        while i < total:
            chunk = image_paths[i : i + batch_n]
            arrs: list[np.ndarray] = []
            ok_idx: list[int] = []
            errs: dict[int, str] = {}
            for j, p in enumerate(chunk):
                j, arr, err = self._preprocess_one_safe((j, p))
                if err is None and arr is not None:
                    arrs.append(arr)
                    ok_idx.append(j)
                else:
                    errs[j] = err or "preprocess failed"
            logits_batch: Optional[np.ndarray] = None
            if arrs:
                try:
                    batch = np.stack(arrs, axis=0).copy()
                    outputs = self._session.run(self._output_names, {self._input_name: batch})
                    logits_batch = np.nan_to_num(
                        outputs[0], nan=0.0, posinf=1.0, neginf=0.0
                    )
                except Exception as exc:  # noqa: BLE001
                    for j in ok_idx:
                        errs[j] = f"inference failed: {exc}"
            ok_pos = 0
            for j, p in enumerate(chunk):
                if j in errs:
                    yield {"image": p, "tags": [], "error": errs[j]}
                elif logits_batch is not None and ok_pos < logits_batch.shape[0]:
                    tags, raw_scores = self._postprocess_one(logits_batch[ok_pos])
                    ok_pos += 1
                    yield {"image": p, "tags": tags, "raw_scores": raw_scores}
                else:
                    yield {"image": p, "tags": [], "error": "no logits"}
                done += 1
                on_progress(done, total)
            i += batch_n
