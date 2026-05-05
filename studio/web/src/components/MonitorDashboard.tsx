/**
 * MonitorDashboard — native React training monitor
 * Replaces the monitor_smooth.html iframe.
 * Data source: GET /api/state?task_id=N  +  SSE monitor_state_updated
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type MonitorState } from '../api/client'
import { useEventStream } from '../lib/useEventStream'

// ── helpers ────────────────────────────────────────────────────────────────

function fmtSec(sec: number): string {
  if (!sec || sec < 0) return '--'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

function calcEMA(data: number[], alpha = 0.02): number[] {
  if (!data.length) return []
  const out = [data[0]]
  for (let i = 1; i < data.length; i++) out.push(alpha * data[i] + (1 - alpha) * out[i - 1])
  return out
}

function downsample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr
  return Array.from({ length: n }, (_, i) => arr[Math.round((i * (arr.length - 1)) / (n - 1))])
}

// ── StatCard ───────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, tone }: {
  label: string
  value: string
  sub?: string
  tone?: 'accent' | 'ok' | 'warn'
}) {
  const color = tone ? `var(--${tone})` : 'var(--fg-primary)'
  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--r-md)',
      padding: '14px 18px',
    }}>
      <div style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 'var(--t-3xl)', fontWeight: 600, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em', color, lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  )
}

// ── LossChart (pure SVG) ───────────────────────────────────────────────────

function LossChart({ losses, emaAlpha }: {
  losses: Array<{ step: number; loss: number }>
  emaAlpha: number
}) {
  if (!losses.length) return (
    <div style={{ height: 240, display: 'grid', placeItems: 'center', color: 'var(--fg-tertiary)', fontSize: 'var(--t-sm)' }}>
      等待数据…
    </div>
  )

  const pts = downsample(losses, 600)
  const raw = pts.map((p) => p.loss)
  const smooth = calcEMA(raw, emaAlpha)
  const steps = pts.map((p) => p.step)

  const W = 760, H = 220, PX = 36, PY = 14
  const minV = Math.min(...smooth), maxV = Math.max(...smooth)
  const range = maxV - minV || 0.001
  const x = (i: number) => PX + (i / (pts.length - 1)) * (W - PX - 8)
  const y = (v: number) => PY + (1 - (v - minV) / range) * (H - PY - PY)

  const smoothPath = smooth.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const areaPath = smoothPath + ` L${x(smooth.length - 1).toFixed(1)},${H - PY} L${PX},${H - PY}Z`
  const rawPath = raw.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')

  // y axis labels
  const yTicks = [minV, (minV + maxV) / 2, maxV].map((v) => ({
    v, y: y(v), label: v.toFixed(4),
  }))
  // x axis labels (5 evenly)
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const i = Math.round(t * (pts.length - 1))
    return { x: x(i), label: String(steps[i] ?? '') }
  })

  const lastY = y(smooth[smooth.length - 1])

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 240, display: 'block' }}>
      {/* grid */}
      {[0.25, 0.5, 0.75].map((t) => (
        <line key={t} x1={PX} y1={PY + t * (H - 2 * PY)} x2={W - 8} y2={PY + t * (H - 2 * PY)}
          stroke="var(--border-subtle)" strokeDasharray="3 3" />
      ))}
      {/* area */}
      <path d={areaPath} fill="var(--accent-soft)" opacity="0.5" />
      {/* raw (faint) */}
      <path d={rawPath} stroke="rgba(74,71,64,0.18)" strokeWidth="1" fill="none" />
      {/* smooth */}
      <path d={smoothPath} stroke="var(--accent)" strokeWidth="2" fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {/* last point */}
      <circle cx={x(smooth.length - 1)} cy={lastY} r="4" fill="var(--accent)" stroke="var(--bg-surface)" strokeWidth="2" />
      {/* y axis labels */}
      {yTicks.map(({ v, y: yt, label }) => (
        <text key={v} x={PX - 4} y={yt + 3.5} fontSize="9" fill="var(--fg-tertiary)"
          fontFamily="var(--font-mono)" textAnchor="end">{label}</text>
      ))}
      {/* x axis labels */}
      {xTicks.map(({ x: xt, label }) => (
        <text key={label} x={xt} y={H - 2} fontSize="9" fill="var(--fg-tertiary)"
          fontFamily="var(--font-mono)" textAnchor="middle">{label}</text>
      ))}
    </svg>
  )
}

// ── Sparkline ─────────────────────────────────────────────────────────────

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <div style={{ height: 50 }} />
  const W = 200, H = 50
  const min = Math.min(...values), max = Math.max(...values)
  const range = max - min || 0.001
  const x = (i: number) => (i / (values.length - 1)) * W
  const y = (v: number) => H - ((v - min) / range) * H
  const path = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 50, marginTop: 8, display: 'block' }}>
      <path d={path} stroke={color} strokeWidth="1.5" fill="none" />
    </svg>
  )
}

// ── SampleGrid ────────────────────────────────────────────────────────────

