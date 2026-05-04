import { useEffect, useMemo, useState } from 'react'

interface Props {
  tags: string[]
  /** 用 textarea 渲染（适合 JoyCaption 自然语言）；否则 chip 列表。 */
  natural?: boolean
  onChange: (tags: string[]) => void
  /** 父组件提交后调；失败 toast 由父组件处理。 */
  onSave?: () => void | Promise<void>
  saving?: boolean
  dirty?: boolean
}

type Mode = 'chip' | 'text'

const parseLine = (raw: string): string[] =>
  raw
    .split(/[,，\n]/)
    .map((t) => t.trim())
    .filter(Boolean)

export default function TagEditor({
  tags,
  natural,
  onChange,
  onSave,
  saving,
  dirty,
}: Props) {
  const [draft, setDraft] = useState('')
  const tagsJoined = useMemo(() => tags.join(', '), [tags])
  const [mode, setMode] = useState<Mode>(natural ? 'text' : 'chip')
  // text 模式 buffer：初始用当前 tags 拼出来，避免「切到 text → 空白」
  const [textBuf, setTextBuf] = useState(() => tagsJoined)

  // tags 变化（外部刷新）→ 清掉草稿
  useEffect(() => {
    setDraft('')
  }, [tags])

  // 进入 text 模式 / tags 外部变 → 同步 textBuf
  useEffect(() => {
    if (mode === 'text') setTextBuf(tagsJoined)
  }, [mode, tagsJoined])

  const addTag = (raw: string) => {
    const t = raw.trim().replace(/^[,，]+|[,，]+$/g, '')
    if (!t) return
    if (tags.includes(t)) {
      setDraft('')
      return
    }
    // 新 tag 默认插到开头（用户偏好：训练时主标签更靠前）
    onChange([t, ...tags])
    setDraft('')
  }

  const removeTag = (t: string) => {
    onChange(tags.filter((x) => x !== t))
  }

  // text 模式失焦或主动 commit → 把 textBuf 解析回 tags（去重保序）
  const commitText = () => {
    const next: string[] = []
    const seen = new Set<string>()
    for (const t of parseLine(textBuf)) {
      if (seen.has(t)) continue
      seen.add(t)
      next.push(t)
    }
    if (JSON.stringify(next) !== JSON.stringify(tags)) onChange(next)
  }

  // natural 模式（JoyCaption） — 整段自由文本，不解析
  if (natural) {
    return (
      <div className="space-y-2 flex-1 min-h-0 flex flex-col">
        <textarea
          value={tags[0] ?? ''}
          onChange={(e) => onChange([e.target.value])}
          placeholder="自然语言 caption..."
          className="w-full flex-1 min-h-[180px] px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-sm focus:outline-none focus:border-cyan-500"
        />
        {onSave && (
          <button
            disabled={saving || !dirty}
            onClick={onSave}
            className="px-3 py-1 rounded text-xs bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 self-start"
          >
            {saving ? '保存中...' : dirty ? '保存' : '已保存'}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2 flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-2 text-[10px] shrink-0">
        <span className="text-slate-500">编辑模式</span>
        <ModeBtn
          active={mode === 'chip'}
          onClick={() => {
            // 切回 chip 前先把 textarea 缓冲落到 tags（避免丢未失焦的改动）
            if (mode === 'text') commitText()
            setMode('chip')
          }}
        >
          chip
        </ModeBtn>
        <ModeBtn
          active={mode === 'text'}
          onClick={() => {
            // 直接切；textBuf 由 useEffect 同步当前 tags
            setMode('text')
          }}
        >
          文本
        </ModeBtn>
        <span className="flex-1" />
        <span className="text-slate-500">{tags.length} tag</span>
      </div>

      {mode === 'chip' ? (
        <>
          <div className="flex flex-wrap gap-1 overflow-y-auto flex-1 min-h-0 content-start">
            {tags.length === 0 && (
              <span className="text-xs text-slate-500">还没有标签</span>
            )}
            {tags.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-xs text-slate-200"
              >
                {t}
                <button
                  onClick={() => removeTag(t)}
                  aria-label={`删除 ${t}`}
                  className="text-slate-500 hover:text-red-400 px-1"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
                  e.preventDefault()
                  addTag(draft)
                } else if (e.key === 'Backspace' && !draft && tags.length) {
                  removeTag(tags[tags.length - 1])
                }
              }}
              placeholder="添加标签后按 Enter / 逗号"
              className="flex-1 px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs focus:outline-none focus:border-cyan-500"
            />
            {onSave && (
              <button
                disabled={saving || !dirty}
                onClick={onSave}
                className="px-3 py-1 rounded text-xs bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500"
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
            className="w-full flex-1 min-h-[160px] px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-xs font-mono focus:outline-none focus:border-cyan-500 resize-none"
          />
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={commitText}
              className="px-2 py-1 rounded text-xs bg-slate-700 hover:bg-slate-600 text-slate-200"
            >
              同步
            </button>
            {onSave && (
              <button
                disabled={saving || !dirty}
                onClick={async () => { commitText(); await onSave() }}
                className="px-3 py-1 rounded text-xs bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500"
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

function ModeBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        'px-1.5 py-0.5 rounded ' +
        (active ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600')
      }
    >
      {children}
    </button>
  )
}
