"""LLM tagger: OpenAI-compatible Chat Completions + Responses payloads."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest
from PIL import Image

from studio import secrets
from studio.services import llm_tagger


@pytest.fixture
def isolated_secrets(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(secrets, "SECRETS_FILE", tmp_path / "secrets.json")
    secrets.update(
        {
            "llm_tagger": {
                "base_url": "http://x/v1",
                "api_key": "k",
                "model": "vision",
                "endpoint": "chat_completions",
                "prompt_preset": "style_json",
                "max_retries": 1,
            }
        }
    )
    return tmp_path


def _png(path: Path) -> Path:
    Image.new("RGB", (8, 8), (10, 20, 30)).save(path)
    return path


def _chat_response(content: str):
    r = MagicMock()
    r.status_code = 200
    r.json.return_value = {"choices": [{"message": {"content": content}}]}
    return r


def _responses_response(content: str):
    r = MagicMock()
    r.status_code = 200
    r.json.return_value = {
        "output": [
            {
                "content": [
                    {"type": "output_text", "text": content},
                ]
            }
        ]
    }
    return r


def test_is_available_requires_model(isolated_secrets) -> None:
    secrets.update({"llm_tagger": {"model": ""}})
    ok, msg = llm_tagger.LLMTagger(session=MagicMock()).is_available()
    assert ok is False
    assert "model" in msg


def test_chat_completions_tag_normalizes_json(isolated_secrets, tmp_path: Path) -> None:
    sess = MagicMock()
    sess.post.return_value = _chat_response(
        '{"count":"1girl","appearance":["long hair"],"tags":["watercolor"],'
        '"environment":["blue background"],"nl":"Soft style."}'
    )
    tagger = llm_tagger.LLMTagger(session=sess)
    img = _png(tmp_path / "1.png")

    [result] = list(tagger.tag([img]))

    assert result["tags"] == ["1girl", "long hair", "watercolor", "blue background"]
    assert result["caption"] == (
        "1girl, long hair, watercolor, blue background. Soft style."
    )
    assert result["caption_json"]["tags"]["appearance"] == ["long hair"]
    args, kwargs = sess.post.call_args
    assert args[0] == "http://x/v1/chat/completions"
    assert kwargs["headers"]["Authorization"] == "Bearer k"
    body = kwargs["json"]
    assert body["model"] == "vision"
    assert "anime style LoRA" in body["messages"][0]["content"]
    assert kwargs["timeout"] == (10, 60)
    assert body["messages"][1]["content"][1]["image_url"]["url"].startswith(
        "data:image/jpeg;base64,"
    )


def test_tag_emits_start_and_done_progress(isolated_secrets, tmp_path: Path) -> None:
    sess = MagicMock()
    sess.post.return_value = _chat_response('{"tags":["ink"]}')
    tagger = llm_tagger.LLMTagger(session=sess)
    img = _png(tmp_path / "1.png")
    progress: list[tuple[int, int]] = []

    list(tagger.tag([img], on_progress=lambda d, t: progress.append((d, t))))

    assert progress == [(0, 1), (1, 1)]


def test_uses_editable_prompt_preset(isolated_secrets, tmp_path: Path) -> None:
    secrets.update(
        {
            "llm_tagger": {
                "prompt_preset": "my_style",
                "prompt_presets": [
                    {"id": "my_style", "label": "My Style", "prompt": "MY PROMPT"}
                ],
            }
        }
    )
    sess = MagicMock()
    sess.post.return_value = _chat_response('{"tags":["ink"]}')
    tagger = llm_tagger.LLMTagger(session=sess)
    img = _png(tmp_path / "1.png")

    list(tagger.tag([img]))

    body = sess.post.call_args.kwargs["json"]
    assert body["messages"][0]["content"] == "MY PROMPT"


def test_responses_endpoint_payload(isolated_secrets, tmp_path: Path) -> None:
    secrets.update({"llm_tagger": {"endpoint": "responses"}})
    sess = MagicMock()
    sess.post.return_value = _responses_response('{"tags":["ink","limited palette"]}')
    tagger = llm_tagger.LLMTagger(session=sess)
    img = _png(tmp_path / "1.png")

    [result] = list(tagger.tag([img]))

    assert result["tags"] == ["ink", "limited palette"]
    args, kwargs = sess.post.call_args
    assert args[0] == "http://x/v1/responses"
    body = kwargs["json"]
    assert body["instructions"]
    assert body["input"][0]["content"][1]["type"] == "input_image"
    assert body["input"][0]["content"][1]["image_url"].startswith(
        "data:image/jpeg;base64,"
    )


def test_fetch_openai_compatible_models() -> None:
    sess = MagicMock()
    r = MagicMock()
    r.status_code = 200
    r.json.return_value = {
        "data": [
            {"id": "vision-b"},
            {"id": "vision-a"},
            {"id": "vision-a"},
            {"name": "vision-c"},
        ]
    }
    sess.get.return_value = r

    items = llm_tagger.fetch_openai_compatible_models(
        "http://x/v1",
        "secret",
        timeout=9,
        session=sess,
    )

    assert items == ["vision-a", "vision-b", "vision-c"]
    args, kwargs = sess.get.call_args
    assert args[0] == "http://x/v1/models"
    assert kwargs["headers"]["Authorization"] == "Bearer secret"
    assert kwargs["timeout"] == 9


def test_text_connectivity_uses_chat_shape() -> None:
    sess = MagicMock()
    r = MagicMock()
    r.status_code = 200
    r.text = '{"choices":[{"message":{"content":"ok"}}]}'
    r.json.return_value = {"choices": [{"message": {"content": "ok"}}]}
    sess.post.return_value = r

    result = llm_tagger.test_openai_compatible_connection(
        "http://x/v1",
        "secret",
        "text-model",
        endpoint="chat_completions",
        timeout=11,
        max_tokens=64,
        session=sess,
    )

    assert result["ok"] is True
    assert result["endpoint_url"] == "http://x/v1/chat/completions"
    assert result["response_preview"] == "ok"
    args, kwargs = sess.post.call_args
    assert args[0] == "http://x/v1/chat/completions"
    assert kwargs["headers"]["Authorization"] == "Bearer secret"
    assert kwargs["json"]["max_tokens"] == 512
    assert kwargs["json"]["messages"][1]["role"] == "user"


def test_text_connectivity_uses_responses_shape() -> None:
    sess = MagicMock()
    r = MagicMock()
    r.status_code = 200
    r.text = '{"output_text":"ok"}'
    r.json.return_value = {"output_text": "ok"}
    sess.post.return_value = r

    result = llm_tagger.test_openai_compatible_connection(
        "http://x/v1",
        "",
        "text-model",
        endpoint="responses",
        session=sess,
    )

    assert result["ok"] is True
    args, kwargs = sess.post.call_args
    assert args[0] == "http://x/v1/responses"
    assert kwargs["json"]["instructions"]
    assert isinstance(kwargs["json"]["input"], str)


def test_responses_payload_uses_instructions(isolated_secrets, tmp_path: Path) -> None:
    secrets.update({"llm_tagger": {"endpoint": "responses"}})
    sess = MagicMock()
    sess.post.return_value = _responses_response('{"tags":["ink"]}')
    tagger = llm_tagger.LLMTagger(session=sess)
    img = _png(tmp_path / "1.png")

    list(tagger.tag([img]))

    body = sess.post.call_args.kwargs["json"]
    assert "instructions" in body
    assert body["input"][0]["role"] == "user"


def test_text_preset_returns_natural_caption(isolated_secrets, tmp_path: Path) -> None:
    secrets.update({"llm_tagger": {"prompt_preset": "joycaption"}})
    sess = MagicMock()
    sess.post.return_value = _chat_response("a calm natural caption")
    tagger = llm_tagger.LLMTagger(session=sess)
    img = _png(tmp_path / "1.png")

    [result] = list(tagger.tag([img]))

    assert result["tags"] == ["a calm natural caption"]
    assert result["caption"] == "a calm natural caption"
    assert "caption_json" not in result


def test_image_data_url_respects_payload_cap(tmp_path: Path) -> None:
    img = tmp_path / "large.png"
    Image.effect_noise((1024, 1024), 80).convert("RGB").save(img)

    data_url = llm_tagger.LLMTagger._image_to_data_url(
        img,
        max_side=1024,
        quality=95,
        max_image_mb=0.25,
    )

    encoded = data_url.split(",", 1)[1].encode("ascii")
    assert len(encoded) <= int(0.25 * 1024 * 1024)
