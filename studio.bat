@echo off
chcp 65001 >nul
REM AnimaStudio Windows shortcut -- forwards to: python -m studio
REM Usage:
REM   studio.bat [--mirror] [subcommand]
REM
REM   --mirror   Use Chinese pip/npm mirrors during first-run setup.
REM              Without this flag, official sources are tried first;
REM              mirrors are used as a fallback if the official source fails.
REM
REM   subcommand: run (default) | dev | build | test
REM
REM NOTE: This file MUST stay pure ASCII. cmd.exe parses .bat files with the
REM system ANSI codepage BEFORE `chcp 65001` takes effect, so any non-ASCII
REM byte breaks line parsing on Japanese (cp932), Chinese (cp936), etc. hosts.

setlocal enabledelayedexpansion
cd /d "%~dp0"

REM Force Python to UTF-8 stdout/stderr so cli.py messages with non-ASCII
REM characters are not mangled on non-UTF-8 system locales (e.g. cp932).
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

REM Parse --mirror flag; collect remaining args to forward to Python.
set _USE_MIRROR=0
set _PASSTHROUGH=
for %%A in (%*) do (
    if "%%A"=="--mirror" (
        set _USE_MIRROR=1
    ) else (
        if "!_PASSTHROUGH!"=="" (
            set _PASSTHROUGH=%%A
        ) else (
            set _PASSTHROUGH=!_PASSTHROUGH! %%A
        )
    )
)

set _ALIYUN=https://mirrors.aliyun.com/pypi/simple/

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

    if "%_USE_MIRROR%"=="1" (
        echo [studio] setup: using Aliyun mirror for pip
        %PYTHON% -m pip install --upgrade pip -i %_ALIYUN% || (echo studio.bat: failed to upgrade pip 1>&2 & goto :fail)
    ) else (
        %PYTHON% -m pip install --upgrade pip
        if errorlevel 1 (
            echo [studio] setup: pip failed, retrying via Aliyun mirror...
            %PYTHON% -m pip install --upgrade pip -i %_ALIYUN% || (echo studio.bat: failed to upgrade pip 1>&2 & goto :fail)
        )
    )

    if exist requirements.txt (
        echo [studio] Installing Python dependencies...
        if "%_USE_MIRROR%"=="1" (
            echo [studio] setup: using Aliyun mirror for pip
            %PYTHON% -m pip install -r requirements.txt -i %_ALIYUN% || (echo studio.bat: pip install failed 1>&2 & goto :fail)
        ) else (
            %PYTHON% -m pip install -r requirements.txt
            if errorlevel 1 (
                echo [studio] setup: pip failed, retrying via Aliyun mirror...
                %PYTHON% -m pip install -r requirements.txt -i %_ALIYUN% || (echo studio.bat: pip install failed 1>&2 & goto :fail)
            )
        )
    ) else (
        echo studio.bat: requirements.txt not found, skipping dependency install 1>&2
    )
)

%PYTHON% -m studio %_PASSTHROUGH%
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
