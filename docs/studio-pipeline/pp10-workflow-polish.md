# PP10 — 工作流打磨：副本 / 并行 / 校验 / 解锁

**状态**：📝 plan 待讨论
**前置依赖**：PP6 已合（version 私有 config、project_jobs、Train 页）
**范围**：4 个独立的 UX/调度优化，互相不耦合，可分别切片单独 commit

| 子片 | 范围 | 难度 |
|---|---|---|
| PP10.1 | 新建 version 时从老 version 做副本（前端 UI + 全量复制 train/reg/config/解锁状态）| 小 |
| PP10.2 | 队列并行：训练任务与数据准备任务可同时跑 | 中 |
| PP10.3 | SchemaForm 数字字段 onBlur 校验（修「0.05 第二个 0 卡住」）| 小 |
| PP10.4 | 项目控制字段「解锁」按钮（per-field unlock，把强制覆盖关掉）| 小 |

---

## PP10.1 — 新版本从老版本做副本

### 问题
建新 version 时只能从空开始；用户做完一次「下载 → 筛选 → 打标 → 正则集」之后想试不同训练参数，每个 version 都要重做一遍。reg 是整个流水线最耗时的阶段（booru 拉几百张图 + auto_tag），最该被复用。

### 现状
- 后端 `versions.create_version(...)` 已经有 `fork_from_version_id` 参数（`studio/versions.py:106`），用 `_copytree_train` 递归 copy `train/`，并把 `config_name` 字段继承到新 version 行。
- API `POST /api/projects/{pid}/versions` 已经把这个参数透传（`studio/server.py:331-340, 471-477`，`VersionCreate.fork_from_version_id`）。
- **前端没用上**：`NewVersionDialog`（`studio/web/src/pages/project/Layout.tsx:219`）只收 `label` 一个字段，调 `api.createVersion(pid, { label })`。
- 后端复制目前只覆盖 `train/` 和 `config_name` 字段；`config.yaml` / `reg/` / `samples/` / `output/` / `monitor_state.json` / `.unlocked.json` 都不复制。

### 定稿方案：全量复制（除训练产物外的所有用户产物）

**复制对象**

| 目录 / 文件 | 是否复制 | 说明 |
|---|---|---|
| `train/`（图片+caption）| ✅ | 已有逻辑 |
| `reg/`（含 meta.json）| ✅ **新增** | 最耗时的阶段，全量复制；用户想重做可在正则页点「清理」 |
| `config.yaml`（PP6.2 version 私有训练配置）| ✅ **新增** | 复制后强制刷新项目特定路径 |
| `.unlocked.json`（PP10.4 解锁状态）| ✅ **新增** | 跟随复制（同 project 内字段语义不变，安全）|
| `samples/` | ❌ | 训练产物，无意义 |
| `output/` | ❌ | 训练产物 |
| `monitor_state.json` | ❌ | 训练运行时状态 |
| `config_name`（DB 字段）| ✅ | 已有逻辑 |

**stage 推进**：fork 时新 version 的 `stage` 跟随源 version。源 stage ∈ `{done, training}` 时新 version 落 `ready`（重新进入待训练态）；其他 stage 直接拷过来。

**前端**
- `NewVersionDialog` 加一个 `<select>`：「从空白开始 / 从 {label1} 复制 / 从 {label2} 复制 / …」，默认空白。
- 当前项目至少有 1 个 version 时下拉才显示选项；首个 version 不显示下拉。
- 选中源 version 时下方一行 hint：「将复制 train/、reg/、训练配置和解锁状态（output/、samples/ 不复制）。」
- 调 `api.createVersion(pid, { label, fork_from_version_id })`。

**后端 `versions.create_version` 扩展**
- 现有 `_copytree_train` 通用化为 `_copytree`（递归 copy；Win 不用硬链接，沿用 `shutil.copy2`）。
- 复制顺序：`train/` → `reg/`（存在才复制）→ `config.yaml`（存在才复制）→ `.unlocked.json`（存在才复制）。
- 复制完 `config.yaml` 后**立即调一次** `version_config.write_version_config(p, new_v, cfg, force_project_overrides=True)` 重写，把 `data_dir / reg_data_dir / output_dir / output_name` 刷成新 version 的路径。`reg_data_dir` 由 `project_specific_overrides` 自动算（它检查新 version 的 `reg/meta.json` 是否存在 → 复制后存在 → 自动指向新路径）。
- stage：源 stage ∈ `{done, training}` → 新 version 落 `ready`；其他 stage 直接 copy。