function SampleGrid({ samples, taskId }: {
  samples: Array<{ path: string; step?: number }>
  taskId: number
}) {
  const [active, setActive] = useState(0)

  const list = useMemo(() => {
    // newest first, max 24
    return [...samples].reverse().slice(0, 24)
  }, [samples])

  useEffect(() => { setActive(0) }, [list])

  if (!list.length) return (
    <div style={{ display: 'grid', placeItems: 'center', height: 200, color: 'var(--fg-tertiary)', fontSize: 'var(--t-sm)' }}>
      等待采样图…
    </div>
  )

  const cur = list[active]
  const filename = cur.path.split(/[\\/]/).pop() ?? cur.path
  const imgUrl = api.sampleImageUrl(filename, taskId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Thumbnail strip */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: 8, background: 'var(--bg-sunken)', borderRadius: 'var(--r-sm)' }}>
        {list.map((s, i) => {
          const fn = s.path.split(/[\\/]/).pop() ?? s.path
          return (
            <button
              key={i}
              onClick={() => setActive(i)}
              style={{
                width: 44, height: 44, borderRadius: 'var(--r-sm)', overflow: 'hidden',
                border: `2px solid ${i === active ? 'var(--accent)' : 'transparent'}`,
                background: 'var(--bg-overlay)', padding: 0, cursor: 'pointer',
                transition: 'border-color 0.12s',
                flexShrink: 0,
              }}
            >
              <img
                src={api.sampleImageUrl(fn, taskId)}
                alt={`step ${s.step ?? i}`}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none' }}
              />
            </button>
          )
        })}
      </div>
      {/* Large preview */}
      <div style={{ flex: 1, minHeight: 200, background: 'var(--bg-sunken)', borderRadius: 'var(--r-sm)', overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img
          key={imgUrl}
          src={imgUrl}
          alt="sample preview"
          style={{ maxWidth: '100%', maxHeight: 320, objectFit: 'contain', display: 'block' }}
        />
        {cur.step != null && (
          <div style={{
            position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(246,245,241,0.9)', border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--r-sm)', padding: '2px 10px',
            fontSize: 'var(--t-xs)', fontFamily: 'var(--font-mono)', color: 'var(--fg-secondary)',
          }}>
            step <strong style={{ color: 'var(--accent)' }}>{cur.step.toLocaleString()}</strong>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function MonitorDashboard({ taskId }: { taskId: number }) {
  const [state, setState] = useState<MonitorState | null>(null)
  const [connected, setConnected] = useState(false)
  const [emaAlpha, setEmaAlpha] = useState(0.02)
  const lastUpdateRef = useRef(0)

  const load = useCallback(async () => {
    try {
      const s = await api.getMonitorState(taskId)
      setState(s)
      setConnected(true)
      lastUpdateRef.current = Date.now()
    } catch {
      if (Date.now() - lastUpdateRef.current > 5000) setConnected(false)
    }
  }, [taskId])

  useEffect(() => {
    void load()
    // Poll every 5s as fallback
    const t = window.setInterval(() => void load(), 5000)
    return () => window.clearInterval(t)
  }, [load])

  useEventStream((evt) => {
    if (evt.type === 'monitor_state_updated' && String(evt.task_id) === String(taskId)) {
      if (evt.state) {
        setState(evt.state as MonitorState)
        setConnected(true)
        lastUpdateRef.current = Date.now()
      } else {
        void load()
      }
    }
  })

  // Derived stats
  const losses = useMemo(() => state?.losses ?? [], [state?.losses])
  const lrHistory = useMemo(() => state?.lr_history ?? [], [state?.lr_history])
  const samples = useMemo(() => state?.samples ?? [], [state?.samples])
  const step = state?.step ?? 0
  const totalSteps = state?.total_steps ?? 0
  const speed = state?.speed ?? 0
  const eta = speed > 0 && totalSteps > step ? fmtSec((totalSteps - step) / speed) : '--'
  const progress = totalSteps > 0 ? Math.min(100, (step / totalSteps) * 100) : 0
  const elapsed = state?.start_time ? fmtSec(Date.now() / 1000 - state.start_time) : '--'

  // Current loss
  const lastLoss = useMemo(() => {
    if (!losses.length) return null
    const raw = losses.map((l) => l.loss)
    const ema = calcEMA(raw, emaAlpha)
    return ema[ema.length - 1]
  }, [losses, emaAlpha])

  // Current LR
  const lastLr = lrHistory.length ? lrHistory[lrHistory.length - 1].lr : null
  const fmtLr = (v: number | null) => {
    if (v === null) return '--'
    if (v < 0.0001) return v.toExponential(1)
    return v.toFixed(5).replace(/0+$/, '').replace(/\.$/, '')
  }

  const vram = state?.vram_used_gb
  const vramTotal = state?.vram_total_gb
  const vramTone = vram && vramTotal ? (vram / vramTotal > 0.85 ? 'warn' : 'ok') as 'ok' | 'warn' : undefined

  if (!state && !connected) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: 200, color: 'var(--fg-tertiary)', fontSize: 'var(--t-sm)' }}>
        等待训练数据…
      </div>
    )
  }

  const lrSparkline = lrHistory.slice(-60).map((l) => l.lr)
  const config = state?.config ?? {}

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 16, overflowY: 'auto' }}>
      {/* Connection status + progress */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)', fontFamily: 'var(--font-mono)',
        flexShrink: 0,
      }}>
        <span style={{
          width: 7, height: 7, borderRadius: '50%',
          background: connected ? 'var(--ok)' : 'var(--err)',
          display: 'inline-block', flexShrink: 0,
          animation: connected ? 'pulse 2s infinite' : 'none',
        }} />
        {connected ? '实时' : '已断开'}
        {totalSteps > 0 && (
          <>
            <span style={{ color: 'var(--border-default)' }}>·</span>
            <span>{step.toLocaleString()} / {totalSteps.toLocaleString()} steps</span>
            <span style={{ color: 'var(--border-default)' }}>·</span>
            <span>{progress.toFixed(1)}%</span>
            <div style={{ flex: 1, height: 4, background: 'var(--bg-overlay)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent)', borderRadius: 2, transition: 'width 1s ease-out' }} />
            </div>
            <span>elapsed {elapsed}</span>
          </>
        )}
        <span style={{ flex: 1 }} />
        <a href={`/monitor_smooth.html?task_id=${taskId}`} target="_blank" rel="noopener"
          style={{ color: 'var(--fg-tertiary)', textDecoration: 'none' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--fg-primary)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--fg-tertiary)' }}
        >独立监控 ↗</a>
      </div>

      {/* 5 stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
        <StatCard label="step" value={step ? step.toLocaleString() : '--'}
          sub={totalSteps ? `of ${totalSteps.toLocaleString()}` : undefined} tone="accent" />
        <StatCard label="loss" value={lastLoss != null ? lastLoss.toFixed(4) : '--'}
          sub={losses.length > 1 ? `↓ trend` : 'awaiting'} tone="ok" />
        <StatCard label="lr" value={fmtLr(lastLr)}
          sub={lrHistory.length ? 'learning rate' : undefined} />
        <StatCard
          label={vram ? 'vram' : 'speed'}
          value={vram ? `${vram.toFixed(1)} GB` : speed ? `${speed.toFixed(2)} it/s` : '--'}
          sub={vramTotal ? `of ${vramTotal.toFixed(0)} GB · ${((vram! / vramTotal) * 100).toFixed(0)}%` : undefined}
          tone={vramTone}
        />
        <StatCard label="eta" value={eta} sub={speed ? `${speed.toFixed(2)} it/s` : undefined} />
      </div>

      {/* Loss chart + samples */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 14 }}>
        {/* Loss chart */}
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 'var(--t-sm)', fontWeight: 600 }}>loss</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                smooth
                <input type="range" min="0.001" max="0.3" step="0.001" value={emaAlpha}
                  onChange={(e) => setEmaAlpha(parseFloat(e.target.value))}
                  style={{ width: 60, accentColor: 'var(--accent)' }}
                />
                <span style={{ fontFamily: 'var(--font-mono)', width: '3ch' }}>{emaAlpha.toFixed(2)}</span>
              </label>
            </div>
          </div>
          <LossChart losses={losses} emaAlpha={emaAlpha} />
        </div>

        {/* Samples */}
        <div className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontSize: 'var(--t-sm)', fontWeight: 600 }}>采样</span>
            <span style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)', fontFamily: 'var(--font-mono)' }}>{samples.length} 张</span>
          </div>
          <div style={{ flex: 1, padding: 10, minHeight: 0 }}>
            <SampleGrid samples={samples} taskId={taskId} />
          </div>
        </div>
      </div>

      {/* LR sparkline + config */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 14 }}>
        {/* LR chart */}
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 'var(--t-sm)', fontWeight: 600, marginBottom: 6 }}>learning rate</div>
          <div style={{ fontSize: 'var(--t-2xl)', fontWeight: 600, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: 'var(--warn)' }}>
            {fmtLr(lastLr)}
          </div>
          <Sparkline values={lrSparkline} color="var(--warn)" />
        </div>

        {/* Config */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 'var(--t-sm)', fontWeight: 600 }}>训练配置</span>
            <span className="caption">{Object.keys(config).length} 项</span>
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {Object.entries(config).map(([k, v], i, arr) => (
              <div key={k} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '6px 14px', fontSize: 'var(--t-xs)',
                borderBottom: i < arr.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-overlay)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <span style={{ color: 'var(--fg-tertiary)', fontFamily: 'var(--font-mono)' }}>{k}</span>
                <span style={{ color: 'var(--fg-primary)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{String(v)}</span>
              </div>
            ))}
            {Object.keys(config).length === 0 && (
              <div style={{ padding: 14, color: 'var(--fg-tertiary)', fontSize: 'var(--t-xs)', textAlign: 'center' }}>
                训练配置加载中…
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
