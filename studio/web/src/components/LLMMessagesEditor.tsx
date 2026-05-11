import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useRef } from 'react'
import type { LLMMessage } from '../api/client'

interface Props {
  messages: LLMMessage[]
  onChange: (msgs: LLMMessage[]) => void
  disabled?: boolean
}

/**
 * LLM tagger preset 的 messages 序列编辑器。
 *
 * - text item: role 下拉 (system/user/assistant) + content textarea + 删除按钮
 * - image item: 固定显示，content / role 不可编辑，但位置可拖
 * - 每条 item 都可拖拽（左侧 grip handle）
 * - 「+ 添加消息」追加 text/user 空消息
 *
 * 后端约束：messages 必须恰好含一个 type=image item（validator 兜底）。前端 UI
 * 不显式阻止删除 image，但删了后端会自动补一个到末尾。
 */
export default function LLMMessagesEditor({ messages, onChange, disabled }: Props) {
  // 拖拽 id：每条 item 一个稳定 id；用 useRef 维护"消息引用 → id" 映射，让 array
  // 重排时 id 跟着内容走（避免单纯按 index 算 id 在拖拽末尾跳变）。
  const idRefs = useRef<WeakMap<LLMMessage, string>>(new WeakMap())
  const seq = useRef(0)
  const idOf = (m: LLMMessage): string => {
    let id = idRefs.current.get(m)
    if (!id) {
      seq.current += 1
      id = `msg-${seq.current}`
      idRefs.current.set(m, id)
    }
    return id
  }
  const ids = messages.map(idOf)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = ids.indexOf(active.id as string)
    const newIdx = ids.indexOf(over.id as string)
    if (oldIdx === -1 || newIdx === -1) return
    onChange(arrayMove(messages, oldIdx, newIdx))
  }

  const updateMsg = (i: number, patch: Partial<LLMMessage>) => {
    onChange(messages.map((m, idx) => (idx === i ? { ...m, ...patch } : m)))
  }

  const deleteMsg = (i: number) => {
    onChange(messages.filter((_, idx) => idx !== i))
  }

  const addMessage = () => {
    // 默认 role：跟随上一条交替（system→user→assistant→user→...）；起始 user
    const last = messages[messages.length - 1]
    const nextRole: LLMMessage['role'] =
      !last || last.type === 'image' || last.role === 'system'
        ? 'user'
        : last.role === 'user'
          ? 'assistant'
          : 'user'
    onChange([...messages, { type: 'text', role: nextRole, content: '' }])
  }

  return (
    <div className="flex flex-col gap-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {messages.map((m, i) => (
            <SortableItem
              key={ids[i]}
              id={ids[i]}
              message={m}
              disabled={disabled}
              onChange={(patch) => updateMsg(i, patch)}
              onDelete={() => deleteMsg(i)}
            />
          ))}
        </SortableContext>
      </DndContext>
      <button
        type="button"
        onClick={addMessage}
        disabled={disabled}
        className="btn btn-secondary btn-sm self-start"
      >
        + 添加消息
      </button>
    </div>
  )
}

function SortableItem({
  id,
  message,
  onChange,
  onDelete,
  disabled,
}: {
  id: string
  message: LLMMessage
  onChange: (patch: Partial<LLMMessage>) => void
  onDelete: () => void
  disabled?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  if (message.type === 'image') {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="flex items-center gap-2 rounded-sm border border-dashed border-subtle bg-surface-soft px-2 py-2"
      >
        <button
          {...attributes}
          {...listeners}
          type="button"
          aria-label="拖动调整位置"
          className="cursor-grab text-fg-tertiary hover:text-fg-secondary select-none px-1"
          disabled={disabled}
        >
          ⋮⋮
        </button>
        <span className="text-sm">📷 当前图片</span>
        <span className="text-[10px] text-fg-tertiary">
          打标时图片塞入此位置；可拖动调整顺序
        </span>
      </div>
    )
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-2 rounded-sm border border-subtle bg-surface px-2 py-2"
    >
      <button
        {...attributes}
        {...listeners}
        type="button"
        aria-label="拖动调整位置"
        className="cursor-grab text-fg-tertiary hover:text-fg-secondary select-none px-1 pt-1"
        disabled={disabled}
      >
        ⋮⋮
      </button>
      <select
        value={message.role}
        onChange={(e) => onChange({ role: e.target.value as LLMMessage['role'] })}
        disabled={disabled}
        className="input input-mono text-xs"
        style={{ width: 110 }}
      >
        <option value="system">system</option>
        <option value="user">user</option>
        <option value="assistant">assistant</option>
      </select>
      <textarea
        value={message.content}
        onChange={(e) => onChange({ content: e.target.value })}
        disabled={disabled}
        rows={3}
        className="input input-mono min-h-16 flex-1 text-xs font-mono"
        placeholder={
          message.role === 'system'
            ? '系统提示，例如：You are an image captioning assistant...'
            : message.role === 'user'
              ? '用户内容（few-shot 示例 / 任务描述）'
              : 'assistant 期望输出（few-shot 示例答案）'
        }
      />
      <button
        type="button"
        onClick={onDelete}
        disabled={disabled}
        className="btn btn-ghost btn-sm text-fg-tertiary hover:text-err shrink-0"
        title="删除消息"
        aria-label="删除消息"
      >
        ✕
      </button>
    </div>
  )
}
