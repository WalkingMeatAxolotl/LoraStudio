import { useEffect, useRef, useState } from 'react'
import {
  api,
  type AttentionBackend,
  type GenerateRequest,
  type LoraEntry,
  type MonitorState,
  type Task,
} from '../../api/client'
import PageHeader from '../../components/PageHeader'
import PathPicker from '../../components/PathPicker'
import { useToast } from '../../components/Toast'
import { useEventStream } from '../../lib/useEventStream'

interface RecentLora {
  label: string
  path: string
  createdAt: number
}

// ── SampleGallery ─────────────────────────────────────────────────────────────

function SampleGallery({ samples, taskId }: {
  samples: Array<{ path: string; step?: number }>
  taskId: number
}) {
  const [active, setActive] = useState(0)
  const prevLen = useRef(0)

  useEffect(() => {
    if (samples.length > prevLen.current) setActive(samples.length - 1)
    prevLen.current = samples.length
  }, [samples.length])

  if (!samples.length) {
    return (
      <div className="grid place-items-center rounded-md border border-subtle bg-sunken text-fg-tertiary text-sm" style={{ minHeight: 220 }}>
        等待生成图…
      </div>
    )
  }

  const cur = samples[active]
  const filename = cur.path.split(/[\\/]/).pop() ?? cur.path
  const fullUrl = api.generateSampleUrl(taskId, filename)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'thin' }}>
        {samples.map((s, i) => {
          const fn = s.path.split(/[\\/]/).pop() ?? s.path
          return (
            <button
              key={i}
              onClick={() => setActive(i)}
              className={`shrink-0 w-14 h-14 rounded overflow-hidden border-2 p-0 cursor-pointer bg-transparent transition-colors ${
                i === active ? 'border-accent' : 'border-transparent hover:border-dim'
              }`}
            >
              <img src={api.generateSampleUrl(taskId, fn)} className="w-full h-full object-cover" alt="" />
            </button>
          )
        })}
      </div>
      <a href={fullUrl} target="_blank" rel="noreferrer">
        <img
          src={fullUrl}
          className="w-full rounded-md border border-subtle object-contain"
          style={{ maxHeight: 480 }}
          alt={filename}
        />
      </a>
      <div className="text-xs text-fg-tertiary font-mono truncate">{filename}</div>
    </div>
  )
}

// ── LoraList ──────────────────────────────────────────────────────────────────

