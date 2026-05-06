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
    return <p style={{ color: 'var(--fg-tertiary)', padding: 24 }}>请先选择 / 创建一个版本</p>
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
      <div className="grid gap-3 flex-1 min-h-0" style={{ gridTemplateColumns: '1.5fr 1fr' }}>

        {/* 左栏 */}
        <div className="flex flex-col gap-3 min-h-0 min-w-0" style={{ overflowY: 'auto' }}>

          {/* 当前预设状态栏 */}
          <section style={{
            borderRadius: 'var(--r-md)',
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)',
            padding: '8px 12px',
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
            flexShrink: 0,
            fontSize: 'var(--t-sm)',
          }}>
            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: configResp?.has_config ? 'var(--ok)' : 'var(--fg-tertiary)', flexShrink: 0 }} />
            <span style={{ color: 'var(--fg-tertiary)' }}>当前预设</span>
            <span className="mono" style={{ color: 'var(--accent)', fontWeight: 600 }}>
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
            <section style={{
              borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)', padding: '10px 12px',
              flexShrink: 0,
            }}>
              <div className="flex items-center gap-1.5" style={{ marginBottom: 10 }}>
                <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
                <span className="caption" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 'var(--t-xs)' }}>可用预设</span>
                <span style={{ fontSize: 'var(--t-2xs)', color: 'var(--fg-tertiary)' }}>点击卡片套用</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {presets.map((p) => {
                  const isActive = p.name === activeVersion.config_name
                  return (
                    <button
                      key={p.name}
                      onClick={() => void onForkPreset(p.name)}
                      disabled={busy}
                      style={{
                        borderRadius: 'var(--r-sm)',
                        border: isActive ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
                        background: isActive ? 'var(--accent-soft)' : 'var(--bg-sunken)',
                        padding: '6px 8px',
                        textAlign: 'left',
                        cursor: busy ? 'default' : 'pointer',
                        transition: 'border-color 0.15s, background 0.15s',
                      }}
                    >
                      <div style={{
                        fontSize: 'var(--t-xs)', fontFamily: 'var(--font-mono)',
                        color: isActive ? 'var(--accent)' : 'var(--fg-primary)',
                        fontWeight: 600,
                      }}>{p.name}</div>
                      <div style={{
                        fontSize: 'var(--t-2xs)', color: 'var(--fg-tertiary)', marginTop: 2,
                      }}>
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
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--fg-tertiary)', fontSize: 'var(--t-sm)',
              borderRadius: 'var(--r-md)', border: '1px dashed var(--border-default)',
            }}>
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
    <div className="flex flex-col gap-3" style={{ minWidth: 0 }}>
      {/* 操作卡片 */}
      <div style={{
        borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)', padding: '10px 12px',
      }}>
        <div className="flex items-center gap-1.5" style={{ marginBottom: 10 }}>
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--ok)', flexShrink: 0 }} />
          <span className="caption" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 'var(--t-xs)' }}>操作</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={onSave}
            disabled={busy || !dirty}
            className="btn btn-secondary btn-sm"
            style={{ width: '100%' }}
          >
            {dirty ? '保存配置' : '已保存'}
          </button>
          <button
            onClick={onEnqueue}
            disabled={busy || !hasConfig}
            className="btn btn-primary"
            style={{ width: '100%' }}
          >
            开始训练
          </button>
        </div>
      </div>

      {/* 状态卡片 */}
      <div style={{
        borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)', padding: '10px 12px',
      }}>
        <div className="flex items-center gap-1.5" style={{ marginBottom: 10 }}>
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: hasConfig ? 'var(--ok)' : 'var(--fg-tertiary)', flexShrink: 0 }} />
          <span className="caption" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 'var(--t-xs)' }}>状态</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--t-xs)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ color: 'var(--fg-tertiary)' }}>预设</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)', fontWeight: 500 }}>
              {configName ?? '—'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ color: 'var(--fg-tertiary)' }}>配置状态</span>
            <span style={{
              fontFamily: 'var(--font-mono)',
              color: hasConfig ? (dirty ? 'var(--warn)' : 'var(--ok)') : 'var(--fg-tertiary)',
              fontWeight: 500,
            }}>
              {!hasConfig ? '未配置' : dirty ? '未保存' : '已保存'}
            </span>
          </div>
        </div>
      </div>

      {/* 训练关键参数卡片 */}
      {hasConfig && config && (
        <div style={{
          borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)',
          background: 'var(--bg-surface)', padding: '10px 12px',
        }}>
          <div className="flex items-center gap-1.5" style={{ marginBottom: 10 }}>
            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
            <span className="caption" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 'var(--t-xs)' }}>关键参数</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--t-xs)' }}>
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
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                  borderTop: '1px solid var(--border-subtle)', paddingTop: 6, marginTop: 2,
                }}>
                  <span style={{ color: 'var(--fg-secondary)', fontWeight: 500 }}>≈ 总梯度步数</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 600 }}>
                    {steps}
                  </span>
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
          className="animate-pulse"
          style={{
            borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)', padding: 14,
          }}
        >
          <div style={{ height: 14, width: 128, borderRadius: 'var(--r-sm)', background: 'var(--bg-sunken)', marginBottom: 10 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Array.from({ length: rows }).map((_, ri) => (
              <div key={ri} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ height: 10, width: 96, borderRadius: 'var(--r-sm)', background: 'var(--bg-sunken)', opacity: 0.7 }} />
                <div style={{ height: 28, borderRadius: 'var(--r-sm)', background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)' }} />
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
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ color: 'var(--fg-tertiary)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)', fontWeight: 500 }}>{v}</span>
    </div>
  )
}
