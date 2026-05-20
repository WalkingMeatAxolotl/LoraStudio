import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import TagAutocomplete from './TagAutocomplete'
import { useToast } from './Toast'

type ScopeKind = 'selected' | 'filtered' | 'all'
type Op = 'add' | 'remove' | 'replace' | 'dedupe'

interface Props {
  cache: Map<string, string[]>
  selectedKeys: string[]
  onApply: (updates: Map<string, string[]>) => void
  tagSuggestions?: string[]
  defaultScope?: ScopeKind
  onClearSelection?: () => void
  filterTag: string
  onFilterTagChange: (v: string) => void
  filteredKeys: string[]
  totalCount: number
  filteredCount: number
  onSelectAll: () => void
}

export default function BulkActionBar({
  cache, selectedKeys, onApply,
  tagSuggestions = [], defaultScope = 'selected', onClearSelection,
  filterTag, onFilterTagChange, filteredKeys, totalCount, filteredCount, onSelectAll,
}: Props) {
  const { t } = useTranslation()
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
    if (scope === 'filtered') return filteredKeys
    return Array.from(cache.keys())
  }

  const parseTags = (raw: string): string[] =>
    raw.split(/[,，\n]/).map((t) => t.trim()).filter(Boolean)

  const apply = (op: Op) => {
    const keys = targetKeys()
    if (keys.length === 0) {
      toast(
        scope === 'selected'
          ? t('bulkAction.noFiles')
          : scope === 'filtered'
            ? t('bulkAction.noFilteredFiles')
            : t('bulkAction.noImages'),
        'error',
      )
      return
    }
    const updates = new Map<string, string[]>()

    if (op === 'add' || op === 'remove') {
      const ts = parseTags(tagsInput)
      if (ts.length === 0) { toast(t('bulkAction.enterTag'), 'error'); return }
      for (const k of keys) {
        const cur = cache.get(k) ?? []
        if (op === 'add') {
          const have = new Set(cur)
          const toAdd = ts.filter((t) => !have.has(t))
          if (toAdd.length === 0) continue
          updates.set(k, position === 'front' ? [...toAdd, ...cur] : [...cur, ...toAdd])
        } else {
          const drop = new Set(ts)
          const next = cur.filter((t) => !drop.has(t))
          if (next.length !== cur.length) updates.set(k, next)
        }
      }
    } else if (op === 'replace') {
      const o = oldTag.trim(); const n = newTag.trim()
      if (!o || !n) { toast(t('bulkAction.replaceNeedsOldNew'), 'error'); return }
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
        const seen = new Set<string>(); const next: string[] = []
        for (const t of cur) { if (seen.has(t)) continue; seen.add(t); next.push(t) }
        if (next.length !== cur.length) updates.set(k, next)
      }
    }

    if (updates.size === 0) { toast(t('bulkAction.noChanges', { op }), 'success'); closePopover(); return }
    onApply(updates)
    toast(t('bulkAction.applyDone', { op, n: updates.size }), 'success')
    closePopover()
  }

  const isSelected = scope === 'selected'
  const opDisabled =
    (isSelected && selectedKeys.length === 0) ||
    (scope === 'filtered' && filteredKeys.length === 0) ||
    (scope === 'all' && cache.size === 0)
  const filteredScopeLabel = filterTag
    ? t('bulkAction.scopeFiltered', { n: filteredCount })
    : t('bulkAction.scopeCurrentList', { n: filteredCount })

  return (
    <div className="rounded-md border border-subtle bg-surface px-3 py-2 flex flex-col gap-1.5 text-xs shrink-0">
      <div className="flex items-center gap-1.5 flex-wrap">
        <TagAutocomplete
          value={filterTag}
          onChange={onFilterTagChange}
          suggestions={tagSuggestions}
          placeholder={t('bulkAction.searchTag')}
          style={{ width: 180 }}
        />
        {filterTag && (
          <button
            onClick={() => onFilterTagChange('')}
            className="btn btn-ghost btn-sm"
            style={{ padding: '2px 6px' }}
          >
            ✕
          </button>
        )}
        <span className="text-fg-tertiary font-mono text-xs min-w-[40px]">
          {filterTag ? `${filteredCount}/${totalCount}` : totalCount}
        </span>

        <span className="text-dim">|</span>

        <button
          onClick={onSelectAll}
          disabled={filteredCount === 0}
          className="btn btn-ghost btn-sm"
        >
          {t('common.selectAll')}
        </button>
        <button
          onClick={onClearSelection}
          disabled={selectedKeys.length === 0}
          className="btn btn-ghost btn-sm"
        >
          {t('bulkAction.clearSelection', { n: selectedKeys.length })}
        </button>

        <span className="text-dim">|</span>

        <span className="text-fg-tertiary">{t('bulkAction.scope')}</span>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as ScopeKind)}
          className="input"
          style={{ fontSize: 'var(--t-xs)', padding: '2px 8px' }}
        >
          <option value="selected">{t('bulkAction.scopeSelected', { n: selectedKeys.length })}</option>
          <option value="filtered" disabled={filteredCount === 0}>{filteredScopeLabel}</option>
          <option value="all">{t('bulkAction.scopeAllCount', { n: totalCount })}</option>
        </select>

        <span className="text-dim">|</span>

        <OpBtn label={t('bulkAction.addTag')} active={openOp === 'add'} disabled={opDisabled}
          onClick={() => setOpenOp(openOp === 'add' ? null : 'add')} />
        <OpBtn label={t('bulkAction.removeTag')} active={openOp === 'remove'} disabled={opDisabled}
          onClick={() => setOpenOp(openOp === 'remove' ? null : 'remove')} />
        <OpBtn label={t('bulkAction.replace')} active={openOp === 'replace'} disabled={opDisabled}
          onClick={() => setOpenOp(openOp === 'replace' ? null : 'replace')} />
        <OpBtn label={t('bulkAction.dedupe')} disabled={opDisabled} onClick={() => apply('dedupe')} />

        <span className="flex-1" />

        {selectedKeys.length > 0 && (
          <span className="text-accent font-mono">
            {t('bulkAction.selectedCount', { n: selectedKeys.length })}
          </span>
        )}
      </div>

      <div className="text-fg-tertiary text-[11px] flex flex-col gap-0.5">
        <span>{t('bulkAction.hintClick')}</span>
        <span>{t('bulkAction.hintShift')}</span>
      </div>

      {openOp && openOp !== 'dedupe' && (
        <div
          className="rounded-sm border border-subtle bg-sunken px-2.5 py-1.5 flex flex-wrap items-center gap-1.5"
          role="dialog"
          aria-label={`bulk-${openOp}`}
        >
          {(openOp === 'add' || openOp === 'remove') && (
            <TagsField value={tagsInput} onChange={setTagsInput}
              placeholder={t('bulkAction.tagPlaceholder')} suggestions={tagSuggestions} />
          )}
          {openOp === 'add' && (
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value as 'front' | 'back')}
              className="input"
              style={{ fontSize: 'var(--t-xs)', padding: '2px 6px' }}
            >
              <option value="front">{t('bulkAction.insertFront')}</option>
              <option value="back">{t('bulkAction.appendBack')}</option>
            </select>
          )}
          {openOp === 'replace' && (
            <>
              <TagsField value={oldTag} onChange={setOldTag} placeholder="old" suggestions={tagSuggestions} />
              <span className="text-fg-tertiary">→</span>
              <TagsField value={newTag} onChange={setNewTag} placeholder="new" suggestions={tagSuggestions} />
            </>
          )}
          <button onClick={() => apply(openOp)} className="btn btn-primary btn-sm">{t('common.execute')}</button>
          <button onClick={closePopover} className="btn btn-ghost btn-sm" aria-label={t('common.close')}>✕</button>
        </div>
      )}
    </div>
  )
}

function OpBtn({ label, onClick, disabled, active }: {
  label: string; onClick: () => void; disabled?: boolean; active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        'px-2 py-0.5 rounded-sm text-xs border transition-colors',
        active
          ? 'bg-accent border-accent text-accent-fg'
          : 'bg-overlay border-subtle text-fg-secondary hover:bg-surface hover:text-fg-primary',
        disabled ? 'opacity-40 cursor-default' : 'cursor-pointer',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

interface TagsFieldProps {
  value: string; onChange: (v: string) => void; placeholder: string; suggestions: string[]
}

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
    <div className="relative" ref={ref}>
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
          className="absolute left-0 top-full mt-0.5 z-30 bg-elevated border border-subtle rounded-sm shadow-lg max-h-[180px] overflow-y-auto min-w-[200px] list-none p-1 m-0"
          role="listbox"
        >
          {matches.map((s) => (
            <li
              key={s}
              onMouseDown={(e) => { e.preventDefault(); pick(s) }}
              className="px-2.5 py-1 text-xs font-mono text-fg-primary cursor-pointer hover:bg-overlay rounded-sm"
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
