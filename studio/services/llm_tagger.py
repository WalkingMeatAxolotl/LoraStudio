"""OpenAI-compatible vision LLM tagger.

Supports both Chat Completions and Responses style endpoints. The model is
asked to return structured JSON, then the worker can persist either local JSON
caption files or rendered TXT captions.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import re
import time
from pathlib import Path
from typing import Any, Iterator, Optional
from urllib.parse import urlparse

import requests
from PIL import Image, ImageOps

from .. import secrets
from .caption_format import (
    caption_json_to_tags,
    caption_json_to_text,
    normalize_caption_json,
)
from .tagger import ProgressFn, TagResult


logger = logging.getLogger(__name__)


_CONNECTIVITY_SYSTEM_PROMPT = (
    "You are a diagnostic assistant. Answer exactly what the user asks, "
    "without mentioning policies, hidden reasoning, or implementation details."
)

_CONNECTIVITY_USER_PROMPT = """Connectivity test for an OpenAI-compatible endpoint.

Please return JSON only, no Markdown:
{
  "ok": true,
  "summary": "one sentence saying the endpoint can answer a non-trivial request",
  "items": [
    "base URL routing works",
    "model selection works",
    "authentication works",
    "the service can generate a moderately long answer"
  ],
  "note": "short note"
}

