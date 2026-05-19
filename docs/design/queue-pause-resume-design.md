# Queue 暂停 / 恢复训练 — 逻辑设计草稿

> 临时设计文档，仅整理**逻辑模型**：状态机、按钮语义、文件存放、用户场景。
> 不涉及代码实现细节。实现 workflow 见后续 ADR / PR 描述。

## 0. 目的与非目的

**目的**：让用户在 UI 上对**训练中**的 task 执行"暂停 → 释放 GPU → 之后从同一进度继续"，
不再像今天的"取消"那样彻底丢进度。

**非目的**：
- 不替换今天的"取消"——cancel 仍然是 terminal、立即释放 GPU、无法恢复。
- 不改变已有的 `--resume-state` / `ResumeFieldPicker` 手动从 .pt 续训路径——这条路径继续存在，跟新加的"暂停 / 恢复"是两套入口（见 §6）。
- 不涉及 generate / download / tag 等非 training task。这些 task 跑得快，没暂停意义。

---

## 1. 任务状态（含新增 paused）

### 当前状态集

| 状态 | 类别 | 说明 |
|------|------|------|
| `pending` | live | 在队列等待调度 |
| `running` | live | 正在执行 |
| `done` | terminal | 正常完成 |
| `failed` | terminal | 异常退出 |
| `canceled` | terminal | 用户取消（硬中断） |

### 新增状态

| 状态 | 类别 | 说明 |
|------|------|------|
| `paused` | **non-terminal, non-live** | 用户主动暂停，state 已保存，可恢复 |

**关键性质**：
- `paused` **不**进 `TERMINAL_STATUSES`——它不是终态，可被恢复。
- `paused` **不**占调度——dispatcher 看到队列只有 paused 没有 pending 时，不会自动拉起 paused，必须用户主动 resume。
- `paused` **不**占 GPU——子进程已退出，资源完全释放，其他 pending task 可正常调度。

### 不引入的中间态

- **不**引入 `pausing`（"正在暂停中"）：从用户点暂停到子进程退出有几秒钟窗口，这段窗口 task 还是 `running`，UI 通过 `pause_pending` 这种"动作中"标志展示，不进 db 状态。
- **不**引入 `resuming`：用户点恢复后，task 状态直接回到 `pending`，dispatcher 自然拾起。UI 区分"原生 pending"和"带 resume 的 pending"靠 `resume_state` 字段，不需要额外状态。

---

## 2. 状态转移图

```
                    ┌──────────────────────────────────────────┐
                    │                                          │
   new ─► pending ──┴─► running ──┬─► done                     │
              │          │  ▲     │                            │
              │          │  │     ├─► failed                   │
              │          │  │     │                            │
              │          │  │     ├─► canceled                 │
              │          │  │     │                            │
              │          │  │     └─► paused ─► (resume) ──────┘
              │          │  │           │
              │          │  │           ├─► (cancel) ─► canceled
              │          │  │           │
              │          ▼  │           ▼
              └──► canceled │       canceled
                   (cancel  │       (server restart → 仍 paused)
                    pending)│
                            │
                  (cancel running)
```

转移说明：
- `running → paused`：用户点暂停 → 发 pause 信号 → 子进程触发 `handle_interrupt` → 保存 state → 进程退出 → supervisor 写 status=paused。
- `paused → pending`（带 resume_state）：用户点恢复 → 复用原 task config，注入 `resume_state` 指向保存的 .pt → 状态写回 pending → dispatcher 重新调度。
- `paused → canceled`：用户在暂停态决定彻底放弃 → 直接改 db 状态，进程早已退出，无需信号。
- `paused → paused`（跨 server 重启）：进程已退出，状态只在 db 里，重启 server 不影响。

---

## 3. 两类暂停语义（术语：暂停 vs 挂起）

用户提到"全局暂停"和"任务级暂停"，这是**两个独立的 feature**，作用对象、生命周期、状态存放都不同。为避免歧义，**故意用不同动词**：

| 名词 | 作用对象 | 动词 | 反义动词 |
|------|---------|------|---------|
| **任务暂停** | 单个 running task | 暂停 | 恢复 |
| **队列挂起** | 整个 dispatcher（"是否拉新 pending"开关） | 挂起 | 恢复调度 |

英文等价（如果以后做 i18n）：task **pause** / **resume** vs queue **hold** / **release**（或 suspend / resume scheduling，HPC 圈惯用术语）。中文敲定 **挂起 / 恢复调度**——挂起是计算机术语里的标准 suspend，恢复调度带"调度"二字跟任务级"恢复"消歧义。

### 3.1 任务暂停（task pause）

**作用对象**：当前正在 running 的 training task。

