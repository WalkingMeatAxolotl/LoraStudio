import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type Task, type TaskStatus } from '../api/client'
import StepShell from '../components/StepShell'
import { useToast } from '../components/Toast'
import { useEventStream } from '../lib/useEventStream'

async function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function pickJsonFile(): Promise<unknown | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.json,application/json'
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) { resolve(null); return }
      try { resolve(JSON.parse(await f.text())) }
      catch { alert('JSON 解析失败'); resolve(null) }
    }
    input.click()
  })
}

type TaskKind = 'train' | 'tag' | 'reg' | 'download' | 'curate' | 'unknown'

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending:   '排队中',
  running:   '运行中',
  done:      '已完成',
  failed:    '失败',
  canceled:  '已取消',
}

const STATUS_TONE: Record<TaskStatus, string> = {
  pending:   'neutral',
  running:   'accent',
  done:      'ok',
  failed:    'err',
  canceled:  'neutral',
}

function inferKind(task: Task): TaskKind {
  const n = task.config_name.toLowerCase()
  if (n.includes('train') || n.includes('lora')) return 'train'
  if (n.includes('tag') || n.includes('caption') || n.includes('wd14')) return 'tag'
  if (n.includes('reg') || n.includes('regular')) return 'reg'
  if (n.includes('download') || n.includes('booru')) return 'download'
  if (n.includes('curate') || n.includes('filter')) return 'curate'
  return 'unknown'
}

const KIND_LABEL: Record<TaskKind, string> = {
  train: '训练', tag: '打标', reg: '正则', download: '下载', curate: '筛选', unknown: '任务',
}

