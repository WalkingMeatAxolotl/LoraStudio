@echo off
chcp 65001 >nul
REM AnimaStudio Windows shortcut -- forwards to: python -m studio
REM Usage:
REM   studio.bat            same as: python -m studio run
REM   studio.bat dev        frontend + backend dev mode
REM   studio.bat build      build frontend only
REM   studio.bat test       run pytest + vitest
REM
REM NOTE: This file MUST stay pure ASCII. cmd.exe parses .bat files with the
REM system ANSI codepage BEFORE `chcp 65001` takes effect, so any non-ASCII
REM byte breaks line parsing on Japanese (cp932), Chinese (cp936), etc. hosts.

setlocal
cd /d "%~dp0"

REM Force Python to UTF-8 stdout/stderr so prints with non-ASCII (Chinese)
REM don't crash on non-UTF-8 system locales (e.g. cp932 Japanese).
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

if exist "venv\Scripts\python.exe" (
    set PYTHON=venv\Scripts\python.exe
) else if exist ".venv\Scripts\python.exe" (
    set PYTHON=.venv\Scripts\python.exe
) else (
    where python >nul 2>nul
    if errorlevel 1 (
        echo studio.bat: python not found on PATH. Please install Python 3.10+. 1>&2
        goto :fail
    )
    echo [studio] No venv detected. Creating venv\ and installing dependencies -- first run may take a few minutes...
    python -m venv venv || (echo studio.bat: failed to create venv 1>&2 & goto :fail)
    set PYTHON=venv\Scripts\python.exe
    %PYTHON% -m pip install --upgrade pip -i https://mirrors.aliyun.com/pypi/simple/ || (echo studio.bat: failed to upgrade pip 1>&2 & goto :fail)
    if exist requirements.txt (
        echo [studio] Installing Python dependencies -- will retry via Aliyun mirror if slow...
        %PYTHON% -m pip install -r requirements.txt
        if errorlevel 1 (
            echo [studio] pip install failed, retrying via Aliyun mirror...
            %PYTHON% -m pip install -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple/ || (echo studio.bat: pip install failed 1>&2 & goto :fail)
        )
    ) else (
        echo studio.bat: requirements.txt not found, skipping dependency install 1>&2
    )
)

%PYTHON% -m studio %*
set STUDIO_ERR=%ERRORLEVEL%
if %STUDIO_ERR% NEQ 0 (
    echo.
    echo [studio] Exit code %STUDIO_ERR%. Press any key to close...
    pause >nul
)
exit /b %STUDIO_ERR%

:fail
echo.
echo [studio] setup failed. Press any key to close...
pause >nul
exit /b 1