**效果**：
- 给该 task 子进程发暂停信号 → 走 `handle_interrupt` → 保 state → 退出。
- task 状态从 `running` → `paused`。
- GPU 释放。**如果队列未挂起**，supervisor 主循环看到 TRAIN 槽位空，自动调度下一个 pending task。
- 用户日后点"恢复"才会把这个 paused task 拉起来。

### 3.2 队列挂起（queue hold）

**作用对象**：supervisor 的 dispatcher，单一 bool 开关。

**状态存放**：db 持久化（建议放 `app_settings` 或 kv 表，单条记录），**跨 server 重启保留**。
理由：挂起是用户显式决策，重启 server 不应自动恢复调度——否则维护重启时队列突然自己跑起来，用户没预期。

**效果**：
- dispatcher 不再从 `pending` 队列拉新 task。
- **不影响**当前正在 running 的 task——它继续跑到自然结束，写入 done / failed。
- **不影响**任务级 pause / resume API——两套独立工作（详见 §3.3）。
- UI 永远显示当前挂起状态（顶部 banner / toggle 按钮的状态色）。
- 用户恢复调度后，dispatcher 恢复正常调度，按现有的 `next_pending` 优先级 + 创建时间排序拉 task。

**挂起状态下的 pending 任务**：什么都不发生——既不算异常也不算错误，UI 显示"等待恢复调度"提示。

### 3.3 两者的交互

**正交关系**：两个开关可以任意组合，4 个象限都合法：

| 队列状态 | running task | 行为 |
|---------|------------|------|
| 未挂起 + 有 running | running 跑完 → 自动拉下一个 pending |
| 未挂起 + 无 running | dispatcher 立刻拉下一个 pending（如有） |
| 已挂起 + 有 running | running 跑完 → **不**拉下一个 pending |
| 已挂起 + 无 running | dispatcher 空转，等恢复调度 |

**挂起时的 task 操作**：
- 任务暂停：允许。挂起时把 running 的 task 暂停 → task 进 paused，TRAIN 槽空着不调度。
- 任务恢复（resume）：允许。task 从 paused 转回 pending，但**不会被实际拉起**——只是排进 pending 队列等恢复调度。UI 上 task 状态显示 pending，旁边附"等待恢复调度"小字。
- 任务取消 / 删除：允许，跟挂起状态无关。

**为什么允许"挂起 + resume"的"延迟启动"语义**：
- 简化模型：resume = "把这个 task 标记为可再被调度"，调度本身受挂起状态控制。
- 反例：如果挂起时禁用 resume 按钮，用户得"先恢复调度 → resume → 再挂起"来排队等一会儿，工作流啰嗦。
- 但是 UI 必须明确显示"task 已在排队，等待恢复调度"，否则用户会困惑"为什么没启动"。

### 3.4 挂起时机的 user case

详见 §7 Case F / G。简单说：用户想"让队列自己慢下来"的场景，比如临时观察、过夜不跑、维护窗口。

---

## 4. 按钮 / 入口分布

### 4.1 Queue 列表页

**顶部 banner**（挂起状态可视化，**仅用 banner，不用 task chip**）：
- 队列未挂起：**不显示任何 banner**——避免视觉噪音。
- 队列已挂起：sticky 顶部 banner "队列已挂起，待办任务不会自动开始 [恢复调度]"。
- 注意：banner 是 UI 元素，**不是** task 状态机的一部分。task 状态徽章只反映 task 自身状态（pending / running / paused / done / failed / canceled），不参与表达队列挂起。

**顶部 actions**：

| 按钮 | 出现条件 | 行为 |
|------|---------|------|
| 暂停当前 | 有 running task **且 task 已进入 train_loop**（见 §8.1） | 任务级暂停 |
| 取消当前 | 有 running task | （现有）任务级 cancel，硬中断 |
| 挂起队列 | 队列未挂起时显示 | 弹 confirmation modal（见 §4.3）|
| 恢复调度 | 队列已挂起时显示 | 直接恢复调度，无需 confirmation |

**不做**：没有"暂停全部"复合按钮。挂起 + 暂停 running 通过 §4.3 的 modal 一次完成。

**每行**：

| 行内按钮 | 出现条件 | 行为 |
|---------|---------|------|
| 恢复 | task.status = paused | 状态回 pending，注入 resume_state |
| 彻底取消 | task.status = paused | paused → canceled，删除 pause 文件 |

paused task 的提示文案：行内显示"在 step N 暂停于 YYYY-MM-DD HH:MM"。
挂起状态下，所有 pending 行（含刚 resume 进来的）显示小字"等待恢复调度"。

### 4.2 QueueDetail 页

跟 Queue 页对齐，按钮放详情卡片：
- running + 已进入 train_loop：暂停 / 取消
- running + 启动阶段：仅显示 取消（暂停按钮隐藏）
- paused：恢复 / 彻底取消 + 显示"在 step N 暂停于 …"
- 其他状态：维持现状

