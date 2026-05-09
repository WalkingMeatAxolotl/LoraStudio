import { useEffect, useState } from 'react'
import { api, type DaemonStatus } from '../../../api/client'
import { useEventStream } from '../../../lib/useEventStream'
import { useToast } from '../../../components/Toast'

export default function DaemonControls() {
  const { toast } = useToast()
  const [status, setStatus] = useState<DaemonStatus | null>(null)
  const [unloading, setUnloading] = useState(false)

  useEffect(() => {
    void api.getDaemonStatus()
      .then(setStatus)
      .catch(() => { /* 启动一闪 — server 还没起齐时容忍 */ })
  }, [])

  useEventStream((evt) => {
    if (evt.type === 'daemon_state_changed') {
      setStatus({
        state: evt.state,
        model_loaded: !!evt.model_loaded,
        busy: !!evt.busy,
        alive: evt.state !== 'stopped',
      } as DaemonStatus)
    }
  })

  const handleUnload = async () => {
    setUnloading(true)
    try {
      const r = await api.unloadDaemon()
      if (r.noop) {
        toast('模型未加载', 'info')
      } else {
        toast('已请求卸载', 'success')
      }
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setUnloading(false)
    }
  }

  if (!status) return null

  const label = status.busy
    ? '生成中'
    : status.state === 'unloading'
      ? '卸载中…'
      : status.model_loaded
        ? '模型已加载'
        : status.state === 'stopped'
          ? '未启动'
          : '空闲（未加载）'

  const dotClass = status.busy
    ? 'bg-warn'
    : status.model_loaded
      ? 'bg-success'
      : 'bg-subtle'

  const canUnload = status.model_loaded && !status.busy && status.state !== 'unloading'

  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          <span className={`inline-block w-2 h-2 rounded-full ${dotClass}`} />
          <span className="text-fg-secondary">推理 daemon</span>
          <span className="text-fg-tertiary">{label}</span>
        </div>
        <button
          className="btn btn-ghost text-xs"
          style={{ padding: '4px 10px' }}
          onClick={handleUnload}
          disabled={!canUnload || unloading}
          title={
            status.busy ? '生成中不可卸载'
              : !status.model_loaded ? '模型未加载，无需卸载'
                : '释放 VRAM；下次出图按需重 load'
          }
        >
          {unloading ? '请求中…' : '卸载模型'}
        </button>
      </div>
    </div>
  )
}
