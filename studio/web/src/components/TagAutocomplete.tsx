import { useEffect, useMemo, useRef, useState } from 'react'

interface Props {
  value: string
  onChange: (v: string) => void
  suggestions: string[]
  placeholder?: string
  style?: React.CSSProperties
}

/** 单 tag 精确补全输入：用于 filter 栏「含 tag」。 */
export default function TagAutocomplete({
  value,
  onChange,
  suggestions,
  placeholder,
  style,
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

  useEffect(() => { setHi(0) }, [value])

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
    <div style={{ position: 'relative', ...style }} ref={ref}>
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder={placeholder}
        className="input input-mono"
        style={{ fontSize: 'var(--t-xs)', width: '100%' }}
      />
      {open && matches.length > 0 && (
        <ul
          style={{
            position: 'absolute', left: 0, top: '100%', marginTop: 2, zIndex: 30,
            background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--r-sm)', boxShadow: 'var(--sh-lg)',
            maxHeight: 240, overflowY: 'auto', minWidth: '100%',
            listStyle: 'none', padding: '4px 0', margin: 0,
          }}
          role="listbox"
        >
          {matches.map((s, i) => (
            <li
              key={s}
              role="option"
              aria-selected={i === hi}
              onMouseDown={(e) => { e.preventDefault(); onChange(s); setOpen(false) }}
              style={{
                padding: '4px 10px', fontSize: 'var(--t-xs)', fontFamily: 'var(--font-mono)',
                color: 'var(--fg-primary)', cursor: 'pointer',
                background: i === hi ? 'var(--bg-overlay)' : 'transparent',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-overlay)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = i === hi ? 'var(--bg-overlay)' : 'transparent' }}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
