import { useLocation } from 'react-router-dom'

const SearchIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
  </svg>
)

interface Crumb { label: string; mono?: boolean }

function useBreadcrumbs(): Crumb[] {
  const { pathname } = useLocation()
  const parts = pathname.split('/').filter(Boolean)

  if (parts.length === 0) return [{ label: '项目' }]

  if (parts[0] === 'queue') {
    if (parts.length === 1) return [{ label: '队列' }]
    return [{ label: '队列' }, { label: `#${parts[1]}`, mono: true }]
  }

  if (parts[0] === 'tools') {
    const labels: Record<string, string> = { presets: '预设', monitor: '监控', settings: '设置' }
    return [{ label: labels[parts[1]] ?? parts[1] }]
  }

  if (parts[0] === 'projects') {
    const crumbs: Crumb[] = [{ label: '项目' }]
    if (parts[1]) crumbs.push({ label: parts[1], mono: true })
    const vIdx = parts.indexOf('v')
    if (vIdx !== -1 && parts[vIdx + 1]) {
      crumbs.push({ label: `v${parts[vIdx + 1]}`, mono: true })
      const stepLabels: Record<string, string> = {
        curate: '筛选', tag: '打标', edit: '标签编辑', reg: '正则集', train: '训练',
      }
      const step = parts[vIdx + 2]
      if (step && stepLabels[step]) crumbs.push({ label: stepLabels[step] })
    } else if (parts[2] === 'download') {
      crumbs.push({ label: '下载' })
    }
    return crumbs
  }

  return [{ label: pathname }]
}

export default function Topbar() {
  const crumbs = useBreadcrumbs()

  return (
    <header style={{
      height: 'var(--topbar-h)',
      padding: '0 20px',
      display: 'flex', alignItems: 'center', gap: 16,
      borderBottom: '1px solid var(--border-subtle)',
      background: 'var(--bg-canvas)',
      flexShrink: 0,
    }}>
      {/* breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
        {crumbs.map((b, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {i > 0 && <span style={{ color: 'var(--fg-tertiary)', userSelect: 'none' }}>/</span>}
            <span style={{
              fontSize: 'var(--t-sm)',
              fontFamily: b.mono ? 'var(--font-mono)' : 'var(--font-sans)',
              color: i === crumbs.length - 1 ? 'var(--fg-primary)' : 'var(--fg-secondary)',
              fontWeight: i === crumbs.length - 1 ? 600 : 400,
            }}>
              {b.label}
            </span>
          </span>
        ))}
      </div>

      {/* search placeholder */}
      <button style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 10px 5px 12px',
        background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
        borderRadius: 'var(--r-md)', color: 'var(--fg-tertiary)',
        fontSize: 'var(--t-sm)', minWidth: 200, cursor: 'default',
      }}>
        {SearchIcon}
        <span style={{ flex: 1, textAlign: 'left' }}>跳转 / 搜索…</span>
        <span className="kbd">⌘K</span>
      </button>
    </header>
  )
}
