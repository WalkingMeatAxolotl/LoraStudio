import { useMemo, useState } from 'react'

type Sort = 'count_desc' | 'count_asc' | 'name_asc' | 'name_desc'

interface Props {
  cache: Map<string, string[]>
  selectedKeys: string[]
  onPickTag: (tag: string) => void
}

export default function TagStatsPanel({
  cache,
  selectedKeys,
  onPickTag,
}: Props) {
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<Sort>('count_desc')

  const usingSelection = selectedKeys.length > 0

  const items = useMemo(() => {
    const counter = new Map<string, number>()
    const targetKeys = usingSelection ? selectedKeys : Array.from(cache.keys())
    for (const k of targetKeys) {
      const tags = cache.get(k) ?? []
      for (const t of tags) counter.set(t, (counter.get(t) ?? 0) + 1)
    }
    return Array.from(counter.entries())
  }, [cache, selectedKeys, usingSelection])

  const sorted = useMemo(() => {
    const out = [...items]
    if (sort === 'count_desc') out.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    else if (sort === 'count_asc') out.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    else if (sort === 'name_asc') out.sort((a, b) => a[0].localeCompare(b[0]))
    else if (sort === 'name_desc') out.sort((a, b) => b[0].localeCompare(a[0]))
    return out
  }, [items, sort])

  const filtered = useMemo(() => {
    if (!filter.trim()) return sorted
    const f = filter.trim().toLowerCase()
    return sorted.filter(([t]) => t.toLowerCase().includes(f))
  }, [sorted, filter])

  const maxCount = filtered.length > 0 ? filtered[0][1] : 1

  return (
    <section style={{
      borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)',
      background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column',
      minHeight: 0, flex: 1, minWidth: 0, overflow: 'hidden',
    }}>
      {/* header */}
      <div style={{
        padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--t-xs)',
        flexShrink: 0, flexWrap: 'wrap',
      }}>
        <span style={{ fontWeight: 600, color: 'var(--fg-primary)' }}>标签分布</span>
        <span style={{
          padding: '1px 6px', borderRadius: 'var(--r-sm)',
          background: usingSelection ? 'var(--accent-soft)' : 'var(--bg-sunken)',
          color: usingSelection ? 'var(--accent)' : 'var(--fg-tertiary)',
          fontSize: 'var(--t-2xs)',
        }}>
          {usingSelection ? `选中 ${selectedKeys.length}` : '全部'}
        </span>
        <span style={{ color: 'var(--fg-tertiary)' }}>{items.length} tag</span>
        <span style={{ color: 'var(--border-default)' }}>|</span>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="input"
          style={{ fontSize: 'var(--t-xs)', padding: '1px 6px' }}
        >
          <option value="count_desc">数量 ↓</option>
          <option value="count_asc">数量 ↑</option>
          <option value="name_asc">名称 A→Z</option>
          <option value="name_desc">名称 Z→A</option>
        </select>
        <span style={{ flex: 1 }} />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="过滤..."
          className="input"
          style={{ fontSize: 'var(--t-xs)', padding: '1px 8px', width: 120 }}
        />
      </div>

      {/* body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <p style={{ padding: '8px 10px', fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)', margin: 0 }}>
            {usingSelection ? '选中的图还没有 tag' : '还没有 tag'}
          </p>
        ) : (
          <div style={{ padding: '4px 6px', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {filtered.map(([t, c]) => {
              const pct = Math.max((c / maxCount) * 100, 3)
              return (
                <button
                  key={t}
                  onClick={() => onPickTag(t)}
                  title={`选中所有含「${t}」的图`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '3px 8px', borderRadius: 'var(--r-sm)',
                    background: 'transparent', border: 'none',
                    cursor: 'pointer', textAlign: 'left' as const,
                    fontSize: 'var(--t-xs)', minWidth: 0,
                    position: 'relative',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-overlay)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  {/* bar */}
                  <span style={{
                    position: 'absolute', inset: 0, borderRadius: 'var(--r-sm)',
                    background: 'var(--accent-soft)', opacity: pct / 100 * 0.35,
                    width: `${pct}%`, zIndex: 0,
                  }} />
                  <span style={{
                    fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)',
                    flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    position: 'relative', zIndex: 1,
                  }}>
                    {t}
                  </span>
                  <span style={{
                    color: 'var(--fg-tertiary)', fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--t-2xs)', position: 'relative', zIndex: 1,
                  }}>
                    {c}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