### 风险 / 边界
- 复制 `train/` + `reg/` 在大数据集上慢（合计可能 2-4 GB）；PP1 已决定 Win 不用硬链接，统一 `shutil.copy2`，可接受。
- 复制 config 后 `data_dir / reg_data_dir / output_dir / output_name` 必须强制覆盖到新 version 路径，否则训练会跑去旧 version 的 train/，污染对照实验。落到 `write_version_config(..., force_project_overrides=True)`。
- `.unlocked.json` 列里的字段是项目特定字段（`resume_lora` 等），跟具体 version 无关，复制是安全的。
- 源 version 和新 version 必须同 project（已有约束 `versions.create_version` 行 132-135）。
- stage 跟随源时新 version 的 `created_at` 仍然是新的 → version tabs 排序正确。

### 切片
单一 commit：
- 后端 `versions.create_version`：全量复制 + stage 跟随 + config 路径强制覆盖。
- 前端 NewVersionDialog 加下拉。
- 测试 case：(1) fork 后 train/ 、reg/ 、config.yaml 、.unlocked.json 都存在；(2) config.yaml 里 data_dir / reg_data_dir / output_dir 指向新 version 路径；(3) 源 stage=done → 新 stage=ready，源 stage=tagging → 新 stage=tagging。

---

## PP10.2 — 队列并行：训练 ∥ 数据准备

### 问题
现在所有任务（download / tag / reg_build / training）都在 supervisor 单进程串行跑。训练一个 LoRA 要几小时，期间下一个项目的下载、打标都堵在队列里。用户希望「炼第一个的时候同时给第二个项目下载、打标」。

### 现状
- `studio/supervisor.py` 单 `_current_proc` / `_current_kind` / `_current_id`（行 153-160），同一时刻只有一个子进程在跑。
- `_tick()` 调度顺序：先 `project_jobs.next_pending`（download/tag/reg_build），再 `db.next_pending`（training tasks）—— 数据准备**优先**，但仍然是串行（行 280-298）。
- 取消逻辑围绕单 `_current_proc` / `_current_kind`（`cancel`、`cancel_job`、`_signal_terminate_async`）。
- 进程结束后 `_finish_current` 清掉 4 块状态字段（proc/kind/id/log_fp/tailer）。

### 改造方案

核心思路：把 supervisor 改成「多槽位调度器」。每个槽位独立：自己的 `_current_proc` / 状态字段 / log tailer / cancel 路径。

#### 推荐方案：双槽位（training 槽 + data 槽）

**槽位定义**
| 槽位 | 接的活 | 资源画像 |
|---|---|---|
| TRAIN | `tasks` 表（训练）| 长任务、占满 GPU |
| DATA  | `project_jobs` 表（download / tag / reg_build）| 短任务、CPU+IO 为主，tag/reg_build 也吃 GPU |

**调度策略**
- TRAIN 槽空 → 拉一条 pending task。
- DATA 槽空 → 拉一条 pending job；但**如果 TRAIN 槽正在跑且新 job 是 GPU-bound（tag、reg_build）**，先看 settings 里的开关 `allow_gpu_during_train`：默认 **off**（保守，避免抢显存 OOM），用户在 Settings 里勾上才并行。download job 不受这个限制（IO-only）。
- 「GPU-bound」判定：job.kind ∈ `{tag, reg_build}` 当作 GPU；download 当作 CPU。reg_build 实际 90% 时间在 booru 拉图（IO），但末尾的 auto_tag 阶段才吃 GPU——粒度不够细，先按整 job 标 GPU-bound 处理。如果之后觉得太保守，再拆 reg_build 的 phase。

**取消 / 终止改造**
- `cancel(task_id)` 只看 TRAIN 槽。
- `cancel_job(job_id)` 只看 DATA 槽。
- `Supervisor.stop()` 同时终止两个槽。
- `_signal_terminate_async` 改成参数化：`_signal_terminate_async(slot)`。

**SSE / event 不变**
- 前端 Queue 页和 project_jobs 那条 SSE 消息已经是 per-task / per-job 区分的，多槽位不影响订阅契约。

