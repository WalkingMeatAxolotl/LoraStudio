"""Studio FastAPI 守护进程的端点冒烟测试（P1 范围）。

测试只覆盖 server.py 暴露的 5 个端点。每个用例通过 monkeypatch 把
`studio.server` 模块里指向运行时数据/HTML 的路径常量改写到 tmp_path，
避免污染仓库真实目录。
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from studio import server


@pytest.fixture
def isolated_paths(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Path]:
    """把 server 模块里的路径全部指向 tmp_path 下的隔离目录。"""
    monitor_data = tmp_path / "monitor_data"
    output = tmp_path / "output"
    samples_dir = output / "samples"
    legacy_html = tmp_path / "monitor_smooth.html"
    web_dist = tmp_path / "web_dist"  # 不创建即模拟未构建
    samples_dir.mkdir(parents=True)

    monkeypatch.setattr(server, "MONITOR_STATE_FILE", monitor_data / "state.json")
    monkeypatch.setattr(server, "OUTPUT_DIR", output)
    monkeypatch.setattr(server, "LEGACY_MONITOR_HTML", legacy_html)
    monkeypatch.setattr(server, "WEB_DIST", web_dist)
    return {
        "monitor_data": monitor_data,
        "output": output,
        "samples_dir": samples_dir,
        "legacy_html": legacy_html,
        "web_dist": web_dist,
    }


@pytest.fixture
def client(isolated_paths: dict[str, Path]) -> TestClient:
    return TestClient(server.app)


# ---------------------------------------------------------------------------
# /api/health
# ---------------------------------------------------------------------------

def test_health_returns_ok(client: TestClient) -> None:
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["version"] == server.app.version


# ---------------------------------------------------------------------------
# /api/state
# ---------------------------------------------------------------------------

def test_state_missing_returns_empty(client: TestClient, isolated_paths: dict[str, Path]) -> None:
    """state.json 不存在时不应报错，返回空状态。"""
    assert not isolated_paths["monitor_data"].exists()  # sanity
    resp = client.get("/api/state")
    assert resp.status_code == 200
    body = resp.json()
    assert body["losses"] == []
    assert body["lr_history"] == []
    assert body["step"] == 0
    assert body["epoch"] == 0
    assert body["start_time"] is None


def test_state_returns_parsed_json(client: TestClient, isolated_paths: dict[str, Path]) -> None:
    payload = {
        "losses": [{"step": 1, "loss": 0.5, "time": 100.0}],
        "lr_history": [{"step": 1, "lr": 1e-4}],
        "epoch": 2,
        "step": 42,
        "total_steps": 1000,
        "speed": 1.23,
        "samples": [],
        "start_time": 1700000000.0,
        "config": {"lora_rank": 32},
    }
    isolated_paths["monitor_data"].mkdir(parents=True)
    (isolated_paths["monitor_data"] / "state.json").write_text(
        json.dumps(payload), encoding="utf-8"
    )
    resp = client.get("/api/state")
    assert resp.status_code == 200
    assert resp.json() == payload


def test_state_corrupt_returns_500(client: TestClient, isolated_paths: dict[str, Path]) -> None:
    isolated_paths["monitor_data"].mkdir(parents=True)
    (isolated_paths["monitor_data"] / "state.json").write_text(
        "this is not json", encoding="utf-8"
    )
    resp = client.get("/api/state")
    assert resp.status_code == 500


# ---------------------------------------------------------------------------
# /samples/{filename}
# ---------------------------------------------------------------------------

def test_sample_404_for_missing(client: TestClient) -> None:
    resp = client.get("/samples/does_not_exist.png")
    assert resp.status_code == 404


def test_sample_returns_file(client: TestClient, isolated_paths: dict[str, Path]) -> None:
    img_path = isolated_paths["samples_dir"] / "step_42.png"
    img_path.write_bytes(b"fake-png-bytes")
    resp = client.get("/samples/step_42.png")
    assert resp.status_code == 200
    assert resp.content == b"fake-png-bytes"


@pytest.mark.parametrize("bad", ["../secret.txt", "..\\secret.txt", "sub/dir.png", "sub\\dir.png"])
def test_sample_blocks_traversal(client: TestClient, bad: str) -> None:
    """`/samples/{name}` 不允许斜杠 / 反斜杠 / 上级路径。"""
    resp = client.get(f"/samples/{bad}")
    # 含 `/` 或 `\` 的会被路由层拆成多段（404），含 `..` 的被显式 400 拒绝；
    # 任何一种都不应该 200。
    assert resp.status_code != 200


# ---------------------------------------------------------------------------
# /
# ---------------------------------------------------------------------------

def test_root_serves_legacy_html(client: TestClient, isolated_paths: dict[str, Path]) -> None:
    isolated_paths["legacy_html"].write_text("<!DOCTYPE html><h1>legacy</h1>", encoding="utf-8")
    resp = client.get("/")
    assert resp.status_code == 200
    assert "legacy" in resp.text


def test_root_fallback_when_no_legacy(client: TestClient, isolated_paths: dict[str, Path]) -> None:
    """旧监控页缺失时返回 JSON 提示，而不是 404。"""
    assert not isolated_paths["legacy_html"].exists()
    resp = client.get("/")
    assert resp.status_code == 200
    body = resp.json()
    assert "AnimaStudio" in body["message"]
