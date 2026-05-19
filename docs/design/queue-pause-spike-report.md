# Queue 暂停信号链路 Spike 报告

**日期**：2026-05-18
**ADR**：[0006-queue-pause-resume](../adr/0006-queue-pause-resume.md)
**Spike 脚本**：[`tools/spike/`](../../tools/spike/)

## 结论

**ADR §候选方案 A（信号通道 + 复用 handle_interrupt）可行**，主线进 PR-1。
方案 B（sentinel 文件 IPC）回归 parking lot。

## 跑了什么

在 Windows 11 上 spawn 一个模拟训练子进程，按 ADR §后端代码方向把整条信号链
端到端跑通：

```
parent (supervisor 模拟)             child (training 模拟)
─────────────────────────            ─────────────────────────
Popen(CREATE_NEW_PROCESS_GROUP)
                          ──spawn──▶ signal.signal(SIGBREAK, h)
                                     signal.signal(SIGINT, h)
                                     emit __EVENT__:train_loop_started
                                     fake step loop (step += 1 / 0.5s)
sleep 3s
proc.send_signal(CTRL_BREAK_EVENT)
                          ──CTRL_BREAK──▶
                                     handler triggered (sig=21)
                                     fake_save_training_state(.pt)
                                     fake_write_config_snapshot(.json)
                                     emit __EVENT__:pause_state
                                     sys.exit(0)
stdout reader:
  parse __EVENT__:pause_state ◀─────
proc.wait() → rc=0
validate 6 个检查
```

## 6 项验证结果（两次连跑都全过）

| # | 检查 | 结果 |
|---|------|------|
| 1 | `CTRL_BREAK_EVENT` 送达 `CREATE_NEW_PROCESS_GROUP` 子进程组 | PASS |
| 2 | `signal.signal(SIGBREAK, handler)` 捕获信号 | PASS（handler 收到 sig=21）|
| 3 | handler 完整跑完 save + emit + `sys.exit(0)` | PASS（rc=0）|
| 4 | parent 读到 `__EVENT__:pause_state` 并解析 payload | PASS |
| 5（附）| pause `.pt` + `.config.json` 各一份落盘 | PASS |
| 6（附）| `__EVENT__:train_loop_started` 事件能用作 `is_pausable` 信号 | PASS |

**关键数字**：发信号 → 子进程退出耗时 **0.62 s**（含 0.5 s fake IO sleep）。
真训练 state 几十~几百 MB，落盘 IO 是大头，但 spike 验证的是信号路径而不是
IO 性能。

## 关键发现

### Python Windows 信号映射

`CTRL_BREAK_EVENT`（OS 层）→ `SIGBREAK`（Python 信号常量值 `21`）。
**不是 SIGINT**——Python Windows docs 明确指 `CTRL_C_EVENT` 才映射 SIGINT，
但 `CREATE_NEW_PROCESS_GROUP` 子进程组收不到 `CTRL_C_EVENT`，只收
`CTRL_BREAK_EVENT`。所以 ADR §`runtime/training/phases/resume.py` 的"Windows
额外注册 SIGBREAK handler"是必须的，不是可选优化。

### subprocess.Popen + stdout=PIPE 经 line buffering

要在 parent 用 `for raw in proc.stdout:` 实时收事件，必须：
- 子进程侧：`PYTHONUNBUFFERED=1` 环境 + `print(..., flush=True)` 双保险。
- 父进程侧：`bufsize=0` 关闭 parent 端的 readahead 缓冲。

只设一边事件会延迟到几 KB stdout 攒满才看到——spike 第一版没设 bufsize=0
时，event 行延迟到子进程退出后才出现，差点误判为"事件没发出来"。

### Parent stdout 自身编码

跟主项目无关的小坑：Windows shell 默认 codepage（cp936 / cp932）encode 中文
print 会抛 `UnicodeEncodeError`。`env["PYTHONIOENCODING"] = "utf-8"` 只对
**子进程**生效，parent 自己得 `sys.stdout.reconfigure(encoding="utf-8")`。
real supervisor 走的是 `stdout=log_fp`（文件），不打 console，不会遇到。

## 对落地的影响

### 直接采纳

- ADR §`runtime/training/phases/resume.py` 在 Windows 上**必须**额外注册
  `signal.SIGBREAK`，不能只靠 SIGINT。
- ADR §`studio/supervisor.py` `_send_pause_signal` 在 Windows 上发
  `CTRL_BREAK_EVENT`、POSIX 发 `SIGINT`——跟 spike 一致。
- ADR §`runtime/training/context.py` `handle_interrupt` 完成 save 后 emit
  `__EVENT__:pause_state` 是必要的——parent 不能光靠 `rc=0` 判断 paused，
  必须看到事件行（rc 在 Windows wrapper 改写场景下不可靠）。
- ADR §Cancel 在 Windows 改 `taskkill /T /F`：信号通道**真的**被 pause 独占
  了，这条决策落地。

### 不需要兜底方案 B

方案 B（sentinel 文件 IPC）在三方 review 里作为 spike 失败的兜底保留。
spike 通过 → 方案 B 不进 PR-1 ~ PR-5，留在 ADR §候选方案作为历史决策痕迹。
如果未来 Windows 行为变化或新平台失效，再回头考虑。

### 仍需 PR-3 集成测覆盖

spike 用 **fake** save（500ms sleep + 几十 KB 文件）跑通了。真 case 几十~
几百 MB optimizer state + wandb finish + monitor flush，整个 handler 跑
3 ~ 10 秒不奇怪。ADR §4.3 暂停过程 modal 30s 超时阈值的合理性、IO 慢盘 /
SSD 写满 / antivirus 锁文件等边界 case，必须在 PR-3 端到端集成测里覆盖，
不在 spike scope 内。

## 复现

```bash
git checkout chore/queue-pause-signal-spike
python tools/spike/pause_signal_parent.py
```

预期：6 项 PASS + `结论: 全部通过 — ADR 方案 A 可行` + `rc=0`。

## Spike 脚本生命周期

PR-0 合入 dev 后留作"曾经验证过方案 A 可行"的可执行证据。下面任一时机
触发 cleanup PR 删除 `tools/spike/`：

- ADR 0006 全套 PR（PR-1 ~ PR-5）合入并生产验证。
- 或本报告结论翻转（方案 A 在真实链路上不稳）。

本报告独立留存，不随脚本删除——脚本是"怎么验"，报告是"验过了 & 结论"。