### 4.3 暂停任务的过程 modal（覆盖全流程）

点"暂停当前"按钮后**立刻弹出一个 modal**，覆盖整个 pause 流程：发信号 → 保存中 → 完成 / 超时 / 失败。modal 期间**锁定其他操作**，避免用户误操作（比如点取消把进度全丢）。

**状态机**（modal 内自管）：

```
[暂停按下]
   ↓
状态1：保存中
  显示：spinner + "正在保存训练状态…（已用 Ns）"
  按钮：无（或一个 disabled 的"等待"），阻止用户做别的
   ↓ 子进程 emit __EVENT__:pause_state（成功）
   ↓ OR 30s 超时
   ↓ OR 子进程异常退出
   ├─→ 状态2A：保存成功
   │     显示：✓ "已暂停在 step N，可随时恢复"
   │     按钮：[好] → 关 modal + toast
   │
   ├─→ 状态2B：超时（>30s 还没收到事件）
   │     显示：⚠️ "保存耗时超过预期（已用 Ns）"
   │     按钮：[再等 30s] [强制取消（保留 pause 文件）] [终止任务（丢弃进度）]
   │     - 再等：继续等下一轮 30s
   │     - 强制取消：发硬终止信号；如果磁盘上 pause 文件已经写出来了仍标 paused，否则降级 canceled
   │     - 终止任务：发硬终止 + 标 canceled
   │
   └─→ 状态2C：子进程异常退出（rc != 0）
         显示：✗ "保存过程出错（exit code N）"
         按钮：[查看日志] [终止任务]
         任务标 failed
```

**关键设计点**：
1. **modal 一启动就锁屏**——pause 期间用户没有机会做"我反悔了不想 pause 了"，因为信号已经发出去了，反悔无意义。
2. **30s 阈值由用户决定下一步**，不再"默默降级 cancel"。三个选项让用户根据 disk / IO 状况自己判断。
3. **modal 期间显示已用秒数**——透明的反馈，避免用户以为程序卡死。
4. **子进程 emit 的 `__EVENT__:pause_state` 是触发"成功"的唯一信号**，光看 rc=0 不够（rc 可能因为 Windows wrapper 改写不可靠）。

### 4.4 挂起队列的 confirmation modal

点"挂起队列"按钮时根据当前 running 情况展示不同的 modal：

**情形 A：没有 running task**
```
挂起队列？
挂起后，新的待办任务不会自动开始。
[确认挂起] [取消]
```

**情形 B：有 running task**
```
挂起队列？
挂起后，新的待办任务不会自动开始。

当前正在运行：task #42 "my_anime_v1"。
对 task #42 做什么？

  ○ 让 task #42 跑完（默认）
  ○ 同时暂停 task #42（保存进度，恢复调度后或单独恢复均可）

[确认挂起，让 task #42 跑完]  [取消]
```

主按钮文案随 radio 选择**联动**（"让 task #42 跑完" / "同时暂停 task #42"），避免用户点完不知道自己确认了什么。
具体 task name / id **直接出现**在选项里，不再用"它"指代。

**情形 B 的 3 个 outcome**：
- 取消 → 什么都不变。
- 确认 + "让 task #42 跑完" → 仅写 queue_held=true。
- 确认 + "同时暂停 task #42" → 写 queue_held=true + 调任务级 pause API（触发 §4.3 暂停过程 modal）。

**恢复调度按钮**：直接生效，无需 confirmation（解除一个限制是低风险操作）。

### 4.5 不变的入口

- 新建 task 页的 `ResumeFieldPicker`（从任意 .pt 起新 task）**不动**。见 §6 路径 B。

---

## 5. State 文件存放与命名

### 5.1 文件位置与命名（per-task 子目录 + pause 前缀 + config snapshot）

**写盘路径**：

| 来源 | 路径 |
|------|------|
| `handle_interrupt`（暂停触发，state） | `<output_dir>/state/task_<TID>/pause_step_<N>.pt` |
| `handle_interrupt`（暂停触发，config snapshot） | `<output_dir>/state/task_<TID>/pause_step_<N>.config.json` |
| `save_state_every` / `save_state_every_epochs`（周期触发） | `<output_dir>/state/task_<TID>/step_<N>.pt` |

三点改动：
1. **加 per-task 子目录**：原因见 §5.3 / §5.4——同一个 version 下可能跑过多个 task，必须用 task_id 隔离 state 文件，否则会互相覆盖（今天的 latent bug）。
2. **pause 文件加 `pause_` 前缀**：区分"暂停锚点"和"周期 checkpoint"。两者生命周期不同（见 §5.5 / §5.6），命名必须能区分。
3. **pause 时同步落盘 config snapshot**：把当前正在用的所有训练参数 freeze 一份 JSON，跟 .pt 同名（`.config.json`后缀）。resume 时**用 snapshot 跑**，不读 task 表 / version 配置 / 外部 preset。详见 §5.7。

