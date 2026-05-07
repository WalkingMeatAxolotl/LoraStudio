import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  api,
  DEFAULT_WD14_MODELS,
  type ModelDownloadStatus,
  type ModelsCatalog,
  type Secrets,
  type SecretsPatch,
  type WD14Runtime,
} from '../../api/client'
import PageHeader from '../../components/PageHeader'
import { useToast } from '../../components/Toast'
import { useEventStream } from '../../lib/useEventStream'
import { applyDensity, applyTheme, getStoredDensity, getStoredTheme, setStoredDensity, setStoredTheme, type Density, type Theme } from '../../lib/theme'

const MASK = '***'

type Section =
  | 'gelbooru'
  | 'danbooru'
  | 'download'
  | 'huggingface'
  | 'joycaption'
  | 'wd14'
  | 'cltagger'
  | 'models'
  | 'queue'

const EMPTY: Secrets = {
  gelbooru: {
    user_id: '',
    api_key: '',
    save_tags: false,
    convert_to_png: true,
    remove_alpha_channel: true,
  },
  danbooru: { username: '', api_key: '', account_type: 'free' },
  download: {
    exclude_tags: [],
    parallel_workers: 4,
    api_rate_per_sec: 2,
    cdn_rate_per_sec: 5,
  },
  huggingface: { token: '' },
  joycaption: {
    base_url: 'http://localhost:8000/v1',
    model: 'fancyfeast/llama-joycaption-beta-one-hf-llava',
    prompt_template: 'Descriptive Caption',
  },
  wd14: {
    model_id: 'SmilingWolf/wd-eva02-large-tagger-v3',
    model_ids: [...DEFAULT_WD14_MODELS],
    local_dir: null,
    threshold_general: 0.35,
    threshold_character: 0.85,
    blacklist_tags: [],
    batch_size: 8,
  },
  cltagger: {
    model_id: 'cella110n/cl_tagger',
    model_path: 'cl_tagger_1_02/model.onnx',
    tag_mapping_path: 'cl_tagger_1_02/tag_mapping.json',
    local_dir: null,
    threshold_general: 0.35,
    threshold_character: 0.6,
    add_rating_tag: false,
    add_model_tag: false,
    blacklist_tags: [],
    batch_size: 8,
  },
  models: { root: null, selected_anima: 'preview3-base' },
  queue: { allow_gpu_during_train: false },
}

const textInputClass = 'w-full px-2 py-1 outline-none rounded-sm bg-sunken border border-subtle text-sm text-fg-primary focus:border-accent'

