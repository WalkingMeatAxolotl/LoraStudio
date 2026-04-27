import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

interface Link {
  to: string
  label: string
  icon: string
}

const main: Link[] = [
  { to: '/', label: '项目', icon: '📁' },
  { to: '/queue', label: '队列', icon: '🚦' },
]

const tools: Link[] = [
  { to: '/tools/presets', label: '预设', icon: '🎚' },
  { to: '/tools/monitor', label: '监控', icon: '📊' },
  { to: '/tools/settings', label: '设置', icon: '⚙️' },
]

const SIDEBAR_OVERRIDE_KEY = 'studio.globalSidebar.expanded'

export default function Sidebar() {
  const loc = useLocation()
  const inProject =
    loc.pathname.startsWith('/projects/') && loc.pathname !== '/projects/'

  // 默认：进项目页自动折叠成图标条；其它页展开。
  // 用户手动点切换会写一个 session 级 override，刷新就清。
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(
    () => {
      try {
        const v = sessionStorage.getItem(SIDEBAR_OVERRIDE_KEY)
        return v === '1' ? true : v === '0' ? false : null
      } catch {
        return null
      }
    }
  )

  // 路由切换且没有 override 时，默认行为接管
  useEffect(() => {
    // intentionally not resetting override on every nav — let user keep it
  }, [inProject])

  const expanded = expandedOverride ?? !inProject
  const collapsed = !expanded

  const toggle = () => {
    const next = !expanded
    setExpandedOverride(next)
    try {
      sessionStorage.setItem(SIDEBAR_OVERRIDE_KEY, next ? '1' : '0')
    } catch {
      /* ignore */
    }
  }

  const linkClass = ({ isActive }: { isActive: boolean }): string =>
    (collapsed
      ? 'flex items-center justify-center w-9 h-9 mx-auto my-1 rounded text-base transition-colors '
      : 'flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ') +
    (isActive
      ? 'bg-cyan-600/20 text-cyan-300'
      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60')

  return (
    <aside
      className={
        'shrink-0 flex flex-col border-r border-slate-800 transition-[width] duration-150 ' +
        (collapsed ? 'w-12 py-2 px-0' : 'w-44 py-4 px-2')
      }
    >
      {!collapsed ? (
        <div className="px-3 mb-4 flex items-start">
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent truncate">
              AnimaStudio
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">v0.2</div>
          </div>
          <button
            onClick={toggle}
            title="折叠侧栏"
            className="text-slate-500 hover:text-slate-200 text-xs px-1"
          >
            ‹
          </button>
        </div>
      ) : (
        <button
          onClick={toggle}
          title="展开侧栏"
          className="text-slate-500 hover:text-slate-200 text-xs h-6 mb-2"
        >
          ›
        </button>
      )}

      <nav className="flex-1" aria-label="primary">
        {main.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end
            className={linkClass}
            title={collapsed ? l.label : undefined}
          >
            <span aria-hidden>{l.icon}</span>
            {!collapsed && <span>{l.label}</span>}
          </NavLink>
        ))}

        {!collapsed ? (
          <>
            <div className="mt-3 mb-1 px-3 text-[10px] uppercase tracking-wider text-slate-600 font-semibold">
              工具
            </div>
            <div className="border-t border-slate-800 mb-1" />
          </>
        ) : (
          <div className="mx-2 my-2 border-t border-slate-800" />
        )}
        {tools.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end
            className={linkClass}
            title={collapsed ? l.label : undefined}
          >
            <span aria-hidden>{l.icon}</span>
            {!collapsed && <span>{l.label}</span>}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