LoRA 输出（`.safetensors`）和 samples 目录**不动**，只挪 state 相关文件。

### 5.2 与 task 的关联

db 的 task 表新加一列：`paused_state_path`（绝对路径），记最后一次暂停写的 .pt。

- 每次 pause 都覆盖这个字段（永远指向"最新可恢复点"）。
- paused → pending（resume）时**不**清空。
- task 进入 terminal 状态（done / failed / canceled）后保留作为历史记录。

### 5.3 同一 version 下多个 task 的隔离（关键场景 1）

**场景**：用户在 version V 下先跑了 task #42（被暂停），然后在同一 V 下又起了 task #43。

| Task | State 路径 | Config snapshot 路径 |
|------|-----------|---------------------|
| #42 | `<output_dir>/state/task_42/pause_step_1000.pt` | `…/state/task_42/pause_step_1000.config.json` |
| #43 | `<output_dir>/state/task_43/pause_step_500.pt`  | `…/state/task_43/pause_step_500.config.json` |

两个 task **完全隔离**，互不干扰；任一被暂停的 task 都能独立 resume，且各自的 config snapshot 不会互相覆盖。

**今天的实现是有 bug 的**：没有 task_id 子目录，task #42 和 #43 都写 `step_500.pt` / `step_1000.pt` 到同一个目录——后跑的会盖前跑的。本 feature 必须修这个 bug，否则 pause/resume 不可靠。

### 5.4 配置改动后再训（仍是同一 version）（关键场景 2）

**场景**：task #42 跑了 1000 step 暂停。用户改了 lr / dataset / optimizer 配置（无论是改 version 配置、改 preset、还是改外部 yaml），submit 出 task #43（同 version）。

- 配置改动 = **新 task**（task_id 不同），不是 "resume #42"。db 记录两条独立 task 行。
- task #42 和 #43 各写各的 state 子目录（见 §5.3），state 互不影响。
- **task #42 的 config snapshot 已经落盘在 `pause_step_1000.config.json`**，pause 时 freeze 的是 pause 那一刻正在用的全部训练参数。
- 用户**改 version / preset / 外部配置文件后，task #42 的 snapshot 不受影响**——resume #42 时严格用 snapshot，跟"最新的 config 长什么样"完全解耦。
- 用户**不能**用改过的配置 resume task #42——见 §8.5（resume 不允许编辑 config，UI 检测到 task 的 config 字段或 snapshot 跟当前 effective config 有差异时禁用恢复按钮提示走 fork）。
- 如果用户想"沿用旧 state 但跑新 config"，用 ResumeFieldPicker 起一个全新 task（§6 路径 B），手动把 .pt 路径指向 task #42 的 state 文件——这就是显式 fork。

**核心原则**：state 归属由 task_id 锁死；config 归属由 snapshot 锁死。配置变更不会回头污染老 task 的任何东西。

### 5.5 Pause 文件生命周期（resume 成功后自动删除）

**核心规则**：pause 文件（`.pt` + 同名 `.config.json` snapshot 配对）是"暂停锚点"，仅在 task 处于 paused 状态期间有效。当 task 离开 paused 状态后**两个文件一起自动删除**——同一 task 任何时刻最多只有 1 对 pause 文件。

| 事件 | pause 文件对处理（.pt + .config.json） |
|------|---------------|
| `running → paused` | 写新 pause 文件对，`paused_state_path` 指向 .pt |
| `paused → pending`（resume，path A） | 子进程**成功加载** state 后删除文件对，清空 `paused_state_path` |
| `paused → canceled`（彻底取消） | 静默删除（task 已弃用，文件无意义） |
| 删除 paused task | 一并删除（见 §5.8） |

**删除时机为什么是"成功加载后"而不是"用户点击 resume 时"**：
- 用户点 resume 后，task 状态先改 pending，等 dispatcher 调度可能要几秒到几分钟（前面有别的 task 在跑）。
- 子进程拉起后 `load_training_state` 可能失败（.pt 损坏 / 版本不兼容 / OOM）。如果点击时就删，加载失败用户无法重试。
- 安全时机：CLI 端 `load_training_state` 成功返回后，emit `__EVENT__:resume_state_loaded:{"path":"..."}`，supervisor 收到事件再删文件。失败则 task → failed，pause 文件保留，用户可以选择再次 resume 或用 ResumeFieldPicker debug。

