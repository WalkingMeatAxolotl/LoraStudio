import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useProjectCtx } from '../context/ProjectContext'
import { api, type MonitorState, type Task } from '../api/client'
import { useEventStream, type StudioEvent } from '../lib/useEventStream'
import CommandPalette from './CommandPalette'

const SearchIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
  </svg>
)

const QueueIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </svg>
)

// ── 格式化工具 ──────────────────────────────────────────────────────────────

function formatETA(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}分`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return m > 0 ? `${h}时${m}分` : `${h}时`
}

function formatElapsed(from: number): string {
  const s = Math.max(0, (Date.now() / 1000) - from)
  if (s < 60) return `${Math.round(s)}s`
  if (s < 3600) return `${Math.round(s / 60)}分`
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  return m > 0 ? `${h}时${m}分` : `${h}时`
}

// ── breadcrumb ──────────────────────────────────────────────────────────────

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

// ── Topbar ──────────────────────────────────────────────────────────────────

export default function Topbar() {
  const crumbs = useBreadcrumbs()
  const navigate = useNavigate()
  const [paletteOpen, setPaletteOpen] = useState(false)

  // 队列详细状态
  const [runningTask, setRunningTask] = useState<Task | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [monitor, setMonitor] = useState<MonitorState | null>(null)

  const refreshQueue = useCallback(async () => {
    try {
      const [running, pending] = await Promise.all([
        api.listQueue('running'),
        api.listQueue('pending'),
      ])
      const firstRunning = running.length > 0 ? running[0] : null
      setRunningTask(firstRunning)
      setPendingCount(pending.length)

      // 有运行中任务时，拉取 MonitorState
      if (firstRunning) {
        try {
          const ms = await api.getMonitorState(firstRunning.id)
          setMonitor(ms)
        } catch {
          setMonitor(null)
        }
      } else {
        setMonitor(null)
      }
    } catch {
      // 忽略
    }
  }, [])

  // 初次加载 + 定时刷新
  useEffect(() => {
    let cancelled = false
    void refreshQueue()

    // 有 running 任务时更快轮询（3s），否则慢轮询（10s）
    const interval = runningTask ? 3000 : 10000
    const timer = setInterval(() => {
      if (cancelled) return
      void refreshQueue()
    }, interval)
    return () => { cancelled = true; clearInterval(timer) }
  }, [refreshQueue, runningTask])

  // SSE 事件监听
  useEventStream((evt: StudioEvent) => {
    if (evt.type === 'task_state_changed') {
      void refreshQueue()
    }
  })

  // ⌘K / Ctrl+K 快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setPaletteOpen((p) => !p)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // ── 计算进度 ──
  const progress = (() => {
    if (!monitor || !runningTask) return null

    // 有 step → 训练进度
    if (monitor.step != null && monitor.total_steps != null && monitor.total_steps > 0) {
      const pct = Math.round((monitor.step / monitor.total_steps) * 100)
      let eta = ''
      if (monitor.speed && monitor.speed > 0) {
        const remaining = (monitor.total_steps - monitor.step) / monitor.speed
        eta = `~${formatETA(remaining)}`
      }
      return { pct, current: monitor.step, total: monitor.total_steps, eta, unit: 'step' as const }
    }

    // 有 epoch → epoch 进度
    if (monitor.epoch != null && monitor.total_epochs != null && monitor.total_epochs > 0) {
      const pct = Math.round((monitor.epoch / monitor.total_epochs) * 100)
      return { pct, current: monitor.epoch, total: monitor.total_epochs, unit: 'epoch' as const }
    }

    // 有 started_at 但无 step → 显示运行时间，无百分比
    if (monitor.start_time) {
      const elapsed = formatElapsed(monitor.start_time)
      return { currentUnit: `运行 ${elapsed}` } as const
    }

    return null
  })()
  const progressBarW = progress && 'pct' in progress ? `${Math.min(100, (progress as { pct: number }).pct)}%` : '0%'

  // ── 渲染 ──
  return (
    <>
      <header
        className="flex items-center gap-4 border-b border-subtle bg-canvas shrink-0 px-5"
        style={{ height: 'var(--topbar-h)' }}
      >
        {/* breadcrumb */}
        <div className="flex items-center gap-2 min-w-0" style={{ flex: runningTask ? '0 1 auto' : 1 }}>
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

        {/* 队列进度（运行中任务） */}
        {runningTask && (
          <button
            onClick={() => navigate(`/queue/${runningTask.id}`)}
            className="flex items-center gap-2 px-2.5 py-1 rounded border border-subtle bg-surface cursor-pointer hover:border-bold transition-colors min-w-0 shrink"
            title={`任务 #${runningTask.id}: ${runningTask.config_name}`}
          >
            {/* 脉冲点 */}
            <span className="dot dot-running shrink-0" />

            {/* 名称 */}
            <span className="text-xs font-mono text-fg-primary overflow-hidden text-ellipsis whitespace-nowrap">
              #{runningTask.id} · {runningTask.config_name || runningTask.name || '—'}
            </span>

            {/* 进度条 */}
            {progress && 'pct' in progress ? (
              <div className="flex items-center gap-1.5">
                <div className="w-16 h-1.5 rounded-full bg-sunken overflow-hidden shrink-0">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-500"
                    style={{ width: progressBarW }}
                  />
                </div>
                <span className="text-2xs font-mono text-fg-tertiary whitespace-nowrap">
                  {progress.pct}% {progress.unit} {progress.current}/{progress.total}
                  {progress.eta ? <span className="ml-1 text-fg-secondary">{progress.eta}</span> : null}
                </span>
              </div>
            ) : progress && 'currentUnit' in progress ? (
              <span className="text-2xs font-mono text-fg-tertiary">{progress.currentUnit}</span>
            ) : (
              <span className="text-2xs font-mono text-fg-tertiary whitespace-nowrap">
                {runningTask.started_at ? `运行 ${formatElapsed(runningTask.started_at)}` : '准备中…'}
              </span>
            )}
          </button>
        )}

        {/* 排队数量（无运行中） */}
        {!runningTask && pendingCount > 0 && (
          <button
            onClick={() => navigate('/queue')}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono text-fg-primary bg-warn-soft border-none cursor-pointer hover:bg-warn/20 transition-colors shrink-0"
          >
            {QueueIcon}
            <span>{pendingCount} 排队中</span>
          </button>
        )}

        {/* 运行 + 排队数量 */}
        {runningTask && pendingCount > 0 && (
          <span className="text-2xs text-fg-tertiary font-mono whitespace-nowrap shrink-0">
            +{pendingCount} 排队
          </span>
        )}

        {/* 弹性空白 */}
        <span className="flex-1 min-w-0" />

        {/* 搜索按钮 */}
        <button
          onClick={() => setPaletteOpen(true)}
          className="flex items-center gap-2 text-fg-tertiary text-sm bg-surface border border-dim rounded-md cursor-pointer min-w-[200px] py-[5px] pl-3 pr-[10px] hover:border-bold transition-colors shrink-0"
        >
          {SearchIcon}
          <span className="flex-1 text-left">跳转 / 搜索…</span>
          <span className="kbd">⌘K</span>
        </button>
      </header>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  )
}
