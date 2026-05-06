import { useEffect, useRef, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import {
  api,
  type Job,
  type ProjectDetail,
  type TaggerName,
  type TaggerStatus,
  type Version,
  type WD14Config,
} from '../../../api/client'
import JobProgress from '../../../components/JobProgress'
import StepShell from '../../../components/StepShell'
import { useToast } from '../../../components/Toast'
import { useEventStream } from '../../../lib/useEventStream'

interface Ctx {
  project: ProjectDetail
  activeVersion: Version | null
  reload: () => Promise<void>
}

/**
 * WD14 本次任务的参数表单。`null` 占位含义：还没拉到 settings 的全局值。
 * 拉到之后用全局值填充，让用户在打标页直接微调；不会写回 settings。
 */
type Wd14Form = {
  threshold_general: number
  threshold_character: number
  model_id: string
  local_dir: string
  blacklist_tags: string[]
}

function fromConfig(cfg: WD14Config): Wd14Form {
  return {
    threshold_general: cfg.threshold_general,
    threshold_character: cfg.threshold_character,
    model_id: cfg.model_id,
    local_dir: cfg.local_dir ?? '',
    blacklist_tags: cfg.blacklist_tags,
  }
}

export default function TaggingPage() {
  const { project, activeVersion, reload } = useOutletContext<Ctx>()
  const { toast } = useToast()

  const [tagger, setTagger] = useState<TaggerName>('wd14')
  const [taggerStatus, setTaggerStatus] = useState<TaggerStatus | null>(null)
  const [outputFormat, setOutputFormat] = useState<'txt' | 'json'>('txt')

  const [wd14Defaults, setWd14Defaults] = useState<WD14Config | null>(null)
  const [wd14Form, setWd14Form] = useState<Wd14Form | null>(null)
  const [advOpen, setAdvOpen] = useState(false)

  const [job, setJob] = useState<Job | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const jobIdRef = useRef<number | null>(null)
  jobIdRef.current = job?.id ?? null

  // 拉一次 settings 的 wd14 默认值；用作预填 + 「还原全局」的基准。
  useEffect(() => {
    void api
      .getSecrets()
      .then((s) => {
        setWd14Defaults(s.wd14)
        setWd14Form(fromConfig(s.wd14))
      })
      .catch((e) => toast(`读取 wd14 默认配置失败：${e}`, 'error'))
    // toast 函数引用稳定；只在 mount 时跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setTaggerStatus(null)
    void api
      .checkTagger(tagger)
      .then(setTaggerStatus)
      .catch((e) =>
        setTaggerStatus({
          name: tagger,
          ok: false,
          msg: String(e),
          requires_service: false,
        })
      )
  }, [tagger])

  // 页面刷新 / 进入时回放最近一次 tag job：锁回 jid + 回放历史日志，让 SSE 接力
  const vid = activeVersion?.id ?? null
  useEffect(() => {
    if (!vid) return
    void api
      .getLatestVersionJob(project.id, vid, 'tag')
      .then((r) => {
        if (!r.job) return
        setJob(r.job)
        setLogs(r.log ? r.log.split('\n') : [])
      })
      .catch(() => {})
  }, [project.id, vid])

  useEventStream((evt) => {
    const jid = jobIdRef.current
    if (evt.type === 'job_log_appended' && jid && evt.job_id === jid) {
      setLogs((prev) => [...prev, String(evt.text ?? '')])
    } else if (evt.type === 'job_state_changed' && jid && evt.job_id === jid) {
      void api.getJob(jid).then(setJob).catch(() => {})
      if (evt.status === 'done' || evt.status === 'failed') {
        void reload()
      }
    }
  })

  if (!activeVersion) {
    return <p className="text-fg-tertiary p-6">请先选择 / 创建一个版本</p>
  }

  const isLive = job?.status === 'running' || job?.status === 'pending'

  // 仅当 form 与 settings 默认不同的字段进 overrides；空 dict 不发。
  const buildWd14Overrides = (): Record<string, unknown> | undefined => {
    if (!wd14Form || !wd14Defaults) return undefined
    const out: Record<string, unknown> = {}
    if (wd14Form.threshold_general !== wd14Defaults.threshold_general)
      out.threshold_general = wd14Form.threshold_general
    if (wd14Form.threshold_character !== wd14Defaults.threshold_character)
      out.threshold_character = wd14Form.threshold_character
    if (wd14Form.model_id !== wd14Defaults.model_id)
      out.model_id = wd14Form.model_id
    const localDirChanged =
      (wd14Form.local_dir || null) !== (wd14Defaults.local_dir ?? null)
    if (localDirChanged) out.local_dir = wd14Form.local_dir || null
    if (
      JSON.stringify(wd14Form.blacklist_tags) !==
      JSON.stringify(wd14Defaults.blacklist_tags)
    )
      out.blacklist_tags = wd14Form.blacklist_tags
    return Object.keys(out).length ? out : undefined
  }

  const startTagging = async () => {
    if (!taggerStatus?.ok) {
      toast(`${tagger} 不可用：${taggerStatus?.msg ?? '未知'}`, 'error')
      return
    }
    try {
      const overrides =
        tagger === 'wd14' ? buildWd14Overrides() : undefined
      const j = await api.startTag(project.id, activeVersion.id, {
        tagger,
        output_format: outputFormat,
        wd14_overrides: overrides,
      })
      setJob(j)
      setLogs([])
      const note = overrides
        ? `（含 ${Object.keys(overrides).length} 项覆盖）`
        : ''
      toast(`已入队 #${j.id}${note}`, 'success')
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  return (
    <StepShell
      idx={3}
      title="自动打标"
      subtitle="WD14 本地推理 或 JoyCaption 远程 vLLM"
      actions={
        <button
          onClick={startTagging}
          disabled={isLive || !taggerStatus?.ok}
          className="btn btn-primary"
        >
          {isLive
            ? '打标中…'
            : taggerStatus === null
              ? '检查中…'
              : '开始打标全部'}
        </button>
      }
    >
    <div className="flex flex-col h-full gap-3">

      {/* 主体两栏：左（tagger 控制 + 模型卡片 + 参数） / 右（预览面板） */}
      <div className="grid gap-3 flex-1 min-h-0" style={{ gridTemplateColumns: '1.5fr 1fr' }}>

        {/* 左栏 */}
        <div className="flex flex-col gap-3 min-h-0 min-w-0 overflow-y-auto">

          {/* tagger / format 控制栏 */}
          <section className="rounded-md border border-subtle bg-surface px-3 py-2 flex flex-wrap items-center gap-2 shrink-0 text-sm">
            <span className="text-fg-tertiary">tagger</span>
            <select
              value={tagger}
              onChange={(e) => setTagger(e.target.value as TaggerName)}
              className="input text-sm"
              style={{ padding: '3px 8px' }}
            >
              <option value="wd14">WD14（本地 ONNX）</option>
              <option value="joycaption">JoyCaption（远程 vLLM）</option>
            </select>
            <span
              className={
                taggerStatus
                  ? taggerStatus.ok ? 'badge badge-ok' : 'badge badge-err'
                  : 'badge badge-neutral'
              }
              title={taggerStatus?.msg ?? '检查中...'}
            >
              {taggerStatus
                ? taggerStatus.ok ? `✓ ${taggerStatus.msg}` : `✗ ${taggerStatus.msg}`
                : '检查中...'}
            </span>

            <span className="text-dim">|</span>
            <span className="text-fg-tertiary">format</span>
            <select
              value={outputFormat}
              onChange={(e) => setOutputFormat(e.target.value as 'txt' | 'json')}
              className="input text-sm"
              style={{ padding: '3px 8px' }}
            >
              <option value="txt">.txt</option>
              <option value="json">.json</option>
            </select>

            <span className="flex-1" />
          </section>

          {/* WD14 本次参数；预填充全局 settings，不写回 */}
          {tagger === 'wd14' && (
            <Wd14Panel
              form={wd14Form}
              defaults={wd14Defaults}
              onChange={setWd14Form}
              advOpen={advOpen}
              setAdvOpen={setAdvOpen}
              disabled={isLive}
            />
          )}

          {job && (
            <JobProgress
              job={job}
              logs={logs}
              onCancel={async () => {
                try {
                  await api.cancelJob(job.id)
                  toast('已取消', 'success')
                } catch (e) {
                  toast(String(e), 'error')
                }
              }}
            />
          )}
        </div>

        {/* 右栏：预览面板 */}
        <TagPreviewPanel
          tagger={tagger}
          taggerStatus={taggerStatus}
          isLive={isLive}
          taggerOk={taggerStatus?.ok ?? false}
        />
      </div>
    </div>
    </StepShell>
  )
}

// ---------------------------------------------------------------------------
// WD14 紧凑参数行
// ---------------------------------------------------------------------------

function Wd14Panel({
  form,
  defaults,
  onChange,
  advOpen,
  setAdvOpen,
  disabled,
}: {
  form: Wd14Form | null
  defaults: WD14Config | null
  onChange: (f: Wd14Form) => void
  advOpen: boolean
  setAdvOpen: (b: boolean) => void
  disabled: boolean
}) {
  if (!form || !defaults) {
    return (
      <section className="rounded-md border border-subtle bg-surface px-3 py-2 text-xs text-fg-tertiary shrink-0">
        加载 wd14 默认参数...
      </section>
    )
  }

  const dirty =
    form.threshold_general !== defaults.threshold_general ||
    form.threshold_character !== defaults.threshold_character ||
    form.model_id !== defaults.model_id ||
    (form.local_dir || null) !== (defaults.local_dir ?? null) ||
    JSON.stringify(form.blacklist_tags) !==
      JSON.stringify(defaults.blacklist_tags)

  const restore = () => onChange(fromConfig(defaults))

  return (
    <section className="rounded-md border border-subtle bg-surface px-3.5 py-2.5 flex flex-col gap-2 shrink-0 text-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <PanelDot />
        <span className="caption">WD14 参数</span>
        <span className="text-xs text-fg-tertiary">
          预填{' '}
          <Link to="/tools/settings" className="text-accent" title="去设置页编辑全局默认">
            全局设置
          </Link>{' '}
          · 本次有效，不写回
        </span>
        <span className="flex-1" />
        {dirty && (
          <>
            <span className="badge badge-warn">已改</span>
            <button
              onClick={restore}
              disabled={disabled}
              className="btn btn-ghost btn-sm"
              title="还原为全局设置"
            >
              ↻ 还原
            </button>
          </>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <ThresholdInput
          label="general"
          value={form.threshold_general}
          base={defaults.threshold_general}
          disabled={disabled}
          onChange={(v) => onChange({ ...form, threshold_general: v })}
        />
        <ThresholdInput
          label="character"
          value={form.threshold_character}
          base={defaults.threshold_character}
          disabled={disabled}
          onChange={(v) => onChange({ ...form, threshold_character: v })}
        />
        <button
          type="button"
          onClick={() => setAdvOpen(!advOpen)}
          className="btn btn-ghost btn-sm text-xs text-fg-tertiary"
        >
          {advOpen ? '▾' : '▸'} 高级
        </button>
      </div>

      {advOpen && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
          <LabeledModelSelect
            label="model_id"
            value={form.model_id}
            options={defaults.model_ids}
            disabled={disabled}
            onChange={(v) => onChange({ ...form, model_id: v })}
            modified={form.model_id !== defaults.model_id}
          />
          <LabeledInput
            label="local_dir"
            value={form.local_dir}
            placeholder="留空 = 自动 HF 下载"
            disabled={disabled}
            onChange={(v) => onChange({ ...form, local_dir: v })}
            modified={
              (form.local_dir || null) !== (defaults.local_dir ?? null)
            }
          />
          <LabeledInput
            className="md:col-span-2"
            label="blacklist_tags（逗号分隔）"
            value={form.blacklist_tags.join(', ')}
            placeholder="如 monochrome, comic"
            disabled={disabled}
            onChange={(v) =>
              onChange({
                ...form,
                blacklist_tags: v
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean),
              })
            }
            modified={
              JSON.stringify(form.blacklist_tags) !==
              JSON.stringify(defaults.blacklist_tags)
            }
          />
        </div>
      )}
    </section>
  )
}

function ThresholdInput({
  label,
  value,
  base,
  disabled,
  onChange,
}: {
  label: string
  value: number
  base: number
  disabled: boolean
  onChange: (v: number) => void
}) {
  const modified = value !== base
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-fg-tertiary font-mono text-xs">{label}</span>
      <input
        type="number"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (!Number.isNaN(n)) onChange(Math.max(0, Math.min(1, n)))
        }}
        disabled={disabled}
        className={`input input-mono ${modified ? 'border-warn' : ''}`}
        style={{ width: 72 }}
        title={modified ? `全局 ${base}` : undefined}
      />
    </label>
  )
}

