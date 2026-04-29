@echo off
chcp 65001 >nul
REM AnimaStudio Windows shortcut -- forwards to: python -m studio
REM Usage:
REM   studio.bat            same as: python -m studio run
REM   studio.bat dev        frontend + backend dev mode
REM   studio.bat build      build frontend only
REM   studio.bat test       run pytest + vitest

setlocal
cd /d "%~dp0"

if exist "venv\Scripts\python.exe" (
    set PYTHON=venv\Scripts\python.exe
) else if exist ".venv\Scripts\python.exe" (
    set PYTHON=.venv\Scripts\python.exe
) else (
    where python >nul 2>nul
    if errorlevel 1 (
        echo studio.bat: PATH 上找不到 python，请先安装 Python 3.10+ 1>&2
        exit /b 1
    )
    echo [studio] 未发现 venv，正在创建 venv\ 并安装依赖（首次运行，可能需要几分钟）...
    python -m venv venv || (echo studio.bat: 创建 venv 失败 1>&2 & exit /b 1)
    set PYTHON=venv\Scripts\python.exe
    %PYTHON% -m pip install --upgrade pip || (echo studio.bat: 升级 pip 失败 1>&2 & exit /b 1)
    if exist requirements.txt (
        %PYTHON% -m pip install -r requirements.txt || (echo studio.bat: pip install -r requirements.txt 失败 1>&2 & exit /b 1)
    ) else (
        echo studio.bat: 找不到 requirements.txt，跳过依赖安装 1>&2
    )
)

%PYTHON% -m studio %*
exit /b %ERRORLEVEL%