function LoraList({ loras, onChange, recent }: {
  loras: LoraEntry[]
  onChange: (l: LoraEntry[]) => void
  recent: RecentLora[]
}) {
  const [pickerIdx, setPickerIdx] = useState<number | null>(null)
  const [recentOpenIdx, setRecentOpenIdx] = useState<number | null>(null)

  const add = () => onChange([...loras, { path: '', scale: 1.0 }])
  const del = (i: number) => onChange(loras.filter((_, idx) => idx !== i))
  const setPath = (i: number, path: string) =>
    onChange(loras.map((l, idx) => idx === i ? { ...l, path } : l))
  const setScale = (i: number, scale: number) =>
    onChange(loras.map((l, idx) => idx === i ? { ...l, scale } : l))

  return (
    <div className="flex flex-col gap-2">
      {loras.map((l, i) => (
        <div key={i} className="flex gap-1.5 items-center">
          <div className="flex-1 flex gap-1 items-center bg-sunken border border-dim rounded-md px-2 py-1.5">
            <span className="text-xs text-fg-tertiary shrink-0 w-4 text-center font-mono">{i + 1}</span>
            <input
              type="text"
              className="input input-mono flex-1 border-0 bg-transparent p-0 text-xs"
              style={{ outline: 'none', boxShadow: 'none' }}
              placeholder="LoRA 路径…"
              value={l.path}
              onChange={(e) => setPath(i, e.target.value)}
            />
            {recent.length > 0 && (
              <button
                onClick={() => setRecentOpenIdx(recentOpenIdx === i ? null : i)}
                className="btn btn-ghost btn-sm text-xs shrink-0 px-1.5 text-fg-tertiary"
                title="最近训出的 LoRA"
              >
                最近
              </button>
            )}
            <button
              onClick={() => setPickerIdx(i)}
              className="btn btn-ghost btn-sm text-xs shrink-0 px-1.5"
              title="浏览文件"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
            </button>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-xs text-fg-tertiary">×</span>
            <input
              type="number"
              className="input text-center text-sm"
              style={{ width: 60, padding: '5px 6px' }}
              min={0} max={2} step={0.05}
              value={l.scale}
              onChange={(e) => setScale(i, Number(e.target.value))}
              title="权重倍率"
            />
          </div>
          <button onClick={() => del(i)} className="btn btn-ghost btn-sm text-fg-tertiary hover:text-err shrink-0 px-1.5">×</button>
        </div>
      ))}
      <button onClick={add} className="btn btn-ghost btn-sm self-start text-xs text-fg-tertiary">
        + 添加 LoRA
      </button>

      {/* 最近 LoRA 浮层（按行下方展开） */}
      {recentOpenIdx !== null && recent.length > 0 && (
        <div className="rounded-md border border-subtle bg-overlay px-2 py-1.5 flex flex-col gap-px text-sm">
          <div className="caption pb-1">最近训出的 LoRA</div>
          {recent.slice(0, 12).map((r) => (
            <button
              key={r.path}
              onClick={() => {
                setPath(recentOpenIdx, r.path)
                setRecentOpenIdx(null)
              }}
              className="flex items-center gap-2 text-left px-2 py-1 rounded text-xs cursor-pointer border-none bg-transparent text-fg-secondary hover:bg-surface"
            >
              <span className="flex-1 truncate">{r.label}</span>
              <span className="font-mono text-fg-tertiary text-2xs truncate" style={{ maxWidth: 280 }}>
                {r.path}
              </span>
            </button>
          ))}
          <button
            onClick={() => setRecentOpenIdx(null)}
            className="btn btn-ghost btn-sm self-end text-2xs text-fg-tertiary mt-1"
          >
            关闭
          </button>
        </div>
      )}

      {pickerIdx !== null && (
        <PathPicker
          dirOnly={false}
          onPick={(p) => { setPath(pickerIdx, p); setPickerIdx(null) }}
          onClose={() => setPickerIdx(null)}
        />
      )}
    </div>
  )
}

// ── PromptList ────────────────────────────────────────────────────────────────

function PromptList({ prompts, onChange }: {
  prompts: string[]
  onChange: (p: string[]) => void
}) {
  const add = () => onChange([...prompts, ''])
  const del = (i: number) => onChange(prompts.filter((_, idx) => idx !== i))
  const set = (i: number, v: string) => onChange(prompts.map((p, idx) => idx === i ? v : p))

  return (
    <div className="flex flex-col gap-2">
      {prompts.map((p, i) => (
        <div key={i} className="flex gap-1.5">
          {prompts.length > 1 && (
            <span className="caption mt-2.5 w-4 text-center shrink-0">{i + 1}</span>
          )}
          <textarea
            className="input flex-1 font-mono text-sm resize-y"
            rows={3}
            value={p}
            onChange={(e) => set(i, e.target.value)}
            placeholder="输入正向提示词…"
          />
          {prompts.length > 1 && (
            <button onClick={() => del(i)} className="btn btn-ghost btn-sm text-fg-tertiary hover:text-err self-start px-1.5">×</button>
          )}
        </div>
      ))}
      <button onClick={add} className="btn btn-ghost btn-sm self-start text-xs text-fg-secondary">
        + 添加 prompt（轮换生成）
      </button>
    </div>
  )
}

// ── NumField ──────────────────────────────────────────────────────────────────

