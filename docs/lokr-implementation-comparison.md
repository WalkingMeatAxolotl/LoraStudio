# LoKr 实现对比：当前实现 vs LyCORIS 官方

> 对照源：本仓库 `anima_train.py:887-927`（`LoKrLayer`）
> 官方源：[KohakuBlueleaf/LyCORIS](https://github.com/KohakuBlueleaf/LyCORIS) `lycoris/modules/lokr.py` + `lycoris/functional/lokr.py`

---

## 0. 是否有官方库

**有。** `pip install lycoris-lora`（PyPI 名 `lycoris_lora`，导入名 `lycoris`）。

- GitHub：https://github.com/KohakuBlueleaf/LyCORIS
- 训练框架接入：sd-scripts (`--network_module=lycoris.kohya`)、sd3-trainer、kohya-ss GUI、ComfyUI 加载器都直接读它产出的权重
- 论文：*Navigating Text-To-Image Customization* (ICLR 2024)，LoKr 节在 §3.3

我们当前的实现是 **重写的简化版**，只覆盖了官方 ~30% 的特性面。

---

## 1. 核心数学公式对比

### 当前实现

```python
# anima_train.py:904-927
W = kron(w1, w2_a @ w2_b) * (alpha / rank)
# w1:   [factor, factor]              — 永远是 full matrix
# w2_a: [out//factor, rank]
# w2_b: [rank, in//factor]
```

固定形态：`w1` 永远满秩、`w2` 永远低秩。

### 官方 LyCORIS

```python
# 通用形态
w1_part = w1            if use_w1 else (w1_a @ w1_b)
w2_part = w2            if use_w2 else (w2_a @ w2_b)
w2_part = rebuild_tucker(t2, w2_a, w2_b)  if use_tucker
W = kron(w1_part, w2_part) * scale
```

四种组合都能开/关：`w1` 全矩阵 vs 低秩、`w2` 全矩阵 vs 低秩 vs Tucker。

---

## 2. `factor` 参数的语义差异（**这是最大的隐患**）

### 当前实现 — `factor` = 整除因子

```python
# anima_train.py:917-922
def _find_factor(self, in_f, out_f, target_factor):
    for f in [target_factor, 4, 2, 1]:
        if in_f % f == 0 and out_f % f == 0:
            return f
    return 1
```

- 只在 `[target, 4, 2, 1]` 四个候选里挑
- 找不到整除就 fallback 到 `factor=1`，此时 `kron([1,1], W) == W`，**LoKr 退化为普通满矩阵 LoRA**（且 rank 变成 `min(in, out)`，参数量爆炸）
- `in_dim = in//factor`, `out_dim = out//factor`

### 官方 — `factor` = 较小因子的**上界**，会找平衡的因子对

```python
# lycoris/functional/general.py: factorization(dim, factor)
# 例：factorization(768, 8)  -> (8, 96)
# 例：factorization(512, -1) -> (16, 32)   # -1 表示尽可能平衡
# 例：factorization(1280, 8) -> (8, 160)
```

- 对 `out_dim` 和 `in_dim` **分别**做因子分解，得到 `(out_a, out_b)` 和 `(in_a, in_b)`
- `w1.shape = [out_a, in_a]`、`w2.shape = [out_b, in_b]`（注意 **两个维度可以不相等**）
- `factor=-1` 表示完全自动选最平衡的因子对（这是大多数指南推荐的值）

**实际差异举例（in=768, out=768, factor=8）：**

| 维度 | 当前实现 | 官方 |
|------|---------|------|
| w1   | [8, 8]   | [8, 8] |
| w2 等价形状 | [96, 96] | [96, 96] |
| 总效果 | 一致 ✓ | 一致 ✓ |

**实际差异举例（in=2048, out=1024, factor=8，假设 rank=4）：**

| 维度 | 当前实现 | 官方 |
|------|---------|------|
| w1   | [8, 8]   | [8, 8] |
| w2_a | [128, 4]（=1024/8） | [128, 4] |
| w2_b | [4, 256]（=2048/8） | [4, 256] |
| 总效果 | 一致 ✓ | 一致 ✓ |

**实际差异举例（in=3072, out=3072, factor=16）：**

| | 当前实现 | 官方 |
|---|---|---|
| factor 实际取值 | `3072 % 16 == 0` → 16 | `factorization(3072, 16)` → (16, 192) |
| 形状 | 等价 | 等价 |

**真正出问题的场景（任一维不能被 factor 整除）：**

- 例：`in=1280, out=1280, factor=8`（1280 % 8 = 0 ✓） — 没事
- 例：`in=1152, out=1152, factor=8`（1152 % 8 = 0 ✓） — 没事
- 例：**任何在候选 `[target, 4, 2, 1]` 全部失败的奇数维度**（少见但存在），会 fallback 到 `factor=1`，此时该层完全退化为满矩阵 LoRA

**结论**：在 Anima 训练的常见维度（256/512/768/1024/1280/2048/3072）上行为基本一致，但 `_find_factor` 的搜索集合 `[target, 4, 2, 1]` **过窄**——例如 user 设 `factor=12`，会跳过 12 直接落到 4。建议改用官方 `factorization()` 算法。

---

## 3. 初始化对比

| 张量 | 当前实现 | 官方 LyCORIS |
|------|---------|------|
| `lokr_w1`（full）   | `kaiming_uniform_(a=√5)` | `kaiming_uniform_(a=√5)` ✓ |
| `lokr_w1_a`         | — 未实现 | `kaiming_uniform_(a=√5)` |
| `lokr_w1_b`         | — 未实现 | `kaiming_uniform_(a=√5)` ⚠️ **不是 zeros** |
| `lokr_w2`（full）   | — 未实现 | `constant_(0)` |
| `lokr_w2_a`         | `kaiming_uniform_(a=√5)` | `kaiming_uniform_(a=√5)` ✓ |
| `lokr_w2_b`         | `zeros_` | `constant_(0)` ✓ |
| `lokr_t2`（Tucker）| — 未实现 | `kaiming_uniform_(a=√5)` |

**关键观察**：当前实现的初始化对**默认 LoKr 形态**（w1 full + w2 低秩）是正确的——`w2_b=0` 保证起步 ΔW=0，与官方一致。

---

## 4. 缺失参数总览

按重要性排序：

### 🔴 高 — 影响默认行为或常被使用

| 官方参数 | 默认值 | 作用 | 当前实现 |
|---------|-------|-----|---------|
| `weight_decompose` (DoRA) | `False` | 把 ΔW 拆成方向 + 幅度向量训练，普遍认为收敛更稳 | ❌ 缺失 |
| `wd_on_out` | `True` | DoRA 沿哪个维度做归一化 | ❌ 依赖 DoRA |
| `rank_dropout` | `0.0` | 训练时随机置零 rank 维（防过拟合） | ❌ 缺失 |
| `module_dropout` | `0.0` | 整层级别的 stochastic depth | ❌ 缺失 |
| `rs_lora` | `False` | scale = α/√r 而非 α/r（高 rank 时更稳） | ❌ 缺失 |
| `use_scalar` | `False` | 额外可训练标量缩放 ΔW | ❌ 缺失 |
| **Conv2d 支持** | — | 官方对 `nn.Conv2d` 走特殊路径 | ❌ **完全不支持**（当前只判断 `nn.Linear`） |

### 🟡 中 — 高级用例

| 官方参数 | 作用 | 当前实现 |
|---------|-----|---------|
| `decompose_both` | w1 也低秩分解（`w1 = w1_a @ w1_b`），进一步压参 | ❌ |
| `use_tucker` | Conv2d 时把 w2 改 Tucker 分解（节省参数） | ❌ |
| `full_matrix` | 关闭 w2 低秩，使用满 w2（少见） | ❌ |
| `bypass_mode` | 替代 forward 路径（用于某些底模兼容） | ❌ |
| `unbalanced_factorization` | 对 in/out 用不一致的因子分解 | ❌ |
| `rank_dropout_scale` | 配合 `rank_dropout` 自动重缩放 | ❌ |

### 🟢 低 — 训练流程相关

| 官方功能 | 当前实现 |
|---------|---------|
| `train_norm`（训练 LayerNorm）| ❌ |
| `bias` adapter（训练 bias）| ❌ |
| 模块级 `multiplier` 表 | ❌ |
| 与 IA³/LoHa/(loha+lokr) 混用 | ❌ |

---

## 5. 权重保存格式

### 键名

| 当前实现 | 官方 |
|---------|------|
| `lora_unet_<...>.lokr_w1` | `lycoris_<...>.lokr_w1` 或 `lokr_w1_a` + `lokr_w1_b` |
| `lora_unet_<...>.lokr_w2_a` | `lycoris_<...>.lokr_w2_a` |
| `lora_unet_<...>.lokr_w2_b` | `lycoris_<...>.lokr_w2_b` |
| `lora_unet_<...>.alpha` | `lycoris_<...>.alpha` |
| — | `lokr_t2`（Tucker） |
| — | `dora_scale`（DoRA） |
| — | `scalar`（use_scalar） |

⚠️ **前缀不同**：当前用 `lora_unet_`（沿用 Kohya LoRA 的命名），LyCORIS 官方多数权重前缀是 `lycoris_unet_` / `lycoris_te_`。**ComfyUI 的 LyCORIS 加载器对前缀宽容**，所以目前能加载——但严格走 LyCORIS 推理代码可能会 miss。

### Metadata

```python
# anima_train.py:1056-1057
"ss_network_module": "lycoris.kohya",
"ss_network_args":  '{"algo": "lokr", "factor": N}'
```

官方完整 `ss_network_args` 至少应包含：

```json
{
  "algo": "lokr",
  "factor": 8,
  "preset": "full",
  "decompose_both": false,
  "use_tucker": false,
  "use_scalar": false,
  "rs_lora": false,
  "weight_decompose": false,
  "wd_on_out": true,
  "rank_dropout": 0.0,
  "module_dropout": 0.0,
  "train_norm": false,
  "dora_wd": false
}
```

缺这些字段时，下游加载器会用默认值——对默认形态 OK，但如果将来开 DoRA/Tucker 必须补全。

---

## 6. 当前实现的隐性正确性问题

1. **`get_param_groups` 的 weight_decay 排除策略**
   - 当前：`w1` 排除 WD，`w2_a/b` 加 WD（`anima_train.py:1015-1031`）
   - 官方：没有这个分组逻辑——LyCORIS 默认让用户自己在 optimizer 设 `wd=0`，因为 LoKr 的 ΔW 已经是低秩约束，再加 WD 会进一步拉小幅度
   - **建议**：保留这个区分是合理的（属于本仓库的优化），但应在文档里说明

2. **`scaling = alpha / rank`**
   - 当前 LoKr 复用了 LoRA 的缩放公式
   - 官方在 `use_w2=True && use_w1=True`（即两端都 full）时会把 alpha 重置为 lora_dim，使 scale=1
   - 当前实现没这个分支——但因为也不支持 `full_matrix`，暂时不会触发

3. **`factor` 越界时的 silent fallback**
   - `_find_factor` 返回 1 时层退化为 LoRA，但用户看不到任何警告
   - 建议至少加 `logger.warning(f"layer {name}: factor fallback to 1, behaves as plain LoRA")`

4. **不接受 `factor=-1`**
   - 官方惯例：`-1` = 自动选最平衡因子（这是 LyCORIS 默认推荐）
   - 当前 `factor` 是正整数，遇到 `-1` 会 fallback 到 1

---

## 7. 修复优先级建议

| 优先级 | 改动 | 工作量 | 价值 |
|--------|------|-------|------|
| P0 | `_find_factor` 改用官方 `factorization()` 算法 | 半天 | 修掉 fallback=1 静默退化 |
| P0 | factor 越界时打 warning | 10 分钟 | 用户可见性 |
| P1 | 实现 `rs_lora`（scale = α/√r） | 1 行代码 | 高 rank 训练稳定性 |
| P1 | 实现 `module_dropout` / `rank_dropout` | 半天 | 防过拟合，效果普遍 |
| P2 | DoRA (`weight_decompose`) | 1-2 天 | 收敛更快，社区主流 |
| P2 | Conv2d 支持 + Tucker | 2-3 天 | 当前 Anima 模型只有 Linear，**暂时不需要** |
| P3 | `decompose_both`、`use_scalar`、`bypass_mode` | 各 1 天 | 高级用户特性 |
| P3 | 直接接入 `lycoris-lora` 包替换自实现 | 1 天 | 一劳永逸，但失去对训练循环的精细控制 |

---

## 8. "要不要直接换成 lycoris 库" 的权衡

**换的优点**
- 自动获得所有上述特性
- 与 sd-scripts/ComfyUI 完全字段对齐
- 后续 LyCORIS 升级（如新出的 GLoRA、Diag-OFT）免费跟进

**换的代价**
- LyCORIS 的注入器假设是 sd-scripts 的 `create_network()` 接口，本仓库的 `LoRAInjector` 直接遍历 `model.named_modules()` 注入，需要适配
- LyCORIS 依赖 `safetensors`、`torch`、`einops`，已经都装了，**无新增依赖**
- 当前 `get_param_groups`（w1 不加 WD）的优化会丢失，需要在 optimizer 这边重新拼

**推荐路径**：保留自实现作为 default，但把 P0+P1 修掉；对 P2+ 的高级特性，**只在用户明确请求时**评估是否切换到 lycoris 包。

---

## 附：官方源码定位

- 模块定义：`lycoris/modules/lokr.py` → `class LokrModule(LycorisBaseModule)`
- 数学函数：`lycoris/functional/lokr.py` → `weight_gen()`, `diff_weight()`, `make_kron()`
- 因子算法：`lycoris/functional/general.py` → `factorization(dim, factor)`
- Preset：`lycoris/config.py` → 预设了 `full`、`attn-mlp`、`unet-transformer-only` 等目标层组合