**用户的反向场景**（曾担心的"想留着"）：
- 想回滚到 pause 时的旧 state → resume 之后训练已经覆盖过 in-memory state，那个 .pt 已经是 stale 拷贝。真要回滚必须先取消当前 resume task，但这时新 pause 文件还没生成、旧的已删——结论是：**回滚不是本 feature 的功能**，要回滚走 §6 路径 B（手动 fork）+ 把握时机（resume 前用 ResumeFieldPicker 起 fork task）。
- 想 fork 一个新分支 → 应该在 resume **之前**做（用 ResumeFieldPicker 起新 task，并行保留 paused task）。pause 文件还在的时候 fork，是合法操作。一旦点了 resume，意图就是"接着跑同一个 task"，旧 state 不再需要。

### 5.6 周期 save 文件生命周期（保留，由用户管理）

跟 pause 文件**完全独立**：
- 由 `save_state_every` / `save_state_every_epochs` 写出，是用户主动开的灾后恢复点。
- **不自动清理**——用户开了这个功能就是要这些 checkpoint。
- 累积在 `state/task_<TID>/` 同子目录，用 `step_<N>.pt` 命名（无 `pause_` 前缀）。
- 跟 pause 文件按文件名区分，不会被 §5.5 的"删除 pause 文件"规则误删。
- 任务 done / failed 后保留作为历史 checkpoint，可被 ResumeFieldPicker 选中起新 task。
- 用户手动清理；或未来加"task done 后批量清"开关。

### 5.7 Config snapshot 设计（resume 的另一半锚点）

**动机**：仅靠 .pt 文件 resume 是不够的——load_training_state 恢复 optimizer + step + lr scheduler 等，但训练参数（dataset 路径、lr、optimizer 类型、batch size、loss weighting、noise schedule、采样配置等）来自外部 args / config。这些参数在 pause 到 resume 之间**可能被用户改动**（编辑 version 配置、改 preset、改外部 yaml）。

如果 resume 时再读"当前 effective config"，paused task 的训练就会受用户后续编辑影响，行为不确定。

**方案**：pause 触发时，`handle_interrupt` 除了写 `.pt`，同步把当前进程**实际在用的所有训练参数**序列化成 JSON，落盘到 `pause_step_<N>.config.json`。resume 时严格从这个 snapshot 拼 args，不读 task 表的 config 字段、不读 version 配置、不读外部 preset。

**snapshot 内容**（候选清单，最终以实现时的 args 序列化结果为准）：
- 所有 `args.*`：lr、optimizer、optimizer_args、scheduler、batch_size、grad_accum、max_train_steps、num_epochs、noise schedule、loss weighting、network_dim、network_alpha、rank、alpha、dropout、conv_dim、conv_alpha、…
- dataset 配置：dataset_config / resolution / caption_extension / shuffle / repeat / class_tokens
- output_dir、output_name、sample_prompts、sample_every、save_every_n_steps、save_state_every…
- 关键路径：base model、vae、text encoder（不存 hash，只存路径）
- random seed
- **不存**：wandb run id（已 finish），monitor live state（已 dump 在 .pt 内）

**resume 流程**：
1. UI 点恢复 → API 取 task.paused_state_path → 推出旁边的 `.config.json`。
2. 拼新 args：基于 snapshot.config.json，**只覆盖** `--resume-state <pt_path>`，其他全用 snapshot。
3. cmd_builder 拼命令 → spawn 子进程 → CLI 跑 snapshot 配置 + 从 .pt load state。

**db 字段**：除了已规划的 `paused_state_path`，加 `paused_config_path`（绝对路径，跟 state 同步覆盖）。也可以约定 "snapshot 路径永远 = state_path 同名 .config.json"，db 只存一个字段——后者更简洁。

**用户改 config 后再点恢复**：
- snapshot 跟用户当前 config 内容可能不一致——这是好事，snapshot 才是正确的。
- UI 建议提示："此 task 暂停时的配置已固化，恢复将沿用暂停时配置；如需用新配置训练，请通过 ResumeFieldPicker 新建 task。"
- §8.5 进一步说明禁用 / 引导规则。

**Snapshot 跟 .pt 同生命周期**：见 §5.5 / §5.8——pause 文件被删时，snapshot 一起删（同文件夹同前缀）。

### 5.8 删除 paused task（或任意状态 task）

- 删除 db 记录。
- 子目录 `state/task_<TID>/` 处理：
  - **Pause 文件（.pt + .config.json）**：跟随 task 一起删（无失分场景，§5.5 已论证）。
  - **周期 save 文件**：UI 弹窗"是否同时删除 N 个 checkpoint 文件"，默认**保留**（用户可能想 ResumeFieldPicker 复用）。
- 子目录粒度让批量清简单：`rm -rf state/task_<TID>/` 就行，不会误伤别的 task。

---

## 6. 两条恢复路径并存

| 入口 | 文件选择 | 任务状态 | 用途 |
|------|----------|----------|------|
| **A. 恢复按钮**（paused task） | 自动用 `paused_state_path` | 原 task 复活（paused → pending） | 主路径：暂停后回来接着跑 |
| **B. ResumeFieldPicker**（新建 task） | 用户手动选任意 .pt | 新建一个 pending task | 已有：跨 task 续训 / 从 done task 中间 checkpoint 重启 / 灾后恢复 |