function NumField({ label, value, onChange, min, max, step }: {
  label: string; value: number
  onChange: (v: number) => void
  min?: number; max?: number; step?: number
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="caption">{label}</label>
      <input
        type="number"
        className="input"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

// ── StatusBadge ───────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'done'    ? 'badge badge-ok'
    : status === 'running'  ? 'badge badge-info'
    : status === 'failed'   ? 'badge badge-err'
    : status === 'canceled' ? 'badge'
    : 'badge'
  const label =
    status === 'done'    ? '已完成'
    : status === 'running'  ? '生成中'
    : status === 'failed'   ? '失败'
    : status === 'pending'  ? '排队中'
    : status === 'canceled' ? '已取消'
    : status
  return <span className={cls}>{label}</span>
}

// ── GeneratePage ──────────────────────────────────────────────────────────────

const DEFAULT_NEG = 'worst quality, low quality, score_1, score_2, score_3, blurry, jpeg artifacts, bad anatomy, bad hands, bad feet, missing fingers, extra fingers, text, watermark, logo, signature'

export default function GeneratePage() {
  const { toast } = useToast()

  const [prompts, setPrompts] = useState<string[]>(['newest, safe, 1girl, masterpiece, best quality'])
  const [negPrompt, setNegPrompt] = useState(DEFAULT_NEG)
  const [width, setWidth] = useState(1024)
  const [height, setHeight] = useState(1024)
  const [steps, setSteps] = useState(25)
  const [cfgScale, setCfgScale] = useState(4.0)
  const [count, setCount] = useState(1)
  const [seed, setSeed] = useState(0)
  const [loras, setLoras] = useState<LoraEntry[]>([])
  const [attentionBackend, setAttentionBackend] = useState<AttentionBackend>('flash_attn')

  const [busy, setBusy] = useState(false)
  const [currentTask, setCurrentTask] = useState<Task | null>(null)
  const [monitorState, setMonitorState] = useState<MonitorState | null>(null)
  const taskIdRef = useRef<number | null>(null)
  taskIdRef.current = currentTask?.id ?? null

  // 最近训出的 LoRA：listProjects → 并行 getProject → 收集 output_lora_path。
  // 用户场景下 project 数 < 20，N+1 调用可接受；不在乎实时性，启动加载一次即可。
  const [recentLoras, setRecentLoras] = useState<RecentLora[]>([])
  useEffect(() => {
    void (async () => {
      try {
        const projects = await api.listProjects()
        const details = await Promise.all(
          projects.map((p) => api.getProject(p.id).catch(() => null))
        )
        const items: RecentLora[] = []
        for (const d of details) {
          if (!d) continue
          for (const v of d.versions) {
            if (v.output_lora_path) {
              items.push({
                label: `${d.title} / ${v.label}`,
                path: v.output_lora_path,
                createdAt: v.created_at,
              })
            }
          }
        }
        items.sort((a, b) => b.createdAt - a.createdAt)
        setRecentLoras(items)
      } catch {
        /* 启动失败不阻塞 — 用户仍可手敲 / PathPicker */
      }
    })()
  }, [])

  const samples = monitorState?.samples ?? []

  // SSE：task_state_changed 触发 task refresh；monitor_state_updated 推 sample 列表。
  // 不用 setInterval（与 dev 4e31c44 全 SSE 原则一致）。
  useEventStream((evt) => {
    const tid = taskIdRef.current
    if (tid == null) return
    if (evt.type === 'task_state_changed' && evt.task_id === tid) {
      void api.getGenerateTask(tid).then((t) => {
        setCurrentTask(t)
        if (t.status === 'done' || t.status === 'failed' || t.status === 'canceled') {
          setBusy(false)
        }
      }).catch(() => { /* task 已清也走这里 */ })
    } else if (
      evt.type === 'monitor_state_updated'
      && String(evt.task_id) === String(tid)
      && evt.state
    ) {
      setMonitorState(evt.state as MonitorState)
    }
  })

  const handleGenerate = async () => {
    if (!prompts.some((p) => p.trim())) {
      toast('请输入至少一条提示词', 'error')
      return
    }
    setBusy(true)
    setCurrentTask(null)
    setMonitorState(null)
    try {
      const body: GenerateRequest = {
        prompts: prompts.filter((p) => p.trim()),
        negative_prompt: negPrompt,
        width, height, steps, count, seed,
        cfg_scale: cfgScale,
        lora_configs: loras.filter((l) => l.path.trim()),
        attention_backend: attentionBackend,
      }
      const t = await api.enqueueGenerate(body)
      setCurrentTask(t)
      toast(`测试任务 #${t.id} 已入队`, 'success')
    } catch (e) {
      toast(String(e), 'error')
      setBusy(false)
    }
  }

  const handleCancel = async () => {
    if (!currentTask) return
    try {
      await api.cancelTask(currentTask.id)
      toast(`已请求取消 #${currentTask.id}`, 'info')
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const cancelable = currentTask
    && (currentTask.status === 'pending' || currentTask.status === 'running')

  return (
    <div className="fade-in">
      <PageHeader eyebrow="工具" title="测试" subtitle="独立运行推理，复用训练采样逻辑（出图不保存，关页面即丢）" />

      <div className="p-6 flex flex-col gap-4">

        {/* ── 提示词（全宽） ── */}
        <div className="card" style={{ padding: 18 }}>
          <div className="text-md font-semibold mb-3">正向提示词</div>
          <PromptList prompts={prompts} onChange={setPrompts} />
          <div className="mt-4">
            <label className="caption block mb-1.5">负面提示词</label>
            <textarea
              className="input w-full font-mono text-sm resize-y"
              rows={3}
              value={negPrompt}
              onChange={(e) => setNegPrompt(e.target.value)}
            />
          </div>
        </div>

        {/* ── 主体：参数 + 结果 ── */}
        <div className="flex gap-4 items-start flex-wrap xl:flex-nowrap">

          {/* 左：参数 */}
          <div className="flex flex-col gap-4 w-full xl:w-[320px] shrink-0">

            <div className="card" style={{ padding: 18 }}>
              <div className="text-md font-semibold mb-3">生成参数</div>
              <div className="flex flex-col gap-3">
                <div className="flex gap-2">
                  <NumField label="宽度" value={width} onChange={setWidth} min={256} max={4096} step={64} />
                  <NumField label="高度" value={height} onChange={setHeight} min={256} max={4096} step={64} />
                </div>
                <div className="flex gap-2">
                  <NumField label="步数" value={steps} onChange={setSteps} min={1} max={150} />
                  <NumField label="CFG Scale" value={cfgScale} onChange={setCfgScale} min={0} max={20} step={0.5} />
                </div>
                <div className="flex gap-2">
                  <NumField label="每 prompt 张数" value={count} onChange={setCount} min={1} max={32} />
                  <NumField label="种子（0=随机）" value={seed} onChange={setSeed} min={0} />
                </div>
              </div>
            </div>

            <div className="card" style={{ padding: 18 }}>
              <div className="text-md font-semibold mb-3">LoRA</div>
              <LoraList loras={loras} onChange={setLoras} recent={recentLoras} />
            </div>

            <div className="flex flex-col gap-1">
              <label className="caption">加速</label>
              <select
                className="input"
                value={attentionBackend}
                onChange={(e) => setAttentionBackend(e.target.value as AttentionBackend)}
              >
                <option value="flash_attn">Flash Attention</option>
                <option value="xformers">xformers</option>
                <option value="none">无（PyTorch SDPA）</option>
              </select>
            </div>

            <div className="flex gap-2">
              <button className="btn btn-primary flex-1" onClick={handleGenerate} disabled={busy}>
                {busy ? '生成中…' : '开始生成'}
              </button>
              {cancelable && (
                <button className="btn btn-ghost" onClick={handleCancel} title="取消当前任务">
                  取消
                </button>
              )}
            </div>
          </div>

          {/* 右：结果 */}
          <div className="flex-1 min-w-0">
            {currentTask ? (
              <div className="card" style={{ padding: 18 }}>
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-md font-semibold">生成结果</span>
                  <span className="caption">#{currentTask.id}</span>
                  <StatusBadge status={currentTask.status} />
                  {currentTask.error_msg && (
                    <span className="text-xs text-err ml-1">{currentTask.error_msg}</span>
                  )}
                </div>
                <SampleGallery samples={samples} taskId={currentTask.id} />
              </div>
            ) : (
              <div
                className="grid place-items-center rounded-md border border-subtle bg-sunken text-fg-tertiary text-sm"
                style={{ minHeight: 260 }}
              >
                填写参数后点击「开始生成」
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
