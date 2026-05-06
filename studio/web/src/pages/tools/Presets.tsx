import { useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  type ConfigData,
  type PresetSummary,
  type SchemaResponse,
} from '../../api/client'
import SchemaForm from '../../components/SchemaForm'
import { useToast } from '../../components/Toast'

// ── TOML 生成（键按字母排序，值尽量保留原始类型） ──────────────────────────
function toTomlValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v)) return '[' + v.map(toTomlValue).join(', ') + ']'
  if (typeof v === 'object') {
    const lines: string[] = []
    for (const [k, vv] of Object.entries(v as Record<string, unknown>)) {
      lines.push(`  ${k} = ${toTomlValue(vv)}`)
    }
    return '{\n' + lines.join('\n') + '\n}'
  }
  const s = String(v)
  if (/[\n"'#[\]{}]/.test(s)) return `'''\n${s}\n'''`
  if (s.includes(' ') || s === '' || /[^\w.\-]/.test(s)) return `"${s}"`
  return s
}

function generateToml(config: ConfigData): string {
  const keys = Object.keys(config).sort()
  return keys.map((k) => `${k} = ${toTomlValue(config[k])}`).join('\n')
}

// ── 描述存储（localStorage，按 preset 名索引） ──────────────────────────────
const DESC_KEY = 'studio.preset.descriptions'
function loadDescriptions(): Record<string, string> {
  try {
    const raw = localStorage.getItem(DESC_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}
function saveDescriptions(d: Record<string, string>) {
  try { localStorage.setItem(DESC_KEY, JSON.stringify(d)) } catch { /* ignore */ }
}

// ── 工具：从 schema 抽默认值 ──────────────────────────────────────────────
function defaultsFromSchema(schema: SchemaResponse | null): ConfigData {
  if (!schema) return {}
  const out: ConfigData = {}
  for (const [name, prop] of Object.entries(schema.schema.properties)) {
    if (prop.default !== undefined) out[name] = prop.default
  }
  return out
}

const NAME_RE = /^[A-Za-z0-9_\-]+$/

interface DraftSeed {
  config: ConfigData
  desc: string
  name: string
}

export default function PresetsPage() {
  const { toast } = useToast()

  // ── backend state ──
  const [schema, setSchema] = useState<SchemaResponse | null>(null)
  const [presets, setPresets] = useState<PresetSummary[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [config, setConfig] = useState<ConfigData | null>(null)
  const [busy, setBusy] = useState(false)

  // 已保存快照，用于 dirty 判定
  const savedJsonRef = useRef<string | null>(null)

  // 描述
  const [descriptions, setDescriptions] = useState<Record<string, string>>(loadDescriptions)
  const [descDraft, setDescDraft] = useState('')
  const [descDirty, setDescDirty] = useState(false)

  // 新建模式输入
  const [newName, setNewName] = useState('')
  const [newNameError, setNewNameError] = useState('')
  const isNew = selected === null

  // ── 进入新建模式时的「种子」（一次性）：复制副本 / 导入 用 ──
  const draftSeedRef = useRef<DraftSeed | null>(null)

  // ── UI 状态 ──
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')
  const [tomlOpen, setTomlOpen] = useState(false)
  const pickerAnchorRef = useRef<HTMLButtonElement | null>(null)
  const pickerPopRef = useRef<HTMLDivElement | null>(null)
  const newNameInputRef = useRef<HTMLInputElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // ── 加载 schema + 预设列表 ──
  useEffect(() => {
    api.schema().then(setSchema).catch((e) => toast(`schema 加载失败: ${e}`, 'error'))
    refreshList()
  }, [toast])

  const refreshList = () => {
    api.listPresets().then(setPresets).catch(() => setPresets([]))
  }

  // ── 选 preset 切换 ──
  // 新建模式（selected=null）：优先用 draftSeed（来自「复制副本」/「导入」），
  // 没种子就用 schema 默认值。draftSeed 是一次性的，消费后清空。
  useEffect(() => {
    if (!selected) {
      const seed = draftSeedRef.current
      draftSeedRef.current = null
      if (seed) {
        setConfig(seed.config)
        savedJsonRef.current = JSON.stringify(seed.config)
        setNewName(seed.name)
        setDescDraft(seed.desc)
        setDescDirty(false)
        // 让用户输名字
        requestAnimationFrame(() => newNameInputRef.current?.focus())
      } else if (schema) {
        const defaults = defaultsFromSchema(schema)
        setConfig(defaults)
        savedJsonRef.current = JSON.stringify(defaults)
        setNewName('')
        setDescDraft('')
        setDescDirty(false)
      } else {
        setConfig(null)
        savedJsonRef.current = null
        setNewName('')
        setDescDraft('')
        setDescDirty(false)
      }
      setNewNameError('')
      return
    }
    api.getPreset(selected).then((data) => {
      setConfig(data)
      savedJsonRef.current = JSON.stringify(data)
      setDescDraft(descriptions[selected] ?? '')
      setDescDirty(false)
    }).catch((e) => {
      toast(`加载失败: ${e}`, 'error')
      setSelected(null)
    })
  }, [selected, schema, descriptions, toast])

  // ── 首次拿到列表后：自动选最近一个，省一次「切换」点击 ──
  const autoSelectedRef = useRef(false)
  useEffect(() => {
    if (autoSelectedRef.current) return
    if (presets.length > 0 && selected === null && draftSeedRef.current === null) {
      autoSelectedRef.current = true
      setSelected(presets[0].name)
    } else if (presets.length === 0 && schema) {
      autoSelectedRef.current = true
      // 列表为空 → 落到新建模式（schema 默认已经预填）
    }
  }, [presets, selected, schema])

  // ── 派生 ──
  const dirty = useMemo(() => {
    if (!config) return false
    return JSON.stringify(config) !== savedJsonRef.current
  }, [config])
  const hasAnyChange = dirty || descDirty

  const filteredPresets = useMemo(
    () => presets.filter((p) => !pickerSearch || p.name.toLowerCase().includes(pickerSearch.toLowerCase())),
    [presets, pickerSearch],
  )

  // ── popover 关闭：点外面关 ──
  useEffect(() => {
    if (!pickerOpen) return
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (
        pickerPopRef.current?.contains(t) ||
        pickerAnchorRef.current?.contains(t)
      ) return
      setPickerOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPickerOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [pickerOpen])

  // ── 操作 ──
  const handleSave = async () => {
    const name = isNew ? newName.trim() : selected
    if (!name) {
      setNewNameError('请输入名称')
      newNameInputRef.current?.focus()
      return
    }
    if (!config) return
    if (isNew) {
      if (!NAME_RE.test(name)) { setNewNameError('仅允许字母、数字、_、-'); return }
      if (presets.find((p) => p.name === name)) { setNewNameError('名称已存在'); return }
    }
    setBusy(true)
    try {
      await api.savePreset(name, config)
      if (descDraft) {
        const next = { ...descriptions, [name]: descDraft }
        setDescriptions(next); saveDescriptions(next)
      } else if (descriptions[name]) {
        const { [name]: _, ...rest } = descriptions
        setDescriptions(rest); saveDescriptions(rest)
      }
      savedJsonRef.current = JSON.stringify(config)
      setDescDirty(false)
      if (isNew) {
        setSelected(name)
        setNewName('')
        setNewNameError('')
        toast(`已创建 ${name}`, 'success')
      } else {
        toast('已保存', 'success')
      }
      refreshList()
    } catch (e) { toast(String(e), 'error') }
    finally { setBusy(false) }
  }

  const handleDuplicate = () => {
    if (!config) return
    const baseName = selected ?? 'preset'
    let candidate = `${baseName}-copy`
    let i = 2
    while (presets.find((p) => p.name === candidate)) {
      candidate = `${baseName}-copy-${i++}`
    }
    draftSeedRef.current = {
      config: JSON.parse(JSON.stringify(config)) as ConfigData,
      desc: descDraft,
      name: candidate,
    }
    setSelected(null)
    setPickerOpen(false)
  }

  const handleNew = () => {
    draftSeedRef.current = null
    setSelected(null)
    setPickerOpen(false)
  }

  const handleDelete = () => {
    if (!selected) return
    if (!window.confirm(`删除预设 ${selected}？`)) return
    setBusy(true)
    api.deletePreset(selected).then(() => {
      const { [selected]: _, ...rest } = descriptions
      setDescriptions(rest); saveDescriptions(rest)
      setSelected(null)
      refreshList()
      toast('已删除', 'success')
    }).catch((e) => toast(String(e), 'error')).finally(() => setBusy(false))
  }

  const handleExport = () => {
    if (!config || !selected) return
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${selected}.json`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // 「导入」：解析后切到新建模式预填，让用户在表单里改 + 输名字 + 看 schema 确认。
  // 不再用 window.prompt 直接保存——跟新建走同一条路径。
  const handleImportFile = async (f: File) => {
    try {
      const text = await f.text()
      let data: ConfigData
      if (f.name.endsWith('.json')) {
        data = JSON.parse(text)
      } else {
        // 简单 YAML（仅 key: value 行）
        data = {}
        for (const line of text.split('\n')) {
          const m = line.match(/^([a-zA-Z_]\w*)\s*:\s*(.+)/)
          if (m) data[m[1]] = m[2].trim()
        }
      }
      const suggested = f.name.replace(/\.(json|ya?ml)$/i, '').replace(/[^A-Za-z0-9_\-]/g, '-')
      draftSeedRef.current = { config: data, desc: '', name: suggested }
      setSelected(null)
      toast('已加载，确认无误后点保存', 'success')
    } catch (e) { toast(String(e), 'error') }
  }

  const onImportClick = () => fileInputRef.current?.click()

  const saveDisabled =
    busy
    || !config
    || (isNew && !newName.trim())
    || (!isNew && !hasAnyChange)

  // ── 渲染 ──
  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* ── 单行 header：picker + 状态 + 全部操作 ──
        Topbar 已经显示「预设」面包屑，这里不再重复 h1。把上一版的页面标题
        和底部操作栏并成一行，picker 当做"当前编辑上下文"的标识，状态 +
        所有动作（导入 / 复制 / 导出 / 删除 / 保存）右侧排齐。 */}
      <div style={{
        padding: '12px 24px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-canvas)',
        flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 14,
        position: 'relative',
      }}>
        <button
          ref={pickerAnchorRef}
          onClick={() => { setPickerOpen((v) => !v); setPickerSearch('') }}
          disabled={busy}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            minWidth: 300, padding: '10px 12px 10px 14px',
            borderRadius: 'var(--r-md)',
            border: `1px solid ${pickerOpen ? 'var(--accent)' : 'var(--border-default)'}`,
            background: pickerOpen ? 'var(--accent-soft)' : 'var(--bg-surface)',
            cursor: busy ? 'default' : 'pointer',
            transition: 'border-color 100ms ease, background 100ms ease',
            boxShadow: pickerOpen ? 'none' : 'var(--sh-sm)',
          }}
          onMouseEnter={(e) => { if (!pickerOpen) (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-strong)' }}
          onMouseLeave={(e) => { if (!pickerOpen) (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-default)' }}
          title="切换 / 新建预设"
        >
          <span style={{
            fontSize: 'var(--t-2xs)', textTransform: 'uppercase', letterSpacing: '0.08em',
            color: 'var(--fg-tertiary)', fontWeight: 600,
          }}>
            预设
          </span>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 'var(--t-md)',
            fontWeight: 600, color: 'var(--fg-primary)',
            flex: 1, textAlign: 'left',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {selected ?? (newName.trim() || '新建中')}
          </span>
          <span style={{ color: 'var(--fg-tertiary)', fontSize: 'var(--t-md)' }}>▾</span>
        </button>

        {/* 状态指示 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{
            display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
            background: hasAnyChange ? 'var(--warn)' : isNew ? 'var(--accent)' : 'var(--ok)',
            flexShrink: 0,
          }} />
          <span style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-secondary)', whiteSpace: 'nowrap' }}>
            {isNew ? '新建中' : hasAnyChange ? '未保存' : '已保存'}
          </span>
        </div>

        <span style={{ flex: 1 }} />

        {/* 全局动作 */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.yaml,.yml"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleImportFile(f)
            if (fileInputRef.current) fileInputRef.current.value = ''
          }}
        />
        <button onClick={onImportClick} disabled={busy} className="btn btn-ghost btn-sm">
          导入
        </button>

        {/* 编辑模式下的预设级动作 */}
        {!isNew && (
          <>
            <span style={{ width: 1, height: 22, background: 'var(--border-subtle)' }} />
            <button onClick={handleDuplicate} disabled={busy || !config} className="btn btn-ghost btn-sm">
              复制副本
            </button>
            <button onClick={handleExport} disabled={busy || !config} className="btn btn-ghost btn-sm">
              导出 JSON
            </button>
            <button onClick={handleDelete} disabled={busy} className="btn btn-ghost btn-sm" style={{ color: 'var(--err)' }}>
              删除
            </button>
          </>
        )}

        {/* 主操作 */}
        <button
          onClick={handleSave}
          disabled={saveDisabled}
          className="btn btn-primary btn-sm"
          style={{ minWidth: 80 }}
        >
          保存
        </button>

        {/* popover */}
        {pickerOpen && (
          <div
            ref={pickerPopRef}
            role="dialog"
            aria-label="切换预设"
            style={{
              position: 'absolute', top: 'calc(100% - 1px)', left: 24,
              width: 480, maxHeight: 480, overflow: 'hidden',
              borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)', boxShadow: 'var(--sh-lg)',
              display: 'flex', flexDirection: 'column',
              zIndex: 50,
            }}
          >
              {/* search */}
              <div style={{
                padding: 10, borderBottom: '1px solid var(--border-subtle)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ position: 'relative', flex: 1, display: 'inline-flex', alignItems: 'center' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round"
                    style={{ position: 'absolute', left: 8, color: 'var(--fg-tertiary)', pointerEvents: 'none' }}>
                    <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
                  </svg>
                  <input
                    autoFocus
                    className="input"
                    placeholder="筛选预设…"
                    value={pickerSearch}
                    onChange={(e) => setPickerSearch(e.target.value)}
                    style={{ width: '100%', paddingLeft: 28, fontSize: 'var(--t-sm)' }}
                  />
                </span>
                <button
                  onClick={refreshList}
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: 'var(--t-xs)' }}
                  title="刷新列表"
                >刷新</button>
              </div>

              {/* grid */}
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 10 }}>
                <div className="grid grid-cols-2 gap-2">
                  {/* + 新建（永远第一格） */}
                  <button
                    onClick={handleNew}
                    style={{
                      borderRadius: 'var(--r-sm)',
                      border: '1px dashed var(--border-default)',
                      background: 'transparent',
                      padding: '10px 12px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      color: 'var(--accent)',
                      fontWeight: 600, fontSize: 'var(--t-sm)',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'; (e.currentTarget as HTMLElement).style.background = 'var(--accent-soft)' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-default)'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                  >
                    + 新建预设
                  </button>
                  {filteredPresets.map((p) => {
                    const active = p.name === selected
                    return (
                      <button
                        key={p.name}
                        onClick={() => { setSelected(p.name); setPickerOpen(false) }}
                        style={{
                          borderRadius: 'var(--r-sm)',
                          border: active ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
                          background: active ? 'var(--accent-soft)' : 'var(--bg-sunken)',
                          padding: '8px 10px',
                          textAlign: 'left',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-strong)' }}
                        onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-subtle)' }}
                      >
                        <div style={{
                          fontSize: 'var(--t-sm)', fontFamily: 'var(--font-mono)',
                          color: active ? 'var(--accent)' : 'var(--fg-primary)',
                          fontWeight: 600,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{p.name}</div>
                        <div style={{
                          fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)',
                          marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {descriptions[p.name] || '—'}
                        </div>
                      </button>
                    )
                  })}
                </div>
                {presets.length > 0 && filteredPresets.length === 0 && (
                  <div style={{
                    color: 'var(--fg-tertiary)', fontSize: 'var(--t-sm)',
                    textAlign: 'center', padding: '16px 0',
                  }}>
                    没有匹配「{pickerSearch}」
                  </div>
                )}
              </div>
            </div>
          )}
      </div>

      {/* ── content（scroll） ── */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* 名称 / 描述 */}
          <section style={{
            borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)', padding: '10px 14px',
          }}>
            <div style={{ display: 'flex', gap: 10 }}>
              {isNew ? (
                <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 'var(--t-sm)', fontWeight: 500, color: 'var(--fg-secondary)' }}>预设名称</span>
                  <input
                    ref={newNameInputRef}
                    className="input input-mono"
                    placeholder="my-training-preset"
                    value={newName}
                    onChange={(e) => { setNewName(e.target.value); setNewNameError('') }}
                    disabled={busy}
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                  {newNameError && (
                    <span style={{ fontSize: 'var(--t-xs)', color: 'var(--err)' }}>{newNameError}</span>
                  )}
                </label>
              ) : (
                <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 'var(--t-sm)', fontWeight: 500, color: 'var(--fg-secondary)' }}>名称（只读）</span>
                  <div style={{
                    padding: '7px 12px', borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-sunken)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)',
                    color: 'var(--fg-primary)',
                  }}>{selected}</div>
                </label>
              )}
              <label style={{ flex: 1.5, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 'var(--t-sm)', fontWeight: 500, color: 'var(--fg-secondary)' }}>描述 / 副标题</span>
                <input
                  className="input"
                  placeholder="用途描述，显示在训练页预设卡片上…"
                  value={descDraft}
                  onChange={(e) => { setDescDraft(e.target.value); setDescDirty(true) }}
                  disabled={busy}
                />
              </label>
            </div>
          </section>

          {/* schema 表单 */}
          {!schema || !config ? (
            <div style={{ height: 200, borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', padding: 14 }}>
              <SkeletonGroups />
            </div>
          ) : (
            <section style={{
              borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)', padding: '10px 14px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--fg-tertiary)', flexShrink: 0 }} />
                <span className="caption" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 'var(--t-xs)' }}>训练参数</span>
              </div>
              <SchemaForm
                schema={schema}
                values={config}
                onChange={setConfig}
              />
            </section>
          )}

          {/* TOML 预览（默认折叠） */}
          {config && Object.keys(config).length > 0 && (
            <section style={{
              borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)', padding: tomlOpen ? '10px 14px' : '6px 14px',
            }}>
              <button
                type="button"
                onClick={() => setTomlOpen((v) => !v)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  background: 'transparent', border: 'none', padding: 0,
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--info)', flexShrink: 0 }} />
                <span className="caption" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 'var(--t-xs)' }}>TOML 预览</span>
                <span style={{ fontSize: 'var(--t-2xs)', color: 'var(--fg-tertiary)' }}>
                  {tomlOpen ? 'sd-scripts 可读的配置文件' : '展开查看 / 复制'}
                </span>
                <span style={{ flex: 1 }} />
                {tomlOpen && (
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: 'var(--t-xs)' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      const toml = generateToml(config)
                      navigator.clipboard.writeText(toml)
                        .then(() => toast('已复制到剪贴板', 'success'))
                        .catch(() => toast('复制失败', 'error'))
                    }}
                  >复制</button>
                )}
                <span style={{ color: 'var(--fg-tertiary)' }}>{tomlOpen ? '▾' : '▸'}</span>
              </button>
              {tomlOpen && (
                <pre style={{
                  margin: '10px 0 0', padding: 12,
                  background: 'var(--bg-sunken)', borderRadius: 'var(--r-sm)',
                  fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)',
                  color: 'var(--fg-secondary)', lineHeight: 1.7,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  maxHeight: 320, overflow: 'auto',
                }}>
                  {generateToml(config)}
                </pre>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Schema 加载骨架 ──
function SkeletonGroups() {
  const rows = [5, 6, 4, 5]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {rows.map((r, gi) => (
        <div key={gi} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ height: 12, width: 100, borderRadius: 'var(--r-sm)', background: 'var(--bg-sunken)', opacity: 0.6 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {Array.from({ length: r }).map((_, ri) => (
              <div key={ri} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ height: 9, width: 80, borderRadius: 'var(--r-sm)', background: 'var(--bg-sunken)', opacity: 0.5 }} />
                <div style={{ height: 26, borderRadius: 'var(--r-sm)', background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)' }} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
