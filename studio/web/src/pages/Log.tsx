import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type Task } from '../api/client'
import { useEventStream } from '../lib/useEventStream'

export default function LogPage() {
  const { id } = useParams<{ id: string }>()
  const taskId = Number(id)
  const [task, setTask] = useState<Task | null>(null)
  const [content, setContent] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const preRef = useRef<HTMLPreElement>(null)

  const refresh = useCallback(async () => {
    if (!Number.isFinite(taskId)) return
    try {
      const [t, log] = await Promise.all([
        api.getTask(taskId),
        api.getLog(taskId),
      ])
      setTask(t)
      setContent(log.content)
    } catch (e) {
      setError(String(e))
    }
  }, [taskId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // SSE：状态变化时刷新一次（最终内容会追到 log 文件里）
  useEventStream((evt) => {
    if (evt.type === 'task_state_changed' && evt.task_id === taskId) {
      void refresh()
    }
  })

  // 任务运行中时每 2 秒拉一次最新日志
  useEffect(() => {
    if (task?.status !== 'running') return
    const tick = window.setInterval(() => void refresh(), 2000)
    return () => window.clearInterval(tick)
  }, [task?.status, refresh])

  // 自动滚到底部
  useEffect(() => {
    if (autoScroll && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight
    }
  }, [content, autoScroll])

  if (!Number.isFinite(taskId)) {
    return <div className="text-red-400">无效任务 ID</div>
  }

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-3 mb-3">
        <Link
          to="/queue"
          className="text-sm text-slate-400 hover:text-slate-200"
        >
          ← 队列
        </Link>
        <h1 className="text-lg font-semibold flex-1">
          任务 #{taskId}
          {task && (
            <span className="ml-2 text-slate-500 text-sm font-normal">
              {task.name} · {task.status}
            </span>
          )}
        </h1>
        <label className="text-xs text-slate-400 flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="h-3 w-3"
          />
          自动滚动
        </label>
        <button
          onClick={() => void refresh()}
          className="text-xs text-slate-400 hover:text-slate-200"
        >
          刷新
        </button>
      </header>

      {error && (
        <div className="mb-3 p-3 rounded bg-red-900/40 border border-red-700 text-red-300 text-sm font-mono">
          {error}
        </div>
      )}

      <pre
        ref={preRef}
        className="flex-1 overflow-auto bg-black/60 border border-slate-800 rounded p-3
          text-xs font-mono text-slate-300 whitespace-pre-wrap break-all min-h-0"
      >
        {content || (
          <span className="text-slate-600">（尚无日志）</span>
        )}
      </pre>
    </div>
  )
}
