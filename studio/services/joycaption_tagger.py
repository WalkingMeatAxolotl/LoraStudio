"""JoyCaption 打标（PP4）。

复用现有脚本逻辑：HTTP POST 到 secrets.joycaption.base_url + /chat/completions，
传 image_url=data:image/...;base64,。失败重试 3 次，timeout 60s。

JoyCaption 输出的是自然语言 caption（不是分类 tag 列表），所以 TagResult.tags
里只有 1 条 string；前端 TagEditor 在 natural 模式下渲染为 textarea。
"""
from __future__ import annotations

import base64
import time
from pathlib import Path
from typing import Any, Iterator, Optional

import requests

from .. import secrets
from .tagger import ProgressFn, TagResult


class JoyCaptionTagger:
    name = "joycaption"
    requires_service = True

    def __init__(self, *, session: Optional[requests.Session] = None) -> None:
        self._session = session or requests.Session()

    # -------------------- protocol --------------------

    def is_available(self) -> tuple[bool, str]:
        cfg = secrets.load().joycaption
        if not cfg.base_url:
            return False, "未配置 base_url（去 Settings 填）"
        try:
            r = self._session.get(
                cfg.base_url.rstrip("/") + "/models", timeout=5
            )
        except requests.RequestException as exc:
            return False, f"连接失败: {exc}"
        if r.ok:
            return True, f"在线: {cfg.model}"
        return False, f"服务返回 {r.status_code}"

    def prepare(self) -> None:
        ok, msg = self.is_available()
        if not ok:
            raise RuntimeError(f"JoyCaption 不可用: {msg}")

    # -------------------- inference --------------------

    def tag(
        self,
        image_paths: list[Path],
        on_progress: ProgressFn = lambda d, t: None,
        *,
        max_retries: int = 3,
        timeout: float = 60.0,
    ) -> Iterator[TagResult]:
        cfg = secrets.load().joycaption
        url = cfg.base_url.rstrip("/") + "/chat/completions"
        total = len(image_paths)
        for i, p in enumerate(image_paths):
            try:
                payload = self._build_payload(p, cfg.model, cfg.prompt_template)
                text = self._call_with_retry(url, payload, max_retries, timeout)
                yield {"image": p, "tags": [text]}
            except Exception as exc:  # noqa: BLE001
                yield {"image": p, "tags": [], "error": str(exc)}
            on_progress(i + 1, total)

    def _build_payload(
        self, image_path: Path, model: str, prompt: str
    ) -> dict[str, Any]:
        with open(image_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()
        ext = image_path.suffix.lower().lstrip(".") or "png"
        return {
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/{ext};base64,{b64}"
                            },
                        },
                    ],
                }
            ],
            "temperature": 0.6,
            "max_tokens": 300,
        }

    def _call_with_retry(
        self,
        url: str,
        payload: dict[str, Any],
        max_retries: int,
        timeout: float,
    ) -> str:
        last_exc: Optional[Exception] = None
        for attempt in range(1, max_retries + 1):
            try:
                r = self._session.post(url, json=payload, timeout=timeout)
                r.raise_for_status()
                data = r.json()
                content = data["choices"][0]["message"]["content"]
                return str(content).strip()
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                if attempt < max_retries:
                    time.sleep(2 ** (attempt - 1))
        raise RuntimeError(
            f"JoyCaption 调用失败（{max_retries} 次重试）: {last_exc}"
        )
