import { useEffect } from 'react'

interface Props {
  src: string
  caption?: string
  hasPrev?: boolean
  hasNext?: boolean
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
}

export default function ImagePreviewModal({
  src,
  caption,
  hasPrev,
  hasNext,
  onClose,
  onPrev,
  onNext,
}: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && hasPrev && onPrev) onPrev()
      else if (e.key === 'ArrowRight' && hasNext && onNext) onNext()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [hasPrev, hasNext, onPrev, onNext, onClose])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center"
      onClick={onClose}
    >
      <button
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        className="absolute top-3 right-4 text-slate-300 hover:text-white text-2xl"
        aria-label="关闭"
      >
        ×
      </button>
      {hasPrev && onPrev && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onPrev()
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-white text-3xl px-3 py-2 bg-black/30 rounded"
          aria-label="上一张"
        >
          ‹
        </button>
      )}
      {hasNext && onNext && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onNext()
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-white text-3xl px-3 py-2 bg-black/30 rounded"
          aria-label="下一张"
        >
          ›
        </button>
      )}
      <img
        src={src}
        alt={caption ?? 'preview'}
        onClick={(e) => e.stopPropagation()}
        className="max-w-[95vw] max-h-[88vh] object-contain"
      />
      {caption && (
        <div className="mt-2 text-xs text-slate-400 font-mono">{caption}</div>
      )}
    </div>
  )
}
