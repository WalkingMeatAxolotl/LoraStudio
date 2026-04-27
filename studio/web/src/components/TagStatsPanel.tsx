import { useMemo, useState } from 'react'

type Sort = 'count_desc' | 'count_asc' | 'name_asc' | 'name_desc'

interface Props {
  /** 完整 tag 缓存（key → tags）。 */
  cache: Map<string, string[]>
  /** 选中的 key 集合；非空 → stats 反映选中；空 → 全部。 */
  selectedKeys: string[]
  /** 点 tag 反向选中含此 tag 的所有图。 */
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

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-800/40 flex flex-col min-h-0 flex-1 w-full min-w-0">
      <header className="px-3 py-1.5 border-b border-slate-700 flex items-center gap-2 text-xs flex-wrap">
        <span className="font-semibold text-slate-100">📊 Tag 统计</span>
        <span
          className={
            'text-[10px] px-1.5 py-0.5 rounded ' +
            (usingSelection
              ? 'bg-cyan-700/40 text-cyan-200'
              : 'bg-slate-700/60 text-slate-300')
          }
        >
          {usingSelection ? `选中 ${selectedKeys.length}` : '全部'}
        </span>
        <span className="text-slate-500">{items.length} tag</span>
        <span className="text-slate-700">|</span>
        <span className="text-slate-400">排序</span>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="px-2 py-0.5 rounded bg-slate-950 border border-slate-700 text-xs"
        >
          <option value="count_desc">数量 ↓</option>
          <option value="count_asc">数量 ↑</option>
          <option value="name_asc">名称 A→Z</option>
          <option value="name_desc">名称 Z→A</option>
        </select>
        <span className="flex-1" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="过滤..."
          className="px-2 py-0.5 text-xs rounded bg-slate-950 border border-slate-700 w-32"
        />
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-3 py-2 text-xs text-slate-500">
            {usingSelection ? '选中的图还没有 tag' : '还没有 tag'}
          </p>
        ) : (
          <div
            className="grid gap-x-3 gap-y-0.5 px-2 py-1"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
          >
            {filtered.map(([t, c]) => (
              <button
                key={t}
                onClick={() => onPickTag(t)}
                title={`选中所有含「${t}」的图`}
                className="text-left text-xs flex items-center gap-2 px-2 py-0.5 rounded hover:bg-slate-700/40 cursor-pointer min-w-0"
              >
                <span className="font-mono text-slate-200 truncate flex-1 min-w-0">
                  {t}
                </span>
                <span className="text-slate-400 tabular-nums">{c}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
