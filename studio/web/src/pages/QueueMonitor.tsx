import { Link, useParams } from 'react-router-dom'

/** PP6.1 — Queue 行点 「📊 监控」 进来。iframe 嵌 monitor_smooth.html?task_id=N，
 * 老 HTML 自己读 query 把 task_id 透传给 /api/state 与 /samples/。 */
export default function QueueMonitorPage() {
  const { id } = useParams<{ id: string }>()
  if (!id || !/^\d+$/.test(id)) {
    return <p className="text-red-300">非法任务 id</p>
  }
  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex items-center gap-2 px-1 pb-2 text-xs">
        <Link to="/queue" className="text-cyan-400 hover:underline">
          ← 队列
        </Link>
        <span className="text-slate-500">·</span>
        <span className="text-slate-300">任务 #{id} 监控</span>
        <span className="flex-1" />
        <a
          href={`/monitor_smooth.html?task_id=${id}`}
          target="_blank"
          rel="noopener"
          className="text-slate-400 hover:text-cyan-400"
        >
          独立窗口打开 ↗
        </a>
      </div>
      <iframe
        src={`/monitor_smooth.html?task_id=${id}`}
        title={`monitor-task-${id}`}
        className="flex-1 w-full border-0 bg-slate-950"
      />
    </div>
  )
}
