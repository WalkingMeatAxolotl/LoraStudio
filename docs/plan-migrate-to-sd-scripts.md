# 切换到 kohya-ss/sd-scripts — 影响面与改动清单

> 目标：把 `anima_train.py` 替换为 sd-scripts 的 `anima_train_network.py`，评估影响范围与必须改动。
>
> 与 `plan-migrate-to-lycoris.md` 是**互斥方案**——切 sd-scripts 后无需再切 lycoris-lora（sd-scripts 自带 LoKr/LoHa 实现）。
>
> 工时估算：**3-5 周**（远高于切 lycoris 的 4-5 天）

---

## 0. 你的假设核对

| 你的假设 | 结论 | 备注 |
|---------|------|------|
| ① 只需要变更训练模块 | **部分正确** | 训练模块替换 + schema 重做 + 启动接口适配 |
| ② 现有训练集相关都不受影响 | **基本正确** | 数据集目录约定一致；caption 格式需小调 |
| ③ SSE 监控和日志需要重做 | **完全正确，且是最大工作量** | sd-scripts 不写 monitor_state.json，需要重做进度协议 |

---

## 1. Studio ↔ 训练 当前耦合面（已扫描）

仓库中 Studio 与训练脚本通过 **5 个文件接口** 解耦，无函数级调用：

| 接口 | 文件 | 当前协议 |
|------|------|---------|
| 启动命令 | `studio/supervisor.py:39-50` | `subprocess: python anima_train.py --config X.yaml --monitor-state-file Y.json` |
| 训练配置 | `versions/{label}/config.yaml` | `studio/schema.py:TrainingConfig` 字段直接 dump |
| 进度状态 | `versions/{label}/monitor_state.json` | anima_train 写，Studio 轮询 mtime |
| 训练日志 | `studio_data/logs/task_*.log` | anima_train stdout 重定向，Studio `LogTailer` 行级追加 |
| 采样图 | `versions/{label}/output/samples/*.png` | anima_train 写，Studio HTTP 代理 |
| 断点续训 | `state.pt`（自定义格式） | anima_train 自己读写，Studio 仅传路径 |

**关键事实**：Studio 完全是**被动消费方**，所有训练侧产物都是文件。这意味着切换训练后端 = 重新定义这 5 个接口的协议。

---

## 2. 改动清单（按"是否受影响"分类）

### 🟢 完全不受影响（可保留）

| 模块 | 为什么不受影响 |
|------|--------------|
| 项目管理（`studio/projects.py`、`studio/versions.py`） | 与训练实现无关 |
| 数据库层（`studio/db.py`、migrations） | 表结构与训练后端无关 |
| 数据集目录扫描（`studio/datasets.py`） | sd-scripts **同样使用** Kohya 风格 `N_xxx` 子目录 + `repeat` 语义，**完全兼容** |
| 数据集上传/管理（`studio/services/uploads.py`） | 文件操作，与训练后端无关 |
| 打标管线后端（WD14 / JoyCaption / `services/tagger.py` 等） | 输出 caption 文件即可，不依赖训练 |
| 缩略图缓存（`thumb_cache.py`、`browse.py`） | 与训练无关 |
| 标签编辑（`services/tagedit.py`、`web/components/TagEditor`） | 编辑文件级 caption，与训练无关 |
| 模型下载器（`services/model_downloader.py`） | 通用文件下载 |
| 正则集生成（`services/reg_builder.py`、`reg_postprocess.py`） | 输出 `reg/` 目录格式，sd-scripts 同样能读 |
| 任务队列调度（`supervisor.py` 主循环） | 通用 subprocess 管理，命令构造可换 |
| 事件总线（`event_bus.py`） | 通用 pub/sub，与训练后端无关 |
| 前端整体框架（`web/`） | 大部分页面（项目列表、数据集、打标、版本切换）不受影响 |

### 🟡 需要适配（中等改动）

