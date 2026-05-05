import { useEffect, useRef, useState } from 'react'
import { useToast } from './Toast'

type ScopeKind = 'selected' | 'all'
type Op = 'add' | 'remove' | 'replace' | 'dedupe'

interface Props {
  cache: Map<string, string[]>
  selectedKeys: string[]
  onApply: (updates: Map<string, string[]>) => void
  tagSuggestions?: string[]
  defaultScope?: ScopeKind
  onClearSelection?: () => void
}

export default function BulkActionBar({
  cache,
  selectedKeys,
  onApply,
  tagSuggestions = [],
  defaultScope = 'selected',
  onClearSelection,
}: Props) {
  const { toast } = useToast()
  const [openOp, setOpenOp] = useState<Op | null>(null)
  const [scope, setScope] = useState<ScopeKind>(defaultScope)
  const [tagsInput, setTagsInput] = useState('')
  const [oldTag, setOldTag] = useState('')
  const [newTag, setNewTag] = useState('')
  const [position, setPosition] = useState<'front' | 'back'>('front')

  const closePopover = () => {
    setOpenOp(null); setTagsInput(''); setOldTag(''); setNewTag('')
  }

  const targetKeys = (): string[] => {
    if (scope === 'selected') return selectedKeys
    return Array.from(cache.keys())
  }

  const parseTags = (raw: string): string[] =>
    raw.split(/[,，\n]/).map((t) => t.trim()).filter(Boolean)

  const apply = (op: Op) => {
    const keys = targetKeys()
    if (scope === 'selected' && keys.length === 0) {
      toast('当前没有选中文件', 'error'); return
    }
    const updates = new Map<string, string[]>()

    if (op === 'add' || op === 'remove') {
      const ts = parseTags(tagsInput)
      if (ts.length === 0) { toast('请输入至少一个 tag', 'error'); return }
      for (const k of keys) {
        const cur = cache.get(k) ?? []
        if (op === 'add') {
          const have = new Set(cur)
          const toAdd = ts.filter((t) => !have.has(t))
          if (toAdd.length === 0) continue
          const next = position === 'front' ? [...toAdd, ...cur] : [...cur, ...toAdd]
          updates.set(k, next)
        } else {
          const drop = new Set(ts)
          const next = cur.filter((t) => !drop.has(t))
          if (next.length !== cur.length) updates.set(k, next)
        }
      }
    } else if (op === 'replace') {
      const o = oldTag.trim(); const n = newTag.trim()
      if (!o || !n) { toast('replace 需要 old / new', 'error'); return }
      for (const k of keys) {
        const cur = cache.get(k) ?? []
        if (!cur.includes(o)) continue
        const next: string[] = []
        const seen = new Set<string>()
        for (const t of cur) {
          const out = t === o ? n : t
          if (seen.has(out)) continue
          seen.add(out); next.push(out)
        }
        updates.set(k, next)
      }
    } else if (op === 'dedupe') {
      for (const k of keys) {
        const cur = cache.get(k) ?? []
        const seen = new Set<string>()
        const next: string[] = []
        for (const t of cur) { if (seen.has(t)) continue; seen.add(t); next.push(t) }
        if (next.length !== cur.length) updates.set(k, next)
      }
    }

    if (updates.size === 0) { toast(`${op}：无改动`, 'success'); closePopover(); return }
    onApply(updates)
    toast(`${op} 完成（${updates.size} 张待保存）`, 'success')
    closePopover()
  }

  const scopeLabel = scope === 'selected' ? `选中 ${selectedKeys.length}` : `全部 ${cache.size}`
  const isSelected = scope === 'selected'
  const opDisabled = isSelected && selectedKeys.length === 0

  return (
    <div style={{
      borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)',
      background: 'var(--bg-surface)', padding: '8px 12px',
      display: 'flex', flexDirection: 'column', gap: 6,
      fontSize: 'var(--t-xs)', flexShrink: 0,
    }}>
      {/* top row: scope + buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--fg-tertiary)' }}>范围</span>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as ScopeKind)}
          className="input"
          style={{ fontSize: 'var(--t-xs)', padding: '2px 8px' }}
        >
          <option value="selected">当前选中（{selectedKeys.length}）</option>
          <option value="all">全部图片</option>
        </select>

        <span style={{ color: 'var(--border-default)' }}>|</span>
        <OpBtn label="+ 加 tag" active={openOp === 'add'} disabled={opDisabled} onClick={() => setOpenOp(openOp === 'add' ? null : 'add')} />
        <OpBtn label="- 删 tag" active={openOp === 'remove'} disabled={opDisabled} onClick={() => setOpenOp(openOp === 'remove' ? null : 'remove')} />
        <OpBtn label="↔ replace" active={openOp === 'replace'} disabled={opDisabled} onClick={() => setOpenOp(openOp === 'replace' ? null : 'replace')} />
        <OpBtn label="dedupe" disabled={opDisabled} onClick={() => apply('dedupe')} />

        <span style={{ flex: 1 }} />
        <span style={{ color: 'var(--fg-tertiary)' }}>{scopeLabel}</span>
        {onClearSelection && selectedKeys.length > 0 && (
          <button onClick={onClearSelection} className="btn btn-ghost btn-sm">✕ 清空</button>
        )}
      </div>

      {/* popover row */}
      {openOp && openOp !== 'dedupe' && (
        <div
          style={{
            borderRadius: 'var(--r-sm)', border: '1px solid var(--border-subtle)',
            background: 'var(--bg-sunken)', padding: '6px 10px',
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
          }}
          role="dialog"
          aria-label={`bulk-${openOp}`}
        >
          {(openOp === 'add' || openOp === 'remove') && (
            <TagsField value={tagsInput} onChange={setTagsInput} placeholder="tag1, tag2 (逗号分隔)" suggestions={tagSuggestions} />
          )}
          {openOp === 'add' && (
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value as 'front' | 'back')}
              className="input"
              style={{ fontSize: 'var(--t-xs)', padding: '2px 6px' }}
            >
              <option value="front">插到开头</option>
              <option value="back">追加到末尾</option>
            </select>
          )}
          {openOp === 'replace' && (
            <>
              <TagsField value={oldTag} onChange={setOldTag} placeholder="old" suggestions={tagSuggestions} />
              <span style={{ color: 'var(--fg-tertiary)' }}>→</span>
              <TagsField value={newTag} onChange={setNewTag} placeholder="new" suggestions={tagSuggestions} />
            </>
          )}
          <button onClick={() => apply(openOp)} className="btn btn-primary btn-sm">执行</button>
          <button onClick={closePopover} className="btn btn-ghost btn-sm" aria-label="关闭">✕</button>
        </div>
      )}
    </div>
  )
}

