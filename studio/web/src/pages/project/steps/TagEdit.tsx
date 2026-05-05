import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  api,
  type CommitItem,
  type ProjectDetail,
  type Version,
} from '../../../api/client'
import BulkActionBar from '../../../components/BulkActionBar'
import ImageGrid, { applySelection } from '../../../components/ImageGrid'
import SaveBar from '../../../components/SaveBar'
import StepShell from '../../../components/StepShell'
import TagAutocomplete from '../../../components/TagAutocomplete'
import TagEditor from '../../../components/TagEditor'
import TagStatsPanel from '../../../components/TagStatsPanel'
import { useToast } from '../../../components/Toast'
import { useEventStream } from '../../../lib/useEventStream'

interface Ctx {
  project: ProjectDetail
  activeVersion: Version | null
  reload: () => Promise<void>
}

const SCROLL_BOX = 'flex-1 min-h-0 overflow-y-auto pr-1'

const keyOf = (folder: string, name: string) => `${folder}/${name}`

interface CaptionMeta {
  folder: string
  name: string
  format: 'txt' | 'json' | 'none'
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export default function TagEditPage() {
  const { project, activeVersion, reload } = useOutletContext<Ctx>()
  const { toast } = useToast()
  const versionId = activeVersion?.id ?? null

  const [cache, setCache] = useState<Map<string, string[]>>(new Map())
  const [initial, setInitial] = useState<Map<string, string[]>>(new Map())
  const [meta, setMeta] = useState<Map<string, CaptionMeta>>(new Map())
  const [keys, setKeys] = useState<string[]>([])

  const [activeKey, setActiveKey] = useState<string>('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [filterTag, setFilterTag] = useState<string>('')

  const reloadCache = useCallback(async () => {
    if (versionId == null) return
    try {
      const r = await api.listCaptionsFull(project.id, versionId)
      const c = new Map<string, string[]>()
      const m = new Map<string, CaptionMeta>()
      const ks: string[] = []
      for (const it of r.items) {
        const k = keyOf(it.folder, it.name)
        c.set(k, it.tags)
        m.set(k, { folder: it.folder, name: it.name, format: it.format })
        ks.push(k)
      }
      setCache(c)
      setInitial(new Map(c))
      setMeta(m)
      setKeys(ks)
    } catch (e) {
      toast(String(e), 'error')
    }
  }, [project.id, versionId, toast])

  useEffect(() => { void reloadCache() }, [reloadCache])

  useEventStream((evt) => {
    if (
      evt.type === 'version_state_changed' &&
      versionId != null &&
      evt.version_id === versionId
    ) {
      void reloadCache(); void reload()
    } else if (
      evt.type === 'job_state_changed' &&
      evt.project_id === project.id &&
      (evt.status === 'done' || evt.status === 'failed')
    ) {
      void reloadCache(); void reload()
    }
  })

  const dirtyKeys = useMemo(() => {
    const out: string[] = []
    for (const k of keys) {
      const cur = cache.get(k) ?? []
      const ini = initial.get(k) ?? []
      if (!arraysEqual(cur, ini)) out.push(k)
    }
    return out
  }, [cache, initial, keys])
  const dirty = dirtyKeys.length > 0

  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const filteredKeys = useMemo(() => {
    const f = filterTag.trim()
    if (!f) return keys
    return keys.filter((k) => (cache.get(k) ?? []).includes(f))
  }, [keys, cache, filterTag])

  const captionItems = useMemo(
    () =>
      filteredKeys.map((k) => {
        const m = meta.get(k)!
        const tags = cache.get(k) ?? []
        return {
          name: k,
          thumbUrl:
            activeVersion != null
              ? api.versionThumbUrl(project.id, activeVersion.id, 'train', m.name, m.folder)
              : '',
          meta: tags.slice(0, 5).join(', '),
        }
      }),
    [filteredKeys, meta, cache, project.id, activeVersion]
  )

  const selectedKeys = useMemo(
    () => filteredKeys.filter((k) => sel.has(k)),
    [filteredKeys, sel]
  )
  const navKeys = selectedKeys.length > 0 ? selectedKeys : filteredKeys
  const activeIndex = activeKey ? navKeys.indexOf(activeKey) : -1

  const tagSuggestions = useMemo(() => {
    const set = new Set<string>()
    for (const tags of cache.values()) for (const t of tags) set.add(t)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [cache])

  const handlePickTag = useCallback(
    (tag: string) => {
      const matched = new Set<string>()
      for (const k of keys) {
        if ((cache.get(k) ?? []).includes(tag)) matched.add(k)
      }
      setSel(matched); setAnchor(null)
      toast(`已选含「${tag}」的 ${matched.size} 张`, 'success')
    },
    [keys, cache, toast]
  )

  if (!activeVersion) {
    return <p style={{ color: 'var(--fg-tertiary)', padding: 24 }}>请先选择 / 创建一个版本</p>
  }

  const handleClick = (key: string, e: React.MouseEvent) => {
    if (e.altKey) { setActiveKey(key); return }
    const r = applySelection(sel, key, e, filteredKeys, anchor)
    setSel(r.next); setAnchor(r.anchor)
  }

  const navActive = (delta: number) => {
    if (navKeys.length === 0) return
    const i = activeKey ? navKeys.indexOf(activeKey) : -1
    const next = i < 0 ? 0 : (i + delta + navKeys.length) % navKeys.length
    setActiveKey(navKeys[next])
  }

  const updateActiveTags = (tags: string[]) => {
    if (!activeKey) return
    setCache((prev) => {
      const next = new Map(prev); next.set(activeKey, [...tags]); return next
    })
  }

  const applyBulkUpdates = (updates: Map<string, string[]>) => {
    setCache((prev) => {
      const next = new Map(prev)
      for (const [k, v] of updates) next.set(k, v)
      return next
    })
  }

  const onSave = async () => {
    if (!dirty || versionId == null) return
    const items: CommitItem[] = dirtyKeys.map((k) => {
      const m = meta.get(k)!
      return { folder: m.folder, name: m.name, tags: cache.get(k) ?? [] }
    })
    try {
      const r = await api.commitCaptions(project.id, versionId, items)
      setInitial(new Map(cache))
      toast(`已保存 ${r.written} 张，还原点 ${r.snapshot.id}`, 'success')
      void reload()
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const onAfterRestore = async () => {
    await reloadCache(); await reload()
  }

  const stats = activeVersion.stats
  const trainTotal = stats?.train_image_count ?? 0
  const taggedTotal = stats?.tagged_image_count ?? 0
  const allTagged = trainTotal > 0 && taggedTotal >= trainTotal

  const activeMeta = activeKey ? meta.get(activeKey) : undefined
  const activeFolder = activeMeta?.folder ?? ''
  const activeName = activeMeta?.name ?? ''
  const activeTags = activeKey ? cache.get(activeKey) ?? [] : []

  return (
    <StepShell
      idx={4}
      title="标签编辑"
      subtitle="批量编辑标签 · 暂存本地 · 保存后写盘"
      actions={
        <>
          {stats && (
            <span className={allTagged ? 'badge badge-ok' : 'badge badge-neutral'}>
              {taggedTotal}/{trainTotal} 已打标
            </span>
          )}
          <SaveBar
            pid={project.id}
            vid={activeVersion.id}
            dirtyCount={dirtyKeys.length}
            onSave={onSave}
            onAfterRestore={onAfterRestore}
          />
        </>
      }
    >
    <div className="flex flex-col h-full gap-3">
      {/* 批量操作栏 — 全宽 */}
      <BulkActionBar
        cache={cache}
        selectedKeys={selectedKeys}
        onApply={applyBulkUpdates}
        tagSuggestions={tagSuggestions}
        defaultScope="selected"
        onClearSelection={() => setSel(new Set())}
      />

      {/* 三栏主体 */}
      <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr 260px', gap: 12, flex: 1, minHeight: 0 }}>
        {/* 左栏：筛选 + 选择工具 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <div style={{
            borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)', padding: '8px 10px',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <TagAutocomplete
              value={filterTag}
              onChange={setFilterTag}
              suggestions={tagSuggestions}
              placeholder="搜索 tag（精确）"
              className="flex-1"
            />
            {filterTag && (
              <button onClick={() => setFilterTag('')} className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }}>
                ✕ 清除
              </button>
            )}
          </div>

          <div style={{
            borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)', padding: '8px 10px',
            display: 'flex', flexDirection: 'column', gap: 6,
            fontSize: 'var(--t-xs)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, color: 'var(--fg-primary)' }}>全部图片</span>
              <span style={{ color: 'var(--fg-tertiary)', fontFamily: 'var(--font-mono)' }}>
                {filterTag ? `${filteredKeys.length}/${keys.length}` : `${keys.length}`}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={() => setSel(new Set(filteredKeys))}
                disabled={filteredKeys.length === 0}
                className="btn btn-ghost btn-sm"
                style={{ flex: 1, fontSize: 'var(--t-xs)' }}
              >
                全选
              </button>
              <button
                onClick={() => setSel(new Set())}
                disabled={sel.size === 0}
                className="btn btn-ghost btn-sm"
                style={{ flex: 1, fontSize: 'var(--t-xs)' }}
              >
                清空 ({sel.size})
              </button>
            </div>
            {selectedKeys.length > 0 && (
              <div style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                已选 {selectedKeys.length} 张
              </div>
            )}
          </div>

          <div style={{ fontSize: 'var(--t-2xs)', color: 'var(--fg-tertiary)', padding: '4px 6px' }}>
            alt+点击 = 查看大图并编辑 · 普通点击 = 多选
          </div>
        </div>

        {/* 中栏：图片网格 + 单图编辑 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, minWidth: 0 }}>
          {/* 图片网格 */}
          <section style={{
            borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column',
            flex: 1, minHeight: 0, overflow: 'hidden',
          }}>
            <div className={`${SCROLL_BOX} p-2`}>
              <ImageGrid
                items={captionItems}
                selected={sel}
                onSelect={handleClick}
                ariaLabel="tag-edit-grid"
                emptyHint={
                  filterTag
                    ? `没有图含「${filterTag}」`
                    : '还没有图。请先在筛选和打标步骤完成操作。'
                }
              />
            </div>
          </section>

          {/* 单图编辑区 */}
          {activeName ? (
            <section style={{
              borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)', padding: 10,
              display: 'flex', flexDirection: 'column', gap: 6,
              flexShrink: 0, height: 280,
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 'var(--t-sm)', fontWeight: 600,
                flexShrink: 0,
              }}>
                <span>单图编辑</span>
                <code style={{ fontSize: 'var(--t-xs)', fontFamily: 'var(--font-mono)', color: 'var(--fg-tertiary)', fontWeight: 400 }}>
                  {activeFolder}/{activeName}
                </code>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 8, flex: 1, minHeight: 0 }}>
                <div style={{
                  background: 'var(--bg-sunken)', borderRadius: 'var(--r-md)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  minHeight: 0, overflow: 'hidden',
                }}>
                  <img
                    src={api.versionThumbUrl(project.id, activeVersion.id, 'train', activeName, activeFolder, 400)}
                    alt={activeName}
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexShrink: 0 }}>
                    <button onClick={() => navActive(-1)} disabled={navKeys.length === 0} aria-label="上一张" className="btn btn-secondary btn-sm">◀</button>
                    <span style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)', width: 80, textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                      {activeIndex >= 0 ? `${activeIndex + 1} / ${navKeys.length}` : `– / ${navKeys.length}`}
                    </span>
                    <button onClick={() => navActive(1)} disabled={navKeys.length === 0} aria-label="下一张" className="btn btn-secondary btn-sm">▶</button>
                  </div>
                  <TagEditor tags={activeTags} onChange={updateActiveTags} />
                </div>
              </div>
            </section>
          ) : null}
        </div>

        {/* 右栏：标签统计 */}
        <div className="min-h-0 min-w-0 flex">
          <TagStatsPanel
            cache={cache}
            selectedKeys={selectedKeys}
            onPickTag={handlePickTag}
          />
        </div>
      </div>
    </div>
    </StepShell>
  )
}
