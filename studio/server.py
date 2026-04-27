"""AnimaStudio 守护服务（FastAPI）。

P1 范围（本文件目前实现）：
    - GET  /                   返回兼容的 monitor_smooth.html（旧监控）
    - GET  /api/health         健康检查
    - GET  /api/state          读取 monitor_data/state.json
    - GET  /samples/{name}     代理采样图（output/samples/）
    - GET  /studio/...         React 应用（构建后挂载，可缺省）

后续阶段会扩展（参见 plan）：
    - P2: /api/schema, /api/configs/*
    - P3: /api/queue/*, /api/events (SSE), /api/logs/{id}
    - P4: /api/datasets

启动：
    python -m studio.server [--host 127.0.0.1] [--port 8765] [--reload]
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .paths import (
    LEGACY_MONITOR_HTML,
    MONITOR_STATE_FILE,
    OUTPUT_DIR,
    WEB_DIST,
    ensure_dirs,
)

ensure_dirs()

app = FastAPI(title="AnimaStudio", version="0.1.0")


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

EMPTY_STATE: dict[str, Any] = {
    "losses": [],
    "lr_history": [],
    "epoch": 0,
    "step": 0,
    "total_steps": 0,
    "speed": 0.0,
    "samples": [],
    "start_time": None,
    "config": {},
}


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "version": app.version}


@app.get("/api/state")
def get_state() -> JSONResponse:
    """读取训练侧写出的 monitor_data/state.json。
    训练未启动 / 文件缺失时返回空状态，不报错。"""
    if not MONITOR_STATE_FILE.exists():
        return JSONResponse(EMPTY_STATE)
    try:
        data = json.loads(MONITOR_STATE_FILE.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(500, f"failed to read state: {exc}")
    return JSONResponse(data)


@app.get("/samples/{filename}")
def get_sample(filename: str) -> FileResponse:
    # 简单防越权
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(400, "invalid filename")
    path = OUTPUT_DIR / "samples" / filename
    if not path.exists():
        raise HTTPException(404)
    return FileResponse(path)


# ---------------------------------------------------------------------------
# 静态资源
# ---------------------------------------------------------------------------

# React 应用：构建后通过 /studio 访问。开发期请用 `npm run dev` 起 5173。
if WEB_DIST.exists():
    app.mount("/studio", StaticFiles(directory=str(WEB_DIST), html=True), name="studio")


@app.get("/", response_model=None)
def root() -> FileResponse | JSONResponse:
    """根路径返回兼容的旧监控页（保持现有体验不变）。
    P3 之后切换为 React 应用，此路由会重定向到 /studio。"""
    if LEGACY_MONITOR_HTML.exists():
        return FileResponse(LEGACY_MONITOR_HTML)
    return JSONResponse(
        {
            "message": "AnimaStudio is running. Build the React app at studio/web/ "
            "(npm install && npm run build) to enable the new UI."
        }
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    import argparse
    import uvicorn

    parser = argparse.ArgumentParser(description="AnimaStudio daemon")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--reload", action="store_true", help="dev mode (auto-reload on edit)"
    )
    args = parser.parse_args()

    print(f"[AnimaStudio] http://{args.host}:{args.port}")
    uvicorn.run(
        "studio.server:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level="info",
    )


if __name__ == "__main__":
    main()