function OpBtn({ label, onClick, disabled, active }: { label: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '2px 8px', borderRadius: 'var(--r-sm)',
        background: active ? 'var(--accent)' : 'var(--bg-overlay)',
        border: active ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
        color: active ? 'var(--accent-fg)' : 'var(--fg-secondary)',
        fontSize: 'var(--t-xs)', cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
      }}
      onMouseEnter={(e) => { if (!disabled && !active) { (e.currentTarget as HTMLElement).style.background = 'var(--bg-surface)'; (e.currentTarget as HTMLElement).style.color = 'var(--fg-primary)' } }}
      onMouseLeave={(e) => { if (!disabled && !active) { (e.currentTarget as HTMLElement).style.background = 'var(--bg-overlay)'; (e.currentTarget as HTMLElement).style.color = 'var(--fg-secondary)' } }}
    >
      {label}
    </button>
  )
}

interface TagsFieldProps { value: string; onChange: (v: string) => void; placeholder: string; suggestions: string[] }

function TagsField({ value, onChange, placeholder, suggestions }: TagsFieldProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const tail = (() => {
    const m = value.match(/([^,，\n]*)$/)
    return (m ? m[1] : value).trim().toLowerCase()
  })()
  const matches = tail
    ? suggestions.filter((s) => s.toLowerCase().includes(tail) && s.toLowerCase() !== tail).slice(0, 8)
    : []

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const pick = (s: string) => {
    const head = value.replace(/([^,，\n]*)$/, '')
    onChange(head + s); setOpen(false)
  }

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="input input-mono"
        style={{ fontSize: 'var(--t-xs)', width: 180 }}
      />
      {open && matches.length > 0 && (
        <ul
          style={{
            position: 'absolute', left: 0, top: '100%', marginTop: 2, zIndex: 20,
            background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--r-sm)', boxShadow: 'var(--sh-lg)',
            maxHeight: 180, overflowY: 'auto', minWidth: 200,
            listStyle: 'none', padding: '4px 0', margin: 0,
          }}
          role="listbox"
        >
          {matches.map((s) => (
            <li
              key={s}
              onMouseDown={(e) => { e.preventDefault(); pick(s) }}
              style={{
                padding: '4px 10px', fontSize: 'var(--t-xs)', fontFamily: 'var(--font-mono)',
                color: 'var(--fg-primary)', cursor: 'pointer',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-overlay)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
