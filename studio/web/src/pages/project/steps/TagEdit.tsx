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

  // 缓存模型：所有图片的 caption 全在内存
  const [cache, setCache] = useState<Map<string, string[]>>(new Map())
  const [initial, setInitial] = useState<Map<string, string[]>>(new Map())
  const [meta, setMeta] = useState<Map<string, CaptionMeta>>(new Map())
  const [keys, setKeys] = useState<string[]>([]) // 保持原始顺序

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

  useEffect(() => {
    void reloadCache()
  }, [reloadCache])

  // SSE：打标 job 完成 → 重拉
  useEventStream((evt) => {
    if (
      evt.type === 'version_state_changed' &&
      versionId != null &&
      evt.version_id === versionId
    ) {
      void reloadCache()
      void reload()
    } else if (
      evt.type === 'job_state_changed' &&
      evt.project_id === project.id &&
      (evt.status === 'done' || evt.status === 'failed')
    ) {
      void reloadCache()
      void reload()
    }
  })

  // dirty 检测
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

  // beforeunload 阻止丢失改动
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  // filter「含 tag」：直接基于 cache
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
              ? api.versionThumbUrl(
                  project.id,
                  activeVersion.id,
                  'train',
                  m.name,
                  m.folder
                )
              : '',
          meta: tags.slice(0, 5).join(', '),
        }
      }),
    [filteredKeys, meta, cache, project.id, activeVersion]
  )

  // 选中（在当前 filteredKeys 范围内）
  const selectedKeys = useMemo(
    () => filteredKeys.filter((k) => sel.has(k)),
    [filteredKeys, sel]
  )
  const navKeys = selectedKeys.length > 0 ? selectedKeys : filteredKeys
  const activeIndex = activeKey ? navKeys.indexOf(activeKey) : -1

  // 自动补全候选 = cache 里出现过的所有 tag
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
      setSel(matched)
      setAnchor(null)
      toast(`已选含「${tag}」的 ${matched.size} 张`, 'success')
    },
    [keys, cache, toast]
  )

  if (!activeVersion) {
    return <p style={{ color: 'var(--fg-tertiary)', padding: 24 }}>请先选择 / 创建一个版本</p>
  }

  // 普通点击 = 多选 toggle（含 shift 区间）；alt+click = 单图查看
  const handleClick = (key: string, e: React.MouseEvent) => {
    if (e.altKey) {
      setActiveKey(key)
      return
    }
    const r = applySelection(sel, key, e, filteredKeys, anchor)
    setSel(r.next)
    setAnchor(r.anchor)
  }

  const navActive = (delta: number) => {
    if (navKeys.length === 0) return
    const i = activeKey ? navKeys.indexOf(activeKey) : -1
    const next = i < 0 ? 0 : (i + delta + navKeys.length) % navKeys.length
    setActiveKey(navKeys[next])
  }

  // 单图编辑：chip 增减 / textarea 失焦直接写入缓存
  const updateActiveTags = (tags: string[]) => {
    if (!activeKey) return
    setCache((prev) => {
      const next = new Map(prev)
      next.set(activeKey, [...tags])
      return next
    })
  }

  // 批量操作 → 合并 updates 进 cache
  const applyBulkUpdates = (updates: Map<string, string[]>) => {
    setCache((prev) => {
      const next = new Map(prev)
      for (const [k, v] of updates) next.set(k, v)
      return next
    })
  }

  // 顶栏「保存」 = 把 dirtyKeys commit 到后端（自动备份）
  const onSave = async () => {
    if (!dirty || versionId == null) return
    const items: CommitItem[] = dirtyKeys.map((k) => {
      const m = meta.get(k)!
      return { folder: m.folder, name: m.name, tags: cache.get(k) ?? [] }
    })
    try {
      const r = await api.commitCaptions(project.id, versionId, items)
      // 更新 initial = 当前 cache
      setInitial(new Map(cache))
      toast(`已保存 ${r.written} 张，还原点 ${r.snapshot.id}`, 'success')
      void reload()
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const onAfterRestore = async () => {
    await reloadCache()
    await reload()
  }

  const stats = activeVersion.stats
  const trainTotal = stats?.train_image_count ?? 0
  const taggedTotal = stats?.tagged_image_count ?? 0
  const allTagged = trainTotal > 0 && taggedTotal >= trainTotal

  const activeMeta = activeKey ? meta.get(activeKey) : undefined
  const activeFolder = activeMeta?.folder ?? ''
  const activeName = activeMeta?.name ?? ''
  const activeFormat = activeMeta?.format ?? 'none'
  const activeTags = activeKey ? cache.get(activeKey) ?? [] : []

  return (
    <StepShell
      idx={4}
      title="标签编辑"
      subtitle="批量替换 / 删除 / 添加标签；自动生成还原点。编辑只改本地缓存，「保存」一键写盘。"
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
    <div className="flex flex-col h-full gap-2" style={{ padding: '12px 24px' }}>

      {/* 批量操作 */}
      <BulkActionBar
        cache={cache}
        selectedKeys={selectedKeys}
        onApply={applyBulkUpdates}
        tagSuggestions={tagSuggestions}
        defaultScope="selected"
        onClearSelection={() => setSel(new Set())}
      />

      {/* 主体：左 40%（grid + stats）+ 右 60%（单图编辑） */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-2 flex-1 min-h-0">
        <div className="grid grid-rows-[3fr_2fr] gap-2 min-h-0 min-w-0">
          {/* 全部图片 */}
          <section style={{
            borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column',
            minHeight: 0, overflow: 'hidden',
          }}>
            <header style={{
              padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)',
              display: 'flex', flexDirection: 'column', gap: 6,
              fontSize: 'var(--t-sm)',
            }}>
              <div className="flex items-center gap-2">
                <span style={{ fontWeight: 600 }}>全部图片</span>
                <span style={{ color: 'var(--fg-tertiary)' }}>
                  {filterTag ? `${filteredKeys.length}/${keys.length}` : `${keys.length}`}
                </span>
                <span
                  style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)' }}
                  title="普通点击 = 多选切换；alt+点击 = 单图查看"
                >
                  alt+点击=查看
                </span>
                <span className="flex-1" />
                <button
                  onClick={() => setSel(new Set(filteredKeys))}
                  disabled={filteredKeys.length === 0}
                  className="btn btn-ghost btn-sm"
                >
                  全选
                </button>
                <button
                  onClick={() => setSel(new Set())}
                  disabled={sel.size === 0}
                  className="btn btn-ghost btn-sm"
                >
                  清空
                </button>
              </div>
              <div className="flex items-center gap-1">
                <TagAutocomplete
                  value={filterTag}
                  onChange={setFilterTag}
                  suggestions={tagSuggestions}
                  placeholder="🔍 含 tag（精确）"
                  className="flex-1"
                />
                {filterTag && (
                  <button
                    onClick={() => setFilterTag('')}
                    className="btn btn-ghost btn-sm"
                    aria-label="清除 filter"
                  >
                    ✕
                  </button>
                )}
              </div>
            </header>
            <div className={`${SCROLL_BOX} p-2`}>
              <ImageGrid
                items={captionItems}
                selected={sel}
                onSelect={handleClick}
                ariaLabel="tag-edit-grid"
                emptyHint={
                  filterTag
                    ? `没有图含「${filterTag}」`
                    : '还没有图。先「② 筛选」拷过来 + 「③ 打标」生成 caption。'
                }
              />
            </div>
          </section>

          {/* tag 统计 */}
          <div className="min-h-0 min-w-0 flex">
            <TagStatsPanel
              cache={cache}
              selectedKeys={selectedKeys}
              onPickTag={handlePickTag}
            />
          </div>
        </div>

        {/* 右栏：单图编辑 */}
        <section style={{
          borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)',
          background: 'var(--bg-surface)', padding: 12,
          minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <h3 style={{
            margin: 0, fontSize: 'var(--t-sm)', fontWeight: 600, flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          }}>
            <span>单图编辑</span>
            {activeName && (
              <code style={{ fontSize: 'var(--t-xs)', fontFamily: 'var(--font-mono)', color: 'var(--fg-tertiary)' }}>
                {activeFolder}/{activeName}
              </code>
            )}
            {activeName && (
              <span style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)' }}>.{activeFormat}</span>
            )}
          </h3>
          {activeName ? (
            <div className="grid grid-rows-[3fr_auto_2fr] gap-2 flex-1 min-h-0">
              <div style={{ background: 'var(--bg-sunken)', borderRadius: 'var(--r-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
                <img
                  src={api.versionThumbUrl(project.id, activeVersion.id, 'train', activeName, activeFolder, 768)}
                  alt={activeName}
                  className="max-w-full max-h-full object-contain"
                />
              </div>
              <div className="flex items-center justify-center gap-2 shrink-0">
                <button onClick={() => navActive(-1)} disabled={navKeys.length === 0} aria-label="上一张" className="btn btn-secondary btn-sm">◀</button>
                <span style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)', width: 96, textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                  {activeIndex >= 0 ? `${activeIndex + 1} / ${navKeys.length}` : `– / ${navKeys.length}`}
                  <span style={{ marginLeft: 4, color: 'var(--border-default)' }}>
                    {selectedKeys.length > 0 ? '(选中)' : '(全部)'}
                  </span>
                </span>
                <button onClick={() => navActive(1)} disabled={navKeys.length === 0} aria-label="下一张" className="btn btn-secondary btn-sm">▶</button>
              </div>
              <div className="flex flex-col min-h-0">
                <TagEditor tags={activeTags} onChange={updateActiveTags} />
              </div>
            </div>
          ) : (
            <p style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-tertiary)', margin: 0 }}>
              alt + 点击左侧任一图查看 / 编辑标签（普通点击是多选）
            </p>
          )}
        </section>
      </div>
    </div>
    </StepShell>
  )
}