To make this a real generation test rather than a tiny ping, include 8 to 12
short English words in the summary and keep every item as a complete phrase.
"""


def _openai_compatible_endpoint(base_url: str, *, kind: str) -> str:
    base = str(base_url or "").strip().rstrip("/")
    if not base:
        raise RuntimeError("LLM base_url 为空")

    parsed = urlparse(base)
    path = parsed.path.rstrip("/")
    for suffix in ("/chat/completions", "/responses", "/models"):
        if path.endswith(suffix):
            root = base[: -len(suffix)]
            return f"{root}/{kind}"
    if path.endswith("/v1"):
        return f"{base}/{kind}"
    if path:
        return f"{base}/v1/{kind}"
    return f"{base}/v1/{kind}"


def fetch_openai_compatible_models(
    base_url: str,
    api_key: str = "",
    *,
    timeout: int = 30,
    session: Optional[requests.Session] = None,
) -> list[str]:
    endpoint = _openai_compatible_endpoint(base_url, kind="models")
    headers = {"Accept": "application/json"}
    token = str(api_key or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    sess = session or requests.Session()
    resp = sess.get(endpoint, headers=headers, timeout=max(5, int(timeout)))
    if resp.status_code >= 400:
        raise RuntimeError(f"模型列表读取失败 (HTTP {resp.status_code}): {resp.text[:300]}")
    payload = resp.json()
    raw_items = payload.get("data") or payload.get("models") or []
    items: list[str] = []
    seen: set[str] = set()
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        model_id = str(raw.get("id") or raw.get("name") or "").strip()
        key = model_id.lower()
        if not model_id or key in seen:
            continue
        seen.add(key)
        items.append(model_id)
    items.sort(key=str.lower)
    return items


def test_openai_compatible_connection(
    base_url: str,
    api_key: str,
    model: str,
    *,
    endpoint: str = "chat_completions",
    timeout: int = 60,
    max_tokens: int = 700,
    temperature: float = 0.2,
    session: Optional[requests.Session] = None,
) -> dict[str, Any]:
    """Run a text-only connectivity test without persisting any settings."""
    endpoint_kind = "responses" if endpoint == "responses" else "chat/completions"
    endpoint_url = _openai_compatible_endpoint(base_url, kind=endpoint_kind)
    token_budget = max(512, int(max_tokens or 700))
    if endpoint == "responses":
        body = {
            "model": model,
            "instructions": _CONNECTIVITY_SYSTEM_PROMPT,
            "input": _CONNECTIVITY_USER_PROMPT,
            "temperature": temperature,
            "max_output_tokens": token_budget,
        }
    else:
        body = {
            "model": model,
            "temperature": temperature,
            "max_tokens": token_budget,
            "messages": [
                {"role": "system", "content": _CONNECTIVITY_SYSTEM_PROMPT},
                {"role": "user", "content": _CONNECTIVITY_USER_PROMPT},
            ],
        }
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    token = str(api_key or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    sess = session or requests.Session()
    started = time.monotonic()
    result: dict[str, Any] = {
        "ok": False,
        "endpoint": endpoint,
        "endpoint_url": endpoint_url,
        "model": model,
        "elapsed_ms": 0,
        "status_code": None,
        "response_preview": "",
        "error": "",
        "request_shape": "responses_text" if endpoint == "responses" else "chat_completions_text",
    }
    try:
        resp = sess.post(
            endpoint_url,
            headers=headers,
            json=body,
            timeout=(10, max(5, int(timeout or 60))),
        )
        result["elapsed_ms"] = int((time.monotonic() - started) * 1000)
        result["status_code"] = resp.status_code
        raw_preview = (resp.text or "")[:1000]
        result["response_preview"] = raw_preview
        if resp.status_code >= 400:
            result["error"] = f"HTTP {resp.status_code}: {raw_preview[:500]}"
            return result
        payload = resp.json()
        text = (
            LLMTagger._extract_responses_text(payload)
            if endpoint == "responses"
            else LLMTagger._extract_chat_text(payload)
        )
        result["response_preview"] = text[:1000]
        result["ok"] = bool(text.strip())
        if not result["ok"]:
            result["error"] = "LLM 返回空内容"
        return result
    except Exception as exc:  # noqa: BLE001
        result["elapsed_ms"] = int((time.monotonic() - started) * 1000)
        result["error"] = str(exc)
        return result


class LLMTagger:
    name = "llm"
    requires_service = True

    def __init__(
        self,
        overrides: dict | None = None,
        *,
        session: Optional[requests.Session] = None,
    ) -> None:
        self._overrides = {
            k: v
            for k, v in (overrides or {}).items()
            if v is not None and k != "api_key"
        }
        self._session = session or requests.Session()

    def _cfg(self) -> "secrets.LLMTaggerConfig":
        base = secrets.load().llm_tagger.model_dump()
        for k, v in self._overrides.items():
            if k in base:
                base[k] = v
        return secrets.LLMTaggerConfig(**base)

    def is_available(self) -> tuple[bool, str]:
        cfg = self._cfg()
        if not cfg.base_url:
            return False, "未配置 base_url"
        if not cfg.model:
            return False, "未配置 model"
        return True, f"{cfg.endpoint} · {cfg.model}"

    def prepare(self) -> None:
        ok, msg = self.is_available()
        if not ok:
            raise RuntimeError(f"LLM tagger 不可用: {msg}")

    def tag(
        self,
        image_paths: list[Path],
        on_progress: ProgressFn = lambda d, t: None,
    ) -> Iterator[TagResult]:
        cfg = self._cfg()
        total = len(image_paths)
        for i, p in enumerate(image_paths):
            try:
                on_progress(i, total)
                data_url = self._image_to_data_url(
                    p,
                    max_side=cfg.max_side,
                    quality=cfg.jpeg_quality,
                )
                parsed = self._call_with_retry(cfg, data_url, p)
                caption_json = self._normalize_llm_payload(parsed)
                yield {
                    "image": p,
                    "tags": caption_json_to_tags(caption_json),
                    "caption": caption_json_to_text(caption_json),
                    "caption_json": caption_json,
                }
            except Exception as exc:  # noqa: BLE001
                yield {"image": p, "tags": [], "error": str(exc)}
            on_progress(i + 1, total)

    def _prompt(self, cfg: "secrets.LLMTaggerConfig") -> str:
        if cfg.prompt_preset == "custom":
            prompt = cfg.custom_prompt.strip()
            if prompt:
                return prompt
        for preset in cfg.prompt_presets:
            if preset.id == cfg.prompt_preset:
                return preset.prompt
        return cfg.prompt_presets[0].prompt

    def _headers(self, cfg: "secrets.LLMTaggerConfig") -> dict[str, str]:
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if cfg.api_key:
            headers["Authorization"] = f"Bearer {cfg.api_key}"
        return headers

    def _call_with_retry(
        self,
        cfg: "secrets.LLMTaggerConfig",
        data_url: str,
        image_path: Path,
    ) -> dict[str, Any]:
        last_exc: Optional[Exception] = None
        for attempt in range(1, cfg.max_retries + 1):
            try:
                if cfg.endpoint == "responses":
                    endpoint = _openai_compatible_endpoint(cfg.base_url, kind="responses")
                    body = self._responses_payload(cfg, data_url, image_path)
                else:
                    endpoint = _openai_compatible_endpoint(
                        cfg.base_url, kind="chat/completions"
                    )
                    body = self._chat_payload(cfg, data_url, image_path)
                started = time.monotonic()
                logger.info(
                    "LLM tagger POST %s model=%s endpoint=%s image=%s timeout=%ss",
                    endpoint,
                    cfg.model,
                    cfg.endpoint,
                    image_path.name,
                    cfg.timeout,
                )
                resp = self._session.post(
                    endpoint,
                    headers=self._headers(cfg),
                    json=body,
                    timeout=(10, max(5, int(cfg.timeout))),
                )
                elapsed_ms = int((time.monotonic() - started) * 1000)
                if resp.status_code >= 400:
                    raise RuntimeError(
                        f"HTTP {resp.status_code} after {elapsed_ms}ms at {endpoint}: {resp.text[:300]}"
                    )
                payload = resp.json()
                content = (
                    self._extract_responses_text(payload)
                    if cfg.endpoint == "responses"
                    else self._extract_chat_text(payload)
                )
                parsed = self._parse_json_text(content)
                logger.info(
                    "LLM tagger OK %s model=%s image=%s elapsed=%sms",
                    endpoint,
                    cfg.model,
                    image_path.name,
                    elapsed_ms,
                )
                return parsed
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                if attempt < cfg.max_retries:
                    time.sleep(2 ** (attempt - 1))
        raise RuntimeError(f"LLM 调用失败（{cfg.max_retries} 次重试）: {last_exc}")

    def _chat_payload(
        self,
        cfg: "secrets.LLMTaggerConfig",
        data_url: str,
        image_path: Path,
    ) -> dict[str, Any]:
        return {
            "model": cfg.model,
            "temperature": cfg.temperature,
            "max_tokens": cfg.max_tokens,
            "messages": [
                {"role": "system", "content": self._prompt(cfg)},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": self._user_text(image_path)},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                },
            ],
        }

    def _responses_payload(
        self,
        cfg: "secrets.LLMTaggerConfig",
        data_url: str,
        image_path: Path,
    ) -> dict[str, Any]:
        return {
            "model": cfg.model,
            "instructions": self._prompt(cfg),
            "temperature": cfg.temperature,
            "max_output_tokens": cfg.max_tokens,
            "input": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": self._user_text(image_path)},
                        {"type": "input_image", "image_url": data_url},
                    ],
                },
            ],
        }

    @staticmethod
    def _user_text(image_path: Path) -> str:
        return json.dumps(
            {
                "file_name": image_path.name,
                "target": "anima_lora_caption",
                "return_json_only": True,
            },
            ensure_ascii=False,
        )

    @staticmethod
    def _extract_chat_text(payload: dict[str, Any]) -> str:
        choices = payload.get("choices") or []
        if not choices:
            raise RuntimeError("LLM response missing choices")
        message = choices[0].get("message") or {}
        content = message.get("content", "")
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                if isinstance(item, dict):
                    if item.get("type") == "text":
                        parts.append(str(item.get("text") or ""))
                elif isinstance(item, str):
                    parts.append(item)
            return "".join(parts).strip()
        return str(content or "").strip()

    @staticmethod
    def _extract_responses_text(payload: dict[str, Any]) -> str:
        direct = payload.get("output_text")
        if direct:
            return str(direct).strip()
        parts: list[str] = []
        for item in payload.get("output") or []:
            if not isinstance(item, dict):
                continue
            for content in item.get("content") or []:
                if not isinstance(content, dict):
                    continue
                if content.get("type") in {"output_text", "text"}:
                    parts.append(str(content.get("text") or ""))
        if parts:
            return "".join(parts).strip()
        # Some compatible providers return Chat Completions shape from /responses.
        return LLMTagger._extract_chat_text(payload)

    @staticmethod
    def _parse_json_text(content: str) -> dict[str, Any]:
        text = str(content or "").strip()
        if not text:
            raise RuntimeError("LLM 返回空内容")
        fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
        if fenced:
            text = fenced.group(1).strip()
        else:
            match = re.search(r"\{.*\}", text, re.S)
            if match:
                text = match.group(0).strip()
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"LLM 返回不是合法 JSON: {text[:200]}") from exc
        if not isinstance(parsed, dict):
            raise RuntimeError("LLM JSON 顶层必须是 object")
        return parsed

    @staticmethod
    def _normalize_llm_payload(parsed: dict[str, Any]) -> dict[str, Any]:
        if isinstance(parsed.get("tags"), list) and not any(
            key in parsed for key in ("appearance", "environment", "ai_output", "fixed")
        ):
            return normalize_caption_json({"tags": parsed.get("tags"), "nl": parsed.get("nl", "")})
        return normalize_caption_json(parsed)

    @staticmethod
    def _image_to_data_url(
        image_path: Path,
        *,
        max_side: int,
        quality: int,
    ) -> str:
        path = Path(image_path)
        if not path.exists():
            raise RuntimeError(f"Image does not exist: {path}")
        with Image.open(path) as img:
            img = ImageOps.exif_transpose(img) or img
            if img.mode != "RGBA":
                img = img.convert("RGBA")
            img.thumbnail((max(64, int(max_side)), max(64, int(max_side))))
            canvas = Image.new("RGB", img.size, (255, 255, 255))
            canvas.paste(img, mask=img.getchannel("A"))
            buf = io.BytesIO()
            canvas.save(
                buf,
                format="JPEG",
                quality=max(1, min(100, int(quality))),
                optimize=True,
            )
        encoded = base64.b64encode(buf.getvalue()).decode("ascii")
        return f"data:image/jpeg;base64,{encoded}"
