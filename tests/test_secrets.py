"""PP0 — secrets.json 读写、deep-merge、敏感字段掩码。"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from studio import secrets, server


@pytest.fixture
def secrets_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """所有读写都落到 tmp_path/secrets.json。"""
    sf = tmp_path / "secrets.json"
    monkeypatch.setattr(secrets, "SECRETS_FILE", sf)
    return sf


@pytest.fixture
def client(secrets_file: Path) -> TestClient:  # noqa: ARG001 (fixture chains the patch)
    return TestClient(server.app)


# ---------------------------------------------------------------------------
# defaults
# ---------------------------------------------------------------------------


def test_defaults_when_file_missing(secrets_file: Path) -> None:
    assert not secrets_file.exists()
    s = secrets.load()
    assert s.gelbooru.user_id == ""
    assert s.gelbooru.api_key == ""
    assert s.wd14.threshold_general == pytest.approx(0.35)
    assert s.joycaption.base_url.startswith("http://")


def test_load_corrupt_json_returns_defaults(secrets_file: Path) -> None:
    secrets_file.write_text("{not valid json", encoding="utf-8")
    # 不应抛错；返回默认实例
    s = secrets.load()
    assert s.gelbooru.user_id == ""


# ---------------------------------------------------------------------------
# update / mask round-trip
# ---------------------------------------------------------------------------


def test_update_writes_file(secrets_file: Path) -> None:
    secrets.update({"gelbooru": {"user_id": "alice", "api_key": "k1"}})
    on_disk = json.loads(secrets_file.read_text(encoding="utf-8"))
    assert on_disk["gelbooru"]["user_id"] == "alice"
    assert on_disk["gelbooru"]["api_key"] == "k1"


def test_update_deep_merge_preserves_other_sections(secrets_file: Path) -> None:
    secrets.update({"huggingface": {"token": "hf_x"}})
    secrets.update({"gelbooru": {"user_id": "bob"}})
    s = secrets.load()
    assert s.huggingface.token == "hf_x"
    assert s.gelbooru.user_id == "bob"


def test_update_mask_keeps_existing_value(secrets_file: Path) -> None:
    secrets.update({"gelbooru": {"api_key": "real-key"}})
    # 模拟前端把 "***" 回传：表示「保持原值」
    secrets.update({"gelbooru": {"api_key": secrets.MASK, "user_id": "bob"}})
    s = secrets.load()
    assert s.gelbooru.api_key == "real-key"
    assert s.gelbooru.user_id == "bob"


def test_to_masked_dict_replaces_sensitive(secrets_file: Path) -> None:
    secrets.update(
        {
            "gelbooru": {"user_id": "alice", "api_key": "secret"},
            "huggingface": {"token": "hf_secret"},
        }
    )
    masked = secrets.to_masked_dict(secrets.load())
    assert masked["gelbooru"]["user_id"] == "alice"  # 非敏感字段保留
    assert masked["gelbooru"]["api_key"] == secrets.MASK
    assert masked["huggingface"]["token"] == secrets.MASK


def test_to_masked_dict_keeps_empty_sensitive_empty(secrets_file: Path) -> None:
    """没有值的敏感字段不应该显示为 "***"，否则前端无法判断「真的为空」。"""
    masked = secrets.to_masked_dict(secrets.load())
    assert masked["gelbooru"]["api_key"] == ""
    assert masked["huggingface"]["token"] == ""


# ---------------------------------------------------------------------------
# get() 点路径
# ---------------------------------------------------------------------------


def test_get_dot_path(secrets_file: Path) -> None:
    secrets.update({"wd14": {"threshold_general": 0.5}})
    assert secrets.get("wd14.threshold_general") == pytest.approx(0.5)


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------


def test_get_secrets_endpoint(client: TestClient) -> None:
    resp = client.get("/api/secrets")
    assert resp.status_code == 200
    body = resp.json()
    assert "gelbooru" in body
    assert "wd14" in body
    assert body["gelbooru"]["api_key"] == ""  # 默认为空，不掩码


def test_put_secrets_round_trip(client: TestClient, secrets_file: Path) -> None:
    resp = client.put(
        "/api/secrets",
        json={"gelbooru": {"user_id": "alice", "api_key": "k"}},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["gelbooru"]["user_id"] == "alice"
    assert body["gelbooru"]["api_key"] == secrets.MASK  # GET 形式：掩码

    # 真实值已落盘
    on_disk = json.loads(secrets_file.read_text(encoding="utf-8"))
    assert on_disk["gelbooru"]["api_key"] == "k"


def test_put_secrets_mask_keeps_value(client: TestClient) -> None:
    client.put("/api/secrets", json={"gelbooru": {"api_key": "first"}})
    # 客户端「不改 api_key 只改 user_id」时回传 MASK
    client.put(
        "/api/secrets",
        json={"gelbooru": {"api_key": secrets.MASK, "user_id": "alice"}},
    )
    s = secrets.load()
    assert s.gelbooru.api_key == "first"
    assert s.gelbooru.user_id == "alice"


def test_has_gelbooru_credentials(secrets_file: Path) -> None:
    assert secrets.has_gelbooru_credentials() is False
    secrets.update({"gelbooru": {"user_id": "u", "api_key": "k"}})
    assert secrets.has_gelbooru_credentials() is True
