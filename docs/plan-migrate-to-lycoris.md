# 迁移到 lycoris-lora 库 — 实施计划

> 目标：把 `anima_train.py` 中的 `LoRALayer` / `LoKrLayer` / `LoRALinear` / `LoRAInjector` 替换为 `lycoris-lora` 包，保留 Anima 训练循环、Studio 后端、断点续训、监控等所有非适配器逻辑。
>
> 工作分支：**`feat/lycoris-migration`**（独立分支，PR 回 master）
>
> 预估工时：**4-5 个工作日**（不含老 ckpt 迁移与 Conv2d）
>
> 风险等级：**低-中**（无老 ckpt 兼容包袱后风险下降）

---

## 0. 前置兼容性确认（已完成）

| 检查项 | 结论 |
|--------|------|
| `LycorisNetwork(module, ...)` 接受任意单一 `nn.Module` | ✓ 验证（`lycoris/wrapper.py`） |
| 不依赖 SD/SDXL pipeline 结构 | ✓ 接受 DiT |
| `target_name` 接受我们当前的层名列表 | ✓ fnmatch + regex 都支持 |
| 通过 `apply_preset({...})` 自定义层选择 | ✓ |
| 不强制使用 PRESET 字典里的 SD 预设 | ✓ 可绕过 |
| 与 PyTorch 标准 `state_dict` 互操作 | ✓ |
| 依赖体积 | 纯 Python，~200KB，仅依赖 `einops`/`safetensors`/`torch`（已安装） |

**结论：可以集成，无需 fork。**

---

## 1. 范围与不动产

### 改动范围（必动）

| 文件 | 当前内容 | 改动 |
|------|---------|------|
| `anima_train.py:875-1100` | `LoRALayer` / `LoKrLayer` / `LoRALinear` / `LoRAInjector` 定义 | 删除自实现，替换为 lycoris API 调用 |
| `anima_train.py:1030-1060` | `save_lora()` | 改用 lycoris state_dict + 我们的 metadata 包装 |
| `anima_train.py:1065-1100` | `load_lora()` | 改用 lycoris state_dict 加载 + 老格式兼容 |
| `anima_train.py:1130-1150` | resume 中的 lora 加载 | 同上 |
| `anima_train.py:2130-2255` | 训练循环中的注入 + optimizer 参数组 | 适配新 API |
| `studio/schema.py:117-136` | `lora_type` / `lokr_factor` 字段 | 扩展为完整 LyCORIS 配置 |
| `studio/schema.py` 相关 UI 元数据 | 字段说明、show_when | 扩展 |
| `tests/test_studio_configs.py` + `tests/test_argparse_bridge.py` | 配置序列化测试 | 补字段 |
| `pyproject.toml` / `requirements.txt` | 依赖列表 | 加 `lycoris-lora>=3.0` |

### 不动产（保护边界）

- Anima 模型加载（`load_qwen_image_dit` 等）
- Flow Matching 训练循环
- ARB 分桶
- 优化器选择（AdamW/AdamW8bit/Prodigy/Adafactor）
- 断点续训的 `state.pt`（除 lora 部分）
- Studio 后端（除新字段）
- 打标管线、正则集、监控 SSE

---

## 2. 迁移阶段（按 commit 切分）

### Stage 1 — 依赖与最小集成（0.5 天）

**目标**：lycoris-lora 装上、能 import、能在 Anima 模型上 `create_lycoris()` 出一个 LoRA network 但不投产

**步骤**
1. `pyproject.toml`/`requirements.txt` 加 `lycoris-lora>=3.0`
2. 写一次性试跑脚本 `scripts/probe_lycoris_anima.py`：
   - 加载 Anima DiT
   - 调 `create_lycoris(model, algo="lokr", linear_dim=32, linear_alpha=16, factor=8, preset=None)` + 自定义 target_name
   - 打印命中的层数，对比当前 `LoRAInjector` 的 316 层
   - 打印一个 LoKr 模块的参数键名（确认 `lycoris_<...>.lokr_w1` 格式）
3. 不进入训练，仅验证

**Done 标准**：probe 脚本输出层数与当前实现一致（误差 ≤ 1，因 lycoris 可能多/少匹配几个 norm 层）

**Commit**：`chore: add lycoris-lora dependency + probe script`

---

### Stage 2 — 自定义 Anima preset（0.5 天）