**两条不互斥也不冲突**：
- A 只有 paused task 才出现，是 task 内部生命周期续接。
- B 永远可用，从文件系统挑 .pt 起新 task。
- 同一个 .pt 文件理论上可以被 B 路径反复用来起新 task，paused_state_path 只是 A 路径的便捷指针。

**为什么不合并成一条**：A 保持原 task 身份（同一行 task，同一个 task_id，loss 历史 / 监控历史延续），B 是新 task（新 id、新 log）。这两个语义不一样，强行合并会让用户困惑"我点恢复为什么 task_id 变了"。

---

## 7. User Case 罗列

### Case A — 临时让出 GPU 做别的
用户跑了 1000 step，临时想用 GPU 跑个 generate。
→ 任务级暂停 → generate task 跑（队列下一个或新插一个） → 用完 GPU → 点"恢复"。

### Case B — 关机 / 离线过夜
用户晚上想关电脑，但希望明天继续。
→ 任务级暂停（保 state） → 关机 → 第二天开机、启动 server → task 状态仍是 paused → 点"恢复"。

### Case C — 观察 loss 后决策
跑了 1000 step，loss 不太对，想离线分析 sample 图再决定。
→ 暂停 → 看 sample / loss 曲线 → 决定继续 OR 彻底取消（paused → canceled）。

### Case D — 调度策略调整
队列有 5 个 task，第二个跑了一半发现第三个更紧急。
→ 暂停第二个 → 调整队列顺序（或直接让第三个排队） → dispatcher 自动跑第三个 → 第三个完了后点"恢复"第二个。

### Case E — 服务器要重启（用户主动）
用户要重启 server（更新代码 / 改配置）。
→ 任务级暂停当前 running（用户**主动**做这一步） → 等子进程退出 → 重启 server → resume。

**关键约定**：server 关闭时**不**自动 pause running task。原因详见 §9——服务器异常退出场景太多（crash / 断电 / OS kill），无法承诺"每次都能保 state"，做了反而给用户错误的安全感。用户该自己 pause 就主动 pause。

### Case F — 让队列今晚自然停下来
"今晚不想让队列继续跑新的，但当前这个跑完没事。"
→ 挂起队列（弹 modal，情形 B，选"让它跑完"） → 当前 task 跑完自然结束 → 队列里 pending 不会自动启动。
→ 早上恢复调度。

### Case G — 全停做维护
"我要做系统维护，全停。"
→ 挂起队列（弹 modal，情形 B，选"同时暂停它"） → 既不调度新的，也保存当前进度。
→ 维护完恢复调度 + 用户手动逐个 resume 想恢复的 paused task。

### Case H — 挂起期间 resume 老 task
"队列挂起着，但我想让一个之前暂停的 task A 排上队，等明天恢复调度后第一个跑。"
→ 点 task A 行内的"恢复" → task A 状态 paused → pending → UI 显示"等待恢复调度"。
→ 明天恢复调度 → dispatcher 按优先级 + 创建时间排序拉，task A 按它的序位进入 running。
→ （如果想让它**先跑**，要顺手调整队列顺序——这是现有功能，不属于本 feature。）

### Case I — 灾后 / 异常恢复（不在本 feature scope）
不属于本 feature，由现有 `save_state_every` + `ResumeFieldPicker` 覆盖：
进程意外死亡 / OOM / 蓝屏 / 断电 → task 被标 failed → 用户用 ResumeFieldPicker 选最近的周期 .pt 起新 task。

**前提**：用户必须在训练配置里**主动开** `save_state_every`（默认 0，即不写中间 checkpoint）。本 feature 不替代这条防线，参 §9。

---

## 8. 边界 / 未定义行为

### 8.1 过早暂停（global_step=0 之前）
用户在 dataset 加载 / 模型加载阶段就想暂停，此时还没进 train_loop，`global_step=0`，存的 state 没意义。

**策略**（双层防护，UI 为主）：
1. **UI 层（主）**：暂停按钮**只在 task 进入 train_loop 后才显示**。启动阶段只显示取消按钮。
   - 实现：CLI 端进入 train_loop 时 emit `__EVENT__:train_loop_started:{}`，supervisor 缓存到 slot，通过 task API / SSE 暴露 `is_pausable: bool`。
   - UI `useMonitorProgress(taskId)` 已经在订阅状态，扩个字段就行。
2. **API 层（防御）**：直接调 pause API 时，server 端检查 `is_pausable` 标志，未就绪返回 409 + 提示文案。覆盖 UI 显示有延迟 / 用户直接调 API 的情况。

不做"自动延后到 loop 启动再暂停"——把简单的事做复杂没必要，用户看不到按钮就知道现在不能暂停。

