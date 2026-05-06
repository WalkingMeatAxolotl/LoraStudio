import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  api,
  downloadBlob,
  type Task,
  type TaskOutputs,
  type TaskStatus,
} from '../api/client'
import { useToast } from '../components/Toast'
import { useEventStream } from '../lib/useEventStream'
import MonitorDashboard from '../components/MonitorDashboard'

type Tab = 'overview' | 'log' | 'monitor' | 'outputs'

const STATUS_BADGE: Record<TaskStatus, string> = {
  pending: 'badge badge-neutral',
  running: 'badge badge-accent',
  done: 'badge badge-ok',
  failed: 'badge badge-err',
  canceled: 'badge badge-neutral',
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: '待运行', running: '运行中', done: '完成', failed: '失败', canceled: '已取消',
}

const TERMINAL: ReadonlyArray<TaskStatus> = ['done', 'failed', 'canceled']

function fmtTime(ts: number | null | undefined): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false })
}

function fmtDuration(start?: number | null, end?: number | null): string {
  if (!start) return '—'
  const e = end ?? Date.now() / 1000
  const sec = Math.max(0, e - start)
  if (sec < 60) return `${sec.toFixed(0)}s`
  const m = Math.floor(sec / 60); const s = Math.floor(sec % 60)
  if (m < 60) return `${m}m ${s}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

// ── StatCard ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, mono, large, tone }: {
  label: string
  value: string
  sub?: string
  mono?: boolean
  large?: boolean
  tone?: 'accent' | 'ok' | 'warn' | 'err' | 'neutral'
}) {
  const toneClass = tone ? `text-${tone}` : 'text-fg-primary'
  return (
    <div className="flex flex-col gap-1 px-[18px] py-3.5 bg-surface rounded-md border border-subtle">
      <span className="text-xs text-fg-tertiary font-mono tracking-widest uppercase">
        {label}
      </span>
      <span
        className={`${large ? 'text-3xl' : 'text-xl'} font-semibold ${mono ? 'font-mono' : 'font-sans'} tabular-nums ${toneClass}`}
        style={{ letterSpacing: '-0.02em', lineHeight: 1.1 }}
      >
        {value}
      </span>
      {sub && (
        <span className="text-xs text-fg-tertiary font-mono">
          {sub}
        </span>
      )}
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function QueueDetailPage() {
  const { id } = useParams<{ id: string }>()
  const taskId = Number(id)
  const navigate = useNavigate()
  const { toast } = useToast()

  const [task, setTask] = useState<Task | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === 'undefined') return 'overview'
    const v = window.location.hash.replace(/^#/, '')
    return (['overview', 'log', 'monitor', 'outputs'] as const).includes(v as Tab) ? (v as Tab) : 'overview'
  })
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const h = `#${tab}`
      if (window.location.hash !== h) window.history.replaceState(null, '', h)
    }
  }, [tab])

  const reload = useCallback(async () => {
    if (!Number.isFinite(taskId)) return
    try { const t = await api.getTask(taskId); setTask(t); setError(null) }
    catch (e) { setError(String(e)) }
  }, [taskId])

  useEffect(() => { void reload() }, [reload])

  useEventStream((evt) => {
    if (evt.type === 'task_state_changed' && evt.task_id === taskId) void reload()
  })

  useEffect(() => {
    if (task?.status !== 'running') return
    const tick = window.setInterval(() => setTask((t) => (t ? { ...t } : t)), 2000)
    return () => window.clearInterval(tick)
  }, [task?.status])

  if (!Number.isFinite(taskId)) return <p className="text-err">无效任务 ID</p>

  const status = task?.status
  const isLive = status === 'running' || status === 'pending'
  const isTerminal = !!status && TERMINAL.includes(status)

  const cancel = async () => {
    if (!task) return
    setBusy(true)
    try { await api.cancelTask(task.id); toast('已发送取消信号', 'success'); void reload() }
    catch (e) { toast(String(e), 'error') }
    finally { setBusy(false) }
  }

  const retry = async () => {
    if (!task) return
    setBusy(true)
    try { const newTask = await api.retryTask(task.id); toast(`重试已入队 #${newTask.id}`, 'success'); navigate(`/queue/${newTask.id}`) }
    catch (e) { toast(String(e), 'error'); setBusy(false) }
    finally { setBusy(true) }
  }

  const remove = async () => {
    if (!task) return
    setBusy(true)
    try { await api.deleteTask(task.id); toast('已删除', 'success'); navigate('/queue') }
    catch (e) { toast(String(e), 'error'); setBusy(false); setConfirmDelete(false) }
  }

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'overview', label: '详情' },
    { key: 'log',      label: '日志' },
    { key: 'monitor',  label: '监控' },
    { key: 'outputs',  label: '输出' },
  ]

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Header */}
      <header className="px-6 py-4 border-b border-subtle flex flex-col gap-2 shrink-0 bg-canvas">
        <div className="flex items-center gap-2.5">
          <Link to="/queue" className="btn btn-ghost btn-sm no-underline"
          >← 队列</Link>
          <span className="text-fg-tertiary">/</span>
          <h1 className="m-0 text-xl font-semibold font-mono">
            #{taskId}
          </h1>
          {task && (
            <>
              <span className="text-fg-secondary text-md">{task.name}</span>
              <code className="text-xs text-fg-tertiary font-mono">{task.config_name}.yaml</code>
            </>
          )}
          {status && (
            <span className={STATUS_BADGE[status]}>
              {status === 'running' && <span className="dot dot-running" />}
              {STATUS_LABEL[status]}
            </span>
          )}
        </div>

        {error && (
          <div className="px-3 py-2 rounded-md bg-err-soft border border-err text-err text-xs font-mono">
            {error}
          </div>
        )}

        {/* Stat cards for running tasks */}
        {task && task.status === 'running' && (
          <div className="grid grid-cols-4 gap-2.5 mt-1">
            <StatCard label="运行时长" value={fmtDuration(task.started_at, null)} mono large tone="accent" />
            <StatCard label="开始时间" value={fmtTime(task.started_at)} mono />
            <StatCard label="Config" value={task.config_name} mono />
            <StatCard label="PID" value={task.pid ? String(task.pid) : '—'} mono />
          </div>
        )}
      </header>

      {/* Tabs */}
      <nav className="flex items-center gap-0 border-b border-subtle shrink-0 px-6">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`py-2 px-[18px] text-sm border-0 bg-transparent -mb-px cursor-pointer transition-colors ${tab === key ? 'font-semibold text-accent border-b-2 border-accent' : 'font-normal text-fg-tertiary hover:text-fg-primary border-b-2 border-transparent hover:border-default'}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Tab body */}
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {tab === 'overview' && task && <OverviewTab task={task} />}
        {tab === 'overview' && !task && (
          <div className="p-6 text-center text-fg-tertiary text-sm">
            加载中...
          </div>
        )}
        {tab === 'log' && <LogTab taskId={taskId} />}
        {tab === 'monitor' && <MonitorTab taskId={taskId} />}
        {tab === 'outputs' && <OutputsTab taskId={taskId} taskName={task?.name ?? ''} />}
      </div>

      {/* Footer actions */}
      <footer className="flex items-center gap-2 px-6 py-2.5 border-t border-subtle shrink-0 bg-surface">
        <Link to="/queue" className="btn btn-ghost btn-sm no-underline">
          ← 返回队列
        </Link>
        <span className="flex-1" />
        {isLive && (
          <button onClick={cancel} disabled={busy} className="btn btn-sm bg-warn-soft border border-warn text-warn"
          >取消任务</button>
        )}
        {isTerminal && (
          <>
            <button onClick={retry} disabled={busy} className="btn btn-primary btn-sm">重试</button>
            <button onClick={() => setConfirmDelete(true)} disabled={busy}
              className="btn btn-sm bg-err-soft border border-err text-err"
            >删除记录</button>
          </>
        )}
      </footer>

      {confirmDelete && task && (
        <ConfirmDialog
          title="删除任务记录"
          message={
            <>
              将永久删除任务{' '}
              <code className="text-fg-primary font-mono">#{task.id} {task.name}</code>{' '}
              的数据库记录。
              <br />
              <span className="text-fg-tertiary text-xs">
                LoRA / 训练日志 / 监控状态文件不会被删，仍在磁盘上。
              </span>
            </>
          }
          confirmLabel="删除"
          danger
          onConfirm={remove}
          onCancel={() => setConfirmDelete(false)}
          busy={busy}
        />
      )}
    </div>
  )
}

// ── OverviewTab ─────────────────────────────────────────────────────────────

function OverviewTab({ task }: { task: Task }) {
  const items: Array<{ label: string; value: React.ReactNode; mono?: boolean }> = [
    { label: 'ID',     value: <code className="font-mono">{task.id}</code> },
    { label: '名称',   value: task.name },
    { label: 'Config', value: <code className="font-mono">{task.config_name}.yaml</code> },
    { label: '状态',   value: <span className={STATUS_BADGE[task.status]}>{task.status === 'running' && <span className="dot dot-running" />}{STATUS_LABEL[task.status]}</span> },
    { label: '优先级', value: task.priority, mono: true },
    { label: '入队时间', value: fmtTime(task.created_at) },
    { label: '开始时间', value: fmtTime(task.started_at) },
    { label: '结束时间', value: fmtTime(task.finished_at) },
    { label: '运行时长', value: fmtDuration(task.started_at, task.finished_at), mono: true },
    { label: '退出码',   value: task.exit_code ?? '—', mono: true },
    { label: 'PID',     value: task.pid ?? '—', mono: true },
  ]

  if (task.project_id || task.version_id) {
    items.push({
      label: '来源',
      value: task.project_id && task.version_id ? (
        <Link to={`/projects/${task.project_id}/v/${task.version_id}/train`}
          className="text-accent font-mono text-sm"
        >项目 #{task.project_id} / v#{task.version_id}</Link>
      ) : '—',
    })
  }
  if (task.config_path) {
    items.push({ label: 'Config 路径', value: <code className="font-mono text-xs break-all">{task.config_path}</code> })
  }
  if (task.monitor_state_path) {
    items.push({ label: '监控文件', value: <code className="font-mono text-xs break-all">{task.monitor_state_path}</code> })
  }
  if (task.error_msg) {
    items.push({ label: '错误', value: <code className="font-mono text-xs break-all text-err">{task.error_msg}</code> })
  }

  return (
    <div className="overflow-y-auto p-5">
      <div className="card overflow-hidden p-0" style={{ maxWidth: 720 }}>
        {items.map((row, i) => (
          <div
            key={row.label}
            className={`grid gap-3 items-center px-[18px] py-2.5 ${i < items.length - 1 ? 'border-b border-subtle' : 'border-b-0'}`}
            style={{ gridTemplateColumns: '140px 1fr' }}
          >
            <span className="text-sm text-fg-tertiary font-normal">
              {row.label}
            </span>
            <span className={`text-sm text-fg-primary ${row.mono ? 'font-mono' : ''}`}>
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── LogTab ──────────────────────────────────────────────────────────────────

function LogTab({ taskId }: { taskId: number }) {
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const preRef = useRef<HTMLPreElement>(null)
  const contentRef = useRef('')

  const setBoth = useCallback((s: string) => { contentRef.current = s; setContent(s) }, [])

  const refresh = useCallback(async () => {
    try { const log = await api.getLog(taskId); setBoth(log.content); setError(null) }
    catch (e) { setError(String(e)) }
  }, [taskId, setBoth])

  useEffect(() => { setBoth(''); void refresh() }, [taskId, refresh, setBoth])

  useEventStream((evt) => {
    if (evt.task_id !== taskId) return
    if (evt.type === 'task_log_appended') {
      const text = typeof evt.text === 'string' ? evt.text : ''
      const prev = contentRef.current
      const sep = prev && !prev.endsWith('\n') ? '\n' : ''
      setBoth(prev + sep + text + '\n')
    } else if (evt.type === 'task_state_changed') {
      void refresh()
    }
  })

  useEffect(() => {
    if (autoScroll && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight
  }, [content, autoScroll])

  return (
    <div className="flex flex-col flex-1 min-h-0 p-4">
      <div className="flex items-center gap-3 text-xs pb-2.5 shrink-0">
        <label className="text-fg-tertiary flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)}
            style={{ width: 14, height: 14, accentColor: 'var(--accent)' }} />
          自动滚动
        </label>
        <span className="flex-1" />
        <button onClick={() => void refresh()} className="btn btn-ghost btn-sm">刷新</button>
      </div>
      {error && (
        <div className="mb-2.5 p-2.5 rounded-md bg-err-soft border border-err text-err text-xs font-mono">{error}</div>
      )}
      <pre ref={preRef} className="flex-1 min-h-0 overflow-auto bg-sunken border border-subtle rounded-md p-3.5 text-xs font-mono text-fg-secondary whitespace-pre-wrap break-all m-0" style={{ lineHeight: 1.6 }}>
        {content || <span className="text-fg-tertiary">（尚无日志）</span>}
      </pre>
    </div>
  )
}

// ── MonitorTab ──────────────────────────────────────────────────────────────

function MonitorTab({ taskId }: { taskId: number }) {
  return (
    <div className="flex-1 min-h-0 overflow-hidden">
      <MonitorDashboard taskId={taskId} />
    </div>
  )
}

// ── OutputsTab ──────────────────────────────────────────────────────────────

function OutputsTab({ taskId, taskName }: { taskId: number; taskName: string }) {
  const { toast } = useToast()
  const [data, setData] = useState<TaskOutputs | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [zipping, setZipping] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let alive = true
    void api.getTaskOutputs(taskId).then((r) => alive && setData(r)).catch((e) => alive && setError(String(e)))
    return () => { alive = false }
  }, [taskId, refreshKey])

  const sortedFiles = useMemo(() => data ? [...data.files].sort((a, b) => b.mtime - a.mtime) : [], [data])

  const openFolder = async () => {
    setBusy(true)
    try { const r = await api.openTaskFolder(taskId); toast(`已打开 ${r.opened}`, 'success') }
    catch (e) { toast(String(e), 'error') }
    finally { setBusy(false) }
  }

  const handleDownloadZip = async () => {
    if (zipping) return
    setZipping(true)
    try {
      const safe = taskName && /^[A-Za-z0-9_.-]+$/.test(taskName)
      const zipName = safe ? `${taskName}_outputs.zip` : `task_${taskId}_outputs.zip`
      await downloadBlob(api.taskOutputsZipUrl(taskId), zipName)
    } catch (e) { toast(`下载失败: ${e}`, 'error') }
    finally { setZipping(false) }
  }

  const copyPath = async () => {
    if (!data?.output_dir) return
    try { await navigator.clipboard.writeText(data.output_dir); toast('路径已复制', 'success') }
    catch { toast('复制失败（浏览器拒绝）', 'error') }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 p-4 gap-2.5">
      {data?.output_dir ? (
        <div className="flex items-center gap-2 text-xs shrink-0 border-b border-subtle pb-2.5">
          <span className="text-fg-tertiary shrink-0">目录</span>
          <code className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-fg-primary font-mono">{data.output_dir}</code>
          <button onClick={copyPath} className="btn btn-ghost btn-sm">复制</button>
          {data.supports_open_folder ? (
            <button onClick={openFolder} disabled={busy || !data.exists}
              className="btn btn-secondary btn-sm"
            >打开</button>
          ) : (
            <span className="text-xs text-fg-tertiary shrink-0">（远程）</span>
          )}
          <button onClick={() => setRefreshKey((k) => k + 1)} className="btn btn-ghost btn-sm">刷新</button>
          {data.exists && data.files.length > 0 && (
            <button onClick={handleDownloadZip} disabled={zipping} className="btn btn-primary btn-sm">
              {zipping ? '打包中...' : '下载全部'}
            </button>
          )}
        </div>
      ) : (
        <div className="text-fg-tertiary text-sm shrink-0 py-2">
          该任务没有 project / version 关联，找不到输出目录
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {error ? (
          <div className="p-2.5 rounded-md bg-err-soft border border-err text-err font-mono text-xs">{error}</div>
        ) : !data ? (
          <div className="text-fg-tertiary text-sm text-center p-5">加载中...</div>
        ) : !data.exists ? (
          <div className="text-warn text-sm text-center p-5">目录不存在</div>
        ) : sortedFiles.length === 0 ? (
          <div className="text-fg-tertiary text-sm text-center p-5">目录为空</div>
        ) : (
          <div className="card overflow-hidden p-0">
            <div
              className="grid gap-2 px-4 py-2 text-xs text-fg-tertiary border-b border-subtle font-mono"
              style={{ gridTemplateColumns: '1fr 100px 160px 80px' }}
            >
              <span>文件</span>
              <span className="text-right">大小</span>
              <span className="text-right">修改时间</span>
              <span className="text-right"></span>
            </div>
            {sortedFiles.map((f) => (
              <div
                key={f.name}
                className="grid gap-2 px-4 py-2 items-center border-b border-subtle text-xs hover:bg-overlay transition-colors"
                style={{ gridTemplateColumns: '1fr 100px 160px 80px' }}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <code className="font-mono text-fg-primary overflow-hidden text-ellipsis whitespace-nowrap">{f.name}</code>
                  {f.is_lora && <span className="badge badge-ok">LoRA</span>}
                </div>
                <span className="text-right font-mono text-fg-tertiary">{fmtBytes(f.size)}</span>
                <span className="text-right font-mono text-fg-tertiary">{fmtTime(f.mtime)}</span>
                <span className="text-right">
                  <a href={api.taskOutputDownloadUrl(taskId, f.name)} download={f.name}
                    className="text-accent no-underline hover:underline text-xs"
                  >下载</a>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── ConfirmDialog ───────────────────────────────────────────────────────────

function ConfirmDialog({
  title, message, confirmLabel = '确认', cancelLabel = '取消', danger = false, busy = false,
  onConfirm, onCancel,
}: {
  title: string; message: React.ReactNode; confirmLabel?: string; cancelLabel?: string
  danger?: boolean; busy?: boolean; onConfirm: () => void; onCancel: () => void
}) {
  return (
    <div onClick={onCancel} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div onClick={(e) => e.stopPropagation()} className="bg-elevated border border-subtle rounded-lg shadow-lg w-full max-w-[420px]">
        <header className="px-[18px] py-3.5 border-b border-subtle">
          <h3 className="m-0 text-md font-semibold text-fg-primary">{title}</h3>
        </header>
        <div className="px-[18px] py-3.5 text-sm text-fg-secondary">{message}</div>
        <footer className="px-[18px] py-3 border-t border-subtle flex items-center gap-2 justify-end">
          <button onClick={onCancel} disabled={busy} className="btn btn-ghost btn-sm">{cancelLabel}</button>
          <button onClick={onConfirm} disabled={busy}
            className={danger ? 'btn btn-sm bg-err border border-err text-fg-inverse' : 'btn btn-primary btn-sm'}
          >{busy ? '...' : confirmLabel}</button>
        </footer>
      </div>
    </div>
  )
}
