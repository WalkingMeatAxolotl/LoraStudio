import { useEffect, useMemo, useRef, useState } from 'react'

interface Props {
  tags: string[]
  natural?: boolean
  onChange: (tags: string[]) => void
  onSave?: () => void | Promise<void>
  saving?: boolean
  dirty?: boolean
}

type Mode = 'chip' | 'text'

const parseLine = (raw: string): string[] =>
  raw.split(/[,，\n]/).map((t) => t.trim()).filter(Boolean)

export default function TagEditor({
  tags, natural, onChange, onSave, saving, dirty,
}: Props) {
  const [draft, setDraft] = useState('')
  const tagsJoined = useMemo(() => tags.join(', '), [tags])
  const [mode, setMode] = useState<Mode>(natural ? 'text' : 'chip')
  const [textBuf, setTextBuf] = useState(() => tagsJoined)

  // Reset draft when image switches
  useEffect(() => { setDraft('') }, [tags])

  // Sync textBuf when tags change WHILE in text mode (image switch)
  const prevTagsJoinedRef = useRef(tagsJoined)
  useEffect(() => {
    if (mode === 'text' && tagsJoined !== prevTagsJoinedRef.current) {
      setTextBuf(tagsJoined)
    }
    prevTagsJoinedRef.current = tagsJoined
  }, [tagsJoined, mode])

  const addTag = (raw: string) => {
    const t = raw.trim().replace(/^[,，]+|[,，]+$/g, '')
    if (!t) return
    if (tags.includes(t)) { setDraft(''); return }
    onChange([t, ...tags])
    setDraft('')
  }

  const removeTag = (t: string) => {
    onChange(tags.filter((x) => x !== t))
  }

  const commitText = () => {
    const next: string[] = []
    const seen = new Set<string>()
    for (const t of parseLine(textBuf)) {
      if (seen.has(t)) continue
      seen.add(t); next.push(t)
    }
    if (JSON.stringify(next) !== JSON.stringify(tags)) onChange(next)
  }

  const switchToText = () => {
    if (mode === 'text') return
    setTextBuf(tagsJoined) // sync immediately, no double-render via effect
    setMode('text')
  }

  const switchToChip = () => {
    if (mode === 'chip') return
    commitText()
    setMode('chip')
  }

  if (natural) {
    return (
      <div className="flex flex-col gap-2 flex-1 min-h-0">
        <textarea
          value={tags[0] ?? ''}
          onChange={(e) => onChange([e.target.value])}
          placeholder="自然语言 caption..."
          className="input input-mono text-sm flex-1 resize-none"
        />
        {onSave && (
          <button
            disabled={saving || !dirty}
            onClick={onSave}
            className={`self-start ${dirty ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}`}
          >
            {saving ? '保存中...' : dirty ? '保存' : '已保存'}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5 flex-1 min-h-0">
      {/* mode switch */}
      <div className="flex items-center gap-1.5 text-xs shrink-0">
        <ModeBtn active={mode === 'chip'} onClick={switchToChip}>chip</ModeBtn>
        <ModeBtn active={mode === 'text'} onClick={switchToText}>文本</ModeBtn>
        <span className="flex-1" />
        <span className="text-fg-tertiary">{tags.length} tag</span>
      </div>

      {/* content area — both modes use flex:1 so no height jitter */}
      {mode === 'chip' ? (
        <>
          <div className="flex flex-wrap gap-1 overflow-y-auto flex-1 min-h-0 content-start py-1">
            {tags.length === 0 && (
              <span className="text-xs text-fg-tertiary">还没有标签</span>
            )}
            {tags.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-overlay border border-subtle text-sm font-mono text-fg-primary"
              >
                {t}
                <button
                  onClick={() => removeTag(t)}
                  aria-label={`删除 ${t}`}
                  className="bg-transparent border-none text-fg-tertiary hover:text-err cursor-pointer p-0 text-sm leading-none"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
                  e.preventDefault(); addTag(draft)
                } else if (e.key === 'Backspace' && !draft && tags.length) {
                  removeTag(tags[tags.length - 1])
                }
              }}
              placeholder="添加标签后按 Enter / 逗号"
              className="input input-mono text-xs flex-1"
            />
            {onSave && (
              <button
                disabled={saving || !dirty}
                onClick={onSave}
                className={dirty ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
              >
                {saving ? '保存中...' : dirty ? '保存' : '已保存'}
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <textarea
            value={textBuf}
            onChange={(e) => setTextBuf(e.target.value)}
            onBlur={commitText}
            placeholder="逗号 / 换行分隔，失焦自动同步"
            className="input input-mono text-xs flex-1 resize-none"
          />
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={commitText} className="btn btn-ghost btn-sm">同步</button>
            {onSave && (
              <button
                disabled={saving || !dirty}
                onClick={async () => { commitText(); await onSave() }}
                className={dirty ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
              >
                {saving ? '保存中...' : dirty ? '保存' : '已保存'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function ModeBtn({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'px-2 py-0.5 rounded-sm text-xs border transition-colors cursor-pointer',
        active
          ? 'bg-accent border-accent text-accent-fg'
          : 'bg-overlay border-subtle text-fg-secondary hover:bg-surface',
      ].join(' ')}
    >
      {children}
    </button>
  )
}