**目标**：用一个 dict 定义 Anima 的层选择，作为 `apply_preset()` 输入

**步骤**
1. 新增 `anima_lora/lycoris_preset.py`：
   ```python
   ANIMA_PRESET = {
       "enable_conv": False,
       "unet_target_module": [],
       "unet_target_name": [
           "q_proj", "k_proj", "v_proj", "output_proj",
           "mlp.layer1", "mlp.layer2",
       ],
       "unet_exclude_name": ["llm_adapter*"],   # 维持当前跳过 llm_adapter 的语义
       "text_encoder_target_module": [],
       "text_encoder_target_name": [],
       "module_algo_map": {},   # 留作后续 per-module override
       "name_algo_map": {},
   }
   ```
2. probe 脚本切到 preset 模式验证

**Done 标准**：preset 命中层与 Stage 1 一致；`llm_adapter` 层被正确跳过

**Commit**：`feat(lokr): add Anima preset config for lycoris`

---

### Stage 3 — 替换适配器实现（1.5 天）

**目标**：`anima_train.py` 不再持有 `LoRALayer/LoKrLayer/LoRALinear/LoRAInjector` 自实现

**步骤**
1. 新增 `anima_lora/lycoris_adapter.py`，封装 lycoris 调用：
   ```python
   class AnimaLycorisAdapter:
       def __init__(self, args):
           self.algo = args.lora_type           # "lora" | "lokr" | "loha" | ...
           self.rank = args.lora_rank
           self.alpha = args.lora_alpha
           self.factor = args.lokr_factor
           self.dropout = args.lora_dropout
           self.use_dora = args.lora_dora
           self.rs_lora = args.lora_rs
           # ...
           self.network = None  # lazy

       def inject(self, model):
           self.network = create_lycoris(
               model,
               algo=self.algo,
               linear_dim=self.rank,
               linear_alpha=self.alpha,
               factor=self.factor,
               dropout=self.dropout,
               weight_decompose=self.use_dora,
               rs_lora=self.rs_lora,
               preset=ANIMA_PRESET,
           )
           self.network.apply_to()
           return self.network

       def get_param_groups(self, weight_decay):
           # 保留 w1 no-WD 优化（lycoris 默认不分组）
           if self.algo != "lokr" or weight_decay == 0:
               return [{"params": list(self.network.parameters()), "weight_decay": weight_decay}]
           no_decay, decay = [], []
           for module in self.network.loras:
               for n, p in module.named_parameters():
                   if "lokr_w1" in n and "lokr_w1_a" not in n and "lokr_w1_b" not in n:
                       no_decay.append(p)
                   else:
                       decay.append(p)
           return [
               {"params": decay, "weight_decay": weight_decay},
               {"params": no_decay, "weight_decay": 0.0},
           ]

       def state_dict(self):
           return self.network.state_dict()

       def load_state_dict(self, sd, strict=True):
           return self.network.load_state_dict(sd, strict=strict)
   ```
2. `anima_train.py` 中 `LoRAInjector(...)` 调用改为 `AnimaLycorisAdapter(args)`
3. **暂时删除** `LoRALayer/LoKrLayer/LoRALinear/LoRAInjector` 自实现代码（保留 git history）
4. 训练循环里 optimizer 构造、grad clip、参数计数全部走新接口

**Done 标准**：能跑起一个 step，loss 数值与旧实现差异 < 1e-4（DoRA/dropout 默认关闭时应几乎一致）

**Commit**：`refactor(lokr): replace self-implemented adapters with lycoris-lora`

---

### Stage 4 — 保存与加载格式（0.5 天）

**目标**：保存的 ckpt 能被 ComfyUI 直接加载；新格式 ckpt 能 round-trip

**步骤**
1. **保存**：
   - 用 `network.state_dict()` 取权重
   - 保留我们当前的 metadata 写入（`ss_network_dim` / `ss_network_alpha` / `ss_network_module` / `ss_network_args`）
   - `ss_network_args` 升级为完整 JSON：
     ```json
     {
       "algo": "lokr",
       "factor": 8,
       "preset": "anima_full",
       "weight_decompose": false,
       "rs_lora": false,
       "rank_dropout": 0.0,
       "module_dropout": 0.0
     }
     ```
   - `ss_network_module` 改为 `"lycoris.kohya"`（与官方对齐）
