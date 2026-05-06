# 样式统一计划：Tailwind + Token 系统

> **最后更新：** 2026-05-06（每次提交后同步修改本文件）
>
> **目标：** 消灭双轨制样式（Tailwind 原生色值 vs CSS 变量内联 style），统一为
> **Tailwind 工具类 + token 变量映射**，为暗色模式和字号调整做准备。

---

## 一、当前状态诊断

### 1.1 双轨制现象

项目目前同时存在两套样式方式：

| 方式 | 典型代码 | 使用文件数 | 问题 |
|------|---------|-----------|------|
| **Tailwind 原生色值** | `className="bg-slate-900 text-slate-300"` | ~10 | 硬编码，暗色模式无法通过 token 切换 |
| **CSS 变量内联** | `style={{ background: 'var(--bg-surface)' }}` | ~18 | JSX 冗长，无法响应 Tailwind 断点 |
| **混用** | 同一组件两者都有 | ~8 | 维护地狱，不一致 |

### 1.2 Token 系统（tokens.css）

位置：`studio/web/src/styles/tokens.css`

已定义的完整变量列表：

```
颜色
  背景层级：  --bg-canvas  --bg-surface  --bg-sunken  --bg-overlay  --bg-elevated
  前景层级：  --fg-primary  --fg-secondary  --fg-tertiary  --fg-disabled  --fg-inverse
  边框：      --border-subtle  --border-default  --border-strong
  强调色：    --accent  --accent-hover  --accent-soft  --accent-fg
  状态色：    --ok  --ok-soft  --warn  --warn-soft  --err  --err-soft  --info  --info-soft

字体族
  --font-sans  --font-mono  --font-serif

排版尺寸（可调节）
  --t-xs(12px)  --t-sm(14px)  --t-base(15px)  --t-md(16px)
  --t-lg(18px)  --t-xl(22px)  --t-2xl(28px)   --t-3xl(36px)
  --t-4xl(46px)  --t-display(60px)

间距（8 档）
  --s-1(4) --s-2(8) --s-3(12) --s-4(16) --s-5(20) --s-6(24) --s-8(32) --s-16(64)

圆角
  --r-sm(4px)  --r-md(6px)  --r-lg(10px)  --r-xl(14px)  --r-pill(999px)

阴影
  --sh-sm  --sh-md  --sh-lg  --sh-xl

布局常量
  --sidebar-w(232px)  --sidebar-collapsed-w(56px)  --topbar-h(52px)
```

**已预留暗色模式：** `.theme-dark { }` 内重定义全部颜色变量，切换时只需给 `<body>` 加 `.theme-dark`。

**已预留字号调节：** `.density-tight` / `.density-loose` 改间距，字号变量可在运行时覆盖（`--t-sm` 等）。

**已有的组件类：**
- 按钮：`.btn` `.btn-primary` `.btn-secondary` `.btn-ghost` `.btn-sm`
- 输入：`.input` `.input-mono`
- 卡片：`.card` `.card-hover`
- 徽章：`.badge` `.badge-ok` `.badge-warn` `.badge-err` `.badge-info` `.badge-neutral` `.badge-accent`
- 状态点：`.dot` `.dot-ok` `.dot-warn` `.dot-err` `.dot-running`
- 其他：`.kbd` `.divider` `.mono` `.tnum` `.serif` `.caption`

---

## 二、目标架构

### 2.1 方案选择：Tailwind 工具类 + CSS 变量映射

**不选"纯 CSS 变量"**：失去 Tailwind 断点、flex/grid 快捷写法、Vite 摇树优化。

**不选"纯 Tailwind 原生色"**：`bg-slate-900` 等硬编码值无法热切换暗色模式。

**选择：将 CSS 变量注册进 Tailwind theme**，这样可以写：
```tsx
// 现在（内联 style，冗长）
<div style={{ background: 'var(--bg-surface)', color: 'var(--fg-primary)' }}>

// 目标（Tailwind 类，简洁 + 响应主题）
<div className="bg-surface text-fg-primary">
```

### 2.2 Tailwind 配置扩展（tailwind.config.js）

