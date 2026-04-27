import { NavLink } from 'react-router-dom'

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

const linkClass = ({ isActive }: { isActive: boolean }): string =>
  'flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ' +
  (isActive
    ? 'bg-cyan-600/20 text-cyan-300'
    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60')

export default function Sidebar() {
  return (
    <aside className="w-48 shrink-0 flex flex-col py-6 px-3 border-r border-slate-800">
      <div className="px-3 mb-6">
        <div className="text-lg font-bold bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">
          AnimaStudio
        </div>
        <div className="text-xs text-slate-500 mt-0.5">v0.2</div>
      </div>
      <nav className="flex-1 space-y-1" aria-label="primary">
        {main.map((l) => (
          <NavLink key={l.to} to={l.to} end className={linkClass}>
            <span aria-hidden>{l.icon}</span>
            <span>{l.label}</span>
          </NavLink>
        ))}

        <div className="mt-4 mb-1 px-3 text-[10px] uppercase tracking-wider text-slate-600 font-semibold">
          工具
        </div>
        <div className="border-t border-slate-800 mb-2" />
        {tools.map((l) => (
          <NavLink key={l.to} to={l.to} end className={linkClass}>
            <span aria-hidden>{l.icon}</span>
            <span>{l.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