function LabeledInput({
  label,
  value,
  placeholder,
  disabled,
  onChange,
  modified,
  className = '',
}: {
  label: string
  value: string
  placeholder?: string
  disabled: boolean
  onChange: (v: string) => void
  modified?: boolean
  className?: string
}) {
  return (
    <label className={'grid grid-cols-[140px_1fr] items-center gap-2 ' + className}>
      <span className="text-fg-tertiary font-mono text-xs">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`input input-mono ${modified ? 'border-warn' : ''}`}
      />
    </label>
  )
}

function LabeledModelSelect({
  label,
  value,
  options,
  disabled,
  onChange,
  modified,
}: {
  label: string
  value: string
  options: string[]
  disabled: boolean
  onChange: (v: string) => void
  modified?: boolean
}) {
  // 当前选中的 model_id 万一不在 options 里（设置同步前的边界），仍显示它，
  // 避免 dropdown 视觉上回退到 options[0]。
  const opts = options.includes(value) ? options : [value, ...options]
  return (
    <label className="grid grid-cols-[140px_1fr] items-center gap-2">
      <span className="text-fg-tertiary font-mono text-xs">{label}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={`input input-mono min-w-0 flex-1 ${modified ? 'border-warn' : ''}`}
        >
          {opts.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <Link
          to="/tools/settings"
          className="text-xs text-fg-tertiary shrink-0"
          title="去设置编辑候选模型列表"
        >
          + 候选
        </Link>
      </div>
    </label>
  )
}

function PanelDot() {
  return <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
}

// ---------------------------------------------------------------------------
// 右侧预览面板
// ---------------------------------------------------------------------------

function TagPreviewPanel({
  tagger,
  taggerStatus,
  isLive,
  taggerOk,
}: {
  tagger: string
  taggerStatus: { ok: boolean; msg: string } | null
  isLive: boolean
  taggerOk: boolean
}) {
  return (
    <div className="flex flex-col gap-3 min-w-0">
      {/* 状态卡片 */}
      <div className="rounded-md border border-subtle bg-surface px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-2">
          <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${taggerOk ? 'bg-ok' : 'bg-err'}`} />
          <span className="caption">状态</span>
        </div>
        <div className="text-xs text-fg-secondary">
          <div className={`font-mono font-medium ${taggerOk ? 'text-ok' : 'text-err'}`}>
            {tagger} {taggerStatus ? (taggerOk ? '✓ 就绪' : '✗ 不可用') : '… 检查中'}
          </div>
          {!taggerOk && taggerStatus && (
            <div className="mt-1 text-fg-tertiary break-all">
              {taggerStatus.msg}
            </div>
          )}
        </div>
      </div>

      {/* 说明卡片 */}
      <div className="rounded-md border border-subtle bg-surface px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
          <span className="caption">说明</span>
        </div>
        <div className="text-xs text-fg-secondary leading-relaxed">
          {tagger === 'wd14'
            ? 'WD14 ONNX 本地推理，无需网络'
            : 'JoyCaption 远程 vLLM，自然语言描述'}
        </div>
      </div>

      {/* 进度提示 */}
      {isLive && (
        <div className="rounded-md border border-subtle bg-surface px-3 py-2.5 text-center">
          <div className="badge badge-warn">打标中</div>
        </div>
      )}
    </div>
  )
}