export default function SettingsPage() {
  const [server, setServer] = useState<Secrets | null>(null)
  const [draft, setDraft] = useState<Secrets>(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    api
      .getSecrets()
      .then((s) => {
        setServer(s)
        setDraft(s)
      })
      .catch((e) => setError(String(e)))
  }, [])

  const dirty = useMemo(
    () => server !== null && JSON.stringify(server) !== JSON.stringify(draft),
    [server, draft]
  )

  const update = <S extends Section, K extends keyof Secrets[S]>(
    section: S,
    key: K,
    value: Secrets[S][K]
  ) => {
    setDraft((prev) => ({
      ...prev,
      [section]: { ...prev[section], [key]: value },
    }))
  }

  const save = async () => {
    if (!server) return
    const patch = buildPatch(draft, server)
    setSaving(true)
    setError(null)
    try {
      const next = await api.updateSecrets(patch)
      setServer(next)
      setDraft(next)
      toast('已保存', 'success')
    } catch (e) {
      setError(String(e))
      toast('保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (error && !server) {
    return (
      <div className="text-err font-mono text-sm p-4 bg-err-soft rounded-md">
        {error}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        eyebrow="全局 · settings"
        title="设置"
        subtitle="API 密钥、路径、模型和队列行为。"
        sticky
        actions={
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="btn btn-primary btn-sm"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        }
      />

      <div className="p-6 pb-12 flex-1 overflow-y-auto">
      <div className="flex flex-col gap-8 max-w-[900px]">

      {error && (
        <div className="p-3 rounded-md bg-err-soft border border-err text-err text-sm font-mono">
          {error}
        </div>
      )}

      <SettingsSection title="Gelbooru">
        <SettingsField label="user_id">
          <input
            type="text"
            value={draft.gelbooru.user_id}
            onChange={(e) => update('gelbooru', 'user_id', e.target.value)}
            className={textInputClass}                                  />
        </SettingsField>
        <SettingsField label="api_key">
          <SensitiveInput
            value={draft.gelbooru.api_key}
            serverValue={server?.gelbooru.api_key ?? ''}
            onChange={(v) => update('gelbooru', 'api_key', v)}
          />
        </SettingsField>
        <SettingsField label="save_tags">
          <Bool value={draft.gelbooru.save_tags} onChange={(v) => update('gelbooru', 'save_tags', v)} />
        </SettingsField>
        <SettingsField label="convert_to_png">
          <Bool value={draft.gelbooru.convert_to_png} onChange={(v) => update('gelbooru', 'convert_to_png', v)} />
        </SettingsField>
        <SettingsField label="remove_alpha_channel">
          <Bool value={draft.gelbooru.remove_alpha_channel} onChange={(v) => update('gelbooru', 'remove_alpha_channel', v)} />
        </SettingsField>
      </SettingsSection>

      <SettingsSection title="Danbooru">
        <SettingsField label="username">
          <input
            type="text"
            value={draft.danbooru.username}
            onChange={(e) => update('danbooru', 'username', e.target.value)}
            placeholder="可选；匿名也能跑（仅速率受限）"
            className={textInputClass}                                  />
        </SettingsField>
        <SettingsField label="api_key">
          <SensitiveInput
            value={draft.danbooru.api_key}
            serverValue={server?.danbooru.api_key ?? ''}
            onChange={(v) => update('danbooru', 'api_key', v)}
          />
        </SettingsField>
        <SettingsField label="account_type">
          <select
            value={draft.danbooru.account_type}
            onChange={(e) => update('danbooru', 'account_type', e.target.value as 'free' | 'gold' | 'platinum')}
            className={textInputClass}          >
            <option value="free">free（max 2 tag）</option>
            <option value="gold">gold（max 6 tag）</option>
            <option value="platinum">platinum（max 12 tag）</option>
          </select>
        </SettingsField>
      </SettingsSection>

      <SettingsSection title="下载（全局）">
        <SettingsField label="exclude_tags (逗号分隔)">
          <input
            type="text"
            value={draft.download.exclude_tags.join(', ')}
            onChange={(e) =>
              update('download', 'exclude_tags',
                e.target.value.split(',').map((t) => t.trim().replace(/^-+/, '')).filter(Boolean)
              )
            }
            placeholder="例：comic, monochrome, lowres"
            className={textInputClass}                                  />
        </SettingsField>
        <p className="text-xs text-fg-tertiary px-1">
          搜索时自动追加 <code>-tag</code>，对 Gelbooru 与 Danbooru 同样生效。
        </p>

        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-subtle">
          <SettingsField label="parallel_workers">
            <input
              type="number" min={1} max={16}
              value={draft.download.parallel_workers}
              onChange={(e) => update('download', 'parallel_workers', Math.max(1, Number(e.target.value) || 1))}
              className={textInputClass}                                        />
          </SettingsField>
          <SettingsField label="api_rate_per_sec">
            <input
              type="number" step="0.5" min={0.5} max={10}
              value={draft.download.api_rate_per_sec}
              onChange={(e) => update('download', 'api_rate_per_sec', Math.max(0.5, Number(e.target.value) || 0.5))}
              className={textInputClass}                                        />
          </SettingsField>
          <SettingsField label="cdn_rate_per_sec">
            <input
              type="number" step="1" min={1} max={20}
              value={draft.download.cdn_rate_per_sec}
              onChange={(e) => update('download', 'cdn_rate_per_sec', Math.max(1, Number(e.target.value) || 1))}
              className={textInputClass}                                        />
          </SettingsField>
        </div>
      </SettingsSection>

      <SettingsSection title="HuggingFace">
        <SettingsField label="token">
          <SensitiveInput
            value={draft.huggingface.token}
            serverValue={server?.huggingface.token ?? ''}
            onChange={(v) => update('huggingface', 'token', v)}
          />
        </SettingsField>
      </SettingsSection>

      <SettingsSection title="JoyCaption (vLLM)">
        <SettingsField label="base_url">
          <input
            type="text"
            value={draft.joycaption.base_url}
            onChange={(e) => update('joycaption', 'base_url', e.target.value)}
            className={textInputClass}                                  />
        </SettingsField>
        <SettingsField label="model">
          <input
            type="text"
            value={draft.joycaption.model}
            onChange={(e) => update('joycaption', 'model', e.target.value)}
            className={textInputClass}                                  />
        </SettingsField>
        <SettingsField label="prompt_template">
          <input
            type="text"
            value={draft.joycaption.prompt_template}
            onChange={(e) => update('joycaption', 'prompt_template', e.target.value)}
            className={textInputClass}                                  />
        </SettingsField>
      </SettingsSection>

      <SettingsSection title="WD14">
        <SettingsField label="model_id (当前选用)">
          <select
            value={draft.wd14.model_id}
            onChange={(e) => update('wd14', 'model_id', e.target.value)}
            className={textInputClass}          >
            {(draft.wd14.model_ids.length > 0 ? draft.wd14.model_ids : [...DEFAULT_WD14_MODELS]).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </SettingsField>
        <SettingsField label="候选模型 (model_ids)">
          <ModelIdsEditor
            ids={draft.wd14.model_ids}
            currentId={draft.wd14.model_id}
            onChange={(next) => update('wd14', 'model_ids', next)}
          />
        </SettingsField>
        <SettingsField label="local_dir (留空 = 自动 HF 下载)">
          <input
            type="text"
            value={draft.wd14.local_dir ?? ''}
            onChange={(e) => update('wd14', 'local_dir', e.target.value || null)}
            className={textInputClass}                                  />
        </SettingsField>
        <SettingsField label="threshold_general">
          <input
            type="number" step="0.01" min={0} max={1}
            value={draft.wd14.threshold_general}
            onChange={(e) => update('wd14', 'threshold_general', Number(e.target.value))}
            className={textInputClass}                                  />
        </SettingsField>
        <SettingsField label="threshold_character">
          <input
            type="number" step="0.01" min={0} max={1}
            value={draft.wd14.threshold_character}
            onChange={(e) => update('wd14', 'threshold_character', Number(e.target.value))}
            className={textInputClass}                                  />
        </SettingsField>
        <SettingsField label="blacklist_tags (逗号分隔)">
          <input
            type="text"
            value={draft.wd14.blacklist_tags.join(', ')}
            onChange={(e) => update('wd14', 'blacklist_tags', e.target.value.split(',').map((t) => t.trim()).filter(Boolean))}
            className={textInputClass}                                  />
        </SettingsField>
        <SettingsField label="batch_size (GPU 推理一批塞几张；CPU 自动降到 1)">
          <input
            type="number" min={1} max={64}
            value={draft.wd14.batch_size}
            onChange={(e) => update('wd14', 'batch_size', Math.max(1, Number(e.target.value) || 1))}
            className={textInputClass}                                  />
        </SettingsField>
        <WD14RuntimePanel />
      </SettingsSection>

      <SettingsSection title="CLTagger">
        <SettingsField label="model_id">
          <input
            type="text"
            value={draft.cltagger.model_id}
            onChange={(e) => update('cltagger', 'model_id', e.target.value)}
            className={textInputClass}                                  />
        </SettingsField>
        <SettingsField label="model_path">
          <input
            type="text"
            value={draft.cltagger.model_path}
            onChange={(e) => update('cltagger', 'model_path', e.target.value)}
            className={textInputClass}                                  />
        </SettingsField>
        <SettingsField label="tag_mapping_path">
          <input
            type="text"
            value={draft.cltagger.tag_mapping_path}
            onChange={(e) => update('cltagger', 'tag_mapping_path', e.target.value)}
            className={textInputClass}                                  />
        </SettingsField>
        <SettingsField label="local_dir (留空 = 自动 HF 下载)">
          <input
            type="text"
            value={draft.cltagger.local_dir ?? ''}
            onChange={(e) => update('cltagger', 'local_dir', e.target.value || null)}
            className={textInputClass}                                  />
        </SettingsField>
        <div className="grid grid-cols-2 gap-2">
          <SettingsField label="threshold_general">
            <input
              type="number" step="0.01" min={0} max={1}
              value={draft.cltagger.threshold_general}
              onChange={(e) => update('cltagger', 'threshold_general', Number(e.target.value))}
              className={textInputClass}                                          />
          </SettingsField>
          <SettingsField label="threshold_character">
            <input
              type="number" step="0.01" min={0} max={1}
              value={draft.cltagger.threshold_character}
              onChange={(e) => update('cltagger', 'threshold_character', Number(e.target.value))}
              className={textInputClass}                                          />
          </SettingsField>
        </div>
        <SettingsField label="add_rating_tag">
          <Bool value={draft.cltagger.add_rating_tag} onChange={(v) => update('cltagger', 'add_rating_tag', v)} />
        </SettingsField>
        <SettingsField label="add_model_tag">
          <Bool value={draft.cltagger.add_model_tag} onChange={(v) => update('cltagger', 'add_model_tag', v)} />
        </SettingsField>
        <SettingsField label="blacklist_tags (逗号分隔)">
          <input
            type="text"
            value={draft.cltagger.blacklist_tags.join(', ')}
            onChange={(e) => update('cltagger', 'blacklist_tags', e.target.value.split(',').map((t) => t.trim()).filter(Boolean))}
            className={textInputClass}                                  />
        </SettingsField>
        <SettingsField label="batch_size (GPU 推理一批塞几张；CPU 自动降到 1)">
          <input
            type="number" min={1} max={64}
            value={draft.cltagger.batch_size}
            onChange={(e) => update('cltagger', 'batch_size', Math.max(1, Number(e.target.value) || 1))}
            className={textInputClass}                                  />
        </SettingsField>
      </SettingsSection>

      <SettingsSection title="队列调度">
        <SettingsField label="允许 GPU 任务与训练并行">
          <div className="flex items-center gap-3">
            <Bool value={draft.queue.allow_gpu_during_train} onChange={(v) => update('queue', 'allow_gpu_during_train', v)} />
            <span className="text-xs text-warn">
              WD14 打标推理 onnxruntime-gpu 大约占 ~2 GB；确认训练之外的剩余显存够再打开，否则 OOM
            </span>
          </div>
        </SettingsField>
      </SettingsSection>

      <DisplaySection />
      <ModelsSection />
    </div>
    </div>
    </div>
  )
}

// ── Section / Field ────────────────────────────────────────────────────────

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-subtle bg-surface p-4 flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-fg-primary mb-0.5">{title}</h2>
      {children}
    </section>
  )
}

function SettingsField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[200px_1fr] gap-3 items-center">
      <label className="text-xs text-fg-secondary font-mono">{label}</label>
      {children}
    </div>
  )
}

