import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import {
  api,
  type ConfigData,
  type PresetSummary,
  type ProjectDetail,
  type SchemaResponse,
  type Version,
  type VersionConfigResponse,
} from '../../../api/client'
import SchemaForm from '../../../components/SchemaForm'
import StepShell from '../../../components/StepShell'
import { useToast } from '../../../components/Toast'

// 全局模型字段来自全局设置，对版本维度只读
const GLOBAL_MODEL_FIELDS = [
  'transformer_path',
  'vae_path',
  'text_encoder_path',
  't5_tokenizer_path',
]

interface Ctx {
  project: ProjectDetail
  activeVersion: Version | null
  reload: () => Promise<void>
}

export default function TrainPage() {
  const { project, activeVersion, reload } = useOutletContext<Ctx>()
  const { toast } = useToast()
  const navigate = useNavigate()

  const [schema, setSchema] = useState<SchemaResponse | null>(null)
  const [presets, setPresets] = useState<PresetSummary[]>([])
  const [configResp, setConfigResp] = useState<VersionConfigResponse | null>(null)
  const [config, setConfig] = useState<ConfigData | null>(null)
  const [busy, setBusy] = useState(false)

  /** 已保存的 config JSON 快照，用于可靠判断是否 dirty */
  const savedJsonRef = useRef<string | null>(null)

  const vid = activeVersion?.id ?? null

  const refreshConfig = useCallback(async () => {
    if (!vid) return
    try {
      const r = await api.getVersionConfig(project.id, vid)
      setConfigResp(r)
      setConfig(r.config)
      savedJsonRef.current = JSON.stringify(r.config)
    } catch (e) {
      toast(`加载训练配置失败: ${e}`, 'error')
    }
  }, [project.id, vid, toast])

  useEffect(() => {
    api.schema().then(setSchema).catch((e) => toast(`schema 加载失败: ${e}`, 'error'))
    api.listPresets().then(setPresets).catch(() => setPresets([]))
  }, [toast])

  useEffect(() => {
    void refreshConfig()
  }, [refreshConfig])

  // 全局模型路径仍然灰显 readonly（值来自 Settings.models 配置；version 维度
  // 改了没意义）。PP10.4 起项目特定字段（data_dir 等）改成可编辑：fork preset
  // 时仍然预填项目路径，但用户后续可以自由改（接续训练填 resume_lora 之类）。
  const disabledFields = GLOBAL_MODEL_FIELDS
  const disabledHints = useMemo(() => {
    const h: Record<string, string> = {}
    for (const f of GLOBAL_MODEL_FIELDS) h[f] = '自动 · 全局设置'
    return h
  }, [])

  const dirty = useMemo(() => {
    if (!config) return false
    return JSON.stringify(config) !== savedJsonRef.current
  }, [config])

  if (!activeVersion || !vid) {
    return <p className="text-fg-tertiary p-6">请先选择 / 创建一个版本</p>
  }

  const onForkPreset = async (name: string) => {
    if (!name) return
    if (
      configResp?.has_config &&
      !window.confirm(
        `换预设会覆盖当前 version 的配置（已保存的内容会丢失）。继续？`
      )
    ) {
      return
    }
    setBusy(true)
    try {
      await api.forkPresetForVersion(project.id, vid, name)
      await refreshConfig()
      toast(`已从预设 ${name} 复制`, 'success')
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const onSaveConfig = async () => {
    if (!config) return
    setBusy(true)
    try {
      const r = await api.putVersionConfig(project.id, vid, config)
      setConfigResp({
        has_config: true,
        config: r.config,
        project_specific_fields: configResp?.project_specific_fields ?? [],
      })
      setConfig(r.config)
      savedJsonRef.current = JSON.stringify(r.config)
      toast('已保存', 'success')
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const onSaveAsPreset = async () => {
    const name = window.prompt(
      '保存为新预设。预设名（字母 / 数字 / _ / -，会清掉项目特定字段）：',
      ''
    )
    if (!name) return
    setBusy(true)
    try {
      await api.saveVersionConfigAsPreset(project.id, vid, name, false)
      const list = await api.listPresets()
      setPresets(list)
      toast(`已保存为预设 ${name}`, 'success')
    } catch (e) {
      const msg = String(e)
      if (msg.includes('已存在')) {
        if (window.confirm(`预设 ${name} 已存在，覆盖？`)) {
          try {
            await api.saveVersionConfigAsPreset(project.id, vid, name, true)
            const list = await api.listPresets()
            setPresets(list)
            toast(`已覆盖预设 ${name}`, 'success')
          } catch (e2) {
            toast(String(e2), 'error')
          }
        }
      } else {
        toast(msg, 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  const onEnqueue = async () => {
    if (!configResp?.has_config) {
      toast('先选预设并保存配置', 'error')
      return
    }
    if (dirty) {
      if (!window.confirm('当前有未保存的改动，确定按上次保存的配置入队？')) return
    }
    setBusy(true)
    try {
      const t = await api.enqueueVersionTraining(project.id, vid)
      toast(`已入队 #${t.id}，去 /queue 查看进度`, 'success')
      void reload()
      navigate('/queue')
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <StepShell
      idx={6}
      title="训练"
      subtitle="选预设 → 编辑 config → 入队训练"
      actions={
        <>
          <button
            onClick={() => void onSaveConfig()}
            disabled={busy || !dirty}
            className="btn btn-secondary btn-sm"
          >
            {dirty ? '保存配置' : '已保存'}
          </button>
          <button
            onClick={() => void onEnqueue()}
            disabled={busy || !configResp?.has_config}
            className="btn btn-primary"
          >
            开始训练
          </button>
        </>
      }
    >
      <div className="flex flex-col h-full gap-3">

        {/* 两栏布局：左（预设 + config 编辑） / 右（估算面板） */}
        <div className="grid grid-cols-[1.5fr_1fr] gap-3 flex-1 min-h-0">

          {/* 左栏 */}
          <div className="flex flex-col gap-3 min-h-0 min-w-0 overflow-y-auto">

            {/* 当前预设状态栏 */}
            <section className="rounded-md border border-subtle bg-surface px-3 py-2 flex flex-wrap items-center gap-2 shrink-0 text-sm">
              <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${configResp?.has_config ? 'bg-ok' : 'bg-fg-tertiary'}`} />
              <span className="text-fg-tertiary">当前预设</span>
              <span className="font-mono text-accent font-semibold">
                {activeVersion.config_name ?? '(未选)'}
              </span>
              <span className="flex-1" />
              <button
                onClick={() => void onSaveAsPreset()}
                disabled={busy || !configResp?.has_config}
                className="btn btn-ghost btn-sm"
              >
                另存为新预设
              </button>
            </section>

            {/* 预设卡片网格 */}
            {presets.length > 0 && (
              <section className="rounded-md border border-subtle bg-surface px-3 py-2.5 shrink-0">
                <div className="flex items-center gap-1.5 mb-2.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                  <span className="text-xs uppercase tracking-[0.06em] font-semibold text-fg-secondary">可用预设</span>
                  <span className="text-[10px] text-fg-tertiary">点击卡片套用</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {presets.map((p) => {
                    const isActive = p.name === activeVersion.config_name
                    return (
                      <button
                        key={p.name}
                        onClick={() => void onForkPreset(p.name)}
                        disabled={busy}
                        className={[
                          'rounded-sm px-2 py-1.5 text-left transition-colors',
                          isActive
                            ? 'border border-accent bg-accent-soft'
                            : 'border border-subtle bg-sunken hover:bg-overlay',
                          busy ? 'cursor-default' : 'cursor-pointer',
                        ].join(' ')}
                      >
                        <div className={`text-xs font-mono font-semibold ${isActive ? 'text-accent' : 'text-fg-primary'}`}>
                          {p.name}
                        </div>
                        <div className="text-[10px] text-fg-tertiary mt-0.5">
                          {isActive ? '当前使用' : '点击套用'}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </section>
            )}

            {configResp === null || !schema ? (
              <ConfigSkeleton />
            ) : !configResp.has_config ? (
              <div className="flex-1 flex items-center justify-center text-fg-tertiary text-sm rounded-md border border-dashed border-dim">
                请从上方预设卡片选择一个，复制进当前 version 后即可编辑配置。
              </div>
            ) : config ? (
              <section className="flex-1 min-h-0 overflow-y-auto pr-1">
                <SchemaForm
                  schema={schema}
                  values={config}
                  onChange={setConfig}
                  disabledFields={disabledFields}
                  disabledHints={disabledHints}
                />
              </section>
            ) : (
              <ConfigSkeleton />
            )}
          </div>

          {/* 右栏：训练估算 + 操作面板 */}
          <TrainEstimatePanel
            configResp={configResp}
            config={config}
            busy={busy}
            dirty={dirty}
            onSave={onSaveConfig}
            onEnqueue={onEnqueue}
            activeVersion={activeVersion}
          />
        </div>
      </div>
    </StepShell>
  )
}

/** 训练估算右侧栏面板 */
function TrainEstimatePanel({
  configResp,
  config,
  busy,
  dirty,
  onSave,
  onEnqueue,
  activeVersion,
}: {
  configResp: VersionConfigResponse | null
  config: ConfigData | null
  busy: boolean
  dirty: boolean
  onSave: () => void
  onEnqueue: () => void
  activeVersion: Version | null
}) {
  const hasConfig = configResp?.has_config ?? false
  const configName = activeVersion?.config_name ?? null

  return (
    <div className="flex flex-col gap-3 min-w-0">

      {/* 操作卡片 */}
      <div className="rounded-md border border-subtle bg-surface px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-2.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-ok shrink-0" />
          <span className="text-xs uppercase tracking-[0.06em] font-semibold text-fg-secondary">操作</span>
        </div>
        <div className="flex flex-col gap-2">
          <button
            onClick={onSave}
            disabled={busy || !dirty}
            className="btn btn-secondary btn-sm w-full"
          >
            {dirty ? '保存配置' : '已保存'}
          </button>
          <button
            onClick={onEnqueue}
            disabled={busy || !hasConfig}
            className="btn btn-primary w-full"
          >
            开始训练
          </button>
        </div>
      </div>

      {/* 状态卡片 */}
      <div className="rounded-md border border-subtle bg-surface px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-2.5">
          <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${hasConfig ? 'bg-ok' : 'bg-fg-tertiary'}`} />
          <span className="text-xs uppercase tracking-[0.06em] font-semibold text-fg-secondary">状态</span>
        </div>
        <div className="flex flex-col gap-1.5 text-xs">
          <div className="flex justify-between items-baseline">
            <span className="text-fg-tertiary">预设</span>
            <span className="font-mono text-fg-primary font-medium">{configName ?? '—'}</span>
          </div>
          <div className="flex justify-between items-baseline">
            <span className="text-fg-tertiary">配置状态</span>
            <span className={`font-mono font-medium ${!hasConfig ? 'text-fg-tertiary' : dirty ? 'text-warn' : 'text-ok'}`}>
              {!hasConfig ? '未配置' : dirty ? '未保存' : '已保存'}
            </span>
          </div>
        </div>
      </div>

      {/* 训练关键参数卡片 */}
      {hasConfig && config && (
        <div className="rounded-md border border-subtle bg-surface px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-2.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
            <span className="text-xs uppercase tracking-[0.06em] font-semibold text-fg-secondary">关键参数</span>
          </div>
          <div className="flex flex-col gap-1.5 text-xs">
            <StatLine label="训练集图片" value={activeVersion?.stats?.train_image_count ?? 0} />
            <StatLine label="repeats" value={config.num_repeats} />
            <StatLine label="batch size" value={config.batch_size} />
            <StatLine label="梯度累积" value={config.gradient_accumulation_steps} />
            {(() => {
              const imgs = activeVersion?.stats?.train_image_count ?? 0
              const reps = Number(config.num_repeats) || 0
              const bs = Number(config.batch_size) || 1
              const ga = Number(config.gradient_accumulation_steps) || 1
              const steps = imgs > 0 && reps > 0 ? Math.ceil(imgs * reps / (bs * ga)) : null
              return steps !== null ? (
                <div className="flex justify-between items-baseline border-t border-subtle pt-1.5 mt-0.5">
                  <span className="text-fg-secondary font-medium">≈ 总梯度步数</span>
                  <span className="font-mono text-accent font-semibold">{steps}</span>
                </div>
              ) : null
            })()}
          </div>
        </div>
      )}
    </div>
  )
}


function ConfigSkeleton() {
  // 一个分组卡片：标题条 + 4-6 行字段（label + input 灰条）
  const groups = [5, 6, 4, 5]
  return (
    <section
      className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3"
      role="status"
      aria-label="加载训练配置中"
    >
      {groups.map((rows, gi) => (
        <div
          key={gi}
          className="animate-pulse rounded-md border border-subtle bg-surface p-3.5"
        >
          <div className="h-3.5 w-32 rounded-sm bg-sunken mb-2.5" />
          <div className="flex flex-col gap-2">
            {Array.from({ length: rows }).map((_, ri) => (
              <div key={ri} className="flex flex-col gap-1">
                <div className="h-2.5 w-24 rounded-sm bg-sunken opacity-70" />
                <div className="h-7 rounded-sm bg-canvas border border-subtle" />
              </div>
            ))}
          </div>
        </div>
      ))}
      <span className="sr-only">加载训练配置中...</span>
    </section>
  )
}

function StatLine({
  label,
  value,
}: {
  label: string
  value: unknown
}) {
  const v = value === null || value === undefined ? '—' : String(value)
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-fg-tertiary">{label}</span>
      <span className="font-mono text-fg-primary font-medium">{v}</span>
    </div>
  )
}
