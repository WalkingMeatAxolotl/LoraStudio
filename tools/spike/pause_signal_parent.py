"""Spike 父进程：模拟 supervisor 发暂停信号 + 读 stdout 事件。

跑法：
    python tools/spike/pause_signal_parent.py

验证 ADR 0006 §Spike 必做的 4 项：
  1. supervisor 端 proc.send_signal(CTRL_BREAK_EVENT) 能否送达
     CREATE_NEW_PROCESS_GROUP 子进程组。
  2. 子进程 signal.signal(SIGBREAK, handler) 能否捕获。
  3. handler 能否完整跑完 save + write snapshot 后 sys.exit(0)。
  4. supervisor 端能否正确读到子进程 stdout 上的 __EVENT__:pause_state
     行后才走 _finish_slot 标 paused。

退出码 0 = 全 4 项通过。非 0 = 至少一项失败，详见报告。
"""
from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


# Windows 下 shell 默认 codepage（cp936 / cp932）无法 encode 中文 print。
# child 用 env PYTHONIOENCODING=utf-8 兜过去了，parent 自己也得 reconfigure。
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")  # type: ignore[union-attr]
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")  # type: ignore[union-attr]


REPO_ROOT = Path(__file__).resolve().parents[2]
CHILD_SCRIPT = Path(__file__).parent / "pause_signal_child.py"
OUTPUT_DIR = REPO_ROOT / "tmp" / "spike_state"
EVENT_MARKER = "__EVENT__:"


@dataclass
class Capture:
    """收集子进程的事件 + stdout 行。"""
    events: list[dict] = field(default_factory=list)
    lines: list[str] = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock)

    def add_line(self, line: str) -> None:
        with self.lock:
            self.lines.append(line)
            if line.startswith(EVENT_MARKER):
                rest = line[len(EVENT_MARKER):]
                try:
                    evt_type, payload_str = rest.split(":", 1)
                    payload = json.loads(payload_str) if payload_str else {}
                    self.events.append({"type": evt_type, **payload})
                except (ValueError, json.JSONDecodeError) as e:
                    print(f"[parent] WARN 事件解析失败: {line!r}: {e}", flush=True)

    def has_event(self, evt_type: str) -> bool:
        with self.lock:
            return any(e["type"] == evt_type for e in self.events)

    def find_event(self, evt_type: str) -> Optional[dict]:
        with self.lock:
            for e in self.events:
                if e["type"] == evt_type:
                    return e
        return None


def reader_thread(proc: subprocess.Popen, capture: Capture) -> None:
    """Mirror supervisor 的 _on_line：逐行读 stdout，识别 __EVENT__ 标记。"""
    assert proc.stdout is not None
    for raw in proc.stdout:
        line = raw.decode("utf-8", errors="backslashreplace").rstrip("\r\n")
        capture.add_line(line)
        print(f"  [child stdout] {line}", flush=True)


def send_pause_signal(proc: subprocess.Popen) -> None:
    """Mirror ADR §后端代码方向 _send_pause_signal：
      Windows: CTRL_BREAK_EVENT；POSIX: SIGINT。
    """
    if os.name == "nt":
        print(f"[parent] 发 CTRL_BREAK_EVENT 给子进程组 pid={proc.pid}", flush=True)
        proc.send_signal(signal.CTRL_BREAK_EVENT)  # type: ignore[attr-defined]
    else:
        print(f"[parent] 发 SIGINT 给子进程 pid={proc.pid}", flush=True)
        proc.send_signal(signal.SIGINT)


