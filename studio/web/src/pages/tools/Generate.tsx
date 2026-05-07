import { useEffect, useRef, useState } from 'react'
import { api, type GenerateRequest, type MonitorState, type Task } from '../../api/client'
import PageHeader from '../../components/PageHeader'
import { useToast } from '../../components/Toast'

// ── SampleGallery ────────────────────────────────────────────────────────────

function SampleGallery({ samples, taskId }: {
  samples: Array<{ path: string; step?: number }>
  taskId: number
}) {
  const [active, setActive] = useState(samples.length - 1)

  useEffect(() => {
    if (samples.length > 0) setActive(samples.length - 1)
  }, [samples.length])

  if (!samples.length) {
    return (
      <div className="grid place-items-center h-48 text-fg-tertiary text-sm rounded-md border border-subtle bg-sunken">
        等待生成图…
      </div>
    )
  }

  const cur = samples[active]
  const filename = cur.path.split(/[\\/]/).pop() ?? cur.path
  const fullUrl = api.sampleImageUrl(filename, taskId)

  return (
    <div className="flex flex-col gap-2.5">
      {/* 缩略图条 */}
      <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'thin' }}>
        {samples.map((s, i) => {
          const fn = s.path.split(/[\\/]/).pop() ?? s.path
          return (
            <button
              key={i}
              onClick={() => setActive(i)}
              className={`shrink-0 w-14 h-14 rounded overflow-hidden border-2 cursor-pointer bg-transparent p-0 transition-colors ${
                i === active ? 'border-accent' : 'border-transparent hover:border-dim'
              }`}
            >
              <img
                src={api.sampleImageUrl(fn, taskId, 112)}
                className="w-full h-full object-cover"
                alt=""
              />
            </button>
          )
        })}
      </div>

      {/* 主图 */}
      <a href={fullUrl} target="_blank" rel="noreferrer" className="block">
        <img
          src={fullUrl}
          className="w-full rounded-md border border-subtle object-contain max-h-[600px]"
          alt={filename}
        />
      </a>
      <div className="text-xs text-fg-tertiary font-mono truncate">{filename}</div>
    </div>
  )
}

// ── JobHistory ────────────────────────────────────────────────────────────────

function JobHistory({ tasks, onSelect, selectedId }: {
  tasks: Task[]
  onSelect: (t: Task) => void
  selectedId?: number
}) {
  if (!tasks.length) return null

  const statusCls = (s: string) =>
    s === 'done'    ? 'text-ok'
    : s === 'running' ? 'text-accent'
    : s === 'failed'  ? 'text-err'
    : 'text-fg-tertiary'

  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="caption mb-2">历史任务</div>
      <div className="flex flex-col gap-1">
        {tasks.map((t) => (
          <button
            key={t.id}
            onClick={() => onSelect(t)}
            className={`flex items-center gap-2 text-left px-2 py-1.5 rounded text-sm cursor-pointer border-none transition-colors ${
              selectedId === t.id ? 'bg-accent-soft text-accent font-medium' : 'bg-transparent text-fg-secondary hover:bg-overlay'
            }`}
          >
            <span className={`font-mono text-xs ${statusCls(t.status)}`}>{t.status}</span>
            <span className="flex-1 truncate font-mono text-xs text-fg-tertiary">#{t.id}</span>
            <span className="text-xs text-fg-disabled">
              {t.created_at ? new Date(t.created_at * 1000).toLocaleString() : ''}
            </span>
          </button>
        ))}
      </div>
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
    <div className="flex flex-col gap-1.5">
      {prompts.map((p, i) => (
        <div key={i} className="flex gap-1.5">
          <textarea
            className="flex-1 field font-mono text-sm resize-none"
            rows={2}
            value={p}
            onChange={(e) => set(i, e.target.value)}
            placeholder="输入提示词…"
          />
          {prompts.length > 1 && (
            <button
              onClick={() => del(i)}
              className="btn btn-ghost btn-sm text-fg-tertiary hover:text-err self-start"
              title="删除此 prompt"
            >×</button>
          )}
        </div>
      ))}
      <button onClick={add} className="btn btn-ghost btn-sm self-start text-xs">
        + 添加 prompt
      </button>
    </div>
  )
}

// ── GeneratePage ──────────────────────────────────────────────────────────────

const DEFAULT_NEG = 'worst quality, low quality, score_1, score_2, score_3, blurry, jpeg artifacts, bad anatomy, bad hands, bad feet, missing fingers, extra fingers, text, watermark, logo, signature'

