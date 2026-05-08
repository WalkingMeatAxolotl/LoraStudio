#!/usr/bin/env bash
# AnimaStudio Linux/macOS shortcut -- forwards to: python -m studio
# Usage:
#   ./studio.sh [--mirror] [subcommand]
#
#   --mirror   Use Chinese pip/npm mirrors during first-run setup.
#              Without this flag, official sources are tried first;
#              mirrors are used as a fallback if the official source fails.
#
#   subcommand: run (default) | dev | build | test
#
# Safe to run with either ./studio.sh or `bash studio.sh`.
# Avoid `source studio.sh` -- not needed (we call venv python directly).
#
# NOTE: Keep all echo messages in plain ASCII/English.
#       Non-UTF-8 locales will display garbled characters for any non-ASCII
#       text in shell output. Python-side messages handle encoding separately.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || { echo "studio.sh: cannot cd to $SCRIPT_DIR" >&2; exit 1; }

# Force Python UTF-8 output so cli.py messages with non-ASCII characters
# are not mangled on non-UTF-8 locales.
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8

# Parse --mirror flag; collect remaining args to forward to Python.
_USE_MIRROR=0
_PASSTHROUGH=()
for _arg in "$@"; do
    if [ "$_arg" = "--mirror" ]; then
        _USE_MIRROR=1
    else
        _PASSTHROUGH+=("$_arg")
    fi
done

_ALIYUN="https://mirrors.aliyun.com/pypi/simple/"
_NPM_MIRROR="https://registry.npmmirror.com"

_pip_install() {
    # Usage: _pip_install [pip args...]
    # Tries official source first; falls back to Aliyun mirror on failure.
    # With --mirror: goes straight to Aliyun mirror.
    if [ "$_USE_MIRROR" = "1" ]; then
        echo "[studio] setup: using Aliyun mirror for pip"
        "$PYTHON" -m pip install "$@" -i "$_ALIYUN"
    else
        "$PYTHON" -m pip install "$@" || {
            echo "[studio] setup: pip failed, retrying via Aliyun mirror..."
            "$PYTHON" -m pip install "$@" -i "$_ALIYUN"
        }
    fi
}

if [ -x "/opt/venv/bin/python" ]; then
    PYTHON="/opt/venv/bin/python"
elif [ -x "venv/bin/python" ]; then
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
    echo "[studio] No venv found. Creating venv/ and installing dependencies (first run, may take a few minutes)..."
    "$BOOTSTRAP_PY" -m venv venv || { echo "studio.sh: failed to create venv" >&2; exit 1; }
    PYTHON="venv/bin/python"
    _pip_install --upgrade pip || { echo "studio.sh: failed to upgrade pip" >&2; exit 1; }
    if [ -f requirements.txt ]; then
        echo "[studio] Installing Python dependencies..."
        _pip_install -r requirements.txt || { echo "studio.sh: pip install failed" >&2; exit 1; }
    else
        echo "studio.sh: requirements.txt not found, skipping dependency install" >&2
    fi
fi

echo "studio.sh: using $PYTHON"
if [ -f "/.dockerenv" ] && [ "${#_PASSTHROUGH[@]}" -eq 0 ]; then
    # Container environment (Docker / CNB): listen on all interfaces, no browser.
    exec "$PYTHON" -m studio run --host 0.0.0.0 --no-browser
else
    exec "$PYTHON" -m studio "${_PASSTHROUGH[@]}"
fi