```js
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 背景层级
        canvas:    'var(--bg-canvas)',
        surface:   'var(--bg-surface)',
        sunken:    'var(--bg-sunken)',
        overlay:   'var(--bg-overlay)',
        elevated:  'var(--bg-elevated)',
        // 前景
        'fg-primary':   'var(--fg-primary)',
        'fg-secondary': 'var(--fg-secondary)',
        'fg-tertiary':  'var(--fg-tertiary)',
        'fg-disabled':  'var(--fg-disabled)',
        // 边框
        'border-subtle':  'var(--border-subtle)',
        'border-default': 'var(--border-default)',
        'border-strong':  'var(--border-strong)',
        // 强调色
        accent:      'var(--accent)',
        'accent-fg': 'var(--accent-fg)',
        'accent-soft':'var(--accent-soft)',
        // 状态色
        ok:    'var(--ok)',
        warn:  'var(--warn)',
        err:   'var(--err)',
        info:  'var(--info)',
      },
      fontSize: {
        'xs':      ['var(--t-xs)',   { lineHeight: '1.5' }],
        'sm':      ['var(--t-sm)',   { lineHeight: '1.5' }],
        'base':    ['var(--t-base)', { lineHeight: '1.6' }],
        'md':      ['var(--t-md)',   { lineHeight: '1.5' }],
        'lg':      ['var(--t-lg)',   { lineHeight: '1.4' }],
        'xl':      ['var(--t-xl)',   { lineHeight: '1.3' }],
        '2xl':     ['var(--t-2xl)',  { lineHeight: '1.2' }],
        '3xl':     ['var(--t-3xl)',  { lineHeight: '1.15' }],
      },
      spacing: {
        's1': 'var(--s-1)',
        's2': 'var(--s-2)',
        's3': 'var(--s-3)',
        's4': 'var(--s-4)',
        's5': 'var(--s-5)',
        's6': 'var(--s-6)',
        's8': 'var(--s-8)',
        's16':'var(--s-16)',
      },
      borderRadius: {
        'sm': 'var(--r-sm)',
        'md': 'var(--r-md)',
        'lg': 'var(--r-lg)',
        'xl': 'var(--r-xl)',
        'pill':'var(--r-pill)',
      },
      boxShadow: {
        'sm': 'var(--sh-sm)',
        'md': 'var(--sh-md)',
        'lg': 'var(--sh-lg)',
        'xl': 'var(--sh-xl)',
      },
      fontFamily: {
        sans:  'var(--font-sans)',
        mono:  'var(--font-mono)',
        serif: 'var(--font-serif)',
      },
    },
  },
  plugins: [],
}
```

### 2.3 暗色模式接入

tokens.css 已有 `.theme-dark { ... }` 覆盖所有颜色变量，Tailwind 侧用 `class` 策略：

```js
// tailwind.config.js
darkMode: ['class', '.theme-dark'],
```

这样 `dark:text-fg-primary` 可以用，同时 `.theme-dark` toggle 也能用（只需 `document.body.classList.toggle('theme-dark')`）。

---

## 三、迁移计划（按文件分批）

### 批次 0：基础设施（Tailwind 配置）✅ 完成

- [x] 修改 `tailwind.config.js`，注册所有 token 变量映射
- [ ] `darkMode` class 策略接入（暗色模式 toggle 时再做）
- [x] 建立常量色值替换对照表（见附录 A）

---

### 批次 1：核心 UI 组件（高优先级）

| 组件 | 当前状态 | 迁移内容 | 进度 |
|------|---------|---------|------|
| `ErrorBoundary.tsx` | Tailwind 原生色（bg-red-50, text-red-700） | 改用 `.err` token 类 | ✅ |
| `Toast.tsx` | Tailwind 原生色（bg-red-900/80, bg-green-900/80） | 改用 `.ok/.err/.info` token 类 | ✅ |
| `ImageGrid.tsx` | Tailwind 原生色（bg-slate-900, border-cyan-400） | 改用 `bg-sunken`, `border-accent` | ✅ |
| `FileList.tsx` | Tailwind 原生色（bg-slate-900, border-slate-800） | 改用 token 类 | ✅ |
| `JobProgress.tsx` | Tailwind 原生色（bg-slate-800/40, text-slate-300） | 改用 token 类 | ✅ |
| `VersionTabs.tsx` | Tailwind 原生色（bg-slate-800/80, text-cyan-300） | 改用 token 类 | ✅ |