### 8.2 暂停过程的 modal（取代"超时默默降级"）
子进程收到暂停信号后，`handle_interrupt` 在保存 state + config snapshot（可能几秒到十几秒）。整个过程**在 UI 端用一个 modal 全程覆盖**，详见 §4.3：

- modal 一启动就锁屏，期间用户不能做别的操作（避免点取消把进度丢了）。
- 30s 超时**不**自动降级，而是 modal 给用户选：[再等 30s] / [强制取消保存进度] / [终止任务丢弃进度]。
- 子进程异常退出（rc != 0）：modal 进失败态，引导用户看日志。
- 成功：modal 关闭 + toast "已暂停在 step N"。

**底层规则保留**：
- 只有子进程 emit `__EVENT__:pause_state` 且文件落盘完整时，才标 `paused`。
- 用户在 modal 里点"强制取消保存进度"时：如果磁盘上 pause 文件已写出来了（snapshot + .pt 都存在）→ 标 paused；否则降级 canceled。
- 用户在 modal 里点"终止任务"：发硬终止 + 标 canceled，不保留任何 pause 文件。

### 8.3 服务器重启 / 异常退出时还在 running 的 task
现状：supervisor.stop() 同步发硬终止信号，state 不存；进程被外部 kill / 断电时 task 留在 running 状态，重启后被 orphan 扫描标 failed。

**本 feature 不改这个**——明确不做"server stop 时自动 pause"。
原因写在 §9：覆盖面太窄（只有用户主动 stop 才能 hook，crash / 断电 / OOM kill 都没机会），做了反而误导用户。引导用户通过 `save_state_every` 主动配置周期 checkpoint。

### 8.4 paused task 跨 server 重启
状态完全在 db，重启 server 不动它。重启后 task 仍是 paused，用户能正常 resume。
orphan 清理逻辑只扫"重启时还是 running 的"，paused 不受影响。

### 8.5 配置变更（由 config snapshot 兜底）
**snapshot 已经把暂停那一刻的 config freeze 在 `pause_step_<N>.config.json`**（详见 §5.7），用户暂停后改 version 配置 / preset / 外部 yaml **都不会污染** paused task 的恢复。

- 恢复按钮永远用 snapshot 跑，跟"用户当前 effective config 长什么样"完全无关。
- UI 在 paused 行 / 详情页用 info 提示："此 task 暂停时的配置已固化，恢复将沿用暂停时配置。如需用新配置训练，请通过 ResumeFieldPicker 新建 task。"
- 不暴露"resume 前编辑 config"入口——想换 config 只能走 §6 路径 B 显式 fork 出新 task。

**为什么不让用户用新 config 直接 resume**：
- optimizer state 跟旧 lr / 旧 betas 强耦合，换 optimizer 类型就直接崩。
- scheduler 状态跟旧 warmup / total_steps 强耦合。
- dataset 换了，loss 历史就失去意义。
- 强行支持 = 一堆"似 resume 非 resume"的边界 case。fork 新 task 是干净边界。

### 8.6 Wandb run
`handle_interrupt` 已 `finish()` 原 run；resume 时起新 run（不复用 run_id）。
**接受这个 trade-off**，写到 doc。未来想接续 run 要单独存 run_id，本期不做。

### 8.7 删除 paused task 时清不清 state 子目录
- Pause 文件对（.pt + .config.json）：**跟着删**（§5.5 / §5.8 已论证无失分场景）。
- 周期 save 文件：UI 弹窗确认，**默认保留**。

### 8.8 多次 pause / resume 不会累积 pause 文件
每次 pause 写新文件对（不同 step），但**任何时刻只有 1 对存活**——resume 成功就删，再 pause 又写新对。
周期 save 文件独立累积，规则不变（§5.6）。

---

## 9. 明确不做的

| 项 | 原因 |
|----|------|
| paused 状态下编辑 config | 语义复杂，容易让 resume 出错 |
| paused 状态下移动 LoRA 输出目录 | output_dir 路径硬编码在 state 文件里 |
| Wandb run id 续接 | 单独 feature，需要存额外字段 |
| 自动清理周期 save 文件 | 用户主动开的 checkpoint，由用户管 |
| pause generate / download / tag task | 这些 task 跑得快，没意义 |
| 强 kill 子进程后还标 paused | 强 kill 时 state 不可信，必须标 canceled |
| **server stop / crash / 断电时自动保 state** | 覆盖面不可控（用户主动 stop 才能 hook，crash / 断电 / OOM kill / 蓝屏全没机会），做了会给用户错觉以为有保护；引导用户在训练配置里开 `save_state_every` 才是正解 |
| **挂起状态下强制禁用 task resume** | UI 反复操作啰嗦；改成"resume 后排队等恢复调度"语义更顺（§3.3） |
| **"暂停全部"复合按钮** | UI 冗余；挂起时 modal 已经能多问一句"是否同时暂停 running"（§4.3） |

