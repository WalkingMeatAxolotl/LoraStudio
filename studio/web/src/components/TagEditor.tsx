import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

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

  // PointerSensor + 6px 启动距离：拖拽手感不会跟「点 × 删除」/ 误触冲突。
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

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
    // 加到末尾：跟 chip 拖拽重排的心智一致（新东西落在底部，用户拖到想要的位置）
    onChange([...tags, t])
    setDraft('')
  }

  const removeTag = (t: string) => {
    onChange(tags.filter((x) => x !== t))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = tags.indexOf(String(active.id))
    const newIndex = tags.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    onChange(arrayMove(tags, oldIndex, newIndex))
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
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={tags} strategy={rectSortingStrategy}>
              <div className="flex flex-wrap gap-1 overflow-y-auto flex-1 min-h-0 content-start py-1">
                {tags.length === 0 && (
                  <span className="text-xs text-fg-tertiary">还没有标签</span>
                )}
                {tags.map((t) => (
                  <SortableChip key={t} id={t} onRemove={() => removeTag(t)} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
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

/** 单个可拖拽 chip。dnd-kit 用 useSortable 给我们 setNodeRef / 拖拽 listeners /
 * transform / transition;CSS.Transform.toString 把 dnd-kit 算出的 (x,y,scale)
 * 翻译成 CSS transform 字符串。
 *
 * × 删除按钮要 stopPropagation onPointerDown —— 否则 6px 移动阈值过后 × 也成了
 * 拖拽起点,点 × 反而触发拖拽。
 */
function SortableChip({ id, onRemove }: { id: string; onRemove: () => void }) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : undefined,
  }
  return (
    <span
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-overlay border border-subtle text-sm font-mono text-fg-primary cursor-grab active:cursor-grabbing select-none touch-none"
    >
      {id}
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onRemove}
        aria-label={`删除 ${id}`}
        className="bg-transparent border-none text-fg-tertiary hover:text-err cursor-pointer p-0 text-sm leading-none"
      >
        ×
      </button>
    </span>
  )
}
