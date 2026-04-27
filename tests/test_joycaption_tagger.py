"""PP4 — JoyCaption: mock requests.Session 验证 payload + 重试。"""
from __future__ import annotations

import io
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from PIL import Image

from studio import secrets
from studio.services import joycaption_tagger


@pytest.fixture
def isolated_secrets(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(secrets, "SECRETS_FILE", tmp_path / "secrets.json")
    secrets.update({"joycaption": {"base_url": "http://x/v1", "model": "m", "prompt_template": "hi"}})
    return tmp_path


def _png(path: Path) -> Path:
    Image.new("RGB", (8, 8), (10, 20, 30)).save(path)
    return path


def _ok_response(content: str = "tag1, tag2"):
    r = MagicMock()
    r.ok = True
    r.status_code = 200
    r.raise_for_status = MagicMock()
    r.json = MagicMock(
        return_value={
            "choices": [{"message": {"content": content}}]
        }
    )
    return r


def test_is_available_ok(isolated_secrets) -> None:
    sess = MagicMock()
    sess.get.return_value = MagicMock(ok=True, status_code=200)
    t = joycaption_tagger.JoyCaptionTagger(session=sess)
    ok, msg = t.is_available()
    assert ok is True
    assert "在线" in msg
    sess.get.assert_called_once_with("http://x/v1/models", timeout=5)


def test_is_available_bad_status(isolated_secrets) -> None:
    sess = MagicMock()
    sess.get.return_value = MagicMock(ok=False, status_code=503)
    t = joycaption_tagger.JoyCaptionTagger(session=sess)
    ok, msg = t.is_available()
    assert ok is False
    assert "503" in msg


def test_is_available_no_base_url(isolated_secrets) -> None:
    secrets.update({"joycaption": {"base_url": ""}})
    t = joycaption_tagger.JoyCaptionTagger(session=MagicMock())
    ok, msg = t.is_available()
    assert ok is False
    assert "base_url" in msg


def test_tag_emits_natural_caption(isolated_secrets, tmp_path: Path) -> None:
    sess = MagicMock()
    sess.post.return_value = _ok_response("a sunny day")
    t = joycaption_tagger.JoyCaptionTagger(session=sess)
    img = _png(tmp_path / "1.png")
    [r] = list(t.tag([img]))
    assert r["tags"] == ["a sunny day"]
    # 验证调用 payload
    args, kwargs = sess.post.call_args
    assert args[0] == "http://x/v1/chat/completions"
    body = kwargs["json"]
    assert body["model"] == "m"
    content = body["messages"][0]["content"]
    assert content[0]["text"] == "hi"
    assert content[1]["image_url"]["url"].startswith("data:image/png;base64,")


def test_tag_retries_then_fails(isolated_secrets, tmp_path: Path, monkeypatch) -> None:
    """所有重试都失败 → 单图返回 error，但循环继续。"""
    sess = MagicMock()
    bad = MagicMock()
    bad.raise_for_status.side_effect = RuntimeError("boom")
    sess.post.return_value = bad
    monkeypatch.setattr(joycaption_tagger.time, "sleep", lambda _: None)  # 跳过等待
    t = joycaption_tagger.JoyCaptionTagger(session=sess)
    img = _png(tmp_path / "1.png")
    [r] = list(t.tag([img], max_retries=2, timeout=1.0))
    assert r["tags"] == []
    assert "失败" in r["error"]
    # 调了 2 次（max_retries=2）
    assert sess.post.call_count == 2
