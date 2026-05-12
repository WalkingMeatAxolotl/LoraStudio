import { useEffect, useState } from 'react'
import { api, type SystemStats as SystemStatsData } from '../api/client'

const POLL_MS = 2500

function toneClass(pct: number): string {
  if (pct >= 90) return 'text-err'
  if (pct >= 70) return 'text-warn'
  return 'text-fg-primary'
}

function fmtGb(used: number, total: number): string {
  return `${used.toFixed(1)}/${Math.round(total)}G`
}

interface PillProps {
  label: string
  value: string
  toneCls: string
  tooltip: string
}

function Pill({ label, value, toneCls, tooltip }: PillProps) {
  return (
    <span className="flex items-baseline gap-1.5" title={tooltip}>
      <span className="text-2xs uppercase tracking-wider text-fg-tertiary">{label}</span>
      <span className={`font-mono text-xs tabular-nums ${toneCls}`}>{value}</span>
    </span>
  )
}

export default function SystemStats() {
  const [stats, setStats] = useState<SystemStatsData | null>(null)

  useEffect(() => {
    let cancelled = false
    let firstFetchDone = false

    const tick = async () => {
      try {
        const s = await api.systemStats()
        if (!cancelled) {
          setStats(s)
          firstFetchDone = true
        }
      } catch {
        // 单次失败保留上次的数据；后端临时挂掉时 topbar 不闪烁
        if (!firstFetchDone && !cancelled) {
          // 首次拉就失败：组件保持不可见，避免空白 pill 占位
        }
      }
    }
    void tick()
    const id = setInterval(tick, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  if (!stats) return null

  const gpu0 = stats.gpu && stats.gpu.length > 0 ? stats.gpu[0] : null
  const ramPct = stats.ram_total_gb > 0 ? (stats.ram_used_gb / stats.ram_total_gb) * 100 : 0
  const vramPct = gpu0 && gpu0.vram_total_gb > 0 ? (gpu0.vram_used_gb / gpu0.vram_total_gb) * 100 : 0

  const gpuExtra = stats.gpu && stats.gpu.length > 1
    ? ` (+${stats.gpu.length - 1} more)`
    : ''
  const gpuTempText = gpu0?.temp_c != null ? ` · ${gpu0.temp_c}°C` : ''
  const gpuLabel = gpu0 ? `${gpu0.name}${gpuTempText}${gpuExtra}` : ''

  return (
    <div className="hidden md:flex items-center gap-4 shrink-0">
      <Pill
        label="CPU"
        value={`${stats.cpu_pct.toFixed(0)}%`}
        toneCls={toneClass(stats.cpu_pct)}
        tooltip={`CPU 占用 ${stats.cpu_pct.toFixed(1)}%`}
      />
      <Pill
        label="MEM"
        value={fmtGb(stats.ram_used_gb, stats.ram_total_gb)}
        toneCls={toneClass(ramPct)}
        tooltip={`内存 ${stats.ram_used_gb.toFixed(1)} / ${stats.ram_total_gb.toFixed(1)} GB (${ramPct.toFixed(0)}%)`}
      />
      {gpu0 && (
        <>
          <Pill
            label="GPU"
            value={`${gpu0.util_pct}%`}
            toneCls={toneClass(gpu0.util_pct)}
            tooltip={`GPU 利用率 · ${gpuLabel}`}
          />
          <Pill
            label="VRAM"
            value={fmtGb(gpu0.vram_used_gb, gpu0.vram_total_gb)}
            toneCls={toneClass(vramPct)}
            tooltip={`显存 ${gpu0.vram_used_gb.toFixed(1)} / ${gpu0.vram_total_gb.toFixed(1)} GB (${vramPct.toFixed(0)}%) · ${gpuLabel}`}
          />
        </>
      )}
    </div>
  )
}