def run_spike() -> int:
    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    env["PYTHONUNBUFFERED"] = "1"
    env["LORA_TASK_ID"] = "42"
    env["SPIKE_OUTPUT_DIR"] = str(OUTPUT_DIR)
    env["SPIKE_MAX_STEPS"] = "100"

    creationflags = 0
    if os.name == "nt":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]

    print(f"[parent] 起 child: {CHILD_SCRIPT}", flush=True)
    print(f"[parent] OS={os.name}, creationflags={creationflags}", flush=True)
    print(f"[parent] OUTPUT_DIR={OUTPUT_DIR}", flush=True)

    started_at = time.time()
    proc = subprocess.Popen(
        [sys.executable, "-u", str(CHILD_SCRIPT)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        cwd=str(REPO_ROOT),
        creationflags=creationflags,
        env=env,
        bufsize=0,
    )

    capture = Capture()
    reader = threading.Thread(target=reader_thread, args=(proc, capture), daemon=True)
    reader.start()

    # 等子进程跑几步再发信号，模拟 "用户点暂停" 的时机
    time.sleep(3.0)

    signal_sent_at = time.time()
    send_pause_signal(proc)

    try:
        rc = proc.wait(timeout=30.0)
    except subprocess.TimeoutExpired:
        print(f"[parent] 子进程 30s 内未退出，强杀", flush=True)
        proc.kill()
        rc = proc.wait()

    finished_at = time.time()
    reader.join(timeout=2.0)

    # ---- 验证报告 ----------------------------------------------------------

    print()
    print("=" * 70)
    print("Spike 验证报告 (ADR 0006 §Spike 必做)")
    print("=" * 70)
    print(f"  os={os.name}  child pid={proc.pid}  rc={rc}")
    print(f"  子进程总耗时: {finished_at - started_at:.2f}s")
    print(f"  发信号 → 退出: {finished_at - signal_sent_at:.2f}s")
    print()

    checks = []

    # 1. 信号送达 = handler 跑了 = 收到 pause_state 事件（间接证据）
    has_pause_state = capture.has_event("pause_state")
    checks.append(("1. CTRL_BREAK_EVENT 送达 CREATE_NEW_PROCESS_GROUP 子进程", has_pause_state))

    # 2. SIGBREAK handler 注册成功 → 信号被自定义 handler 捕获（不是默认 abort）。
    # 间接证据：handler 输出 "[child] handler 触发" 行
    handler_triggered = any("handler 触发" in ln for ln in capture.lines)
    checks.append(("2. signal.signal(SIGBREAK, handler) 捕获 (handler 触发)", handler_triggered))

    # 3. handler 完整跑完 + sys.exit(0)
    handler_complete = any("handler 完成" in ln for ln in capture.lines) and rc == 0
    checks.append(("3. handler 完整 save + emit + sys.exit(0) (rc=0)", handler_complete))

    # 4. parent 读到 __EVENT__:pause_state 行，并能解析 payload
    pause_evt = capture.find_event("pause_state")
    parent_got_event = pause_evt is not None and "state_path" in (pause_evt or {})
    checks.append(("4. parent 读到 __EVENT__:pause_state + 解析 payload", parent_got_event))

    # 附加验证：pause 文件落盘
    state_files = list(OUTPUT_DIR.rglob("pause_step_*.pt")) if OUTPUT_DIR.exists() else []
    config_files = list(OUTPUT_DIR.rglob("pause_step_*.config.json")) if OUTPUT_DIR.exists() else []
    files_ok = len(state_files) == 1 and len(config_files) == 1
    checks.append(("5. pause .pt + .config.json 各一份落盘 (附加)", files_ok))

    # train_loop_started 事件也验证一下
    has_loop_started = capture.has_event("train_loop_started")
    checks.append(("6. 收到 train_loop_started 事件 (is_pausable 信号)", has_loop_started))

    all_pass = True
    for label, ok in checks:
        mark = "[PASS]" if ok else "[FAIL]"
        if not ok:
            all_pass = False
        print(f"  {mark} {label}")
    print()

    if pause_evt:
        print(f"  pause_state payload: {json.dumps(pause_evt, ensure_ascii=False, indent=2)}")
    print(f"  state files: {[str(p.relative_to(OUTPUT_DIR)) for p in state_files]}")
    print(f"  config files: {[str(p.relative_to(OUTPUT_DIR)) for p in config_files]}")
    print()
    print("=" * 70)
    print(f"结论: {'全部通过 — ADR 方案 A 可行' if all_pass else '至少一项失败 — 需回退方案 B 或 debug'}")
    print("=" * 70)

    return 0 if all_pass else 1


if __name__ == "__main__":
    sys.exit(run_spike())
