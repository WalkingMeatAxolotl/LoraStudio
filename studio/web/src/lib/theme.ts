/** 主题 + 字号密度的 runtime 切换。
 *
 * tokens.css 里定义了三组 CSS variable layer：
 *   - .theme-dark  → 暗色调色板（不加这个类即为日间默认）
 *   - .density-tight / .density-loose → 紧凑 / 宽松字号 + 间距（无类即默认）
 *
 * 这个模块负责把用户选择持久化到 localStorage，并在 boot 时（main.tsx 里
 * `initTheme()`）和 Settings 页里手动切换时把对应类挂在 documentElement 上。
 */

export type Theme = 'light' | 'dark'
export type Density = 'tight' | 'default' | 'loose'

const KEY_THEME = 'studio.theme'
const KEY_DENSITY = 'studio.density'

const DEFAULT_THEME: Theme = 'light'
const DEFAULT_DENSITY: Density = 'default'

function safeGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function safeSet(key: string, val: string) {
  try { localStorage.setItem(key, val) } catch { /* ignore */ }
}

// ── theme ──────────────────────────────────────────────────────────────────
export function getStoredTheme(): Theme {
  const v = safeGet(KEY_THEME)
  return v === 'dark' ? 'dark' : 'light'
}

export function setStoredTheme(t: Theme): void {
  safeSet(KEY_THEME, t)
}

export function applyTheme(t: Theme): void {
  const root = document.documentElement
  if (t === 'dark') root.classList.add('theme-dark')
  else root.classList.remove('theme-dark')
}

export function toggleTheme(): Theme {
  const next: Theme = getStoredTheme() === 'dark' ? 'light' : 'dark'
  setStoredTheme(next)
  applyTheme(next)
  return next
}

// ── density ────────────────────────────────────────────────────────────────
export function getStoredDensity(): Density {
  const v = safeGet(KEY_DENSITY)
  return v === 'tight' || v === 'loose' ? v : 'default'
}

export function setStoredDensity(d: Density): void {
  safeSet(KEY_DENSITY, d)
}

export function applyDensity(d: Density): void {
  const root = document.documentElement
  root.classList.remove('density-tight', 'density-loose')
  if (d === 'tight') root.classList.add('density-tight')
  else if (d === 'loose') root.classList.add('density-loose')
  // 'default' 不加类
}

// ── boot ───────────────────────────────────────────────────────────────────
export function initTheme(): void {
  applyTheme(getStoredTheme() || DEFAULT_THEME)
  applyDensity(getStoredDensity() || DEFAULT_DENSITY)
}