**字段重构（实现层）**
当前 `_current_*` 5 个字段抽成一个 `_Slot` 内部类：
```
class _Slot:
    proc / kind / id / log_fp / tailer / state_poller / cancel_pending
```
然后 `Supervisor` 拥有 `self._train_slot` 和 `self._data_slot`。每个 `_tick` 轮询两个槽各自的 `proc.poll()`，独立结束。

#### 候选 B：通用 N 槽位 + 资源标签

**做法**：每个 worker 声明所需资源（`gpu`、`cpu`、`io`）；槽位池按资源画像匹配。

**优点**：以后加 sample preview / 第二张 GPU 都能复用。

**缺点**：第一版过度抽象。当前只有「GPU 训练」「IO 下载」「GPU 打标」三类，明确双槽足够。

**结论**：先双槽（推荐方案），架构上把 `_Slot` 抽成可扩展的列表（一个 `list[_Slot]`），以后想加第三槽（比如 sample preview 槽）只是 append 一个槽 + 调度规则。

#### 候选 C：完全独立的两个 supervisor 线程

**做法**：起两个 `Supervisor` 实例，一个只看 tasks 一个只看 project_jobs。

**优点**：代码改动最少。

**缺点**：两份 `_loop` / `_reconcile_orphans` 重复；两个线程读同一 SQLite 的并发锁需要小心；`stop()` 协调要写两遍。**不推荐**。

### 风险 / 边界
- **GPU 显存抢占**：训练 anima 一般占 14-22 GB（4090 24G），WD14 onnxruntime-gpu 占 1-2 GB；同时跑可能 OOM 或大幅降速。**默认 off** 是关键防线。Settings 页加一行开关 + 风险提示。
- **磁盘 IO 抢占**：训练读 train/ 是顺序读 + 缓存住，下载是写 `download/`，互不冲突。可忽略。
- **日志文件互不冲突**：每个 task / job 自己一份 log，已经分开（`logs/{task_id}.log` / `jobs/{job_id}.log`），没问题。
- **重启恢复**：`_reconcile_orphans` 已分别清 tasks 和 project_jobs（行 257-278），双槽不影响这套逻辑。
- **测试**：现有 `test_supervisor.py` 注入 `cmd_builder` 模拟，需要新增 1-2 个并发 case（同时 spawn 一个 task 和一个 download job）。

### 切片
- **PP10.2.a**：把 supervisor 单槽位重构成 `_Slot` + `_slots: list[_Slot]`，先不开并行（仍只有一个槽）。验证测试不挂。
- **PP10.2.b**：加第二槽 + 调度策略（download 总并行、tag/reg_build 看 settings 开关）。Settings 页加开关 UI。新增 2 个测试。

两个 commit。10.2.a 是纯重构、风险低；10.2.b 是行为改动。

---

## PP10.3 — SchemaForm 数字字段 onBlur 校验

### 问题
表单里输入 `0.05`，敲到第二个 `0`（即输入框内容是 `0.0`）时，`parseFloat("0.0") === 0`，state 重置成 `0`，受控 `<input>` 重新渲染显示 `"0"`，用户键入的小数点被吞掉，再也输不进 `0.05`。用户描述「强制到 1」对应的可能是 `min={prop.minimum}` HTML5 约束的视觉表现。

### 现状
`studio/web/src/components/Field.tsx:144-172` int / float 分支：
```tsx
<input
  type="number"
  step={kind === 'int' ? 1 : 'any'}
  value={value === null || value === undefined ? '' : String(value)}
  min={prop.minimum} max={prop.maximum}
  onChange={(e) => {
    const raw = e.target.value
    if (raw === '') { onChange(prop.default); return }
    const num = kind === 'int' ? parseInt(raw, 10) : parseFloat(raw)
    if (!Number.isNaN(num)) onChange(num)   // 每次按键都立即父 onChange
  }}
/>
```
父 `SchemaForm.onChange → setConfig(...)` 每次都会触发整树重渲染，受控组件的 value 永远来自数字 → 字符串，丢了「输入中状态」。

### 改造方案

#### 推荐方案：Field 内部维护 raw 字符串缓冲，blur/Enter 时提交

