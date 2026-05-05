import { useEffect, useMemo, useState } from 'react'
import { api, type HealthResponse, type Task } from '../../api/client'

export default function MonitorPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [taskId, setTaskId] = useState<number | null>(null)

  useEffect(() => {
    api.health().then(setHealth).catch((e) => setError(String(e)))
    api.listQueue().then(setTasks).catch(() => setTasks([]))
  }, [])

  const defaultTaskId = useMemo<number | null>(() => {
    const running = tasks.find((t) => t.status === 'running')
    if (running) return running.id
    const ended = [...tasks]
      .filter((t) => t.finished_at)
      .sort((a, b) => (b.finished_at ?? 0) - (a.finished_at ?? 0))[0]
    return ended?.id ?? null
  }, [tasks])

  useEffect(() => {
    if (taskId === null && defaultTaskId !== null) setTaskId(defaultTaskId)
  }, [defaultTaskId, taskId])

  const ok = !error && health?.status === 'ok'
  const selectedTask = tasks.find((t) => t.id === taskId)
  const iframeSrc = taskId
    ? `/monitor_smooth.html?task_id=${taskId}`
    : '/monitor_smooth.html'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      {/* 顶部状态栏 */}
      <section style={{
        borderRadius: 'var(--r-md)',
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)',
        padding: '10px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
        fontSize: 'var(--t-xs)', flexShrink: 0, flexWrap: 'wrap',
      }}>
        {/* 健康指示 */}
        <span style={{
          display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
          background: ok ? 'var(--ok)' : 'var(--err)',
          boxShadow: ok ? '0 0 6px var(--ok)' : '0 0 6px var(--err)',
        }} />
        <span style={{
          fontWeight: 600,
          color: ok ? 'var(--ok)' : 'var(--err)',
          fontFamily: 'var(--font-mono)',
        }}>
          {error ? 'offline' : health?.status ?? '...'}
        </span>
        {health && (
          <span style={{ color: 'var(--fg-tertiary)', fontFamily: 'var(--font-mono)' }}>
            v{health.version}
          </span>
        )}

        <span style={{ color: 'var(--border-subtle)' }}>|</span>

        {/* 任务选择 */}
        <span style={{ color: 'var(--fg-tertiary)' }}>任务</span>
        <select
          value={taskId ?? ''}
          onChange={(e) => setTaskId(e.target.value === '' ? null : Number(e.target.value))}
          style={{
            padding: '4px 10px',
            borderRadius: 'var(--r-sm)',
            background: 'var(--bg-sunken)',
            border: '1px solid var(--border-subtle)',
            fontSize: 'var(--t-xs)',
            color: 'var(--fg-primary)',
            outline: 'none',
          }}
        >
          <option value="">（最新 running，没有则显示空）</option>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              #{t.id} · {t.name} · {t.status}
            </option>
          ))}
        </select>

        {selectedTask && (
          <>
            <span style={{ color: 'var(--border-subtle)' }}>|</span>
            <span className={statusBadge(selectedTask.status)}>
              {statusLabel(selectedTask.status)}
            </span>
          </>
        )}

        <span style={{ flex: 1 }} />

        <a
          href={iframeSrc}
          target="_blank"
          rel="noreferrer"
          style={{
            fontSize: 'var(--t-xs)',
            color: 'var(--fg-tertiary)',
            textDecoration: 'none',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--fg-primary)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--fg-tertiary)' }}
        >
          独立窗口打开 ↗
        </a>
      </section>

      {/* 监控 iframe */}
      <iframe
        key={iframeSrc}
        src={iframeSrc}
        title="Anima Training Monitor"
        style={{
          flex: 1,
          width: '100%',
          borderRadius: 'var(--r-md)',
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-sunken)',
          minHeight: 0,
        }}
      />
    </div>
  )
}

function statusBadge(status: string): string {
  switch (status) {
    case 'running': return 'badge badge-accent'
    case 'pending': return 'badge badge-neutral'
    case 'done': return 'badge badge-ok'
    case 'failed': return 'badge badge-err'
    case 'canceled': return 'badge badge-neutral'
    default: return 'badge badge-neutral'
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'running': return '运行中'
    case 'pending': return '排队中'
    case 'done': return '已完成'
    case 'failed': return '失败'
    case 'canceled': return '已取消'
    default: return status
  }
}