---

### 批次 2：已重写组件（CSS 变量 → Tailwind 类）

这些组件已用 CSS 变量，迁移是将 `style={{ ... }}` 改成 `className="..."`，不改视觉效果：

| 组件 | 当前状态 | 优先级 | 进度 |
|------|---------|--------|------|
| `SaveBar.tsx` | CSS 变量内联 | 中 | ⬜ |
| `BulkActionBar.tsx` | CSS 变量内联 | 中 | ⬜ |
| `TagEditor.tsx` | CSS 变量内联 | 中 | ⬜ |
| `TagAutocomplete.tsx` | CSS 变量内联 | 中 | ⬜ |
| `TagStatsPanel.tsx` | CSS 变量内联 | 低 | ⬜ |
| `StepShell.tsx` | CSS 变量内联（少量） | 低 | ⬜ |
| `ProjectStepper.tsx` | CSS 变量内联 | 低 | ⬜ |
| `StageBadge.tsx` | CSS 变量内联 | 低 | ⬜ |
| `Sidebar.tsx` | CSS 变量内联（复杂） | 低 | ⬜ |
| `Topbar.tsx` | CSS 变量内联 | 低 | ⬜ |
| `PageHeader.tsx` | CSS 变量内联 | 低 | ⬜ |
| `MonitorDashboard.tsx` | CSS 变量内联 | 低 | ⬜ |
| `SchemaForm.tsx` | CSS 变量内联 | 低 | ⬜ |
| `PathPicker.tsx` | CSS 变量内联 | 低 | ⬜ |
| `Field.tsx` | 混用（Tailwind flex + CSS 变量） | 中 | ⬜ |

---

### 批次 3：页面文件

| 页面 | 当前状态 | 优先级 | 进度 |
|------|---------|--------|------|
| `project/Overview.tsx` | CSS 变量内联 | 低 | ⬜ |
| `project/Layout.tsx` | CSS 变量内联 | 低 | ⬜ |
| `project/steps/Curation.tsx` | 混用（Tailwind 布局 + CSS 变量细节） | 中 | ⬜ |
| `project/steps/Download.tsx` | Tailwind 原生色 | 中 | ⬜ |
| `project/steps/Tagging.tsx` | Tailwind 原生色 | 中 | ⬜ |
| `project/steps/Train.tsx` | Tailwind 原生色 | 中 | ⬜ |
| `project/steps/Regularization.tsx` | Tailwind 原生色 | 中 | ⬜ |
| `project/steps/TagEdit.tsx` | 混用 | 低（已重写布局） | ⬜ |
| `tools/Presets.tsx` | 混用 | 中 | ⬜ |
| `tools/Settings.tsx` | Tailwind 原生色 | 中 | ⬜ |
| `tools/Monitor.tsx` | 混用 | 低 | ⬜ |
| `Queue.tsx` | CSS 变量内联 | 低 | ⬜ |
| `QueueDetail.tsx` | 混用 | 低 | ⬜ |
| `Projects.tsx` | 混用 | 低 | ⬜ |

---

## 四、迁移规则

### 4.1 颜色替换对照表（附录 A）

> 硬编码 Tailwind 原生色 → token 化等价类

| 旧写法 | 新写法 | 说明 |
|--------|--------|------|
| `bg-slate-950` / `bg-slate-900` | `bg-canvas` / `bg-sunken` | 最深背景 |
| `bg-slate-800` / `bg-slate-800/40` | `bg-surface` / `bg-overlay` | 卡片/悬停背景 |
| `bg-slate-700` | `bg-elevated` | 弹框背景 |
| `border-slate-700` / `border-slate-800` | `border-border-subtle` | 细边框 |
| `text-slate-100` / `text-white` | `text-fg-primary` | 主文本 |
| `text-slate-300` / `text-slate-400` | `text-fg-secondary` | 次级文本 |
| `text-slate-500` / `text-slate-600` | `text-fg-tertiary` | 提示文本 |
| `text-cyan-300` / `text-cyan-400` | `text-accent` | 强调文本 |
| `bg-cyan-600` | `bg-accent` | 强调背景 |
| `border-cyan-400` / `ring-cyan-400` | `border-accent` | 强调边框 |
| `bg-red-900/80` / `text-red-300` | `bg-err` / `text-fg-primary`（err 状态） | 错误状态 |
| `bg-green-900/80` / `text-green-300` | `bg-ok` / `text-fg-primary`（ok 状态） | 成功状态 |
| `bg-yellow-900/80` / `text-yellow-300` | `bg-warn` / ...  | 警告状态 |
| `text-xs` | `text-xs`（保留，已映射到 --t-xs） | 字号 |
| `text-sm` | `text-sm`（保留，已映射到 --t-sm） | 字号 |

