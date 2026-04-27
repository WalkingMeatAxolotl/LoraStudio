import { useEffect, useMemo, useRef, useState } from 'react'

interface Props {
  value: string
  onChange: (v: string) => void
  suggestions: string[]
  placeholder?: string
  className?: string
}

/** 单 tag 精确补全输入：用于 filter 栏「含 tag」。 */
export default function TagAutocomplete({
  value,
  onChange,
  suggestions,
  placeholder,
  className,
}: Props) {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    const v = value.trim().toLowerCase()
    if (!v) return suggestions.slice(0, 12)
    return suggestions
      .filter((s) => s.toLowerCase().includes(v) && s.toLowerCase() !== v)
      .slice(0, 12)
  }, [value, suggestions])

  useEffect(() => {
    setHi(0)
  }, [value])

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || matches.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHi((i) => (i + 1) % matches.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHi((i) => (i - 1 + matches.length) % matches.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      onChange(matches[hi])
      setOpen(false)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className={'relative ' + (className ?? '')} ref={ref}>
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder={placeholder}
        className="px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs w-full"
      />
      {open && matches.length > 0 && (
        <ul
          className="absolute left-0 top-full mt-0.5 z-20 bg-slate-900 border border-slate-700 rounded shadow-lg max-h-60 overflow-y-auto min-w-full"
          role="listbox"
        >
          {matches.map((s, i) => (
            <li
              key={s}
              role="option"
              aria-selected={i === hi}
              onMouseDown={(e) => {
                e.preventDefault()
                onChange(s)
                setOpen(false)
              }}
              className={
                'px-2 py-1 text-xs font-mono cursor-pointer ' +
                (i === hi ? 'bg-slate-700 text-white' : 'text-slate-200 hover:bg-slate-800')
              }
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