```tsx
const [raw, setRaw] = useState<string>(() => formatNum(value))
useEffect(() => {
  // 外部 value 变化（比如 reset / fork preset）时同步缓冲
  setRaw(formatNum(value))
}, [value])

<input
  type="text"            // 改成 text 或 number 都可；text 更宽容
  inputMode="decimal"    // 移动端键盘
  value={raw}
  onChange={(e) => setRaw(e.target.value)}      // 只更新本地
  onBlur={() => commit()}
  onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
/>

function commit() {
  if (raw === '') { onChange(prop.default); setRaw(formatNum(prop.default)); return }
  const num = kind === 'int' ? parseInt(raw, 10) : parseFloat(raw)
  if (!Number.isNaN(num)) onChange(num)
  // 失败：丢回 raw=''→default，或者保留红边显示「不合法」。先简单：丢回原值。
  else setRaw(formatNum(value))
}
```

注意点：
- **type 改成 `text` + `inputMode="decimal"`**：避免浏览器 `type=number` 的内置规整（Firefox 会阻止用户输 `0.0`，Chrome 不会但 valueAsNumber 行为不同）。也避开 HTML5 `min/max` 自动 clamp。
- **min / max 改成手动校验**：commit 时若超出范围，blur 后 onChange(clamp(num)) + 提示。或者只在 SaveBar 提交时整体校验。第一刀**先不 clamp**，让用户填什么就填什么；schema 校验由后端 `TrainingConfig` 兜底（`write_version_config` 已经走 pydantic）。前端只做转换。
- **空字符串行为**：用户清空想用 default。当前是立即写 default，新方案改成 blur 时才写。提示更平滑。

#### 候选 B：保留 onChange 但加防抖（debounce 300ms）

**做法**：`onChange` 用 `useDeferredValue` 或 lodash debounce。

**缺点**：仍然受 value 字符串化截断（debounce 不解决根因，只是把闪回延迟）。**不推荐**。

#### 候选 C：用三方表单库（react-hook-form / formik）

**远超本次范围**，整套 SchemaForm 重写。**不考虑**。

### 风险 / 边界
- 同一个 Field 既有 path 字符串又有 number；`PathStringField` 不受影响（已经是 text）。
- string-list（textarea）也是 onChange 立即更新；用户没抱怨过——保持不变。
- 单元测试：`Field.test.tsx` 还没有，可以新增 1 个测试覆盖「输入 0.05 不被截断」。

### 切片
单一 commit。改 `Field.tsx` 的 int/float 分支 + 加 1-2 个 vitest case。

---

## PP10.4 — 项目控制字段「解锁」按钮

### 问题
Train 页里 `data_dir / reg_data_dir / output_dir / output_name / resume_lora / resume_state` + 全局 model 路径都是 disabled 状态。用户偶尔需要改：比如 `resume_lora` 想接续训练（spec 里写「除非用户显式 PUT 改写」但 UI 没给入口），或者 `output_name` 想改 LoRA 文件名。需要每条字段一个解锁按钮，点击后变成可编辑。

### 现状

**前端**
- `studio/web/src/components/SchemaForm.tsx` 透传 `disabledFields: string[]` 给 Field。
- `studio/web/src/components/Field.tsx:38` 渲染「自动 · 项目控制」徽章；input 全禁。
- `studio/web/src/pages/project/steps/Train.tsx:62-68`：`disabledFields = [...project_specific_fields, ...GLOBAL_MODEL_FIELDS]`。

**后端**
- `studio/services/version_config.py` 的 `write_version_config(force_project_overrides=True)`（行 113-138）会用 `project_specific_overrides(p, v)` 强制覆盖 `PROJECT_SPECIFIC_FIELDS`。**这意味着前端就算把字段改了，存盘时也会被服务器盖掉。**所以解锁不只是前端事，得有一份「该 version 用户已解锁的字段」状态。

### 改造方案

#### 推荐方案：version 级 `unlocked_fields` 数组，前端 + 后端共同尊重

**数据**
- 在 version 私有 config.yaml 里加一个 meta key（不进入 TrainingConfig schema 校验）。最简：在 yaml 顶部加一段注释或单独的旁路文件 `versions/{label}/.unlocked.json`。
  - **更干净的选择**：旁路文件 `versions/{label}/.unlocked.json`，内容是 `{"fields": ["resume_lora", "output_name"]}`。schema 不动，pydantic `extra=forbid` 不破。