---

## 10. 决策记录

### 第一轮（初始 5 个开放问题）

1. ~~**队列级暂停是否纳入本期 scope**~~ **已决**（§3.2 / §3.3 / §4 / §7 Case F-H）：
   纳入本期。用 **挂起 / 恢复调度** 命名跟"暂停"区分。
   状态用 db 持久化的单一 bool（survives server restart），不动 task 状态机。
   挂起跟任务级 pause / resume **正交**，4 个象限都合法。
2. ~~**"暂停全部"复合按钮**~~ **已决**（§4.4 / §9）：
   不做独立按钮。挂起队列的 confirmation modal 检测 running task 并多问一句"是否同时暂停"——一次操作覆盖两种意图。
3. ~~**server stop / crash 时自动保 state**~~ **已决**（§8.3 / §9）：
   不做。覆盖面太窄（只能 hook 用户主动 stop，crash / 断电 / 蓝屏全部漏掉），承诺不了"必然保 state"反而误导用户。引导用户开 `save_state_every` 周期 checkpoint。
4. ~~**删除 paused task 时 .pt 文件处理**~~ **已决**（§5.5 / §5.8）：
   Pause 文件对（.pt + .config.json）：跟随 task 一起删（resume / 取消 / 删除 task 任一时刻），同一 task 任何时刻最多 1 对 pause 文件。
   周期 save 文件：UI 弹窗确认，默认保留。
5. ~~**过早暂停（train_loop 未启动）**~~ **已决**（§8.1）：
   UI 端暂停按钮在 task 进入 train_loop 之前**不显示**（用 `__EVENT__:train_loop_started` 事件门控）。API 端做 defense-in-depth 拒绝。

### 第二轮（三方 review 吸收）

6. ~~**术语 "冻结" 反直觉**~~ **已决**（§3 / 全文）：
   中文改 **挂起 / 恢复调度**，英文 hold / release（或 suspend / resume scheduling）。理由：挂起是计算机标准 suspend 术语，恢复调度带"调度"二字消歧义。
7. ~~**"继续训练" 命名不对称 + 跟 ResumeFieldPicker 撞**~~ **已决**：行内按钮统一改为 **恢复**。
8. ~~**§8.2 暂停超时默默降级 cancel = 用户惊吓**~~ **已决**（§4.3 / §8.2）：
   重新设计为"暂停过程 modal" 覆盖全流程——点暂停立刻锁屏 modal 显示进度，30s 超时让用户从 [再等 30s] / [强制取消] / [终止任务] 三选一。
9. ~~**config snapshot 解耦**~~ **已决**（§5.1 / §5.7 / §8.5）：
   pause 时同步写 `pause_step_<N>.config.json`，把当前训练实际在用的参数全 freeze。resume 严格用 snapshot，跟用户后续改的 version / preset / 外部 yaml 完全解耦。
10. ~~**modal 文案 "它" 指代不明**~~ **已决**（§4.4）：
    所有提及 running task 处直接用具体 `#{id} "{name}"`，radio + 主按钮文案联动。
11. ~~**挂起状态用 banner 还是 chip**~~ **已决**（§4.1）：
    仅用顶部 sticky banner，**不用 task chip 形式**——banner 是 UI 元素，不是 task 状态机。未挂起时不显示任何东西避免噪音。

### 第三轮（其他 review 反馈，未在本文档处理，留给 ADR / UI spec / v2）

PM 视角：
- 成功指标章节（落 ADR）
- feature flag / 灰度策略（落 ADR）
- per-task 子目录改造拆独立前置 PR（落 PR 拆分计划）
- `save_state_every` 默认值改非 0（独立 PR 评估）

User 视角：
- paused 行显示 step + loss（v2）
- 批量 pause / resume（v2）
- 挂起定时自动恢复（v2）
- paused 超 X 天提醒（v2）
- 首次跑训练 UI 推荐开 `save_state_every`（独立 PR）

Designer 视角：
- 状态徽章配色 / banner / 时间戳格式（UI spec 单独文档）
- a11y 细节（UI spec）
- 暂停 / 取消按钮颜色 + 顺序（UI spec）
- "等待恢复调度" 用紫色 chip 而非小字（UI spec）

---

## 11. 下一步

本文档定调后，可以拆 ADR + 实现 PR：
- ADR 落到 `docs/adr/000X-queue-pause-resume.md`，承袭本文档逻辑模型。
- 实现 PR 拆分见前次讨论的 workflow（spike → 后端骨架 → API → cmd → UI → 文档）。
- 实现前先跑 Windows 信号 spike，确认 `CTRL_BREAK_EVENT` → `SIGBREAK` → handle_interrupt 链路通。