| 模块 | 改动 |
|------|------|
| `studio/schema.py:TrainingConfig` | **整张 schema 重写**：sd-scripts 字段名、单位、默认值与我们当前完全不同（如 `--learning_rate` vs `learning_rate`、`--mixed_precision bf16` vs `precision: bf16`）。约 80+ 字段需要逐个映射 |
| `studio/argparse_bridge.py` | 当前是 schema → argparse 互转；sd-scripts 用 **TOML 配置 + CLI args 双层**，需要重写为 schema → TOML（dataset config）+ CLI args（训练 args）的双输出 |
| `studio/supervisor.py:_default_cmd_builder` | 命令构造改为 `accelerate launch sd-scripts/anima_train_network.py --config_file <toml> --dataset_config <toml> ...`。涉及 `accelerate` 配置文件预生成 |
| `studio/services/version_config.py` | 改为生成两个 TOML（训练 config + dataset config），不再写单一 YAML |
| Caption 格式 | sd-scripts 只读 `.txt`（同名），**不读 JSON**。需要确认打标管线落 `.txt`（已有）；若用户用 JSON caption，需要在训练前导出 `.txt` 快照 |
| 数据集 `meta.json`（正则集标志） | sd-scripts 用 TOML 配置声明 reg 目录，不依赖 meta.json；保留 meta.json 作为 Studio 内部用 |
| 前端 LoRA 配置面板（`web/src/components/SchemaForm.tsx` 渲染） | schema 重写后字段全变，UI 自动跟随但需要重新分组/排版 |
| 测试套件（`tests/test_studio_configs.py`、`test_argparse_bridge.py`） | 全部需要重写 |

### 🔴 必须重做（最大工作量，符合你的假设 ③）

| 模块 | 当前机制 | sd-scripts 实际情况 | 改动 |
|------|---------|---------------------|------|
| **进度监控** (`monitor_state.json`) | anima_train 调 `update_monitor()` 写 JSON，含 epoch/step/loss/lr/sample_path/ETA 等结构化字段 | sd-scripts **完全不写此文件**；只在 stdout 打印 tqdm 进度条 + `accelerator.log()` 调用（默认到 tensorboard） | **必须重写**。两条路：<br>① 写一个 stdout 解析器（脆弱，tqdm 输出格式可能变）<br>② Fork sd-scripts 加一个 `--monitor_state_file` patch（可维护但脱离上游） |
| **Sample 图监控** | anima_train 在 `update_monitor(sample_path=...)` 中报告新出图 | sd-scripts 写到 `{output_dir}/sample/<name>_<step>.png`，但**不报告事件** | Studio 的 `MonitorStatePoller` 改为**目录扫描**：watch `output/sample/` 文件新增 |
| **断点续训** | `state.pt` 含 `lora_state_dict + optimizer + RNG + monitor_state` | sd-scripts 用 accelerate 的 `save_state()` 写多文件目录（`pytorch_model.bin`、`optimizer.bin`、`scheduler.bin`、`random_states_*.pkl`），格式完全不同 | **state.pt 概念彻底废弃**，改为传 sd-scripts 的 `--resume <dir>` 路径；Studio 不再持有"resume 状态"的概念性所有权 |
| **`studio/log_tail.py:LogTailer`** | 行级追加日志 | 通用，但需要**新增一层 stdout 解析**抽出 step/loss 推给 EventBus（替代当前 monitor_state.json 推送） | 新增 `SdScriptsProgressParser`，订阅 LogTailer 输出，正则匹配 `steps:  XX% \| step=N loss=XX.X` 之类，转发为 SSE `monitor_state` 事件 |
| **EventBus 事件协议** | 当前 SSE 事件有 `monitor_state_updated`、`task_log_appended` 等 | 协议不变，但 `monitor_state_updated` 的数据来源从"读 JSON 文件"改为"解析器实时构造" | EventBus 自身不变，**生产者改了** |
| **前端监控页面** (`web/src/components/JobProgress.tsx` 等) | 消费 SSE 事件渲染 | 协议保持兼容时**前端不动**；如果字段精度/频率变化可能要调显示 | 优先保协议兼容 |

---

## 3. 数据集兼容性细查（你的假设 ②）

### ✅ 完全兼容的部分