function fmtAgo(ts: number): string {
  const sec = Math.max(0, Date.now() / 1000 - ts)
  if (sec < 60) return '刚刚'
  if (sec < 3600) return `${Math.floor(sec / 60)}m 前`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h 前`
  return `${Math.floor(sec / 86400)}d 前`
}

function fmtDuration(start: number | null, end: number | null): string {
  if (!start) return '—'
  const e = end ?? Date.now() / 1000
  const sec = Math.max(0, e - start)
  if (sec < 60) return `${sec.toFixed(0)}s`
  const m = Math.floor(sec / 60); const s = Math.floor(sec % 60)
  if (m < 60) return `${m}m ${s}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function fmtDurationShort(ms: number): string {
  if (ms < 60e3) return `${Math.round(ms / 1e3)}s`
  if (ms < 3600e3) return `${Math.round(ms / 60e3)}m`
  return `${(ms / 3600e3).toFixed(1)}h`
}

export default function QueuePage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const reloadTimer = useRef<number | null>(null)
  const { toast } = useToast()
  const navigate = useNavigate()

  const reload = useCallback(async () => {
    try { setTasks(await api.listQueue()); setError(null) }
    catch (e) { setError(String(e)) }
    finally { setLoaded(true) }
  }, [])

  useEventStream((evt) => {
    if (evt.type !== 'task_state_changed') return
    if (reloadTimer.current) return
    reloadTimer.current = window.setTimeout(() => {
      reloadTimer.current = null; void reload()
    }, 100)
  })

  useEffect(() => { void reload() }, [reload])
  useEffect(() => {
    const hasRunning = tasks.some((t) => t.status === 'running')
    if (!hasRunning) return
    const tick = window.setInterval(() => setTasks((ts) => [...ts]), 2000)
    return () => window.clearInterval(tick)
  }, [tasks])

  const clearDone = async () => {
    const done = tasks.filter((t) => t.status === 'done')
    if (done.length === 0) { toast('没有已完成的任务', 'success'); return }
    if (!confirm(`删除 ${done.length} 个已完成任务？`)) return
    setBusy(true)
    try {
      for (const t of done) await api.deleteTask(t.id)
      toast(`已清理 ${done.length} 个任务`, 'success')
      await reload()
    } catch (e) { toast(String(e), 'error') }
    finally { setBusy(false) }
  }

  const sorted = useMemo(() => [...tasks].sort((a, b) => b.id - a.id), [tasks])

  const prevCount = useCallback((taskId: number): number => {
    let count = 0
    for (const t of sorted) {
      if (t.id === taskId) break
      if (t.status === 'running' || t.status === 'pending') count++
    }
    return count
  }, [sorted])

  const estimateEta = useCallback((task: Task): string | null => {
    if (task.status !== 'running' || !task.started_at) return null
    const elapsed = (Date.now() / 1000 - task.started_at) * 1000
    return `已运行 ${fmtDurationShort(elapsed)}`
  }, [])

  const hasRunning = useMemo(() => tasks.some(t => t.status === 'running'), [tasks])

  return (
    <StepShell
      idx={-1}
      eyebrow="全局 · queue"
      title="队列"
      subtitle="同一时刻仅运行一个任务 · 完成后自动启动下一个"
      actions={
        <>
          <button onClick={clearDone} disabled={busy} className="btn btn-ghost btn-sm">清理已完成</button>
          {hasRunning && (
            <button
              className="btn btn-secondary btn-sm"
              style={{ color: 'var(--warn)', borderColor: 'var(--warn)' }}
            >
              暂停队列
            </button>
          )}
          <button
            disabled={busy || tasks.length === 0}
            onClick={async () => {
              try { await downloadJson(`queue_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`, await api.exportQueue()) }
              catch (e) { setError(String(e)) }
            }}
            className="btn btn-ghost btn-sm"
          >导出</button>
          <button
            disabled={busy}
            onClick={async () => {
              const payload = await pickJsonFile()
              if (!payload) return
              setBusy(true)
              try {
                const r = await api.importQueue(payload)
                toast(`已导入 ${r.imported_count} 个任务${Object.keys(r.renamed).length ? `（${Object.keys(r.renamed).length} 个改名）` : ''}`, 'success')
                await reload()
              } catch (e) { setError(String(e)) }
              finally { setBusy(false) }
            }}
            className="btn btn-ghost btn-sm"
          >导入</button>
          <button onClick={() => void reload()} className="btn btn-ghost btn-sm">刷新</button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {error && (
          <div style={{
            padding: '10px 14px', borderRadius: 'var(--r-md)', background: 'var(--err-soft)',
            border: '1px solid var(--err)', color: 'var(--err)',
            fontSize: 'var(--t-xs)', fontFamily: 'var(--font-mono)',
          }}>
            {error}
          </div>
        )}

        {!loaded ? (
          <div style={{
            borderRadius: 'var(--r-lg)',
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)',
            overflow: 'hidden',
          }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} style={{
                padding: '18px 22px',
                display: 'grid', gridTemplateColumns: '60px 1fr 110px 1fr 160px', gap: 16,
                alignItems: 'center',
                borderBottom: i < 2 ? '1px solid var(--border-subtle)' : 'none',
                opacity: 0.4,
              }}>
                <div style={{ height: 14, background: 'var(--bg-overlay)', borderRadius: 4 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ height: 13, background: 'var(--bg-overlay)', borderRadius: 4, width: '60%' }} />
                  <div style={{ height: 10, background: 'var(--bg-overlay)', borderRadius: 4, width: '40%' }} />
                </div>
                <div style={{ height: 20, background: 'var(--bg-overlay)', borderRadius: 4 }} />
                <div style={{ height: 10, background: 'var(--bg-overlay)', borderRadius: 4 }} />
                <div style={{ height: 10, background: 'var(--bg-overlay)', borderRadius: 4 }} />
              </div>
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div style={{
            borderRadius: 'var(--r-lg)', border: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)',
            padding: '48px 0', textAlign: 'center',
          }}>
            <div style={{ fontSize: 'var(--t-md)', fontWeight: 600, color: 'var(--fg-secondary)', marginBottom: 6 }}>
              队列为空
            </div>
            <div style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-tertiary)' }}>
              从项目训练页入队任务即可
            </div>
          </div>
        ) : (
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            {sorted.map((t) => {
              const isRunning = t.status === 'running'
              const isTerminal = ['done', 'failed', 'canceled'].includes(t.status)
              const hasProject = !!(t.project_id && t.version_id)
              const kind = inferKind(t)
              const eta = estimateEta(t)
              const tone = STATUS_TONE[t.status]

              return (
                <button
                  key={t.id}
                  onClick={() => navigate(`/queue/${t.id}`)}
                  className="card card-hover"
                  style={{
                    padding: 0, textAlign: 'left',
                    border: isRunning ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
                    cursor: isRunning ? 'pointer' : 'default',
                    overflow: 'hidden', display: 'block',
                    background: isRunning ? 'var(--accent-soft)' : 'var(--bg-surface)',
                  }}
                >
                  <div style={{
                    padding: '16px 22px',
                    display: 'grid',
                    gridTemplateColumns: '60px 1fr 110px 1fr 160px',
                    gap: 16, alignItems: 'center',
                  }}>
                    {/* #ID */}
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)',
                      color: isRunning ? 'var(--accent)' : 'var(--fg-tertiary)',
                      fontWeight: isRunning ? 600 : 400,
                    }}>
                      #{t.id}
                    </span>

                    {/* 名称 + 种类 */}
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontWeight: 600, color: 'var(--fg-primary)',
                        fontSize: 'var(--t-sm)', overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {t.name}
                      </div>
                      <div style={{
                        fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)',
                        color: 'var(--fg-tertiary)', marginTop: 2,
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                        <span>{KIND_LABEL[kind]}</span>
                        <span>{t.config_name}</span>
                        {hasProject && (
                          <Link
                            to={`/projects/${t.project_id}/v/${t.version_id}/train`}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              color: 'var(--accent)', fontSize: 'var(--t-2xs)',
                              textDecoration: 'none', flexShrink: 0,
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.textDecoration = 'underline' }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.textDecoration = 'none' }}
                          >
                            项目
                          </Link>
                        )}
                      </div>
                    </div>

                    {/* 状态 */}
                    <span className={`badge badge-${tone}`} style={{ textAlign: 'center', fontSize: 'var(--t-xs)' }}>
                      {isRunning && <span className="dot dot-running" />}
                      {STATUS_LABEL[t.status]}
                    </span>

                    {/* 进度 / 报错 */}
                    <div style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-secondary)', minWidth: 0 }}>
                      {isRunning ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-tertiary)', fontSize: 'var(--t-xs)' }}>
                            {fmtDuration(t.started_at, null)}
                          </span>
                          <div style={{ height: 4, background: 'var(--bg-overlay)', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ height: '100%', background: 'var(--accent)', width: '42%', borderRadius: 2 }} />
                          </div>
                        </div>
                      ) : t.error_msg ? (
                        <span style={{ color: 'var(--err)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', fontSize: 'var(--t-xs)' }}>
                          {t.error_msg}
                        </span>
                      ) : isTerminal ? (
                        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-tertiary)', fontSize: 'var(--t-xs)' }}>
                          用时 {fmtDuration(t.started_at, t.finished_at)}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--fg-tertiary)', fontSize: 'var(--t-xs)' }}>—</span>
                      )}
                    </div>

                    {/* ETA / 时间 */}
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)',
                      color: 'var(--fg-tertiary)', textAlign: 'right',
                    }}>
                      {isRunning ? (
                        <>
                          {eta && <span style={{ color: 'var(--accent)' }}>{eta}</span>}
                          {eta && <br />}
                          <span style={{ fontSize: 'var(--t-xs)' }}>{fmtAgo(t.started_at!)} 开始</span>
                        </>
                      ) : t.finished_at ? (
                        <>
                          <span>{fmtAgo(t.finished_at)}</span>
                          <br />
                          <span style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)' }}>完成</span>
                        </>
                      ) : (
                        <span>前面 {prevCount(t.id)} 个</span>
                      )}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </StepShell>
  )
}
