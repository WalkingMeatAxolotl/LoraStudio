# AnimaLoraStudio · 重设计交接文档

> mockup 文件：`AnimaLoraStudio Redesign.html`（同目录），Tweaks 已锁定 sidebar / comfortable / default radius / light。

## 0. 我能做什么 / 不能做什么

我**不能直接 push 到你的 GitHub fork** — 我的 GitHub 集成只有「读 / import 进项目」权限，没有「写回仓库」。

所以请按这个顺序：
1. 用本文档底部的下载链接拿到所有 mockup 源文件（HTML + 4 个 jsx + tokens.css）
2. 自己 commit 到 fork 的某个 mockup 分支（比如 `redesign-mockup`），方便对照
3. 在 `studio/web/` 上按下面的「迁移清单」开搞

## 1. 视觉系统总览

**调色板**（warm-ivory，浅 + 深）— 全部在 `tokens.css` 里以 CSS 变量声明
- `--bg-canvas / --bg-surface / --bg-sunken / --bg-overlay / --bg-elevated`
- `--fg-primary / --fg-secondary / --fg-tertiary / --fg-disabled`
- `--border-subtle / --border-default / --border-strong`
- `--accent / --accent-hover / --accent-soft / --accent-fg`
- `--ok / --warn / --err / --info`（每个都有 `-soft` 配套）
- 浅色：accent `#d8541d`（暖橙）；深色：accent `#ed6b3a`，bg `#15140f`
- 阴影分 4 档：`--sh-sm / md / lg / xl`，含 0px ring + drop shadow 双层

**字号刻度**（重点：比当前 12-13px 上调一档）
- `--t-xs 11 · sm 13 · base 14 · md 15 · lg 17 · xl 20 · 2xl 26 · 3xl 34 · 4xl 44 · display 56`
- 监控关键数字必须用 `var(--t-3xl)` + `tabular-nums` + `font-mono`

**字体**：Inter (sans) + JetBrains Mono (mono) + EB Garamond (serif，备用)
- 所有数字一律 mono + tabular-nums

**间距**：4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64
- density 修饰类：`.density-tight` 缩 30%，`.density-loose` 放 30%

**圆角**：默认 6px。`.radius-sharp` 全压到 0-6px；`.radius-soft` 提到 8-20px

## 2. 信息架构（已重新设计）

**左侧 sidebar**（替代之前可能的顶栏 stepper）
```
┌─ logo · Anima
├─ 项目 ✓ active
├─ 队列 (1) ●            ← 全局，永远在
├──────────────────
│  当前项目 · slug / version
│  ├─ 1 · 下载   ✓
│  ├─ 2 · 筛选   ✓
│  ├─ 3 · 打标   ✓
│  ├─ 4 · 编辑   ●(进行中)
│  ├─ 5 · 正则
│  └─ 6 · 训练
├──────────────────
└─ 预设 / 监控 / 设置（底部）
```
- 进入项目时下半部分展开；其他时候只剩「项目 / 队列」
- collapsed 模式 56px，仅 icon + tooltip
- 进度色：done = ok 绿，active = accent 橙跳动，pending = neutral

**topbar**（52px 高）
- 左：breadcrumb（项目 / 项目名 / 版本号 mono / 当前步骤）
- 中：⌘K 搜索 placeholder（命令面板）
- 右：「训练中 · 任务名 · step 4,200 / 10,000」状态药丸（橙底 + 跳动点）—— **这是解决「重点功能不突出」的关键**

## 3. 关键页面清单（mockup → 真实代码迁移）

| Mockup section | 文件 | 目标 React 组件（建议） | 改动重点 |
|---|---|---|---|
| ProjectsPage | `pages-1.jsx` | `routes/projects/index.tsx` | 卡片网格替换列表；卡片含进度条 / stage badge |
| ProjectOverview | `pages-1.jsx` | `routes/projects/[id]/overview.tsx` | 4 个 StatCard + PipelineTimeline + 近期任务 + 版本卡 |
| DownloadPage | `pages-2.jsx` | `routes/projects/[id]/download.tsx` | tab 切 booru/upload/url；右栏 `download/` 状态卡 |
| CurationPage | `pages-2.jsx` | `routes/projects/[id]/curation.tsx` | 双面板（download/ ↔ train/），中部「复制 →」按钮 |
| TaggingPage | `pages-2.jsx` | `routes/projects/[id]/tagging.tsx` | 模型选择 2×2 卡片 + 阈值；右栏单图预测预览（颜色按置信度） |
| TagEditPage | `pages-2.jsx` | `routes/projects/[id]/tag-edit.tsx` | 三栏：批量操作 / 当前图标签 / 全集分布柱图 |
| RegPage | `pages-3.jsx` | `routes/projects/[id]/regularization.tsx` | 参数表单 + AR 桶分布柱图 |
| TrainPage | `pages-3.jsx` | `routes/projects/[id]/train.tsx` | 预设卡 3 列 + 9 字段网格 + 折叠 toml + 右侧预估栏 |
| QueuePage | `pages-3.jsx` | `routes/queue.tsx` | 表格行：id · name · 状态 · 进度 · eta |
| MonitorPage | `pages-3.jsx` | `routes/queue/[id].tsx` 或 `monitor.tsx` | **5 列大数字 + loss 曲线 + 采样轮播 + checkpoint 列表 + 日志** —— 这是仪表盘核心 |
| SettingsPage | `pages-3.jsx` | `routes/settings.tsx` | 4 个 group：路径 / 后端 / Booru / JoyCaption |

