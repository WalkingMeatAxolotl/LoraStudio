"""PP6.2 — /api/projects/{pid}/versions/{vid}/config/* HTTP。"""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from studio import db, projects, server, versions
from studio.schema import TrainingConfig


@pytest.fixture
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    dbfile = tmp_path / "studio.db"
    db.init_db(dbfile)
    monkeypatch.setattr(db, "STUDIO_DB", dbfile)
    monkeypatch.setattr(server.db, "STUDIO_DB", dbfile)
    monkeypatch.setattr(projects, "PROJECTS_DIR", tmp_path / "projects")
    monkeypatch.setattr(projects, "TRASH_DIR", tmp_path / "_trash")
    presets_dir = tmp_path / "presets"
    presets_dir.mkdir()
    from studio import presets_io
    monkeypatch.setattr(presets_io, "USER_PRESETS_DIR", presets_dir)
    return {"db": dbfile, "presets": presets_dir}


@pytest.fixture
def client(env) -> TestClient:
    server.app.state.supervisor = None
    return TestClient(server.app)


def _make(client: TestClient) -> tuple[int, int]:
    p = client.post("/api/projects", json={"title": "P"}).json()
    return p["id"], p["versions"][0]["id"]


def _seed_preset(env, name: str, **overrides) -> None:
    from studio import presets_io
    base = TrainingConfig().model_dump()
    base.update(overrides)
    presets_io.write_preset(name, base)


# ---------------------------------------------------------------------------
# GET /config
# ---------------------------------------------------------------------------


def test_get_config_returns_no_config_initially(client: TestClient) -> None:
    pid, vid = _make(client)
    r = client.get(f"/api/projects/{pid}/versions/{vid}/config")
    assert r.status_code == 200
    body = r.json()
    assert body["has_config"] is False
    assert body["config"] is None
    assert "data_dir" in body["project_specific_fields"]
    assert "output_name" in body["project_specific_fields"]


def test_get_config_for_unknown_version_404(client: TestClient) -> None:
    pid, _ = _make(client)
    r = client.get(f"/api/projects/{pid}/versions/9999/config")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# POST /config/from_preset
# ---------------------------------------------------------------------------


