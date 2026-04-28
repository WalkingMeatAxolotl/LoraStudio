import { useEffect, useMemo, useState } from 'react'
import { api, type HealthResponse, type Task } from '../../api/client'

/** PP6.1 — 工具 / 监控：自动锁当前 running task；下拉切换历史任务。
 *
 * 默认：URL 没 ?task_id → 选 running 的；没有 running → 选最近一次完成的；
 * 都没有 → 显示空 monitor（iframe 仍能加载，state 全空）。
 */
export default function MonitorPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [taskId, setTaskId] = useState<number | null>(null)

  useEffect(() => {
    api.health().then(setHealth).catch((e) => setError(String(e)))
    api.listQueue().then(setTasks).catch(() => setTasks([]))
  }, [])

  // 自动锁定：running > 最近 done/failed/canceled
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
  const iframeSrc = taskId
    ? `/monitor_smooth.html?task_id=${taskId}`
    : '/monitor_smooth.html'

  return (
    <div className="flex flex-col h-full gap-3">
      <section className="rounded-xl border border-slate-700 bg-slate-800/40 px-5 py-3 flex items-center gap-3 flex-wrap">
        <span
          className={`inline-block w-2 h-2 rounded-full ${
            ok ? 'bg-emerald-400' : 'bg-red-400'
          }`}
        />
        <span className={ok ? 'text-emerald-400' : 'text-red-400'}>
          {error ? 'offline' : health?.status ?? '...'}
        </span>
        {health && (
          <span className="text-slate-500 text-sm">v{health.version}</span>
        )}

        <span className="text-slate-700">|</span>
        <label className="text-xs text-slate-400">任务</label>
        <select
          value={taskId ?? ''}
          onChange={(e) =>
            setTaskId(e.target.value === '' ? null : Number(e.target.value))
          }
          className="px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs"
        >
          <option value="">（最新 running，没有则显示空）</option>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              #{t.id} · {t.name} · {t.status}
            </option>
          ))}
        </select>

        <span className="flex-1" />
        <a
          href={iframeSrc}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-slate-400 hover:text-slate-200"
        >
          独立窗口打开 ↗
        </a>
      </section>

      <iframe
        key={iframeSrc} /* 切换 task 时强制重新加载 */
        src={iframeSrc}
        title="Anima Training Monitor"
        className="flex-1 w-full rounded-xl border border-slate-700 bg-black/30 min-h-0"
      />
    </div>
  )
}
