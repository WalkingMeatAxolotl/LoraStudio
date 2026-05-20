import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<Sort>('count_desc')

  const usingSelection = selectedKeys.length > 0

  const items = useMemo(() => {
    const counter = new Map<string, number>()
    const targetKeys = usingSelection ? selectedKeys : Array.from(cache.keys())
    for (const k of targetKeys) {
      const tags = cache.get(k) ?? []
      for (const tag of tags) counter.set(tag, (counter.get(tag) ?? 0) + 1)
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
    return sorted.filter(([tag]) => tag.toLowerCase().includes(f))
  }, [sorted, filter])

  const maxCount = filtered.length > 0 ? filtered[0][1] : 1

  return (
    <section className="rounded-md border border-subtle bg-surface flex flex-col min-h-0 flex-1 min-w-0 overflow-hidden">
      <div className="px-2.5 py-1.5 border-b border-subtle flex items-center gap-2 text-xs shrink-0 flex-wrap">
        <span className="font-semibold text-fg-primary">{t('tagStats.title')}</span>
        <span className={`px-1.5 py-px rounded-sm text-[10px] ${usingSelection ? 'bg-accent-soft text-accent' : 'bg-sunken text-fg-tertiary'}`}>
          {usingSelection ? t('tagStats.selected', { n: selectedKeys.length }) : t('common.all')}
        </span>
        <span className="text-fg-tertiary">{t('tagStats.tagCount', { n: items.length })}</span>
        <span className="text-dim">|</span>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="input"
          style={{ fontSize: 'var(--t-xs)', padding: '1px 6px' }}
        >
          <option value="count_desc">{t('tagStats.sortCountDesc')}</option>
          <option value="count_asc">{t('tagStats.sortCountAsc')}</option>
          <option value="name_asc">{t('tagStats.sortNameAZ')}</option>
          <option value="name_desc">{t('tagStats.sortNameZA')}</option>
        </select>
        <span className="flex-1" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('common.filter')}
          className="input"
          style={{ fontSize: 'var(--t-xs)', padding: '1px 8px', width: 120 }}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-2.5 py-2 text-xs text-fg-tertiary m-0">
            {usingSelection ? t('tagStats.noTagsSelected') : t('tagStats.noTags')}
          </p>
        ) : (
          <div className="p-1.5 flex flex-col gap-px">
            {filtered.map(([tag, c]) => {
              const pct = Math.max((c / maxCount) * 100, 3)
              return (
                <button
                  key={tag}
                  onClick={() => onPickTag(tag)}
                  title={`选中所有含「${tag}」的图`}
                  className="flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-transparent border-none cursor-pointer text-left text-xs min-w-0 relative hover:bg-overlay transition-colors"
                >
                  <span style={{
                    position: 'absolute', inset: 0, borderRadius: 'var(--r-sm)',
                    background: 'var(--accent-soft)', opacity: pct / 100 * 0.35,
                    width: `${pct}%`, zIndex: 0,
                  }} />
                  <span className="font-mono text-fg-primary flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap relative z-[1]">
                    {tag}
                  </span>
                  <span className="text-fg-tertiary font-mono text-[10px] relative z-[1]">
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
