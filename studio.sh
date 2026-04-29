#!/usr/bin/env bash
# AnimaStudio Linux/macOS shortcut -- forwards to: python -m studio
# Usage:
#   ./studio.sh            same as: python -m studio run
#   ./studio.sh dev        frontend + backend dev mode
#   ./studio.sh build      build frontend only
#   ./studio.sh test       run pytest + vitest
#
# Safe to run with either ./studio.sh or `bash studio.sh`.
# Avoid `source studio.sh` -- not needed (we call venv python directly).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || { echo "studio.sh: cannot cd to $SCRIPT_DIR" >&2; exit 1; }

if [ -x "venv/bin/python" ]; then
    PYTHON="venv/bin/python"
elif [ -x ".venv/bin/python" ]; then
    PYTHON=".venv/bin/python"
else
    if command -v python3 >/dev/null 2>&1; then
        BOOTSTRAP_PY="python3"
    elif command -v python >/dev/null 2>&1; then
        BOOTSTRAP_PY="python"
    else
        echo "studio.sh: no python found (need python3 or python on PATH)" >&2
        exit 1
    fi
    echo "[studio] 未发现 venv，正在创建 venv/ 并安装依赖（首次运行，可能需要几分钟）..."
    "$BOOTSTRAP_PY" -m venv venv || { echo "studio.sh: 创建 venv 失败" >&2; exit 1; }
    PYTHON="venv/bin/python"
    "$PYTHON" -m pip install --upgrade pip || { echo "studio.sh: 升级 pip 失败" >&2; exit 1; }
    if [ -f requirements.txt ]; then
        "$PYTHON" -m pip install -r requirements.txt || { echo "studio.sh: pip install -r requirements.txt 失败" >&2; exit 1; }
    else
        echo "studio.sh: 找不到 requirements.txt，跳过依赖安装" >&2
    fi
fi

echo "studio.sh: using $PYTHON"
"$PYTHON" -m studio "$@"
