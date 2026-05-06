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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0 }}>
        <textarea
          value={tags[0] ?? ''}
          onChange={(e) => onChange([e.target.value])}
          placeholder="自然语言 caption..."
          className="input input-mono"
          style={{ flex: 1, resize: 'none', fontSize: 'var(--t-sm)' }}
        />
        {onSave && (
          <button
            disabled={saving || !dirty}
            onClick={onSave}
            className={dirty ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
            style={{ alignSelf: 'flex-start' }}
          >
            {saving ? '保存中...' : dirty ? '保存' : '已保存'}
          </button>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0 }}>
      {/* mode switch */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--t-xs)', flexShrink: 0 }}>
        <ModeBtn active={mode === 'chip'} onClick={switchToChip}>chip</ModeBtn>
        <ModeBtn active={mode === 'text'} onClick={switchToText}>文本</ModeBtn>
        <span style={{ flex: 1 }} />
        <span style={{ color: 'var(--fg-tertiary)' }}>{tags.length} tag</span>
      </div>

      {/* content area — both modes use flex:1 so no height jitter */}
      {mode === 'chip' ? (
        <>
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 4,
            overflowY: 'auto', flex: 1, minHeight: 0, alignContent: 'flex-start',
            padding: '4px 0',
          }}>
            {tags.length === 0 && (
              <span style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)' }}>还没有标签</span>
            )}
            {tags.map((t) => (
              <span
                key={t}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '3px 8px', borderRadius: 'var(--r-pill)',
                  background: 'var(--bg-overlay)', border: '1px solid var(--border-subtle)',
                  fontSize: 'var(--t-sm)', fontFamily: 'var(--font-mono)',
                  color: 'var(--fg-primary)',
                }}
              >
                {t}
                <button
                  onClick={() => removeTag(t)}
                  aria-label={`删除 ${t}`}
                  style={{
                    background: 'transparent', border: 'none',
                    color: 'var(--fg-tertiary)', cursor: 'pointer',
                    padding: 0, fontSize: 'var(--t-sm)', lineHeight: 1,
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--err)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--fg-tertiary)' }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
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
              className="input input-mono"
              style={{ flex: 1, fontSize: 'var(--t-xs)' }}
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
            className="input input-mono"
            style={{ flex: 1, resize: 'none', fontSize: 'var(--t-xs)' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
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
      style={{
        padding: '2px 8px', borderRadius: 'var(--r-sm)',
        background: active ? 'var(--accent)' : 'var(--bg-overlay)',
        border: active ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
        color: active ? 'var(--accent-fg)' : 'var(--fg-secondary)',
        fontSize: 'var(--t-xs)', cursor: 'pointer',
      }}
      onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--bg-surface)' }}
      onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--bg-overlay)' }}
    >
      {children}
    </button>
  )
}
