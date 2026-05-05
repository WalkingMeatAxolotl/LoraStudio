import { useCallback, useEffect, useMemo, useState } from 'react'
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

  const vid = activeVersion?.id ?? null

  const refreshConfig = useCallback(async () => {
    if (!vid) return
    try {
      const r = await api.getVersionConfig(project.id, vid)
      setConfigResp(r)
      setConfig(r.config)
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
    if (!config || !configResp?.config) return false
    return JSON.stringify(config) !== JSON.stringify(configResp.config)
  }, [config, configResp])

  if (!activeVersion || !vid) {
    return <p className="text-slate-500">请先选择 / 创建一个版本</p>
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
      subtitle="选预设 → 编辑 config（项目特定字段自动填）→ 入队"
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
    <div className="flex flex-col h-full gap-3" style={{ padding: '16px 24px' }}>

      {/* 预设选择控制栏 */}
      <section style={{
        borderRadius: 'var(--r-md)',
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)',
        padding: '10px 14px',
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10,
        flexShrink: 0,
        fontSize: 'var(--t-sm)',
      }}>
        <span style={{ color: 'var(--fg-tertiary)' }}>当前预设</span>
        <span className="mono" style={{ color: 'var(--accent)', fontWeight: 600 }}>
          {activeVersion.config_name ?? '(未选)'}
        </span>
        <span style={{ color: 'var(--border-default)' }}>|</span>
        <span style={{ color: 'var(--fg-tertiary)' }}>换预设</span>
        <select
          value=""
          onChange={(e) => void onForkPreset(e.target.value)}
          disabled={busy || presets.length === 0}
          className="input"
          style={{ padding: '3px 8px', fontSize: 'var(--t-sm)' }}
        >
          <option value="">— 选预设 —</option>
          {presets.map((p) => (
            <option key={p.name} value={p.name}>{p.name}</option>
          ))}
        </select>
        <button
          onClick={() => void onSaveAsPreset()}
          disabled={busy || !configResp?.has_config}
          className="btn btn-ghost btn-sm"
        >
          另存为新预设
        </button>
      </section>

      {configResp === null || !schema ? (
        // 初次加载（configResp 还没 fetch 回来 / schema 还没拉到）→ skeleton
        <ConfigSkeleton />
      ) : !configResp.has_config ? (
        <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
          请先从下拉「换一个预设」选一个，复制进当前 version 后即可编辑配置。
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
    </StepShell>
  )
}

/** 训练配置加载中的 skeleton — 模拟 SchemaForm 的分组卡片结构。 */
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
          className="border border-slate-700 rounded-lg bg-slate-800/40 p-4 animate-pulse"
        >
          <div className="h-4 w-32 bg-slate-700 rounded mb-3" />
          <div className="space-y-2">
            {Array.from({ length: rows }).map((_, ri) => (
              <div key={ri} className="space-y-1">
                <div className="h-3 w-24 bg-slate-700/70 rounded" />
                <div className="h-7 bg-slate-800 border border-slate-700 rounded" />
              </div>
            ))}
          </div>
        </div>
      ))}
      <span className="sr-only">加载训练配置中...</span>
    </section>
  )
}
