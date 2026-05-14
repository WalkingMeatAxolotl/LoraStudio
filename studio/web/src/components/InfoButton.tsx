import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * click-toggle 弹层。给字段名 / section title / 卡片角加帮助说明，不在主流
 * UI 占空间，用户需要时才显示。
 *
 * 行为：
 * - 点 trigger 切换；点外部 / Esc 关
 * - aria-expanded 给屏幕阅读器；trigger 自带 aria-label
 * - trigger 是 SVG i-in-circle 图标（之前用 Unicode ⓘ 字符在不同字体里
 *   垂直位置不一致跟相邻文字基线对不齐；SVG 用固定 viewBox 严格居中）
 *
 * 不做的事（YAGNI；将来真有别的 trigger 需求再扩）：
 * - 不支持 hover 触发（手机不友好）
 * - 不动态计算 placement（统一 bottom-left；视口溢出靠 max-width 收）
 */
interface InfoButtonProps {
  children: ReactNode
  ariaLabel?: string
}

function InfoIcon() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx={8} cy={8} r={6.5} />
      <line x1={8} y1={7.5} x2={8} y2={11.5} />
      <circle cx={8} cy={4.8} r={0.6} fill="currentColor" stroke="none" />
    </svg>
  )
}

export function InfoButton({ children, ariaLabel = '更多信息' }: InfoButtonProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span ref={wrapRef} className="info-btn-anchor">
      <button
        type="button"
        className="info-btn-trigger"
        onClick={(e) => {
          // stopPropagation：避免放在 <summary> / clickable row 里触发外层 toggle
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <InfoIcon />
      </button>
      {open && (
        <div className="info-btn-panel" role="dialog">
          {children}
        </div>
      )}
    </span>
  )
}