export default function GeneratePage() {
  const { toast } = useToast()

  // 表单状态
  const [prompts, setPrompts] = useState<string[]>(['newest, safe, 1girl, masterpiece, best quality'])
  const [negPrompt, setNegPrompt] = useState(DEFAULT_NEG)
  const [width, setWidth] = useState(1024)
  const [height, setHeight] = useState(1024)
  const [steps, setSteps] = useState(25)
  const [cfgScale, setCfgScale] = useState(4.0)
  const [count, setCount] = useState(1)
  const [seed, setSeed] = useState(0)
  const [loraPath, setLoraPath] = useState('')
  const [samplerName] = useState('er_sde')

  // 任务状态
  const [busy, setBusy] = useState(false)
  const [currentTask, setCurrentTask] = useState<Task | null>(null)
  const [monitorState, setMonitorState] = useState<MonitorState | null>(null)
  const [history, setHistory] = useState<Task[]>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const samples = monitorState?.samples ?? []

  // 加载历史
  const loadHistory = async () => {
    try {
      const items = await api.listGenerateTasks()
      setHistory(items)
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    loadHistory()
  }, [])

  // 轮询 monitor state
  useEffect(() => {
    if (!currentTask) return
    const poll = async () => {
      try {
        const state = await api.getMonitorState(currentTask.id)
        setMonitorState(state)
        const refreshed = await api.getGenerateTask(currentTask.id)
        setCurrentTask(refreshed)
        if (['done', 'failed', 'canceled'].includes(refreshed.status)) {
          stopPoll()
          setBusy(false)
          loadHistory()
        }
      } catch { /* ignore */ }
    }
    poll()
    pollRef.current = setInterval(poll, 2000)
    return stopPoll
  }, [currentTask?.id])

  const stopPoll = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  const handleSelect = async (t: Task) => {
    stopPoll()
    setCurrentTask(t)
    setBusy(false)
    try {
      const state = await api.getMonitorState(t.id)
      setMonitorState(state)
    } catch { /* ignore */ }
  }

  const handleGenerate = async () => {
    if (!prompts.some(p => p.trim())) {
      toast('请输入至少一条提示词', 'error'); return
    }
    setBusy(true)
    stopPoll()
    setMonitorState(null)
    try {
      const body: GenerateRequest = {
        prompts: prompts.filter(p => p.trim()),
        negative_prompt: negPrompt,
        width, height, steps, count, seed,
        cfg_scale: cfgScale,
        sampler_name: samplerName,
        lora_path: loraPath,
      }
      const task = await api.enqueueGenerate(body)
      setCurrentTask(task)
      toast(`生成任务 #${task.id} 已入队`, 'success')
      loadHistory()
    } catch (e) {
      toast(String(e), 'error')
      setBusy(false)
    }
  }

  const statusLabel = (s?: string) =>
    s === 'running' ? '生成中…'
    : s === 'done'  ? '已完成'
    : s === 'failed' ? '失败'
    : s === 'pending' ? '排队中'
    : ''

  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="工具"
        title="图片生成"
        subtitle="独立运行推理，复用训练采样逻辑"
      />

      <div className="p-6 flex flex-col gap-5">
        <div className="flex gap-5 items-start flex-wrap lg:flex-nowrap">

          {/* 左侧：参数表单 */}
          <div className="flex flex-col gap-4 min-w-0 w-full lg:w-[380px] shrink-0">
            <div className="card" style={{ padding: 18 }}>
              <div className="text-md font-semibold mb-3.5">提示词</div>
              <PromptList prompts={prompts} onChange={setPrompts} />
              <div className="mt-3">
                <label className="caption block mb-1">负面提示词</label>
                <textarea
                  className="field w-full font-mono text-sm resize-none"
                  rows={3}
                  value={negPrompt}
                  onChange={(e) => setNegPrompt(e.target.value)}
                />
              </div>
            </div>

            <div className="card" style={{ padding: 18 }}>
              <div className="text-md font-semibold mb-3.5">生成参数</div>
              <div className="flex flex-col gap-3">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="caption block mb-1">宽度</label>
                    <input type="number" className="field w-full" min={256} max={4096} step={64}
                      value={width} onChange={(e) => setWidth(Number(e.target.value))} />
                  </div>
                  <div className="flex-1">
                    <label className="caption block mb-1">高度</label>
                    <input type="number" className="field w-full" min={256} max={4096} step={64}
                      value={height} onChange={(e) => setHeight(Number(e.target.value))} />
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="caption block mb-1">步数</label>
                    <input type="number" className="field w-full" min={1} max={150}
                      value={steps} onChange={(e) => setSteps(Number(e.target.value))} />
                  </div>
                  <div className="flex-1">
                    <label className="caption block mb-1">CFG Scale</label>
                    <input type="number" className="field w-full" min={0} max={20} step={0.5}
                      value={cfgScale} onChange={(e) => setCfgScale(Number(e.target.value))} />
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="caption block mb-1">每 prompt 张数</label>
                    <input type="number" className="field w-full" min={1} max={32}
                      value={count} onChange={(e) => setCount(Number(e.target.value))} />
                  </div>
                  <div className="flex-1">
                    <label className="caption block mb-1">种子（0=随机）</label>
                    <input type="number" className="field w-full" min={0}
                      value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
                  </div>
                </div>
                <div>
                  <label className="caption block mb-1">LoRA 路径（可选）</label>
                  <input type="text" className="field w-full font-mono text-sm"
                    placeholder="models/lora/my_lora.safetensors"
                    value={loraPath} onChange={(e) => setLoraPath(e.target.value)} />
                </div>
              </div>
            </div>

            <button
              className="btn btn-primary w-full"
              onClick={handleGenerate}
              disabled={busy}
            >
              {busy ? '生成中…' : '开始生成'}
            </button>

            <JobHistory tasks={history} onSelect={handleSelect} selectedId={currentTask?.id} />
          </div>

          {/* 右侧：结果展示 */}
          <div className="flex-1 min-w-0">
            {currentTask && (
              <div className="card" style={{ padding: 18 }}>
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-md font-semibold">生成结果</span>
                  <span className="caption">#{currentTask.id}</span>
                  {currentTask.status && (
                    <span className={`text-xs font-medium ml-auto ${
                      currentTask.status === 'done'    ? 'text-ok'
                      : currentTask.status === 'running' ? 'text-accent'
                      : currentTask.status === 'failed'  ? 'text-err'
                      : 'text-fg-tertiary'
                    }`}>
                      {statusLabel(currentTask.status)}
                    </span>
                  )}
                </div>
                <SampleGallery samples={samples} taskId={currentTask.id} />
              </div>
            )}

            {!currentTask && (
              <div className="grid place-items-center h-64 text-fg-tertiary text-sm rounded-md border border-subtle bg-sunken">
                填写参数后点击「开始生成」
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