## 4. 共享组件（必须先抽出）

按建议顺序抽：

1. **`Tokens` (CSS)** — 把 `tokens.css` 整个搬到 `studio/web/src/styles/tokens.css`，在入口 import
2. **`StatCard`** — `{ label, value, sub?, tone?, large?, mono? }`，在 `chrome.jsx` 风格里
3. **`PageHeader`** — `{ eyebrow, title, subtitle, actions, sticky }`
4. **`Sidebar` + `NavItem` + `ProjectStepperNav`** — `chrome.jsx` 里的版本，把 onNav 接成 react-router `<Link>`
5. **`Topbar`** — breadcrumb 由 router 派生，projectStatus 从全局 store（zustand？）订阅
6. **`Chip` / `Field` / `ImgTile` / `Pane`** — 表单 / 图片瓦片小件
7. **`LossChart` + `Sparkline`** — SVG 自绘，数据从训练 IPC 流式来；用相同 path 公式
8. **`StageBadge`** — running / queued / done / failed / tagging / curating

## 5. 状态管理建议

- 全局：当前训练任务（监控 + topbar 共用） → store
- 当前项目 + 当前步骤 → URL 派生
- Tweaks（深浅 + accent 色）→ localStorage，启动时读，应用到 `<html>` 的 className + style

## 6. 迁移分阶段（建议 PR 拆分）

**PR-1 · tokens + chrome**（最小可见改动）
- 落 `tokens.css`，新 Sidebar + Topbar，先把现有页面塞进新壳子里，业务逻辑不动
- 验收：所有页面在新布局里能打开，没数据丢失

**PR-2 · 项目流（步骤 1-4）**
- ProjectsPage 卡片化、Overview 完整重写、Download/Curation/Tagging/TagEdit 四个步骤页

**PR-3 · 训练流（步骤 5-6 + 队列 + 监控）**
- Reg / Train 表单，QueuePage 表格，MonitorPage 仪表盘
- 监控页是用户最久的页面，单独 PR 反复打磨

**PR-4 · 设置 + 主题切换**
- Settings 4-section 布局
- light/dark 切换持久化

## 7. 必看的 mockup 决策（容易看漏）

- **训练状态药丸**（topbar 右侧）：所有页面都显示，全局可见进度，点击跳监控。**这是最重要的一处「重点突出」**
- **监控大数字**：step / loss / lr / vram / eta 必须 34px+ mono tabular-nums，颜色按状态变（loss 下降绿、vram >75% 黄）
- **批量操作位置**（TagEdit）：左栏固定，「应用 (12)」按钮变橙 — 让未保存数变成视觉重量
- **stage badge** 用 dot + 文字组合，dot 跳动表示活跃；不要纯色块
- **AR 桶分布**：filled-bar + 分子分母 mono 数字，比饼图直观
- **placeholder image tile**：用 `idx * 47 % 360` 派生 hsl 渐变，避免空灰块

## 8. 我未做的（要你补）

- 实际 IPC 接线（Tauri command 调用）
- 错误态 / 空态 / loading skeleton（mockup 默认全有数据）
- 国际化（mockup 全中文硬编码，建议接现有 i18n）
- 移动端适配（mockup 仅桌面 1280-2560）
- 命令面板 (⌘K) 真实搜索逻辑
- WebSocket / SSE 监控数据流的 reconnect 处理

## 9. 文件清单（需要拷到 fork 的 mockup 分支）

```
AnimaLoraStudio Redesign.html   ← 入口
tokens.css                       ← 设计 tokens
chrome.jsx                       ← Sidebar + Topbar + 图标
pages-1.jsx                      ← Projects + Overview
pages-2.jsx                      ← Download + Curation + Tagging + TagEdit
pages-3.jsx                      ← Reg + Train + Queue + Monitor + Settings
tweaks-panel.jsx                 ← Tweaks 容器（生产里可丢弃）
HANDOFF.md                       ← 本文档
```

## 10. 接手后的第一件事

打开 mockup，按 Tweaks 面板底部「跳转」分组挨个点一遍 12 个页面状态，用截图工具存下来当对照规范。然后从 PR-1 (tokens + chrome) 开始。

—

如果中途遇到具体页面卡住，可以把那个页面的 React 源码拷出来贴回 chat，让 Claude（额度恢复后）做 1:1 重写。
