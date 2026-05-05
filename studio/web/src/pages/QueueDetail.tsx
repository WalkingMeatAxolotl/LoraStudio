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
  const toneColor = tone ? `var(--${tone})` : 'var(--fg-primary)'
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 4,
      padding: '14px 18px',
      background: 'var(--bg-surface)',
      borderRadius: 'var(--r-md)',
      border: '1px solid var(--border-subtle)',
    }}>
      <span style={{
        fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)',
        fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}>
        {label}
      </span>
      <span style={{
        fontSize: large ? 'var(--t-3xl)' : 'var(--t-xl)',
        fontWeight: 600,
        fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '-0.02em',
        color: toneColor,
        lineHeight: 1.1,
      }}>
        {value}
      </span>
      {sub && (
        <span style={{
          fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)',
          fontFamily: 'var(--font-mono)',
        }}>
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

  if (!Number.isFinite(taskId)) return <p style={{ color: 'var(--err)' }}>无效任务 ID</p>

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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      {/* Header */}
      <header style={{
        padding: '16px 24px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', flexDirection: 'column', gap: 8,
        flexShrink: 0, background: 'var(--bg-canvas)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link to="/queue" className="btn btn-ghost btn-sm"
            style={{ textDecoration: 'none' }}
          >← 队列</Link>
          <span style={{ color: 'var(--fg-tertiary)' }}>/</span>
          <h1 style={{ margin: 0, fontSize: 'var(--t-xl)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
            #{taskId}
          </h1>
          {task && (
            <>
              <span style={{ color: 'var(--fg-secondary)', fontSize: 'var(--t-md)' }}>{task.name}</span>
              <code style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)', fontFamily: 'var(--font-mono)' }}>{task.config_name}.yaml</code>
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
          <div style={{
            padding: '8px 12px', borderRadius: 'var(--r-md)',
            background: 'var(--err-soft)', border: '1px solid var(--err)',
            color: 'var(--err)', fontSize: 'var(--t-xs)', fontFamily: 'var(--font-mono)',
          }}>
            {error}
          </div>
        )}

        {/* Stat cards for running tasks */}
        {task && task.status === 'running' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 4 }}>
            <StatCard label="运行时长" value={fmtDuration(task.started_at, null)} mono large tone="accent" />
            <StatCard label="开始时间" value={fmtTime(task.started_at)} mono />
            <StatCard label="Config" value={task.config_name} mono />
            <StatCard label="PID" value={task.pid ? String(task.pid) : '—'} mono />
          </div>
        )}
      </header>

      {/* Tabs */}
      <nav style={{
        display: 'flex', alignItems: 'center', gap: 0,
        borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0, padding: '0 24px',
      }}>
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: '8px 18px',
              fontSize: 'var(--t-sm)',
              fontWeight: tab === key ? 600 : 400,
              border: 'none', background: 'transparent',
              color: tab === key ? 'var(--accent)' : 'var(--fg-tertiary)',
              borderBottom: tab === key ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1, cursor: 'pointer',
            }}
            onMouseEnter={(e) => { if (tab !== key) { (e.currentTarget as HTMLElement).style.color = 'var(--fg-primary)'; (e.currentTarget as HTMLElement).style.borderBottomColor = 'var(--border-default)' } }}
            onMouseLeave={(e) => { if (tab !== key) { (e.currentTarget as HTMLElement).style.color = 'var(--fg-tertiary)'; (e.currentTarget as HTMLElement).style.borderBottomColor = 'transparent' } }}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Tab body */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {tab === 'overview' && task && <OverviewTab task={task} />}
        {tab === 'overview' && !task && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-tertiary)', fontSize: 'var(--t-sm)' }}>
            加载中...
          </div>
        )}
        {tab === 'log' && <LogTab taskId={taskId} />}
        {tab === 'monitor' && <MonitorTab taskId={taskId} />}
        {tab === 'outputs' && <OutputsTab taskId={taskId} taskName={task?.name ?? ''} />}
      </div>

      {/* Footer actions */}
      <footer style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 24px',
        borderTop: '1px solid var(--border-subtle)', flexShrink: 0,
        background: 'var(--bg-surface)',
      }}>
        <Link to="/queue" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>
          ← 返回队列
        </Link>
        <span style={{ flex: 1 }} />
        {isLive && (
          <button onClick={cancel} disabled={busy} className="btn btn-sm"
            style={{ background: 'var(--warn-soft)', border: '1px solid var(--warn)', color: 'var(--warn)' }}
          >取消任务</button>
        )}
        {isTerminal && (
          <>
            <button onClick={retry} disabled={busy} className="btn btn-primary btn-sm">重试</button>
            <button onClick={() => setConfirmDelete(true)} disabled={busy}
              className="btn btn-sm"
              style={{ background: 'var(--err-soft)', border: '1px solid var(--err)', color: 'var(--err)' }}
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
              <code style={{ color: 'var(--fg-primary)', fontFamily: 'var(--font-mono)' }}>#{task.id} {task.name}</code>{' '}
              的数据库记录。
              <br />
              <span style={{ color: 'var(--fg-tertiary)', fontSize: 'var(--t-xs)' }}>
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
    { label: 'ID',     value: <code style={{ fontFamily: 'var(--font-mono)' }}>{task.id}</code> },
    { label: '名称',   value: task.name },
    { label: 'Config', value: <code style={{ fontFamily: 'var(--font-mono)' }}>{task.config_name}.yaml</code> },
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
          style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)' }}
        >项目 #{task.project_id} / v#{task.version_id}</Link>
      ) : '—',
    })
  }
  if (task.config_path) {
    items.push({ label: 'Config 路径', value: <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)', wordBreak: 'break-all' }}>{task.config_path}</code> })
  }
  if (task.monitor_state_path) {
    items.push({ label: '监控文件', value: <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)', wordBreak: 'break-all' }}>{task.monitor_state_path}</code> })
  }
  if (task.error_msg) {
    items.push({ label: '错误', value: <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)', wordBreak: 'break-all', color: 'var(--err)' }}>{task.error_msg}</code> })
  }

  return (
    <div style={{ overflowY: 'auto', padding: 20 }}>
      <div className="card" style={{ padding: 0, overflow: 'hidden', maxWidth: 720 }}>
        {items.map((row, i) => (
          <div key={row.label} style={{
            display: 'grid', gridTemplateColumns: '140px 1fr',
            alignItems: 'center', gap: 12, padding: '10px 18px',
            borderBottom: i < items.length - 1 ? '1px solid var(--border-subtle)' : 'none',
          }}>
            <span style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-tertiary)', fontWeight: 400 }}>
              {row.label}
            </span>
            <span style={{
              fontSize: 'var(--t-sm)', color: 'var(--fg-primary)',
              fontFamily: row.mono ? 'var(--font-mono)' : 'inherit',
            }}>
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
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, padding: 16 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, fontSize: 'var(--t-xs)',
        paddingBottom: 10, flexShrink: 0,
      }}>
        <label style={{ color: 'var(--fg-tertiary)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)}
            style={{ width: 14, height: 14, accentColor: 'var(--accent)' }} />
          自动滚动
        </label>
        <span style={{ flex: 1 }} />
        <button onClick={() => void refresh()} className="btn btn-ghost btn-sm">刷新</button>
      </div>
      {error && (
        <div style={{
          marginBottom: 10, padding: 10, borderRadius: 'var(--r-md)',
          background: 'var(--err-soft)', border: '1px solid var(--err)',
          color: 'var(--err)', fontSize: 'var(--t-xs)', fontFamily: 'var(--font-mono)',
        }}>{error}</div>
      )}
      <pre ref={preRef} style={{
        flex: 1, minHeight: 0, overflow: 'auto',
        background: 'var(--bg-sunken)', border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--r-md)', padding: 14,
        fontSize: 'var(--t-xs)', fontFamily: 'var(--font-mono)',
        color: 'var(--fg-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        margin: 0, lineHeight: 1.6,
      }}>
        {content || <span style={{ color: 'var(--fg-tertiary)' }}>（尚无日志）</span>}
      </pre>
    </div>
  )
}

// ── MonitorTab ──────────────────────────────────────────────────────────────

function MonitorTab({ taskId }: { taskId: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, padding: 16 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--t-xs)',
        paddingBottom: 10, flexShrink: 0,
      }}>
        <span style={{ color: 'var(--fg-tertiary)' }}>训练监控 · 实时</span>
        <span style={{ flex: 1 }} />
        <a
          href={`/monitor_smooth.html?task_id=${taskId}`}
          target="_blank" rel="noopener"
          className="btn btn-ghost btn-sm"
          style={{ textDecoration: 'none' }}
        >独立窗口打开 ↗</a>
      </div>
      <iframe
        src={`/monitor_smooth.html?task_id=${taskId}`}
        title={`monitor-task-${taskId}`}
        style={{
          flex: 1, width: '100%',
          borderRadius: 'var(--r-md)',
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-sunken)',
        }}
      />
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
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, padding: 16, gap: 10 }}>
      {data?.output_dir ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--t-xs)',
          flexShrink: 0, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 10,
        }}>
          <span style={{ color: 'var(--fg-tertiary)', flexShrink: 0 }}>目录</span>
          <code style={{
            flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: 'nowrap', color: 'var(--fg-primary)', fontFamily: 'var(--font-mono)',
          }}>{data.output_dir}</code>
          <button onClick={copyPath} className="btn btn-ghost btn-sm">复制</button>
          {data.supports_open_folder ? (
            <button onClick={openFolder} disabled={busy || !data.exists}
              className="btn btn-secondary btn-sm"
            >打开</button>
          ) : (
            <span style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)', flexShrink: 0 }}>（远程）</span>
          )}
          <button onClick={() => setRefreshKey((k) => k + 1)} className="btn btn-ghost btn-sm">刷新</button>
          {data.exists && data.files.length > 0 && (
            <button onClick={handleDownloadZip} disabled={zipping} className="btn btn-primary btn-sm">
              {zipping ? '打包中...' : '下载全部'}
            </button>
          )}
        </div>
      ) : (
        <div style={{ color: 'var(--fg-tertiary)', fontSize: 'var(--t-sm)', flexShrink: 0, padding: '8px 0' }}>
          该任务没有 project / version 关联，找不到输出目录
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {error ? (
          <div style={{ padding: 10, borderRadius: 'var(--r-md)', background: 'var(--err-soft)', border: '1px solid var(--err)', color: 'var(--err)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)' }}>{error}</div>
        ) : !data ? (
          <div style={{ color: 'var(--fg-tertiary)', fontSize: 'var(--t-sm)', textAlign: 'center', padding: 20 }}>加载中...</div>
        ) : !data.exists ? (
          <div style={{ color: 'var(--warn)', fontSize: 'var(--t-sm)', textAlign: 'center', padding: 20 }}>目录不存在</div>
        ) : sortedFiles.length === 0 ? (
          <div style={{ color: 'var(--fg-tertiary)', fontSize: 'var(--t-sm)', textAlign: 'center', padding: 20 }}>目录为空</div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 100px 160px 80px',
              gap: 8, padding: '8px 16px', fontSize: 'var(--t-xs)',
              color: 'var(--fg-tertiary)', borderBottom: '1px solid var(--border-subtle)',
              fontFamily: 'var(--font-mono)',
            }}>
              <span>文件</span>
              <span style={{ textAlign: 'right' }}>大小</span>
              <span style={{ textAlign: 'right' }}>修改时间</span>
              <span style={{ textAlign: 'right' }}></span>
            </div>
            {sortedFiles.map((f) => (
              <div key={f.name} style={{
                display: 'grid', gridTemplateColumns: '1fr 100px 160px 80px',
                gap: 8, padding: '8px 16px', alignItems: 'center',
                borderBottom: '1px solid var(--border-subtle)',
                fontSize: 'var(--t-xs)',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-overlay)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <code style={{
                    fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{f.name}</code>
                  {f.is_lora && <span className="badge badge-ok">LoRA</span>}
                </div>
                <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--fg-tertiary)' }}>{fmtBytes(f.size)}</span>
                <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--fg-tertiary)' }}>{fmtTime(f.mtime)}</span>
                <span style={{ textAlign: 'right' }}>
                  <a href={api.taskOutputDownloadUrl(taskId, f.name)} download={f.name}
                    style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 'var(--t-xs)' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.textDecoration = 'underline' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.textDecoration = 'none' }}
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
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--r-lg)',
        boxShadow: 'var(--sh-xl)',
        width: '100%', maxWidth: 420,
      }}>
        <header style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)' }}>
          <h3 style={{ margin: 0, fontSize: 'var(--t-md)', fontWeight: 600, color: 'var(--fg-primary)' }}>{title}</h3>
        </header>
        <div style={{ padding: '14px 18px', fontSize: 'var(--t-sm)', color: 'var(--fg-secondary)' }}>{message}</div>
        <footer style={{ padding: '12px 18px', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} disabled={busy} className="btn btn-ghost btn-sm">{cancelLabel}</button>
          <button onClick={onConfirm} disabled={busy}
            className={danger ? 'btn btn-sm' : 'btn btn-primary btn-sm'}
            style={danger ? { background: 'var(--err)', border: '1px solid var(--err)', color: 'var(--err-fg)' } : {}}
          >{busy ? '...' : confirmLabel}</button>
        </footer>
      </div>
    </div>
  )
}