def test_fork_preset_writes_version_config(client: TestClient, env) -> None:
    pid, vid = _make(client)
    _seed_preset(env, "tpl", lora_rank=64)
    r = client.post(
        f"/api/projects/{pid}/versions/{vid}/config/from_preset",
        json={"name": "tpl"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["from_preset"] == "tpl"
    cfg = body["config"]
    assert cfg["lora_rank"] == 64
    # 项目特定字段被强制覆盖
    assert cfg["data_dir"].endswith("train")
    # version.config_name 同步成 informational 来源
    v = client.get(f"/api/projects/{pid}/versions/{vid}").json()
    assert v["config_name"] == "tpl"


def test_fork_preset_unknown_404(client: TestClient) -> None:
    pid, vid = _make(client)
    r = client.post(
        f"/api/projects/{pid}/versions/{vid}/config/from_preset",
        json={"name": "nope"},
    )
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# PUT /config
# ---------------------------------------------------------------------------


def test_put_config_forces_project_overrides(client: TestClient, env) -> None:
    pid, vid = _make(client)
    _seed_preset(env, "tpl")
    client.post(
        f"/api/projects/{pid}/versions/{vid}/config/from_preset",
        json={"name": "tpl"},
    )
    cfg = client.get(f"/api/projects/{pid}/versions/{vid}/config").json()["config"]
    cfg["data_dir"] = "/etc/passwd"
    cfg["output_name"] = "hacked"
    cfg["lora_rank"] = 96
    r = client.put(f"/api/projects/{pid}/versions/{vid}/config", json=cfg)
    assert r.status_code == 200
    body = r.json()
    # data_dir 被服务端覆盖回 train
    assert body["config"]["data_dir"].endswith("train")
    # output_name 也被覆盖
    assert body["config"]["output_name"] != "hacked"
    # 用户改的非项目字段保留
    assert body["config"]["lora_rank"] == 96


def test_put_config_invalid_data_400(client: TestClient, env) -> None:
    pid, vid = _make(client)
    _seed_preset(env, "tpl")
    client.post(
        f"/api/projects/{pid}/versions/{vid}/config/from_preset",
        json={"name": "tpl"},
    )
    cfg = client.get(f"/api/projects/{pid}/versions/{vid}/config").json()["config"]
    cfg["lora_rank"] = 99999  # 超出范围
    r = client.put(f"/api/projects/{pid}/versions/{vid}/config", json=cfg)
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# POST /config/save_as_preset
# ---------------------------------------------------------------------------


def test_save_as_preset_clears_project_fields(client: TestClient, env) -> None:
    pid, vid = _make(client)
    _seed_preset(env, "tpl", lora_rank=128)
    client.post(
        f"/api/projects/{pid}/versions/{vid}/config/from_preset",
        json={"name": "tpl"},
    )
    r = client.post(
        f"/api/projects/{pid}/versions/{vid}/config/save_as_preset",
        json={"name": "my-tuned"},
    )
    assert r.status_code == 200, r.text
    saved = r.json()
    assert saved["saved_preset"] == "my-tuned"
    assert saved["config"]["data_dir"] == "./dataset"  # schema 默认
    assert saved["config"]["lora_rank"] == 128

    # 全局 preset 池里出现 my-tuned
    from studio import presets_io
    presets = {p["name"] for p in presets_io.list_presets()}
    assert "my-tuned" in presets


def test_save_as_preset_existing_409(client: TestClient, env) -> None:
    pid, vid = _make(client)
    _seed_preset(env, "tpl")
    client.post(
        f"/api/projects/{pid}/versions/{vid}/config/from_preset",
        json={"name": "tpl"},
    )
    r = client.post(
        f"/api/projects/{pid}/versions/{vid}/config/save_as_preset",
        json={"name": "tpl"},  # 同名 + 不带 overwrite
    )
    assert r.status_code == 400  # presets_io.PresetError("已存在") → _err_code 400
    # overwrite=True 应允许
    r2 = client.post(
        f"/api/projects/{pid}/versions/{vid}/config/save_as_preset",
        json={"name": "tpl", "overwrite": True},
    )
    assert r2.status_code == 200


def test_save_as_preset_without_config_400(client: TestClient) -> None:
    pid, vid = _make(client)
    r = client.post(
        f"/api/projects/{pid}/versions/{vid}/config/save_as_preset",
        json={"name": "x"},
    )
    assert r.status_code == 400  # version 还没 fork 过任何 preset


# ---------------------------------------------------------------------------
# POST /queue (PP6.3 入队)
# ---------------------------------------------------------------------------


def test_enqueue_without_config_400(client: TestClient) -> None:
    pid, vid = _make(client)
    r = client.post(f"/api/projects/{pid}/versions/{vid}/queue")
    assert r.status_code == 400


def test_enqueue_creates_task_with_ids_and_config_path(
    client: TestClient, env
) -> None:
    pid, vid = _make(client)
    _seed_preset(env, "tpl", lora_rank=64)
    client.post(
        f"/api/projects/{pid}/versions/{vid}/config/from_preset",
        json={"name": "tpl"},
    )
    r = client.post(f"/api/projects/{pid}/versions/{vid}/queue")
    assert r.status_code == 200, r.text
    task = r.json()
    assert task["status"] == "pending"
    assert task["project_id"] == pid
    assert task["version_id"] == vid
    assert task["config_path"] and task["config_path"].endswith("config.yaml")
    # version stage 推到 training
    v = client.get(f"/api/projects/{pid}/versions/{vid}").json()
    assert v["stage"] == "training"


def test_enqueue_rejects_active_task(client: TestClient, env) -> None:
    """同 version 已有 pending/running task → 409。"""
    pid, vid = _make(client)
    _seed_preset(env, "tpl")
    client.post(
        f"/api/projects/{pid}/versions/{vid}/config/from_preset",
        json={"name": "tpl"},
    )
    r1 = client.post(f"/api/projects/{pid}/versions/{vid}/queue")
    assert r1.status_code == 200
    r2 = client.post(f"/api/projects/{pid}/versions/{vid}/queue")
    assert r2.status_code == 409
