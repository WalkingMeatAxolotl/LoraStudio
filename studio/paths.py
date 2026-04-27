"""Studio 内部使用的路径常量与目录初始化。"""
from __future__ import annotations
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# 训练侧已有
MONITOR_DATA = REPO_ROOT / "monitor_data"
MONITOR_STATE_FILE = MONITOR_DATA / "state.json"
OUTPUT_DIR = REPO_ROOT / "output"
LEGACY_MONITOR_HTML = REPO_ROOT / "monitor_smooth.html"

# Studio 持久化（SQLite + 用户保存的 config + 任务日志）
STUDIO_DATA = REPO_ROOT / "studio_data"
STUDIO_DB = STUDIO_DATA / "studio.db"
USER_CONFIGS_DIR = STUDIO_DATA / "configs"
LOGS_DIR = STUDIO_DATA / "logs"

# React 前端
WEB_DIR = REPO_ROOT / "studio" / "web"
WEB_DIST = WEB_DIR / "dist"


def ensure_dirs() -> None:
    """首次运行时创建必要目录。"""
    for d in (MONITOR_DATA, STUDIO_DATA, USER_CONFIGS_DIR, LOGS_DIR):
        d.mkdir(parents=True, exist_ok=True)
