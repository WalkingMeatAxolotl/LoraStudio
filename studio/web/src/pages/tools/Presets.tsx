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
  // 含特殊字符则加引号
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

export default function PresetsPage() {
  const { toast } = useToast()

  // Backend state
  const [schema, setSchema] = useState<SchemaResponse | null>(null)
  const [presets, setPresets] = useState<PresetSummary[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [config, setConfig] = useState<ConfigData | null>(null)
  const [busy, setBusy] = useState(false)

  // 已保存的快照，用于判断 dirty
  const savedJsonRef = useRef<string | null>(null)

  // 描述
  const [descriptions, setDescriptions] = useState<Record<string, string>>(loadDescriptions)
  const [descDraft, setDescDraft] = useState('')
  const [descDirty, setDescDirty] = useState(false)

  // 编辑模式（新建 vs 编辑）
  const [newName, setNewName] = useState('')
  const [newNameError, setNewNameError] = useState('')
  const isNew = selected === null

  // 搜索
  const [search, setSearch] = useState('')

  // ── 加载 schema + 预设列表 ──
  useEffect(() => {
    api.schema().then(setSchema).catch((e) => toast(`schema 加载失败: ${e}`, 'error'))
    refreshList()
  }, [toast])

  const refreshList = () => {
    api.listPresets().then(setPresets).catch(() => setPresets([]))
  }

  // ── 选定预设后加载 ──
  useEffect(() => {
    if (!selected) {
      // 新建预设：用 schema 默认值初始化配置
      if (schema) {
        const defaults: ConfigData = {}
        for (const [key, prop] of Object.entries(schema.schema.properties)) {
          if (prop.default !== undefined) {
            defaults[key] = prop.default
          }
        }
        setConfig(defaults)
        savedJsonRef.current = JSON.stringify(defaults)
      } else {
        setConfig(null)
        savedJsonRef.current = null
      }
      setDescDraft('')
      setDescDirty(false)
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
  }, [selected, descriptions, toast, schema])

  const dirty = useMemo(() => {
    if (!config) return false
    return JSON.stringify(config) !== savedJsonRef.current
  }, [config])

  const hasAnyChange = dirty || descDirty

  // ── 操作 ──
  const handleSave = async () => {
    const name = isNew ? newName.trim() : selected
    if (!name) { setNewNameError('请输入名称'); return }
    if (!config) return

    // 名称校验
    if (isNew && !/^[A-Za-z0-9_\-]+$/.test(name)) {
      setNewNameError('仅允许字母、数字、_、-')
      return
    }
    // 检查是否与已有同名
    if (isNew && presets.find((p) => p.name === name)) {
      setNewNameError('名称已存在')
      return
    }

    setBusy(true)
    try {
      await api.savePreset(name, config)
      // 保存描述
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
      }
      toast(`已保存${isNew ? '新预设 ' + name : ''}`, 'success')
      refreshList()
    } catch (e) { toast(String(e), 'error') }
    finally { setBusy(false) }
  }

  const handleSaveAs = () => {
    const name = window.prompt('保存为新预设名（字母 / 数字 / _ / -）：', '')
    if (!name) return
    if (!/^[A-Za-z0-9_\-]+$/.test(name)) { toast('名称仅允许字母、数字、_、-', 'error'); return }
    if (presets.find((p) => p.name === name)) {
      if (!window.confirm(`预设 ${name} 已存在，覆盖？`)) return
    }
    setBusy(true)
    api.savePreset(name, config ?? {}).then(() => {
      if (descDraft) {
        const next = { ...descriptions, [name]: descDraft }
        setDescriptions(next); saveDescriptions(next)
      }
      setSelected(name)
      refreshList()
      toast('已保存', 'success')
    }).catch((e) => toast(String(e), 'error')).finally(() => setBusy(false))
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

  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.json,.yaml,.yml'
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return
      try {
        const text = await f.text()
        let data: ConfigData
        if (f.name.endsWith('.json')) {
          data = JSON.parse(text)
        } else {
          // 简单 YAML 解析（仅支持 key: value）
          data = {}
          for (const line of text.split('\n')) {
            const m = line.match(/^([a-zA-Z_]\w*)\s*:\s*(.+)/)
            if (m) data[m[1]] = m[2].trim()
          }
        }
        const name = f.name.replace(/\.(json|ya?ml)$/i, '').replace(/[^A-Za-z0-9_\-]/g, '-')
        const finalName = window.prompt('预设名：', name)
        if (!finalName) return
        if (!/^[A-Za-z0-9_\-]+$/.test(finalName)) { toast('名称仅允许字母、数字、_、-', 'error'); return }
        setBusy(true)
        await api.savePreset(finalName, data)
        setSelected(finalName)
        refreshList()
        toast(`已导入 ${finalName}`, 'success')
      } catch (e) { toast(String(e), 'error') }
      finally { setBusy(false) }
    }
    input.click()
  }

  const filteredPresets = useMemo(
    () => presets.filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase())),
    [presets, search],
  )

  // ── 渲染 ──
  return (
    <div className="fade-in flex flex-col h-full">
      {/* Header */}
      <div className="py-5 px-6 pb-4 border-b border-subtle bg-canvas shrink-0">
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <div className="caption mb-1.5">全局 · presets</div>
            <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em]">预设</h1>
            <p className="mt-1.5 text-fg-secondary text-md max-w-[720px]">
              管理 sd-scripts 训练预设 · 保存后可在项目训练页直接套用
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={handleImport} disabled={busy} className="btn btn-ghost btn-sm">导入</button>
            <button onClick={handleExport} disabled={busy || !selected} className="btn btn-ghost btn-sm">导出 JSON</button>
            <button onClick={() => setSelected(null)} className="btn btn-primary btn-sm">
              新建预设
            </button>
          </div>
        </div>
      </div>

      {/* 内容 */}
      <div className="flex-1 min-h-0 overflow-auto p-4">
        <div className="flex flex-col gap-3">

          {/* —— 可用预设卡片 —— */}
          {presets.length > 0 && (
            <section className="rounded-md border border-subtle bg-surface px-3.5 py-2.5">
              <div className="flex items-center gap-2 mb-2.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                <span className="caption uppercase tracking-[0.06em] text-xs">可用预设</span>
                <span className="text-2xs text-fg-tertiary">点击编辑</span>
                <span className="flex-1" />
                <span className="relative inline-flex items-center">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                    className="absolute left-2 text-fg-tertiary pointer-events-none"
                  ><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
                  <input className="input pl-7 py-1 text-xs w-40" placeholder="筛选预设…"
                    value={search} onChange={(e) => setSearch(e.target.value)} />
                </span>
                <button onClick={refreshList} disabled={busy} className="btn btn-ghost btn-sm text-xs">刷新</button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {filteredPresets.map((p) => {
                  const isActive = p.name === selected
                  return (
                    <button
                      key={p.name}
                      onClick={() => setSelected(p.name)}
                      disabled={busy}
                      className={`rounded-sm ${isActive ? 'border border-accent bg-accent-soft' : 'border border-subtle bg-sunken hover:border-bold'} px-2 py-1.5 text-left ${busy ? 'cursor-default' : 'cursor-pointer'} transition-[border-color,background] duration-150`}
                    >
                      <div className={`text-xs font-mono font-semibold overflow-hidden text-ellipsis whitespace-nowrap ${isActive ? 'text-accent' : 'text-fg-primary'}`}>{p.name}</div>
                      {descriptions[p.name] ? (
                        <div className="text-2xs text-fg-tertiary mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">
                          {descriptions[p.name]}
                        </div>
                      ) : (
                        <div className="text-2xs text-fg-tertiary mt-0.5">
                          {isActive ? '编辑中' : '点击编辑'}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
              {filteredPresets.length === 0 && (
                <div className="text-fg-tertiary text-sm text-center py-3">
                  {search ? `没有匹配 "${search}"` : '尚无预设，新建一个或导入'}
                </div>
              )}
            </section>
          )}

          {/* —— 预设详情 —— */}
          {(isNew || (selected && config)) ? (
            <>
              {/* 名称 & 描述栏 */}
              <section className="rounded-md border border-subtle bg-surface px-3.5 py-2.5">
                <div className="flex items-center gap-2 mb-2.5">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${hasAnyChange ? 'bg-warn' : 'bg-ok'}`} />
                  <span className="caption uppercase tracking-[0.06em] text-xs">
                    {isNew ? '新建预设' : `预设 · ${selected}`}
                  </span>
                  {hasAnyChange && <span className="badge badge-warn">未保存</span>}
                  <span className="flex-1" />
                  {!isNew && (
                    <button onClick={handleDelete} disabled={busy} className="btn btn-ghost btn-sm text-err">
                      删除
                    </button>
                  )}
                </div>
                <div className="flex gap-2.5">
                  {isNew ? (
                    <label className="flex-1 flex flex-col gap-1">
                      <span className="text-sm font-medium text-fg-secondary">预设名称</span>
                      <input
                        className="input input-mono font-mono"
                        placeholder="my-training-preset"
                        value={newName}
                        onChange={(e) => { setNewName(e.target.value); setNewNameError('') }}
                        disabled={busy}
                      />
                      {newNameError && <span className="text-xs text-err">{newNameError}</span>}
                    </label>
                  ) : (
                    <label className="flex-1 flex flex-col gap-1">
                      <span className="text-sm font-medium text-fg-secondary">名称（只读）</span>
                      <div className="py-1.5 px-3 rounded-md border border-subtle bg-sunken font-mono text-sm text-fg-primary">{selected}</div>
                    </label>
                  )}
                  <label className="flex-[1.5] flex flex-col gap-1">
                    <span className="text-sm font-medium text-fg-secondary">描述 / 副标题</span>
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

              {/* TOML 预览 */}
              {config && Object.keys(config).length > 0 && (
                <section className="rounded-md border border-subtle bg-surface px-3.5 py-2.5">
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-info shrink-0" />
                    <span className="caption uppercase tracking-[0.06em] text-xs">TOML 预览</span>
                    <span className="flex-1" />
                    <button className="btn btn-ghost btn-sm text-xs"
                      onClick={() => {
                        const toml = generateToml(config)
                        navigator.clipboard.writeText(toml).then(() => toast('已复制到剪贴板', 'success')).catch(() => toast('复制失败', 'error'))
                      }}
                    >复制</button>
                  </div>
                  <pre className="m-0 p-3 bg-sunken rounded-sm font-mono text-xs text-fg-secondary leading-[1.7] whitespace-pre-wrap break-words max-h-60 overflow-auto">
                    {generateToml(config)}
                  </pre>
                </section>
              )}

              {/* Schema 表单：仅在「已选中但数据还未回来」时显示骨架屏 */}
              {(!schema || (!isNew && !config)) ? (
                <div className="h-[200px] rounded-md border border-subtle bg-surface p-3.5">
                  <SkeletonGroups />
                </div>
              ) : (
                <section className="rounded-md border border-subtle bg-surface px-3.5 py-2.5">
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-fg-tertiary shrink-0" />
                    <span className="caption uppercase tracking-[0.06em] text-xs">训练参数</span>
                  </div>
                  <SchemaForm
                    schema={schema}
                    values={config ?? {}}
                    onChange={setConfig}
                  />
                </section>
              )}

              {/* 操作栏 */}
              <section className="rounded-md border border-subtle bg-surface px-3.5 py-2.5 flex items-center gap-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ok shrink-0" />
                <span className="caption uppercase tracking-[0.06em] text-xs">操作</span>
                <span className="flex-1" />
                {!isNew && (
                  <button onClick={handleSaveAs} disabled={busy || !config} className="btn btn-ghost btn-sm">
                    另存为新预设
                  </button>
                )}
                <button
                  onClick={handleSave}
                  disabled={busy || (!isNew && !hasAnyChange) || (!isNew && !config)}
                  className="btn btn-primary btn-sm"
                >
                  {isNew ? '创建预设' : hasAnyChange ? '保存预设' : '已保存'}
                </button>
              </section>
            </>
          ) : presets.length === 0 ? (
            <div className="rounded-lg border border-subtle bg-surface py-12 text-center">
              <div className="text-md font-semibold text-fg-secondary mb-1.5">
                尚无预设
              </div>
              <div className="text-sm text-fg-tertiary mb-4">
                点击右上角「新建预设」或「导入」开始
              </div>
              <button onClick={() => setSelected(null)} className="btn btn-primary">
                新建预设
              </button>
            </div>
          ) : (
            <div className="rounded-lg border border-subtle bg-surface py-12 text-center text-fg-tertiary text-sm">
              从上⽅选择预设编辑，或点「新建预设」创建
            </div>
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
    <div className="flex flex-col gap-3">
      {rows.map((r, gi) => (
        <div key={gi} className="flex flex-col gap-2">
          <div className="h-3 w-24 rounded-sm bg-sunken opacity-60" />
          <div className="flex flex-col gap-1.5">
            {Array.from({ length: r }).map((_, ri) => (
              <div key={ri} className="flex flex-col gap-0.5">
                <div className="h-2 w-20 rounded-sm bg-sunken opacity-50" />
                <div className="h-[26px] rounded-sm border border-subtle bg-canvas" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
