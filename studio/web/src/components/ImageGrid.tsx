import { memo } from 'react'

export interface ImageGridItem {
  name: string
  thumbUrl: string
  /** 鼠标悬停时显示在角标的小字（可选）：例如标签预览。 */
  meta?: string
}

interface Props {
  items: ImageGridItem[]
  selected: Set<string>
  /** 单击 = checkbox 切换；shift+click = 区间选；详见 applySelection。 */
  onSelect: (name: string, e: React.MouseEvent) => void
  /** 鼠标悬停时回调：用于驱动外部「大图预览面板」。 */
  onHover?: (name: string) => void
  /** 全屏 modal 预览，由 cell 上的放大镜按钮触发（可选）。 */
  onPreview?: (name: string) => void
  /** 渲染上限；超出在末尾显示「显示前 N 张」。 */
  limit?: number
  emptyHint?: string
  /** 测试 / 长列表场景下传入用于 grid 标识的 aria-label。 */
  ariaLabel?: string
  /** 列数（默认按宽度自适应）。FolderColumn 这种窄列会传 2-3。 */
  columnsClass?: string
}

// 默认按容器宽度自动塞满：每格最小 120px，剩余宽度均分给最后一列；
// 容器越宽列越多，无需断点切换。
const DEFAULT_COLUMNS = 'grid-cols-[repeat(auto-fill,minmax(120px,1fr))]'

export default function ImageGrid({
  items,
  selected,
  onSelect,
  onHover,
  onPreview,
  limit = 500,
  emptyHint = '没有图片',
  ariaLabel,
  columnsClass = DEFAULT_COLUMNS,
}: Props) {
  if (items.length === 0) {
    return <p className="text-fg-tertiary text-sm py-2">{emptyHint}</p>
  }
  const shown = items.slice(0, limit)
  const overflow = items.length - shown.length

  return (
    <div
      role="grid"
      aria-label={ariaLabel}
      className={`grid ${columnsClass} gap-1`}
    >
      {shown.map((it) => {
        const isSel = selected.has(it.name)
        return (
          <Cell
            key={it.name}
            item={it}
            selected={isSel}
            onSelect={onSelect}
            onHover={onHover}
            onPreview={onPreview}
          />
        )
      })}
      {overflow > 0 && (
        <p className="col-span-full text-xs text-fg-tertiary mt-1">
          仅显示前 {limit} 张（共 {items.length} 张）
        </p>
      )}
    </div>
  )
}

/** Cell 用 memo 包起来：父组件每次因为 hover 改 focus 都会重渲，但绝大多数
 * cell 的 selected / onSelect / item 引用都没变，能跳过重渲，避免 N 张缩略图
 * 全部重新创建 DOM。 */
const Cell = memo(function Cell({
  item,
  selected,
  onSelect,
  onHover,
  onPreview,
}: {
  item: ImageGridItem
  selected: boolean
  onSelect: (name: string, e: React.MouseEvent) => void
  onHover?: (name: string) => void
  onPreview?: (name: string) => void
}) {
  return (
    <div
      role="gridcell"
      aria-selected={selected}
      onMouseEnter={onHover ? () => onHover(item.name) : undefined}
      onClick={(e) => onSelect(item.name, e)}
      title={item.meta ? `${item.name}\n${item.meta}` : item.name}
      className={
        'group relative aspect-square overflow-hidden rounded border cursor-pointer select-none ' +
        (selected
          ? 'border-accent ring-2 ring-accent-soft'
          : 'border-subtle hover:border-dim') +
        ' bg-sunken'
      }
    >
      <img
        src={item.thumbUrl}
        alt={item.name}
        loading="lazy"
        decoding="async"
        draggable={false}
        className="w-full h-full object-cover pointer-events-none"
      />
      {/* checkbox 视觉指示：选中显示蓝色实心 ✓，未选中悬停时显示白色空框 */}
      <span
        aria-hidden
        className={
          'absolute top-1 left-1 w-5 h-5 rounded-sm flex items-center justify-center text-[12px] font-bold transition-opacity ' +
          (selected
            ? 'bg-accent text-accent-fg opacity-100'
            : 'bg-black/50 border border-subtle text-transparent opacity-0 group-hover:opacity-100')
        }
      >
        ✓
      </span>
      {/* 放大镜：悬停时出现，点击触发 modal 全屏预览（不影响选择状态） */}
      {onPreview && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onPreview(item.name)
          }}
          aria-label={`预览 ${item.name}`}
          className="absolute top-1 right-1 w-5 h-5 rounded-sm bg-black/60 text-white text-[11px] opacity-0 group-hover:opacity-100 hover:bg-black/80"
        >
          ⤢
        </button>
      )}
    </div>
  )
})

/** 给 caller 用的工具：单击 = checkbox 切换；shift+click = 区间选。
 *
 * - 单击已选中 → 取消选中
 * - 单击未选中 → 加入选中
 * - shift+click：从 anchor 到当前位置之间所有项加入选中（不取消已选中的）
 *
 * 注意：不再要求 ctrl/cmd —— 单击就是切换，符合「checkbox 多选」UX。
 */
export function applySelection(
  current: Set<string>,
  name: string,
  e: React.MouseEvent,
  names: string[],
  lastAnchor: string | null
): { next: Set<string>; anchor: string } {
  if (e.shiftKey && lastAnchor && names.includes(lastAnchor)) {
    const i = names.indexOf(lastAnchor)
    const j = names.indexOf(name)
    if (j === -1) return _toggle(current, name)
    const [lo, hi] = i < j ? [i, j] : [j, i]
    const next = new Set(current)
    for (let k = lo; k <= hi; k++) next.add(names[k])
    return { next, anchor: name }
  }
  return _toggle(current, name)
}

function _toggle(
  current: Set<string>,
  name: string
): { next: Set<string>; anchor: string } {
  const next = new Set(current)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  return { next, anchor: name }
}