```
{version}/train/
  10_character_name/    ← Kohya 风格 N_xxx，repeat=10，sd-scripts 一样支持
    img001.jpg
    img001.txt
    img002.jpg
    img002.txt
{version}/reg/          ← 正则集独立目录，sd-scripts 通过 dataset TOML 声明
  1_character_name/
    reg001.jpg
    reg001.txt
```

- **`N_xxx` repeat 语法**：anima_train 与 sd-scripts 完全一致 ✓
- **`reg/` 独立目录**：sd-scripts 在 dataset TOML 里写 `is_reg = true` 即可 ✓
- **图片扩展名**：`.jpg/.jpeg/.png/.webp/.bmp` 双方都支持 ✓
- **caption_extension**：`.txt` 双方都支持 ✓

### ⚠️ 需要一次性验证的部分

| 项 | 我方现状 | sd-scripts 期望 | 行动 |
|---|---------|----------------|------|
| Caption 文件 | 同时存在 `.json` 和 `.txt`（打标管线产 `.json`，导出器产 `.txt`） | 只读 `.txt` | 确认打标流程结束后**总是**生成 `.txt` 快照（`services/caption_snapshot.py` 已经在做） |
| `meta.json`（正则集标记） | 我方 schema 用它判断 `reg/` 是否启用 | sd-scripts 不读 | 保留作为 Studio 内部状态，不影响训练 |
| 默认 caption 覆盖（`reg_caption` 字段） | anima_train 通过 `caption_override` 实现 | sd-scripts 用 `caption_dropout_every_n_epochs=0` + 在 dataset TOML 写 `class_tokens` | 转换语义 |
| `keep_tokens` | 我方 schema 字段 | sd-scripts 同名字段 | 直接映射 ✓ |
| `prefer_json` | 我方特有 | 不存在 | 字段废弃 |

**结论**：训练集相关 **不需要重新组织目录结构**，但 caption 格式需要确保 `.txt` 是 single source of truth。

---

## 4. SSE 监控重做的具体工作（你的假设 ③）

这是**最大且最容易出问题的工作量**。

### 当前流（保留 anima_train.py）

```
anima_train.py
  ↓ update_monitor(epoch=N, step=M, loss=X, lr=Y, sample_path=...)
  ↓ 写入 monitor_state.json
Studio MonitorStatePoller
  ↓ 检测 mtime 变化
  ↓ 整体读 JSON → publish("monitor_state_updated", state)
EventBus
  ↓ SSE 推送
前端 JobProgress 组件渲染
```

### 切到 sd-scripts 后的新流（两种方案）

#### 方案 A — stdout 解析器（无需改 sd-scripts）

```
sd-scripts/anima_train_network.py
  ↓ stdout: "steps: 12% | 120/1000 | loss=0.245 lr=1.0e-4 ..."
  ↓ stdout: "saving checkpoint to ..."
  ↓ stdout: "generating sample images..."
LogTailer（行级追加）
  ↓ 每行都送一份给 SdScriptsProgressParser
SdScriptsProgressParser
  ↓ 正则匹配进度行 → 构造 monitor_state dict
  ↓ publish("monitor_state_updated", synthetic_state)
EventBus → SSE → 前端
```

**优点**：完全不动 sd-scripts，pip 安装即可
**缺点**：
- tqdm 格式可能升级时变化，解析器易碎
- 拿不到 anima_train 现有的丰富字段（如 `loss_history`、`sample_history`、ETA）
- 进度更新频率受 tqdm refresh 影响

**工作量**：3-5 天写 + 测试

#### 方案 B — Fork sd-scripts 加监控 hook

```
sd-scripts (我们的 fork)
  ↓ 加一个 --monitor_state_file 参数
  ↓ 训练循环里每 N step 写 monitor_state.json
  ↓ （和 anima_train 当前行为一致）
Studio MonitorStatePoller（保持不变）
```

**优点**：
- 协议与现状完全一致，Studio 端零改动
- 字段丰富、稳定

**缺点**：
- 维护一个 sd-scripts fork（每月 rebase）
- 失去"装 pip 即用"的便利

**工作量**：2 天写 patch + 长期 rebase 维护成本

