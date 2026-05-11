"""JoyCaption compatibility wrapper.

JoyCaption is an OpenAI-compatible vision LLM captioner, so the actual HTTP
request/response path is handled by :mod:`studio.services.llm_tagger`.  This
wrapper keeps the historical ``joycaption`` tagger name and Settings fields
working while avoiding a second LLM tagger implementation.
"""
from __future__ import annotations

from pathlib import Path
from typing import Iterator, Optional

import requests

from .. import secrets
from .llm_tagger import LLMTagger
from .tagger import ProgressFn, TagResult


class JoyCaptionTagger:
    name = "joycaption"
    requires_service = True

    def __init__(self, *, session: Optional[requests.Session] = None) -> None:
        self._session = session or requests.Session()

    def _llm(self) -> LLMTagger:
        cfg = secrets.load().joycaption
        overrides = {
            "base_url": cfg.base_url,
            "model": cfg.model,
            "endpoint": "chat_completions",
            "prompt_preset": "joycaption",
            "temperature": 0.6,
            "max_tokens": 300,
        }
        # Backward compatibility for users who already customized the old
        # JoyCaption prompt field before it became a built-in LLM preset.
        prompt = str(cfg.prompt_template or "").strip()
        if prompt and prompt != "Descriptive Caption":
            overrides["prompt_preset"] = "custom"
            overrides["custom_prompt"] = prompt
            overrides["_output_format"] = "text"
        return LLMTagger(overrides=overrides, session=self._session)

    def is_available(self) -> tuple[bool, str]:
        return self._llm().is_available()

    def prepare(self) -> None:
        self._llm().prepare()

    def tag(
        self,
        image_paths: list[Path],
        on_progress: ProgressFn = lambda d, t: None,
    ) -> Iterator[TagResult]:
        yield from self._llm().tag(image_paths, on_progress=on_progress)
