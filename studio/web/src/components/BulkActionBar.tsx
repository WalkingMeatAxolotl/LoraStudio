import { useEffect, useRef, useState } from 'react'
import { useToast } from './Toast'

type ScopeKind = 'selected' | 'all'
type Op = 'add' | 'remove' | 'replace' | 'dedupe'

interface Props {
  /** 当前缓存（key → tags），只读。 */
  cache: Map<string, string[]>
  /** 选中的 keys。 */
  selectedKeys: string[]
  /** 操作完成后把 (key → newTags) 的更新合并回缓存。 */
  onApply: (updates: Map<string, string[]>) => void
  /** 自动补全候选（top tags）。 */
  tagSuggestions?: string[]
  defaultScope?: ScopeKind
  /** 清空选择（外部给的 callback）。 */
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
  const [position, setPosition] = useState<'front' | 'back'>('back')

  const closePopover = () => {
    setOpenOp(null)
    setTagsInput('')
    setOldTag('')
    setNewTag('')
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
      toast('当前没有选中文件', 'error')
      return
    }
    const updates = new Map<string, string[]>()

    if (op === 'add' || op === 'remove') {
      const ts = parseTags(tagsInput)
      if (ts.length === 0) {
        toast('请输入至少一个 tag', 'error')
        return
      }
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
      const o = oldTag.trim()
      const n = newTag.trim()
      if (!o || !n) {
        toast('replace 需要 old / new', 'error')
        return
      }
      for (const k of keys) {
        const cur = cache.get(k) ?? []
        if (!cur.includes(o)) continue
        const next: string[] = []
        const seen = new Set<string>()
        for (const t of cur) {
          const out = t === o ? n : t
          if (seen.has(out)) continue
          seen.add(out)
          next.push(out)
        }
        updates.set(k, next)
      }
    } else if (op === 'dedupe') {
      for (const k of keys) {
        const cur = cache.get(k) ?? []
        const seen = new Set<string>()
        const next: string[] = []
        for (const t of cur) {
          if (seen.has(t)) continue
          seen.add(t)
          next.push(t)
        }
        if (next.length !== cur.length) updates.set(k, next)
      }
    }

    if (updates.size === 0) {
      toast(`${op}：无改动`, 'success')
      closePopover()
      return
    }
    onApply(updates)
    toast(`${op} 完成（${updates.size} 张待保存）`, 'success')
    closePopover()
  }

  const scopeLabel =
    scope === 'selected' ? `选中 ${selectedKeys.length}` : `全部 ${cache.size}`
  const isSelected = scope === 'selected'
  const opDisabled = isSelected && selectedKeys.length === 0

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/80 backdrop-blur px-3 py-2 flex flex-col gap-2 text-xs shrink-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-slate-400">范围</span>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as ScopeKind)}
          className="px-2 py-0.5 rounded bg-slate-950 border border-slate-700 text-xs"
        >
          <option value="selected">当前选中（{selectedKeys.length}）</option>
          <option value="all">全部图片</option>
        </select>

        <span className="text-slate-700">|</span>
        <BarBtn label="+ 加 tag" disabled={opDisabled} active={openOp === 'add'} onClick={() => setOpenOp(openOp === 'add' ? null : 'add')} />
        <BarBtn label="- 删 tag" disabled={opDisabled} active={openOp === 'remove'} onClick={() => setOpenOp(openOp === 'remove' ? null : 'remove')} />
        <BarBtn label="↔ replace" disabled={opDisabled} active={openOp === 'replace'} onClick={() => setOpenOp(openOp === 'replace' ? null : 'replace')} />
        <BarBtn label="dedupe" disabled={opDisabled} onClick={() => apply('dedupe')} />

        <span className="flex-1" />
        <span className="text-slate-500">{scopeLabel}</span>
        {onClearSelection && selectedKeys.length > 0 && (
          <button
            onClick={onClearSelection}
            className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
          >
            ✕ 清空
          </button>
        )}
      </div>

      {openOp && openOp !== 'dedupe' && (
        <div
          className="rounded border border-slate-700 bg-slate-900/80 px-2 py-1.5 flex flex-wrap items-center gap-2"
          role="dialog"
          aria-label={`bulk-${openOp}`}
        >
          {(openOp === 'add' || openOp === 'remove') && (
            <TagsField
              value={tagsInput}
              onChange={setTagsInput}
              placeholder="tag1, tag2 (逗号分隔)"
              suggestions={tagSuggestions}
            />
          )}
          {openOp === 'add' && (
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value as 'front' | 'back')}
              className="px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs"
            >
              <option value="back">追加到末尾</option>
              <option value="front">插到开头</option>
            </select>
          )}
          {openOp === 'replace' && (
            <>
              <TagsField value={oldTag} onChange={setOldTag} placeholder="old" suggestions={tagSuggestions} />
              <span className="text-slate-500">→</span>
              <TagsField value={newTag} onChange={setNewTag} placeholder="new" suggestions={tagSuggestions} />
            </>
          )}
          <button
            onClick={() => apply(openOp)}
            className="px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs"
          >
            执行
          </button>
          <button
            onClick={closePopover}
            className="px-2 py-1 rounded text-slate-500 hover:text-slate-200 text-xs ml-auto"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

function BarBtn({ label, onClick, disabled, active }: { label: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        'px-2 py-0.5 rounded ' +
        (active
          ? 'bg-cyan-600 text-white'
          : 'bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:bg-slate-800 disabled:text-slate-500')
      }
    >
      {label}
    </button>
  )
}

interface TagsFieldProps {
  value: string
  onChange: (v: string) => void
  placeholder: string
  suggestions: string[]
}

function TagsField({ value, onChange, placeholder, suggestions }: TagsFieldProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const tail = (() => {
    const m = value.match(/([^,，\n]*)$/)
    return (m ? m[1] : value).trim().toLowerCase()
  })()
  const matches = tail
    ? suggestions
        .filter((s) => s.toLowerCase().includes(tail) && s.toLowerCase() !== tail)
        .slice(0, 8)
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
    onChange(head + s)
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs w-56"
      />
      {open && matches.length > 0 && (
        <ul
          className="absolute left-0 top-full mt-0.5 z-20 bg-slate-900 border border-slate-700 rounded shadow-lg max-h-44 overflow-y-auto min-w-[200px]"
          role="listbox"
        >
          {matches.map((s) => (
            <li
              key={s}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(s)
              }}
              className="px-2 py-1 text-xs font-mono text-slate-200 hover:bg-slate-700 cursor-pointer"
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
