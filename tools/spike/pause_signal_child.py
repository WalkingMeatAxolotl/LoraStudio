"""Spike 子进程：模拟训练循环 + SIGBREAK/SIGINT handler。

跑法：由 pause_signal_parent.py spawn，不要单独跑（信号靠 parent 发）。

模拟的是 ADR 0006 §后端代码方向 / runtime/training 那条链路：
  - 主循环 = train_loop（每秒 step += 1，print 到 stdout）
  - handler = TrainingContext.handle_interrupt：保 state（fake .pt + .config.json）+
    emit __EVENT__:pause_state + sys.exit(0)

stdout 用 supervisor 的 __EVENT__ 协议（详见 studio/supervisor.py:49 _EVENT_MARKER）。
"""
from __future__ import annotations

import json
import os
import signal
import sys
import time
from pathlib import Path


# 模拟 TrainingContext 的状态
STATE = {
    "global_step": 0,
    "task_id": int(os.environ.get("LORA_TASK_ID", "9999")),
    "interrupted": False,
    "output_dir": Path(os.environ.get("SPIKE_OUTPUT_DIR", "tmp/spike_state")).resolve(),
}


def emit_event(event_type: str, payload: dict) -> None:
    """Mirror supervisor.py:49 的 __EVENT__ 协议。"""
    print(f"__EVENT__:{event_type}:{json.dumps(payload, ensure_ascii=False)}", flush=True)


def fake_save_training_state(state_path: Path) -> None:
    """模拟 runtime/training/state.py save_training_state 的写盘耗时 + 体积。"""
    state_path.parent.mkdir(parents=True, exist_ok=True)
    # 真 save_training_state 写 optimizer + model + monitor 通常几十~几百 MB；
    # spike 不模拟体积，只验证文件写出来 + 信号路径通即可。
    state_path.write_bytes(b"FAKE_TRAINING_STATE_BLOB" * 1024)
    time.sleep(0.5)  # 模拟 IO 耗时


def fake_write_config_snapshot(config_path: Path, step: int) -> None:
    """模拟 ADR §5.7 config snapshot：把 args 全 freeze 成 JSON。"""
    snapshot = {
        "args": {"lr": 1e-4, "optimizer": "AdamW", "batch_size": 4, "max_train_steps": 1000},
        "dataset": {"resolution": 1024, "caption_extension": ".txt"},
        "output": {"output_dir": str(STATE["output_dir"]), "output_name": "spike_test"},
        "seed": 42,
        "global_step_at_pause": step,
    }
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(json.dumps(snapshot, indent=2, ensure_ascii=False), encoding="utf-8")


def handle_interrupt(sig, frame) -> None:
    """Mirror runtime/training/context.py:109 handle_interrupt + ADR §后端代码方向。"""
    if STATE["interrupted"]:
        print(f"[child] 二次信号 sig={sig}，强退", flush=True)
        sys.exit(1)
    STATE["interrupted"] = True
    step = STATE["global_step"]
    print(f"[child] handler 触发: sig={sig} step={step}", flush=True)

    state_dir = STATE["output_dir"] / "state" / f"task_{STATE['task_id']}"
    state_path = state_dir / f"pause_step_{step}.pt"
    config_path = state_dir / f"pause_step_{step}.config.json"

    print(f"[child] 写 state: {state_path}", flush=True)
    fake_save_training_state(state_path)
    print(f"[child] 写 config snapshot: {config_path}", flush=True)
    fake_write_config_snapshot(config_path, step)

    emit_event("pause_state", {
        "state_path": str(state_path),
        "config_path": str(config_path),
        "step": step,
    })
    print(f"[child] handler 完成，sys.exit(0)", flush=True)
    sys.exit(0)


def main() -> None:
    if os.name == "nt":
        signal.signal(signal.SIGBREAK, handle_interrupt)
        print(f"[child] 注册 SIGBREAK handler (Windows, pid={os.getpid()})", flush=True)
    signal.signal(signal.SIGINT, handle_interrupt)
    print(f"[child] 注册 SIGINT handler (pid={os.getpid()})", flush=True)

    emit_event("train_loop_started", {"task_id": STATE["task_id"]})

    max_steps = int(os.environ.get("SPIKE_MAX_STEPS", "100"))
    while STATE["global_step"] < max_steps:
        STATE["global_step"] += 1
        print(f"[child] step {STATE['global_step']}/{max_steps}", flush=True)
        time.sleep(0.5)

    print(f"[child] 训练正常结束 (走到 max_steps)", flush=True)


if __name__ == "__main__":
    main()