#### 方案 C（折中） — 提交 PR 给上游

向 sd-scripts 提一个 `--monitor_state_file` 选项的 PR；在合并前用方案 B，合并后自动转方案 A 等价物。

---

## 5. 总工作量分解

| 阶段 | 内容 | 工时 |
|------|------|------|
| 1 | 安装 sd-scripts + 验证 anima_train_network.py 跑通（手动 CLI） | 1 天 |
| 2 | Schema 完全重写 + argparse_bridge 重写 + version_config 改 TOML 双输出 | 5-7 天 |
| 3 | supervisor 命令构造改写 + accelerate 配置生成 | 1-2 天 |
| 4 | SSE 监控重做（方案 A 或 B） | 3-5 天 |
| 5 | Sample 图目录扫描替代 monitor_state | 1-2 天 |
| 6 | 断点续训路径机制改造（state.pt 废弃） | 1-2 天 |
| 7 | Caption 格式验证 + `services/caption_snapshot.py` 调整 | 1 天 |
| 8 | 测试套件全部重写 | 3-4 天 |
| 9 | 前端 LoRA 配置面板字段调整 + 文档 | 2-3 天 |
| 10 | 完整端到端回归（Studio → 训练 → 监控 → ComfyUI 加载） | 2-3 天 |
| **合计** | | **~3-5 周** |

---

## 6. 何时应该选 sd-scripts 而非 lycoris

切 sd-scripts 的**唯一合理理由**是：你想要这些 sd-scripts 独有的能力，而 lycoris 给不了：

| 能力 | 切 sd-scripts | 切 lycoris |
|------|--------------|-----------|
| LoHa | ✓ | ✓ |
| DoRA | ✓ | ✓ |
| LoKr 完整参数 | ✓ | ✓ |
| **多 GPU (accelerate)** | ✓ | ✗（自实现需要重做训练循环） |
| **`--blocks_to_swap` VRAM offload** | ✓ | ✗（anima_train.py 不支持） |
| **Adafactor + fused backward** | ✓ | ✗ |
| **`--unsloth_offload_checkpointing`** | ✓ | ✗ |
| **多种 timestep 采样**（sigma/sigmoid/shift/flux_shift） | ✓ | ✗ |
| **多种 loss**（l1/l2/huber/smooth_l1） | ✓ | ✗ |
| **per-module rank/lr** (`network_reg_dims`) | ✓ | 需自实现 |
| **kohya 团队持续更新** | ✓ | ✗ |

**反过来——你会失去**：
- AnimaLoraStudio 的 `state.pt` 简洁断点续训语义
- `update_monitor()` 主动推送的丰富监控字段
- 自己写训练循环带来的灵活性（如未来想加自定义 loss/sampler）
- Studio 作为"端到端流水线"的产品定位（变成"sd-scripts 的 Web GUI"）

---

## 7. 推荐路径

| 你的优先级 | 推荐 |
|-----------|------|
| 想要更多算法（LoHa/DoRA），保持产品形态 | **切 lycoris**（4-5 天，已有 plan） |
| 想要 VRAM 优化 + 多 GPU + 上游持续更新，接受产品形态转变 | **切 sd-scripts**（3-5 周，本文档） |
| 不确定 | 先切 lycoris 试水（成本低、可逆），3 个月后再评估是否需要 sd-scripts |

---

## 8. 如果决定走 sd-scripts，需要先决策

1. ⬜ **方案 A（stdout 解析）vs 方案 B（fork sd-scripts）vs 方案 C（PR 上游）**
2. ⬜ AnimaLoraStudio 是否重新定位为"sd-scripts 的 Web GUI"（影响产品文档与 README）
3. ⬜ 是否一并废弃自定义 `state.pt`，只支持 accelerate save_state 目录
4. ⬜ 多 GPU 支持优先级（如果不需要，accelerate 单卡配置可极简化）
5. ⬜ 老 ckpt 是否做迁移（建议**不做**，理由同 lycoris plan：新分支干净起步）
6. ⬜ 工作分支命名（建议 `feat/sd-scripts-backend`）
