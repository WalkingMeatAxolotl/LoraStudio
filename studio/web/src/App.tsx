import { useEffect, useState } from 'react'
import { api, type HealthResponse } from './api/client'

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch((e) => setError(String(e)))
  }, [])

  const status = error ? 'offline' : health?.status ?? '...'
  const statusColor =
    status === 'ok'
      ? 'text-emerald-400'
      : status === 'offline'
      ? 'text-red-400'
      : 'text-slate-400'

  return (
    <div className="min-h-screen p-8 max-w-4xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">
          AnimaStudio
        </h1>
        <p className="text-slate-400 mt-1">
          训练监控、配置编辑、任务队列。当前为 P1 骨架。
        </p>
      </header>

      <section className="rounded-xl border border-slate-700 bg-slate-800/40 p-5 mb-4">
        <h2 className="text-base font-semibold mb-2 text-slate-200">守护进程状态</h2>
        <div className="flex items-center gap-3">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              status === 'ok' ? 'bg-emerald-400' : 'bg-red-400'
            }`}
          />
          <span className={statusColor}>{status}</span>
          {health && (
            <span className="text-slate-500 text-sm">v{health.version}</span>
          )}
        </div>
        {error && (
          <p className="text-red-400 text-sm mt-2 font-mono">{error}</p>
        )}
      </section>

      <section className="rounded-xl border border-slate-700 bg-slate-800/40 p-5">
        <h2 className="text-base font-semibold mb-3 text-slate-200">入口</h2>
        <ul className="space-y-2">
          <li>
            <a
              href="/"
              className="text-cyan-400 hover:text-cyan-300 hover:underline"
            >
              → 训练监控面板（旧 UI）
            </a>
          </li>
          <li className="text-slate-500 text-sm">
            P2 起将在此挂载：配置 / 数据集 / 队列 / 日志
          </li>
        </ul>
      </section>
    </div>
  )
}