2. **加载**：
   - 直接走 `network.load_state_dict()`，要求新格式（`lycoris_unet_*` 前缀）
   - 遇到旧 `lora_unet_*` 前缀 → **明确报错**："此 ckpt 由旧版本训练，请重新训练或切回 master 分支"
3. 在 ComfyUI 上加载新 ckpt 出图，对比旧 ckpt 视觉差异

**已剔除**：~~老 ckpt 迁移函数~~（按决策 #4，不做）

**Done 标准**：
- 新 ckpt 在 ComfyUI 加载 + 出图正常
- 新 ckpt 保存→加载 round-trip 一致
- 旧 ckpt 加载报清晰错误（不是 silent 加载错乱）
- `ss_network_args` 完整字段

**Commit**：`feat(lokr): lycoris-format save/load (new format only)`

---

### Stage 5 — 断点续训整合（0.5 天）

**目标**：新格式 `state.pt` 中 lora 部分能正确 round-trip

**步骤**
1. `state.pt` 中 `lora_state_dict` 字段保存 `adapter.state_dict()`
2. resume 时直接 `adapter.load_state_dict()` 加载新格式
3. 旧版 `state.pt` 检测到旧格式 lora 键名 → 明确报错（按决策 #4，不迁移）
4. optimizer state、RNG、loss 历史保持不变（这些与 lora 实现无关）

**Done 标准**：
- 新分支训练 100 step 存 ckpt → resume → 再跑 100 step，loss 曲线连续
- 旧 `state.pt` resume 时报清晰错误

**Commit**：`feat(lokr): resume training with lycoris adapter`

---

### Stage 6 — Studio Schema 扩展（1 天）

**目标**：把新算法/新参数暴露到 Studio UI

**字段扩展**（`studio/schema.py`）：

```python
# 替换原 lora_type Literal["lora", "lokr"]
lora_algo: Literal["lora", "lokr", "loha", "dylora", "diag-oft"] = Field("lokr", ...)

# 新增
lora_dora: bool = Field(False, description="DoRA：方向/幅度分离训练，收敛更快",
                         json_schema_extra=_meta("lora", show_when="lora_algo!=full"))
lora_rs: bool = Field(False, description="rs-LoRA：scale=α/√r，高 rank 训练更稳",
                       json_schema_extra=_meta("lora"))
lora_dropout: float = Field(0.0, ge=0.0, le=1.0, description="LoRA 输入 dropout",
                             json_schema_extra=_meta("lora"))
lora_rank_dropout: float = Field(0.0, ge=0.0, le=1.0, description="rank 维 dropout",
                                  json_schema_extra=_meta("lora"))
lora_module_dropout: float = Field(0.0, ge=0.0, le=1.0, description="层级 stochastic depth",
                                    json_schema_extra=_meta("lora"))
lora_use_tucker: bool = Field(False, description="Tucker 分解（仅 Conv2d 有效，Anima 暂无）",
                               json_schema_extra=_meta("lora", show_when="lora_algo==lokr"))
```

**向后兼容**：
- 保留 `lora_type` 字段，标记 deprecated，自动映射到 `lora_algo`
- 已有 Studio 配置文件 load 时做 schema 迁移

**UI 更新**（`studio/web/` 相关 vue/jsx 组件）：
- 抽屉里 LoRA 区块加新字段
- DoRA 默认折叠在"高级"分组里

**Done 标准**：
- Studio 能保存/加载新字段
- 旧 Studio 配置打开不报错
- 训练命令构造正确传递新参数

**Commit**：`feat(studio): expose DoRA/dropout/algo selection in LoRA panel`

---

### Stage 7 — 测试与文档（1 天）

**测试清单**

| 项 | 工具 | Done |
|----|------|------|
| 单元：probe 脚本检查命中层数 | pytest | |
| 单元：legacy state_dict 迁移函数 | pytest 喂 fixture | |
| 集成：跑 50 step LoKr 默认配置，对比旧实现 loss | 手测 | loss 曲线差异 < 5% |
| 集成：跑 50 step LoKr + DoRA | 手测 | 不爆且收敛趋势正常 |
| 集成：跑 50 step LoHa（新增算法） | 手测 | 不爆 |
| 集成：保存 + ComfyUI 加载 + 出图 | 手测 | 视觉与旧 ckpt 一致 |
| 集成：新分支 ckpt → resume → 续训 | 手测 | loss 连续 |
| 集成：旧 ckpt resume 报错路径 | 手测 | 错误信息清晰指向重训 |
| 集成：Studio 端到端跑通新参数 | 手测 | UI/后端/CLI 链路 |

