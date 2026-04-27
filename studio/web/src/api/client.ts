// 与 FastAPI 守护进程交互的薄封装。
// 开发时由 Vite proxy 转发到 127.0.0.1:8765；生产部署时与 API 同源。

export interface HealthResponse {
  status: string
  version: string
}

async function getJSON<T>(path: string): Promise<T> {
  const resp = await fetch(path, { headers: { Accept: 'application/json' } })
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`)
  return (await resp.json()) as T
}

export const api = {
  health: () => getJSON<HealthResponse>('/api/health'),
  state: () => getJSON<Record<string, unknown>>('/api/state'),
}
