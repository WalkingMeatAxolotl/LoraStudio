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
import TagEditor from '../../../components/TagEditor'
import TagStatsPanel from '../../../components/TagStatsPanel'
import { useToast } from '../../../components/Toast'
import { useEventStream } from '../../../lib/useEventStream'

interface Ctx {
  project: ProjectDetail
  activeVersion: Version | null
  reload: () => Promise<void>
}

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
      setCache(c); setInitial(new Map(c)); setMeta(m); setKeys(ks)
    } catch (e) { toast(String(e), 'error') }
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
    } catch (e) { toast(String(e), 'error') }
  }

  const onAfterRestore = async () => { await reloadCache(); await reload() }

  const stats = activeVersion.stats
  const trainTotal = stats?.train_image_count ?? 0
  const taggedTotal = stats?.tagged_image_count ?? 0
  const allTagged = trainTotal > 0 && taggedTotal >= trainTotal

  const activeMeta = activeKey ? meta.get(activeKey) : undefined
  const activeFolder = activeMeta?.folder ?? ''
  const activeName = activeMeta?.name ?? ''
  const activeTags = activeKey ? cache.get(activeKey) ?? [] : []

  const isEditing = Boolean(activeKey)

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
      {/*
       * 统一布局：右侧面板宽度在两种模式下恒定（flex: 0 0 32%），
       * BulkActionBar 始终在右侧面板内，切换模式时不改变宽度 → 无抖动。
       *
       * 普通模式:   [图片网格 flex:1] [右侧面板 32%]
       * 编辑模式:   [大图预览 flex:1] [图片网格 flex:1.5] [右侧面板 32%]
       */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 10 }}>

        {/* ── 大图预览（仅编辑模式）── */}
        {isEditing && (
          <section style={{
            flex: 1,
            borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column',
            minWidth: 0, overflow: 'hidden',
          }}>
            {/* 文件名 header */}
            <div style={{
              padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)',
              flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)' }}>单图编辑</span>
              <code style={{
                flex: 1, minWidth: 0, fontSize: 'var(--t-xs)', fontFamily: 'var(--font-mono)',
                color: 'var(--fg-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {activeFolder}/{activeName}
              </code>
            </div>
            {/* 图片区：position:relative + absolute img 保证可靠填充 */}
            <div style={{
              flex: 1, position: 'relative', background: 'var(--bg-sunken)',
            }}>
              <img
                key={activeKey}
                src={api.versionThumbUrl(project.id, activeVersion.id, 'train', activeName, activeFolder, 800)}
                alt={activeName}
                style={{
                  position: 'absolute', inset: 8,
                  width: 'calc(100% - 16px)', height: 'calc(100% - 16px)',
                  objectFit: 'contain', borderRadius: 'var(--r-sm)',
                }}
              />
            </div>
          </section>
        )}

        {/* ── 图片网格（始终显示）── */}
        <section style={{
          flex: isEditing ? 1.5 : 1,
          borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)',
          background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column',
          minWidth: 0, overflow: 'hidden',
        }}>
          {/* 只有 inner div 可滚动，外层 section overflow:hidden 防整页滚 */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
            <ImageGrid
              items={captionItems}
              selected={sel}
              onSelect={handleClick}
              ariaLabel="tag-edit-grid"
              emptyHint={filterTag ? `没有图含「${filterTag}」` : '还没有图。请先在筛选和打标步骤完成操作。'}
            />
          </div>
        </section>

        {/* ── 右侧面板：宽度恒定，BulkActionBar 永远在这里 ── */}
        <div style={{
          flex: '0 0 32%', display: 'flex', flexDirection: 'column', gap: 10,
          minWidth: 0,
        }}>
          <BulkActionBar
            cache={cache}
            selectedKeys={selectedKeys}
            onApply={applyBulkUpdates}
            tagSuggestions={tagSuggestions}
            defaultScope="selected"
            onClearSelection={() => setSel(new Set())}
            filterTag={filterTag}
            onFilterTagChange={setFilterTag}
            totalCount={keys.length}
            filteredCount={filteredKeys.length}
            onSelectAll={() => setSel(new Set(filteredKeys))}
          />

          {isEditing ? (
            /* 标签编辑器 */
            <section style={{
              flex: 1,
              borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)', padding: 10,
              display: 'flex', flexDirection: 'column', gap: 8,
              minHeight: 0, overflow: 'hidden',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <button onClick={() => navActive(-1)} disabled={navKeys.length === 0} aria-label="上一张" className="btn btn-secondary btn-sm">◀</button>
                <span style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)', fontFamily: 'var(--font-mono)', flex: 1, textAlign: 'center' }}>
                  {activeIndex >= 0 ? `${activeIndex + 1} / ${navKeys.length}` : `– / ${navKeys.length}`}
                </span>
                <button onClick={() => navActive(1)} disabled={navKeys.length === 0} aria-label="下一张" className="btn btn-secondary btn-sm">▶</button>
                <button onClick={() => setActiveKey('')} className="btn btn-ghost btn-sm" aria-label="关闭编辑" style={{ marginLeft: 4 }}>✕</button>
              </div>
              <TagEditor tags={activeTags} onChange={updateActiveTags} />
            </section>
          ) : (
            /* 标签统计面板 */
            <TagStatsPanel
              cache={cache}
              selectedKeys={selectedKeys}
              onPickTag={handlePickTag}
            />
          )}
        </div>
      </div>
    </StepShell>
  )
}
