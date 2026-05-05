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
import { useToast } from '../../components/Toast'
import { useEventStream } from '../../lib/useEventStream'

const MASK = '***'

type Section =
  | 'gelbooru'
  | 'danbooru'
  | 'download'
  | 'huggingface'
  | 'joycaption'
  | 'wd14'
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
  models: { root: null, selected_anima: 'preview3-base' },
  queue: { allow_gpu_during_train: false },
}

const textInput: React.CSSProperties = {
  width: '100%',
  padding: '4px 8px',
  borderRadius: 'var(--r-sm)',
  background: 'var(--bg-sunken)',
  border: '1px solid var(--border-subtle)',
  fontSize: 'var(--t-sm)',
  color: 'var(--fg-primary)',
  outline: 'none',
}

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
      <div style={{ color: 'var(--err)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)', padding: 16, background: 'var(--err-soft)', borderRadius: 'var(--r-md)' }}>
        {error}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 900, display: 'flex', flexDirection: 'column', gap: 32, paddingBottom: 48 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ fontSize: 'var(--t-2xl)', fontWeight: 600, flex: 1, color: 'var(--fg-primary)' }}>设置</h1>
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="btn btn-primary btn-sm"
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </header>

      {error && (
        <div style={{ padding: 12, borderRadius: 'var(--r-md)', background: 'var(--err-soft)', border: '1px solid var(--err)', color: 'var(--err)', fontSize: 'var(--t-sm)', fontFamily: 'var(--font-mono)' }}>
          {error}
        </div>
      )}

      <SettingsSection title="Gelbooru">
        <SettingsField label="user_id">
          <input
            type="text"
            value={draft.gelbooru.user_id}
            onChange={(e) => update('gelbooru', 'user_id', e.target.value)}
            style={textInput}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
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
            style={textInput}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
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
            style={textInput}
          >
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
            style={textInput}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
        </SettingsField>
        <p style={{ fontSize: 'var(--t-2xs)', color: 'var(--fg-tertiary)', padding: '0 4px' }}>
          搜索时自动追加 <code>-tag</code>，对 Gelbooru 与 Danbooru 同样生效。
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
          <SettingsField label="parallel_workers">
            <input
              type="number" min={1} max={16}
              value={draft.download.parallel_workers}
              onChange={(e) => update('download', 'parallel_workers', Math.max(1, Number(e.target.value) || 1))}
              style={textInput}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </SettingsField>
          <SettingsField label="api_rate_per_sec">
            <input
              type="number" step="0.5" min={0.5} max={10}
              value={draft.download.api_rate_per_sec}
              onChange={(e) => update('download', 'api_rate_per_sec', Math.max(0.5, Number(e.target.value) || 0.5))}
              style={textInput}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </SettingsField>
          <SettingsField label="cdn_rate_per_sec">
            <input
              type="number" step="1" min={1} max={20}
              value={draft.download.cdn_rate_per_sec}
              onChange={(e) => update('download', 'cdn_rate_per_sec', Math.max(1, Number(e.target.value) || 1))}
              style={textInput}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
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
            style={textInput}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
        </SettingsField>
        <SettingsField label="model">
          <input
            type="text"
            value={draft.joycaption.model}
            onChange={(e) => update('joycaption', 'model', e.target.value)}
            style={textInput}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
        </SettingsField>
        <SettingsField label="prompt_template">
          <input
            type="text"
            value={draft.joycaption.prompt_template}
            onChange={(e) => update('joycaption', 'prompt_template', e.target.value)}
            style={textInput}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
        </SettingsField>
      </SettingsSection>

      <SettingsSection title="WD14">
        <SettingsField label="model_id (当前选用)">
          <select
            value={draft.wd14.model_id}
            onChange={(e) => update('wd14', 'model_id', e.target.value)}
            style={textInput}
          >
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
            style={textInput}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
        </SettingsField>
        <SettingsField label="threshold_general">
          <input
            type="number" step="0.01" min={0} max={1}
            value={draft.wd14.threshold_general}
            onChange={(e) => update('wd14', 'threshold_general', Number(e.target.value))}
            style={textInput}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
        </SettingsField>
        <SettingsField label="threshold_character">
          <input
            type="number" step="0.01" min={0} max={1}
            value={draft.wd14.threshold_character}
            onChange={(e) => update('wd14', 'threshold_character', Number(e.target.value))}
            style={textInput}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
        </SettingsField>
        <SettingsField label="blacklist_tags (逗号分隔)">
          <input
            type="text"
            value={draft.wd14.blacklist_tags.join(', ')}
            onChange={(e) => update('wd14', 'blacklist_tags', e.target.value.split(',').map((t) => t.trim()).filter(Boolean))}
            style={textInput}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
        </SettingsField>
        <SettingsField label="batch_size (GPU 推理一批塞几张；CPU 自动降到 1)">
          <input
            type="number" min={1} max={64}
            value={draft.wd14.batch_size}
            onChange={(e) => update('wd14', 'batch_size', Math.max(1, Number(e.target.value) || 1))}
            style={textInput}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
        </SettingsField>
        <WD14RuntimePanel />
      </SettingsSection>

      <SettingsSection title="队列调度">
        <SettingsField label="允许 GPU 任务与训练并行">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Bool value={draft.queue.allow_gpu_during_train} onChange={(v) => update('queue', 'allow_gpu_during_train', v)} />
            <span style={{ fontSize: 'var(--t-2xs)', color: 'var(--warn)' }}>
              WD14 打标推理 onnxruntime-gpu 大约占 ~2 GB；确认训练之外的剩余显存够再打开，否则 OOM
            </span>
          </div>
        </SettingsField>
      </SettingsSection>

      <ModelsSection />
    </div>
  )
}

function focusBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = 'var(--accent)'
}
function blurBorder(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = 'var(--border-subtle)'
}

// ── Section / Field ────────────────────────────────────────────────────────

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{
      borderRadius: 'var(--r-md)',
      border: '1px solid var(--border-subtle)',
      background: 'var(--bg-surface)',
      padding: 16,
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <h2 style={{ fontSize: 'var(--t-sm)', fontWeight: 600, color: 'var(--fg-primary)', marginBottom: 2 }}>{title}</h2>
      {children}
    </section>
  )
}

function SettingsField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 12, alignItems: 'center' }}>
      <label style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-secondary)', fontFamily: 'var(--font-mono)' }}>{label}</label>
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
      style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
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
      style={textInput}
      onFocus={focusBorder}
      onBlur={blurBorder}
    />
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <ul style={{ display: 'flex', flexDirection: 'column', gap: 4, listStyle: 'none', margin: 0, padding: 0 }}>
        {ids.map((m) => {
          const isCurrent = m === currentId
          return (
            <li key={m} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '4px 8px', borderRadius: 'var(--r-sm)',
              border: isCurrent ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
              background: isCurrent ? 'var(--accent-soft)' : 'var(--bg-sunken)',
              fontSize: 'var(--t-xs)',
            }}>
              <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m}</code>
              {isCurrent ? (
                <span style={{ fontSize: 'var(--t-2xs)', color: 'var(--accent)' }}>当前</span>
              ) : (
                <button onClick={() => remove(m)} style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--err)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--fg-tertiary)' }}
                >×</button>
              )}
            </li>
          )
        })}
      </ul>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder="添加 HuggingFace 模型 ID"
          style={{ ...textInput, flex: 1 }}
          onFocus={focusBorder}
          onBlur={blurBorder}
        />
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
            style={{ ...textInput, flex: 1 }}
            onFocus={focusBorder}
            onBlur={blurBorder}
          />
          <button onClick={saveRoot} disabled={!rootDirty || savingRoot} className="btn btn-primary btn-sm"
            title={rootDirty ? '保存路径配置' : '未修改'}>
            {savingRoot ? '保存中...' : '保存路径'}
          </button>
          <button onClick={() => setRootDraft(serverRoot ?? '')} disabled={!rootDirty || savingRoot}
            style={{ padding: '2px 8px', color: 'var(--fg-tertiary)', background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: 'var(--r-sm)', opacity: !rootDirty ? 0.3 : 1 }}
          >↻</button>
        </div>
      </SettingsField>

      {error && <div style={{ color: 'var(--err)', fontSize: 'var(--t-xs)', fontFamily: 'var(--font-mono)' }}>{error}</div>}
      {!catalog ? (
        <p style={{ color: 'var(--fg-tertiary)', fontSize: 'var(--t-xs)' }}>加载...</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Anima 主模型 */}
          <ModelGroupCard title={catalog.anima_main.name}>
            <p style={{ fontSize: 'var(--t-2xs)', color: 'var(--fg-tertiary)', margin: 0 }}>
              {catalog.anima_main.description} · <code>{catalog.anima_main.repo}</code>
              <br />选中的版本会作为<strong style={{ color: 'var(--fg-primary)' }}>新建 version</strong>的默认 transformer。
            </p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {catalog.anima_main.variants.map((v) => {
                const key = `anima_main:${v.variant}`
                const dl = catalog.downloads[key]
                const isSel = v.variant === selectedAnima
                const canSelect = v.exists && dl?.status !== 'running'
                return (
                  <li key={v.variant} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    fontSize: 'var(--t-xs)', padding: '4px 6px', borderRadius: 'var(--r-sm)',
                    background: isSel ? 'var(--accent-soft)' : 'transparent',
                    border: isSel ? '1px solid var(--accent)' : '1px solid transparent',
                  }}>
                    <input type="radio" name="anima_variant" checked={isSel} disabled={!canSelect}
                      onChange={() => void pickAnima(v.variant)}
                      style={{ accentColor: 'var(--accent)', flexShrink: 0 }}
                      title={canSelect ? '选作默认主模型' : v.exists ? '下载中...' : '未下载，请先下载'}
                    />
                    <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)', width: 128, flexShrink: 0 }}>{v.variant}</code>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--t-xs)' }}>
              <span style={{ color: 'var(--fg-tertiary)' }}>{catalog.anima_vae.description} · <code>{catalog.anima_vae.repo}</code></span>
              <span style={{ flex: 1 }} />
              <ModelStatusBadge exists={catalog.anima_vae.exists} size={catalog.anima_vae.size} status={catalog.downloads.anima_vae?.status} />
              <DownloadButton exists={catalog.anima_vae.exists} status={catalog.downloads.anima_vae?.status} busy={busy.has('anima_vae')} onClick={() => void start('anima_vae')} />
            </div>
          </ModelGroupCard>

          {/* Qwen3 + T5 */}
          {(['qwen3', 't5_tokenizer'] as const).map((id) => {
            const m = catalog[id]
            const dl = catalog.downloads[id]
            const allExist = m.files.every((f) => f.exists)
            const totalSize = m.files.reduce((s, f) => s + f.size, 0)
            return (
              <ModelGroupCard key={id} title={m.name}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--t-xs)' }}>
                  <span style={{ color: 'var(--fg-tertiary)' }}>{m.description} · <code>{m.repo}</code></span>
                  <span style={{ flex: 1 }} />
                  <ModelStatusBadge exists={allExist} size={totalSize} status={dl?.status} fileCount={m.files.length} existsCount={m.files.filter((f) => f.exists).length} />
                  <DownloadButton exists={allExist} status={dl?.status} busy={busy.has(id)} onClick={() => void start(id)} />
                </div>
              </ModelGroupCard>
            )
          })}

          {/* 下载日志 */}
          {Object.values(catalog.downloads).filter((d) => d.status === 'running' || d.status === 'failed').length > 0 && (
            <details style={{ fontSize: 'var(--t-xs)' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--fg-tertiary)' }}>
                下载日志 ({Object.values(catalog.downloads).filter((d) => d.status === 'running' || d.status === 'failed').length})
              </summary>
              <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Object.values(catalog.downloads).map((d) => (
                  <div key={d.key} style={{ borderRadius: 'var(--r-sm)', border: '1px solid var(--border-subtle)', background: 'var(--bg-sunken)', padding: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-secondary)' }}>{d.key}</code>
                      <ModelStatusBadge exists={d.status === 'done'} size={0} status={d.status} />
                      {d.message && <span style={{ color: 'var(--err)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.message}</span>}
                    </div>
                    <pre style={{ fontSize: 'var(--t-2xs)', fontFamily: 'var(--font-mono)', color: 'var(--fg-tertiary)', maxHeight: 128, overflow: 'auto', whiteSpace: 'pre-wrap', margin: 0 }}>
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
    <div style={{ borderRadius: 'var(--r-sm)', border: '1px solid var(--border-subtle)', background: 'var(--bg-sunken)', padding: 10 }}>
      <h4 style={{ fontSize: 'var(--t-xs)', fontWeight: 600, color: 'var(--fg-primary)', margin: '0 0 6px' }}>{title}</h4>
      {children}
    </div>
  )
}

function ModelStatusBadge({ exists, size, status, fileCount, existsCount }: {
  exists: boolean; size: number; status?: ModelDownloadStatus['status']; fileCount?: number; existsCount?: number
}) {
  if (status === 'running') {
    return <StatusLabel bg="var(--warn-soft)" fg="var(--warn)" text="下载中..." pulse />
  }
  if (status === 'failed') {
    return <StatusLabel bg="var(--err-soft)" fg="var(--err)" text="失败" />
  }
  if (exists) {
    return <StatusLabel bg="var(--ok-soft)" fg="var(--ok)" text={`✓ ${fmtBytes(size)}${fileCount !== undefined ? ` (${existsCount}/${fileCount})` : ''}`} />
  }
  if (fileCount !== undefined && existsCount! > 0) {
    return <StatusLabel bg="var(--warn-soft)" fg="var(--warn)" text={`部分 (${existsCount}/${fileCount})`} />
  }
  return <StatusLabel bg="var(--bg-overlay)" fg="var(--fg-tertiary)" text="未下载" />
}

function StatusLabel({ bg, fg, text, pulse }: { bg: string; fg: string; text: string; pulse?: boolean }) {
  return (
    <span style={{
      fontSize: 'var(--t-2xs)', padding: '2px 6px', borderRadius: 'var(--r-sm)',
      background: bg, color: fg, fontFamily: 'var(--font-mono)',
      ...(pulse ? { animation: 'pulse 1.5s infinite' } : {}),
    }}>{text}</span>
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

  if (error) return <div style={{ color: 'var(--err)', fontSize: 'var(--t-xs)', fontFamily: 'var(--font-mono)' }}>{error}</div>
  if (!rt) return <div style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)' }}>加载 runtime 状态...</div>

  const epLabel = (rt.providers ?? []).map((p) => p.replace('ExecutionProvider', '')).join(' / ') || '(none)'
  const cuda = rt.cuda_detect ?? { available: false, driver_version: null, gpu_name: null }
  const cudaInfo = cuda.available ? `${cuda.gpu_name ?? '?'} (driver ${cuda.driver_version ?? '?'})` : '未检测到 NVIDIA GPU'
  const mismatched = cuda.available && !rt.cuda_available

  const runtimeBox: React.CSSProperties = {
    borderRadius: 'var(--r-sm)', border: '1px solid var(--border-subtle)',
    background: 'var(--bg-sunken)', padding: 8,
    display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--t-xs)',
  }

  return (
    <div style={runtimeBox}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--fg-tertiary)', flexShrink: 0 }}>runtime:</span>
        <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)' }}>{rt.installed ?? '(未安装)'}{rt.version ? `==${rt.version}` : ''}</code>
        <StatusLabel bg={rt.cuda_available ? 'var(--ok-soft)' : 'var(--warn-soft)'} fg={rt.cuda_available ? 'var(--ok)' : 'var(--warn)'} text={rt.cuda_available ? 'CUDA' : 'CPU only'} />
      </div>
      <div style={{ color: 'var(--fg-tertiary)' }}>EP: <code style={{ color: 'var(--fg-secondary)', fontFamily: 'var(--font-mono)' }}>{epLabel}</code></div>
      <div style={{ color: 'var(--fg-tertiary)' }}>GPU 检测: <span style={{ color: 'var(--fg-secondary)' }}>{cudaInfo}</span></div>

      {rt.restart_required && (
        <div style={{ borderRadius: 'var(--r-sm)', border: '1px solid var(--err)', background: 'var(--err-soft)', padding: '6px 8px', color: 'var(--err)', fontSize: 'var(--t-2xs)' }}>
          已装新 onnxruntime 包，但当前进程仍在用旧的。<strong>请重启 Studio</strong> 让 EP 切换生效。
        </div>
      )}
      {!rt.restart_required && mismatched && (
        <div style={{ color: 'var(--warn)', fontSize: 'var(--t-2xs)' }}>
          检测到 NVIDIA GPU 但 onnxruntime 只有 CPU EP — WD14 会跑得很慢。点下方「重装为 GPU 版」修复。
        </div>
      )}
      {rt.cuda_load_error && (
        <div style={{ borderRadius: 'var(--r-sm)', border: '1px solid var(--err)', background: 'var(--err-soft)', padding: '6px 8px', fontSize: 'var(--t-2xs)', color: 'var(--err)' }}>
          <div>CUDA EP 加载失败，已降级到 CPU。</div>
          <code style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-2xs)', color: 'var(--err)', wordBreak: 'break-all', whiteSpace: 'pre-wrap', marginTop: 4 }}>
            {rt.cuda_load_error}
          </code>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingTop: 4 }}>
        <button onClick={() => install('auto')} disabled={busy !== null} className="btn btn-secondary btn-sm">{busy === 'auto' ? '装包中...' : '自动检测'}</button>
        <button onClick={() => install('gpu')} disabled={busy !== null} className="btn btn-primary btn-sm">{busy === 'gpu' ? '装包中...' : '重装为 GPU'}</button>
        <button onClick={() => install('cpu')} disabled={busy !== null} className="btn btn-secondary btn-sm">{busy === 'cpu' ? '装包中...' : '重装为 CPU'}</button>
        <button onClick={() => void refresh()} disabled={busy !== null} style={{ padding: '2px 8px', color: 'var(--fg-tertiary)', background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: 'var(--r-sm)' }}>↻</button>
      </div>
    </div>
  )
}