### 4.2 内联 style 消除规则

```tsx
// ❌ 禁止（迁移后不应出现）
style={{ background: 'var(--bg-surface)' }}
style={{ color: 'var(--fg-tertiary)' }}
style={{ fontSize: 'var(--t-xs)' }}
style={{ borderRadius: 'var(--r-md)' }}
style={{ gap: 8 }}  // 固定像素间距

// ✅ 目标写法
className="bg-surface"
className="text-fg-tertiary"
className="text-xs"
className="rounded-md"
className="gap-2"   // Tailwind 间距 = 8px

// ✅ 例外：以下允许保留 style={{}}
style={{ width: '...%' }}         // 百分比/计算值
style={{ flex: '0 0 32%' }}       // 复杂 flex 简写
style={{ position, inset }}       // 绝对定位布局
```

### 4.3 组件类复用规则

能用 tokens.css 里预定义类的，不用 Tailwind 组合：

```tsx
// ❌ 不要自己拼
className="px-2 py-1 rounded bg-accent text-accent-fg text-xs font-medium"

// ✅ 用预定义类
className="btn btn-primary btn-sm"

// ❌
className="px-2 py-0.5 rounded-full bg-ok/20 text-ok text-xs"

// ✅
className="badge badge-ok"
```

---

## 五、暗色模式接入计划（未开始）

1. **触发器：** `<body>` class 切换 `.theme-dark`，在 Settings 页面加切换按钮
2. **持久化：** `localStorage.setItem('theme', 'dark')`，`main.tsx` 启动时读取并应用
3. **Tailwind 配置：** `darkMode: ['class', '.theme-dark']`
4. **测试范围：** 所有使用 token 颜色变量的组件自动跟随；使用硬编码原生色的需要迁移（批次 1）

---

## 六、字号调节计划（未开始）

已有 `.density-tight` / `.density-loose` 骨架，需要：
1. `tokens.css` 完善 `density-tight` 内减小所有 `--t-*` 值
2. `tokens.css` 完善 `density-loose` 内增大所有 `--t-*` 值
3. Settings 页面加"显示密度"选择器（紧凑 / 正常 / 宽松）
4. 持久化到 localStorage

---

## 七、进度追踪

### 已完成（已提交）

| 提交 | 内容 |
|------|------|
| `7cfb32a` | TagEdit 布局重写、StepShell overflow 修复、BulkActionBar/TagAutocomplete/SaveBar/TagEditor 全部改用 CSS 变量（去掉 Tailwind 原生黑色系） |
| `6527fde` | cli.py onnxruntime bootstrap 修复（进度可见 + 镜像回退）；Curation 排序二字竖排修复 |
| `628fe17` | 添加样式统一计划文档（STYLE_UNIFICATION.md） |
| *(下一条)* | 批次 0：tailwind.config.js token 映射；批次 1：ErrorBoundary/Toast/ImageGrid/FileList/JobProgress/VersionTabs 去除硬编码原生色 |

### 待开始

- 批次 0：Tailwind 配置扩展（tailwind.config.js token 映射）
- 批次 1：剩余 Tailwind 原生色组件迁移（ImageGrid、Toast、JobProgress 等）
- 批次 2：CSS 变量内联 → className 替换
- 批次 3：页面文件清理
- 暗色模式 toggle
- 字号调节

---

*本文件随每次样式相关提交更新。格式：在「已完成」表格追加行，在对应批次表格勾选复选框。*