function Bool({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <input
      type="checkbox"
      checked={value}
      onChange={(e) => onChange(e.target.checked)}
      className="w-4 h-4"
      style={{ accentColor: 'var(--accent)' }}
    />
  )
}

function SensitiveInput({ value, serverValue, onChange }: {
  value: string; serverValue: string; onChange: (v: string) => void
}) {
  const masked = value === MASK
  return (
    <input
      type="password"
      value={masked ? '' : value}
      placeholder={serverValue === MASK ? '已保存（不显示），输入新值才覆盖' : ''}
      onChange={(e) => onChange(e.target.value || MASK)}
      className={textInputClass}                />
  )
}

// ── ModelIdsEditor ──────────────────────────────────────────────────────────

function ModelIdsEditor({ ids, currentId, onChange }: {
  ids: string[]; currentId: string; onChange: (next: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const seen = new Set(ids)

  const add = () => {
    const v = draft.trim()
    if (!v) return
    if (seen.has(v)) { setDraft(''); return }
    onChange([...ids, v])
    setDraft('')
  }
  const remove = (m: string) => {
    if (m === currentId) return
    onChange(ids.filter((x) => x !== m))
  }

  return (
    <div className="flex flex-col gap-1.5">
      <ul className="flex flex-col gap-1 list-none m-0 p-0">
        {ids.map((m) => {
          const isCurrent = m === currentId
          return (
            <li key={m} className={`flex items-center gap-2 px-2 py-1 rounded-sm text-xs ${
              isCurrent ? 'border border-accent bg-accent-soft' : 'border border-subtle bg-sunken'
            }`}>
              <code className="font-mono text-fg-primary flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{m}</code>
              {isCurrent ? (
                <span className="text-xs text-accent">当前</span>
              ) : (
                <button onClick={() => remove(m)} className="text-xs text-fg-tertiary hover:text-err bg-transparent border-none cursor-pointer transition-colors">×</button>
              )}
            </li>
          )
        })}
      </ul>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder="添加 HuggingFace 模型 ID"
          className={`${textInputClass} flex-1`}                            />
        <button onClick={add} disabled={!draft.trim() || seen.has(draft.trim())} className="btn btn-secondary btn-sm">+ 添加</button>
      </div>
    </div>
  )
}

function buildPatch(draft: Secrets, server: Secrets): SecretsPatch {
  const out: Record<string, Record<string, unknown>> = {}
  for (const key of Object.keys(draft) as Section[]) {
    const sub: Record<string, unknown> = {}
    const d = draft[key] as unknown as Record<string, unknown>
    const s = server[key] as unknown as Record<string, unknown>
    for (const k of Object.keys(d)) {
      const dv = d[k]
      const sv = s[k]
      if (dv === MASK) continue
      if (JSON.stringify(dv) !== JSON.stringify(sv)) sub[k] = dv
    }
    if (Object.keys(sub).length) out[key] = sub
  }
  return out as SecretsPatch
}

// ── Models Section ─────────────────────────────────────────────────────────

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function ModelsSection() {
  const { toast } = useToast()
  const [catalog, setCatalog] = useState<ModelsCatalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [rootDraft, setRootDraft] = useState<string>('')
  const [serverRoot, setServerRoot] = useState<string | null>(null)
  const [savingRoot, setSavingRoot] = useState(false)
  const [selectedAnima, setSelectedAnima] = useState<string>('preview3-base')

  const reload = useCallback(async () => {
    try {
      const [c, sec] = await Promise.all([api.getModelsCatalog(), api.getSecrets()])
      setCatalog(c)
      const root = sec.models?.root ?? null
      setServerRoot(root)
      setRootDraft((prev) => (prev === '' || prev === (serverRoot ?? '') ? root ?? '' : prev))
      setSelectedAnima(sec.models?.selected_anima ?? 'preview3-base')
      setError(null)
    } catch (e) {
      setError(String(e))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pickAnima = async (variant: string) => {
    if (variant === selectedAnima) return
    setSelectedAnima(variant)
    try {
      await api.updateSecrets({ models: { selected_anima: variant } })
      toast(`默认主模型已切到 ${variant}`, 'success')
      await reload()
    } catch (e) {
      toast(String(e), 'error')
      void reload()
    }
  }

  useEffect(() => { void reload() }, [reload])

  const saveRoot = async () => {
    const v = rootDraft.trim()
    setSavingRoot(true)
    try {
      await api.updateSecrets({ models: { root: v ? v : null } })
      toast(v ? `已保存模型根目录: ${v}` : '已恢复默认模型根目录', 'success')
      await reload()
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setSavingRoot(false)
    }
  }

  const rootDirty = rootDraft.trim() !== (serverRoot ?? '')

  useEventStream((evt) => {
    if (evt.type === 'model_download_changed') { void reload() }
  })

  const start = async (model_id: string, variant?: string) => {
    const key = variant ? `${model_id}:${variant}` : model_id
    setBusy((s) => new Set(s).add(key))
    try {
      await api.startModelDownload({ model_id, variant })
      toast(`开始下载 ${key}`, 'success')
      await reload()
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setBusy((s) => { const n = new Set(s); n.delete(key); return n })
    }
  }

  return (
    <SettingsSection title="Models（一键下载训练所需模型）">
      <SettingsField label="模型根目录 (models_root)">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="text"
            value={rootDraft}
            onChange={(e) => setRootDraft(e.target.value)}
            placeholder="留空 = 默认 REPO_ROOT/anima/"
            className={`${textInputClass} flex-1`}                                  />
          <button onClick={saveRoot} disabled={!rootDirty || savingRoot} className="btn btn-primary btn-sm"
            title={rootDirty ? '保存路径配置' : '未修改'}>
            {savingRoot ? '保存中...' : '保存路径'}
          </button>
          <button onClick={() => setRootDraft(serverRoot ?? '')} disabled={!rootDirty || savingRoot}
            className="px-2 py-0.5 text-fg-tertiary bg-transparent border-none cursor-pointer rounded-sm"
            style={{ opacity: !rootDirty ? 0.3 : 1 }}
          >↻</button>
        </div>
      </SettingsField>

      {error && <div className="text-err text-xs font-mono">{error}</div>}
      {!catalog ? (
        <p className="text-fg-tertiary text-xs">加载...</p>
      ) : (
        <div className="flex flex-col gap-2">
          {/* Anima 主模型 */}
          <ModelGroupCard title={catalog.anima_main.name}>
            <p className="text-xs text-fg-tertiary m-0">
              {catalog.anima_main.description} · <code>{catalog.anima_main.repo}</code>
              <br />选中的版本会作为<strong className="text-fg-primary">新建 version</strong>的默认 transformer。
            </p>
            <ul className="list-none m-0 p-0 flex flex-col gap-1">
              {catalog.anima_main.variants.map((v) => {
                const key = `anima_main:${v.variant}`
                const dl = catalog.downloads[key]
                const isSel = v.variant === selectedAnima
                const canSelect = v.exists && dl?.status !== 'running'
                return (
                  <li key={v.variant} className={`flex items-center gap-2 text-xs px-1.5 py-1 rounded-sm ${
                    isSel ? 'bg-accent-soft border border-accent' : 'bg-transparent border border-transparent'
                  }`}>
                    <input type="radio" name="anima_variant" checked={isSel} disabled={!canSelect}
                      onChange={() => void pickAnima(v.variant)}
                      className="shrink-0"
                      style={{ accentColor: 'var(--accent)' }}
                      title={canSelect ? '选作默认主模型' : v.exists ? '下载中...' : '未下载，请先下载'}
                    />
                    <code className="font-mono text-fg-primary w-32 shrink-0">{v.variant}</code>
                    <ModelStatusBadge exists={v.exists} size={v.size} status={dl?.status} />
                    <span style={{ flex: 1 }} />
                    <DownloadButton exists={v.exists} status={dl?.status} busy={busy.has(key)} onClick={() => void start('anima_main', v.variant)} />
                  </li>
                )
              })}
            </ul>
          </ModelGroupCard>

          {/* VAE */}
          <ModelGroupCard title={catalog.anima_vae.name}>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-fg-tertiary">{catalog.anima_vae.description} · <code>{catalog.anima_vae.repo}</code></span>
              <span style={{ flex: 1 }} />
              <ModelStatusBadge exists={catalog.anima_vae.exists} size={catalog.anima_vae.size} status={catalog.downloads.anima_vae?.status} />
              <DownloadButton exists={catalog.anima_vae.exists} status={catalog.downloads.anima_vae?.status} busy={busy.has('anima_vae')} onClick={() => void start('anima_vae')} />
            </div>
          </ModelGroupCard>

          {/* Qwen3 + T5 */}
          {(['qwen3', 't5_tokenizer', 'cltagger'] as const).map((id) => {
            const m = catalog[id]
            const dl = catalog.downloads[id]
            const allExist = m.files.every((f) => f.exists)
            const totalSize = m.files.reduce((s, f) => s + f.size, 0)
            return (
              <ModelGroupCard key={id} title={m.name}>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-fg-tertiary">{m.description} · <code>{m.repo}</code></span>
                  <span style={{ flex: 1 }} />
                  <ModelStatusBadge exists={allExist} size={totalSize} status={dl?.status} fileCount={m.files.length} existsCount={m.files.filter((f) => f.exists).length} />
                  <DownloadButton exists={allExist} status={dl?.status} busy={busy.has(id)} onClick={() => void start(id)} />
                </div>
              </ModelGroupCard>
            )
          })}

          {/* 下载日志 */}
          {Object.values(catalog.downloads).filter((d) => d.status === 'running' || d.status === 'failed').length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-fg-tertiary">
                下载日志 ({Object.values(catalog.downloads).filter((d) => d.status === 'running' || d.status === 'failed').length})
              </summary>
              <div className="mt-1 flex flex-col gap-2">
                {Object.values(catalog.downloads).map((d) => (
                  <div key={d.key} className="rounded-sm border border-subtle bg-sunken p-2">
                    <div className="flex items-center gap-2 mb-1">
                      <code className="font-mono text-fg-secondary">{d.key}</code>
                      <ModelStatusBadge exists={d.status === 'done'} size={0} status={d.status} />
                      {d.message && <span className="text-err overflow-hidden text-ellipsis whitespace-nowrap">{d.message}</span>}
                    </div>
                    <pre className="text-xs font-mono text-fg-tertiary max-h-32 overflow-auto whitespace-pre-wrap m-0">
                      {d.log_tail.join('\n') || '(等待日志...)'}
                    </pre>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </SettingsSection>
  )
}

function ModelGroupCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-sm border border-subtle bg-sunken p-2.5">
      <h4 className="text-xs font-semibold text-fg-primary mb-1.5">{title}</h4>
      {children}
    </div>
  )
}

function ModelStatusBadge({ exists, size, status, fileCount, existsCount }: {
  exists: boolean; size: number; status?: ModelDownloadStatus['status']; fileCount?: number; existsCount?: number
}) {
  if (status === 'running') {
    return <StatusLabel bg="bg-warn-soft" fg="text-warn" text="下载中..." pulse />
  }
  if (status === 'failed') {
    return <StatusLabel bg="bg-err-soft" fg="text-err" text="失败" />
  }
  if (exists) {
    return <StatusLabel bg="bg-ok-soft" fg="text-ok" text={`✓ ${fmtBytes(size)}${fileCount !== undefined ? ` (${existsCount}/${fileCount})` : ''}`} />
  }
  if (fileCount !== undefined && existsCount! > 0) {
    return <StatusLabel bg="bg-warn-soft" fg="text-warn" text={`部分 (${existsCount}/${fileCount})`} />
  }
  return <StatusLabel bg="bg-overlay" fg="text-fg-tertiary" text="未下载" />
}

function StatusLabel({ bg, fg, text, pulse }: { bg: string; fg: string; text: string; pulse?: boolean }) {
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded-sm font-mono ${bg} ${fg}`}
      style={pulse ? { animation: 'pulse 1.5s infinite' } : undefined}
    >{text}</span>
  )
}

function DownloadButton({ exists, status, busy, onClick }: {
  exists: boolean; status?: ModelDownloadStatus['status']; busy: boolean; onClick: () => void
}) {
  const running = status === 'running' || busy
  if (running) {
    return <button disabled className="btn btn-secondary btn-sm" style={{ opacity: 0.5 }}>...</button>
  }
  return (
    <button onClick={onClick} className={exists ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm'}
      title={exists ? '已下载，点击重新下载' : '下载'}>
      {exists ? '↻ 重下' : '⤓ 下载'}
    </button>
  )
}

// ── WD14 Runtime Panel ──────────────────────────────────────────────────────

function WD14RuntimePanel() {
  const [rt, setRt] = useState<WD14Runtime | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'auto' | 'gpu' | 'cpu'>(null)
  const { toast } = useToast()

  const refresh = useCallback(async () => {
    try {
      const r = await api.getWD14Runtime()
      setRt(r)
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const install = async (target: 'auto' | 'gpu' | 'cpu') => {
    const detail = target === 'auto' ? '将按 nvidia-smi 检测自动选 GPU/CPU 包'
      : target === 'gpu' ? '将卸载现有 onnxruntime 并安装 onnxruntime-gpu'
      : '将卸载现有 onnxruntime-gpu 并安装 onnxruntime（CPU）'
    if (!confirm(`${detail}。装包需要几分钟。\n\n注意：装完后必须重启 Studio 才能生效。继续？`)) return
    setBusy(target)
    try {
      const result = await api.installWD14Runtime(target)
      setRt({
        installed: result.installed, version: result.version, providers: result.providers,
        cuda_available: result.cuda_available, restart_required: result.restart_required,
        cuda_load_error: result.cuda_load_error, preload: result.preload, cuda_detect: result.cuda_detect,
      })
      const newPkg = result.installed_pkg ?? result.installed ?? '?'
      const newVer = result.installed_version ?? result.version ?? '?'
      toast(`已装 ${newPkg}==${newVer}，请重启 Studio 让 EP 生效`, 'success')
    } catch (e) {
      toast(`装包失败: ${e}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  if (error) return <div className="text-err text-xs font-mono">{error}</div>
  if (!rt) return <div className="text-xs text-fg-tertiary">加载 runtime 状态...</div>

  const epLabel = (rt.providers ?? []).map((p) => p.replace('ExecutionProvider', '')).join(' / ') || '(none)'
  const cuda = rt.cuda_detect ?? { available: false, driver_version: null, gpu_name: null }
  const cudaInfo = cuda.available ? `${cuda.gpu_name ?? '?'} (driver ${cuda.driver_version ?? '?'})` : '未检测到 NVIDIA GPU'
  const mismatched = cuda.available && !rt.cuda_available

  const runtimeBoxClass = 'rounded-sm border border-subtle bg-sunken p-2 flex flex-col gap-1 text-xs'

  return (
    <div className={runtimeBoxClass}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-fg-tertiary shrink-0">runtime:</span>
        <code className="font-mono text-fg-primary">{rt.installed ?? '(未安装)'}{rt.version ? `==${rt.version}` : ''}</code>
        <StatusLabel bg={rt.cuda_available ? 'bg-ok-soft' : 'bg-warn-soft'} fg={rt.cuda_available ? 'text-ok' : 'text-warn'} text={rt.cuda_available ? 'CUDA' : 'CPU only'} />
      </div>
      <div className="text-fg-tertiary">EP: <code className="text-fg-secondary font-mono">{epLabel}</code></div>
      <div className="text-fg-tertiary">GPU 检测: <span className="text-fg-secondary">{cudaInfo}</span></div>

      {rt.restart_required && (
        <div className="rounded-sm border border-err bg-err-soft px-2 py-1.5 text-err text-xs">
          已装新 onnxruntime 包，但当前进程仍在用旧的。<strong>请重启 Studio</strong> 让 EP 切换生效。
        </div>
      )}
      {!rt.restart_required && mismatched && (
        <div className="rounded-sm border border-info bg-info-soft px-2 py-1.5 text-info text-xs">
          检测到 NVIDIA GPU 但 onnxruntime 只有 CPU EP — WD14 会跑得很慢。点下方「重装为 GPU 版」修复。
        </div>
      )}
      {rt.cuda_load_error && (
        <div className="rounded-sm border border-err bg-err-soft px-2 py-1.5 text-xs text-err">
          <div>CUDA EP 加载失败，已降级到 CPU。</div>
          <code className="block font-mono text-xs text-err break-all whitespace-pre-wrap mt-1">
            {rt.cuda_load_error}
          </code>
        </div>
      )}

      <div className="flex gap-1.5 flex-wrap pt-1">
        <button onClick={() => install('auto')} disabled={busy !== null} className="btn btn-secondary btn-sm">{busy === 'auto' ? '装包中...' : '自动检测'}</button>
        <button onClick={() => install('gpu')} disabled={busy !== null} className="btn btn-primary btn-sm">{busy === 'gpu' ? '装包中...' : '重装为 GPU'}</button>
        <button onClick={() => install('cpu')} disabled={busy !== null} className="btn btn-secondary btn-sm">{busy === 'cpu' ? '装包中...' : '重装为 CPU'}</button>
        <button onClick={() => void refresh()} disabled={busy !== null} className="px-2 py-0.5 text-fg-tertiary bg-transparent border-none cursor-pointer rounded-sm">↻</button>
      </div>
    </div>
  )
}

// ── Display Section ────────────────────────────────────────────────────────

function DisplaySection() {
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme())
  const [density, setDensity] = useState<Density>(() => getStoredDensity())

  const handleThemeChange = (t: Theme) => {
    setTheme(t)
    setStoredTheme(t)
    applyTheme(t)
  }

  const handleDensityChange = (d: Density) => {
    setDensity(d)
    setStoredDensity(d)
    applyDensity(d)
  }

  const densityLabel = (d: Density): string => {
    if (d === 'tight') return '紧凑'
    if (d === 'loose') return '宽松'
    return '默认'
  }

  const densityDesc = (d: Density): string => {
    if (d === 'tight') return '字号更小，间距更紧，适合小屏或高信息密度'
    if (d === 'loose') return '字号更大，间距更宽，适合阅读舒适'
    return '标准字号与间距'
  }

  return (
    <SettingsSection title="显示">
      <SettingsField label="主题">
        <div className="flex gap-1">
          {(['light', 'dark'] as Theme[]).map((t) => (
            <button
              key={t}
              onClick={() => handleThemeChange(t)}
              className={`btn btn-sm ${theme === t ? 'btn-primary' : 'btn-secondary'}`}
            >
              {t === 'light' ? '☀ 日间' : '☾ 暗色'}
            </button>
          ))}
        </div>
      </SettingsField>

      <SettingsField label="界面缩放">
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1">
            {(['tight', 'default', 'loose'] as Density[]).map((d) => (
              <button
                key={d}
                onClick={() => handleDensityChange(d)}
                className={`btn btn-sm ${density === d ? 'btn-primary' : 'btn-secondary'}`}
              >
                {densityLabel(d)}
              </button>
            ))}
          </div>
          <p className="text-xs text-fg-tertiary m-0">
            {densityDesc(density)}
          </p>
        </div>
      </SettingsField>
    </SettingsSection>
  )
}