**文档更新**

- `README.md`：算法清单更新（lora/lokr/loha/dora/...）
- `docs/training-tips.md`：DoRA / dropout 推荐用法
- `docs/lokr-implementation-comparison.md`：标记为"历史文档"，新加一段说明已切到官方库
- 新增 `docs/lycoris-integration.md`：用法、preset 说明、迁移老 ckpt 的步骤

**Commit**：`test+docs: lycoris integration regression suite + user docs`

---

## 3. 风险与应对

| 风险 | 概率 | 影响 | 应对 |
|------|------|------|------|
| lycoris 命中层数与当前 `LoRAInjector` 不一致 | 中 | 训练效果偏移 | Stage 1 probe 阶段对齐，发现差异调 preset |
| `w1 no-WD` 参数分组写错（lycoris 内部参数命名差异） | 中 | 训练略偏 | 单元测试遍历参数名打印验证 |
| ~~老 ckpt 迁移漏 key~~ | — | — | **N/A**：按决策 #4 不做老 ckpt 迁移 |
| ComfyUI 加载新格式失败 | 低 | 推理不可用 | Stage 4 必须用真 ComfyUI 测一次 |
| lycoris-lora 升级 API 变 | 低 | 未来维护 | requirements 锁 `lycoris-lora>=3.0,<4.0` |
| Studio 老配置文件不兼容 | 中 | 用户体验差 | Stage 6 写 schema 迁移层 |
| Anima 的某些层名 lycoris fnmatch 不匹配 | 低 | 该层不训 | Stage 1 probe 输出全部命中层名 + 漏网层名 |

---

## 4. 回退方案

工作分支策略下，回退极简单：

1. **未合并前**：分支随时可弃，master 不受影响
2. **合并后发现问题**：`git revert` 整个 PR commit；老用户继续用 master 实现
3. **依赖层**：第一版**强切**，不保留旧实现 fallback（双实现维护成本高）

不建议长期共存。

---

## 5. 不在本次范围

明确**不做**的事：

- 不切到 sd-scripts（那是另一个 plan）
- 不引入 LyCORIS 的 IA³/GLoRA/BOFT 等冷门算法（先把 LoRA/LoKr/LoHa/DoRA 跑稳）
- 不改优化器逻辑
- 不改训练循环
- 不动监控 SSE
- 不改打标管线

---

## 6. 节点检查表

```
[ ] Stage 1: 依赖装上 + probe 脚本对齐层数
[ ] Stage 2: Anima preset 写完 + 验证排除 llm_adapter
[ ] Stage 3: AnimaLycorisAdapter 替换自实现 + loss 对比通过
[ ] Stage 4: 保存 + 加载 + ComfyUI 验证 + 老 ckpt 迁移
[ ] Stage 5: 断点续训 round-trip
[ ] Stage 6: Studio schema 扩展 + UI 字段
[ ] Stage 7: 测试套件 + 文档
[ ] 最后:    在干净环境上 pip install + 跑一次完整 Studio 训练流程
```

每个 stage 单独 commit + 手测后再继续（遵守仓库的 workflow 约定）。

---

## 7. 启动条件 / 已决策项

| # | 项 | 决策 |
|---|----|------|
| 1 | lycoris-lora 与 Anima 兼容性 | ✅ 已验证（DiT 接受单 nn.Module，target_name 自定义） |
| 2 | `lora_type` 字段向后兼容 | ✅ **保留**，标记 deprecated，自动映射到 `lora_algo`；**后续版本周期删除** |
| 3 | Conv2d 支持 | ✅ **跳过**。Anima 是纯 DiT，主干 + TE + LLM Adapter 全是 `nn.Linear`；VAE 有 Conv2d 但冻结不训。`enable_conv=False` 即可，未来需要时改一个 flag 即可加上 |
| 4 | 老 ckpt 迁移 | ✅ **不做**。Stage 4 中的 `migrate_old_lokr_state_dict` 函数 + Stage 5 的 legacy resume 路径**全部移除**。新分支只保证新格式 round-trip |
| 5 | 工作分支 | ✅ **单开 branch `feat/lycoris-migration`**，所有 7 个 stage 的 commit 落在此分支，完成后开 PR 合 master |
| 6 | 回归测试小数据集 | ⬜ 待准备（10-20 张图作 fixture） |