- API：`GET /api/projects/{pid}/versions/{vid}/config` 返回 `{has_config, config, project_specific_fields, unlocked_fields}`。
- 新端点：`POST /api/projects/{pid}/versions/{vid}/config/unlock` body `{field: "resume_lora"}`；`POST /.../lock` 反向。

**后端 `write_version_config` 逻辑**
- `force_project_overrides=True` 时：用 `project_specific_overrides` 但跳过 `unlocked_fields` 列表里那几个，让用户值生效。
- pseudo：
  ```python
  overrides = project_specific_overrides(p, v)
  for f in unlocked_fields(p, v):
      overrides.pop(f, None)
  payload.update(overrides)
  ```

**前端**
- Field 组件已经接收 `disabled` + `disabledHint`。新增 prop `onUnlock?: () => void`。
- 当 `disabled=true` 且 `onUnlock` 给了，徽章右边加一个小按钮「🔓 解锁」。点击 → 调 `api.unlockField(pid, vid, name)` → setUnlockedFields → 重新计算 disabledFields（从 disabledFields 里去掉这个 name）。
- 解锁的字段右上角换成「⚠️ 已解锁」徽章，提示「保存时不会用项目路径覆盖」；旁边给「🔒 重新锁定」按钮。
- 全局 model 字段（`transformer_path` 等）**不**走解锁路径——那些是用户在 Settings 里改的源头，Train 页解锁了存到 version config 也没有意义（且新建 version 后又会被覆盖回去）。所以解锁只对 `PROJECT_SPECIFIC_FIELDS` 开放。

#### 候选 B：全局解锁开关（一个按钮把六个字段全打开）

**优点**：UI 简单。

**缺点**：用户大多数场景只想改 1 个字段（比如 `resume_lora`），全开后下次保存把所有字段都按用户值落盘，路径错位风险高。**不推荐**。

#### 候选 C：在 yaml 里加 `# unlock: resume_lora` 注释行

**优点**：零端点改动。

**缺点**：注释靠 yaml round-trip 保留；pydantic 走 dict 之后注释丢失。**不推荐**。

### 风险 / 边界
- **解锁后的字段不再被项目重命名跟随**：比如解锁了 `output_dir` 后，用户改 project slug（PP1 决定 slug 不可改，所以这个风险其实不存在），路径也不会自动跟。OK。
- **`resume_lora` 解锁是常见用法**：用户接续训练时填上一次的 `_final.safetensors` 路径。让这条 work 起来很有价值。
- **fork preset 后 unlocked 状态怎么办**：换预设时 `.unlocked.json` 应该被清掉（重置成默认锁住所有项目字段）。fork_preset_for_version 那条路径加一行 unlink。
- **从老 version 复制（PP10.1）后 unlocked 状态怎么办**：建议**不**复制 `.unlocked.json`，新 version 默认全锁；用户自己再开。
- **测试**：新增 2-3 个测试：unlock + write 后字段保留用户值；lock 后字段被重新覆盖；fork preset 清空 unlocked。

### 切片
单一 commit：旁路文件 + 2 个端点 + Field 加按钮 + Train 页传 onUnlock + 几个测试。比 PP10.1/10.3 略大但仍单 PR。

---

## 实施顺序建议

1. **PP10.3 数字 onBlur**（小、独立、立即受益）
2. **PP10.1 副本 version**（小、独立、与 10.3 不耦合）
3. **PP10.4 解锁按钮**（小、改动后端但隔离在 version_config）
4. **PP10.2 队列并行**（中、唯一动 supervisor 的、放最后）

每片单独 commit + 手测，按 [workflow.md](../../C:/Users/Mei/.claude/projects/G--AnimaLoraToolkit/memory/workflow.md) 里「PP 之间不混 commit」的约定走。

## 不做的事

- **训练中实时调参**（PP6 已经决定不支持，入队即锁定 config 副本）。
- **多 GPU 并行训练**（不在本次范围；只是单 GPU 上「训练 + 数据准备」并行）。
- **跨 version 共享 reg/**（spec 决定 reg 跟 train 走，不复用；PP10.1 候选 B 也不做）。
- **解锁全局 model 路径**（值的源头在 Settings，不在 version 维度暴露解锁）。
