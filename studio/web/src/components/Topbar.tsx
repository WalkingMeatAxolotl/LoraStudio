import { useLocation } from 'react-router-dom'
import { useProjectCtx } from '../context/ProjectContext'

const SearchIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
  </svg>
)

interface Crumb { label: string; mono?: boolean }

function useBreadcrumbs(): Crumb[] {
  const { pathname } = useLocation()
  const ctx = useProjectCtx()
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

    const projectLabel = ctx?.project?.title ?? (parts[1] ? `#${parts[1]}` : null)
    if (projectLabel) crumbs.push({ label: projectLabel })

    const vIdx = parts.indexOf('v')
    if (vIdx !== -1 && parts[vIdx + 1]) {
      const versionLabel = ctx?.activeVersion?.label ?? `v${parts[vIdx + 1]}`
      crumbs.push({ label: versionLabel, mono: true })
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
    <header
      className="flex items-center gap-4 border-b border-subtle bg-canvas shrink-0 px-5"
      style={{ height: 'var(--topbar-h)' }}
    >
      {/* breadcrumb */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {crumbs.map((b, i) => (
          <span key={i} className="flex items-center gap-2">
            {i > 0 && <span className="text-fg-tertiary select-none">/</span>}
            <span className={
              `text-sm ${b.mono ? 'font-mono' : ''} ` +
              (i === crumbs.length - 1 ? 'text-fg-primary font-semibold' : 'text-fg-secondary')
            }>
              {b.label}
            </span>
          </span>
        ))}
      </div>

      {/* search placeholder */}
      <button className="flex items-center gap-2 text-fg-tertiary text-sm bg-surface border border-dim rounded-md cursor-default min-w-[200px] py-[5px] pl-3 pr-[10px]">
        {SearchIcon}
        <span className="flex-1 text-left">跳转 / 搜索…</span>
        <span className="kbd">⌘K</span>
      </button>
    </header>
  )
}
