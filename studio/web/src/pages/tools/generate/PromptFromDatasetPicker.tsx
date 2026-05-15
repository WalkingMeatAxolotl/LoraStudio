import { useEffect, useMemo, useState } from 'react'
import { api, type CaptionEntry, type ProjectSummary } from '../../../api/client'
import { useLocalStorageState } from '../../../lib/useLocalStorageState'

// 命名前缀对齐 useAdvancedMode 的 `studio:` 约定（PR #66 P1-4）。旧的
// `anima.generate.promptDataset.*` key 在 mount 时 migrate 一次后丢弃。
const LAST_PROJECT_KEY = 'studio:generate:promptDataset:projectId'
const LAST_VERSION_KEY = 'studio:generate:promptDataset:versionId'
const LEGACY_PROJECT_KEY = 'anima.generate.promptDataset.projectId'
const LEGACY_VERSION_KEY = 'anima.generate.promptDataset.versionId'

function migrateLegacyKey(legacyKey: string, newKey: string): void {
  if (typeof window === 'undefined') return
  if (window.localStorage.getItem(newKey) !== null) return
  const raw = window.localStorage.getItem(legacyKey)
  if (raw === null) return
  const n = Number(raw)
  if (Number.isFinite(n)) {
    window.localStorage.setItem(newKey, JSON.stringify(n))
  }
  window.localStorage.removeItem(legacyKey)
}

/** 从训练集 caption 里选一条，把 tags 拿到生成 prompt 里。
 *
 * 流程：选项目 → 选版本 → 列 captions → 单选 → 「追加」/「替换」。
 * 保留 inline 展开（不弹 modal），跟 LoRA picker 一致。
 */
export default function PromptFromDatasetPicker({
  onAppend, onReplace, onClose,
}: {
  /** 把选中 caption 的 tags 追加到当前 prompt 末尾 */
  onAppend: (tags: string[]) => void
  /** 用 tags 替换整个 prompt */
  onReplace: (tags: string[]) => void
  onClose: () => void
}) {
  // 一次性 migrate 旧 anima.* key 到 studio: 命名（PR #66 P1-4 约定）；module 顶部
  // 调用即可，没必要进 useEffect —— 没读 / 写 React state 副作用，只动 localStorage。
  if (typeof window !== 'undefined') {
    migrateLegacyKey(LEGACY_PROJECT_KEY, LAST_PROJECT_KEY)
    migrateLegacyKey(LEGACY_VERSION_KEY, LAST_VERSION_KEY)
  }

  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [pid, setPid] = useLocalStorageState<number | null>(LAST_PROJECT_KEY, null)
  const [vid, setVid] = useLocalStorageState<number | null>(LAST_VERSION_KEY, null)
  const [versions, setVersions] = useState<Array<{ id: number; label: string }>>([])
  const [captions, setCaptions] = useState<CaptionEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // 1. 拉项目列表；若上次记的 pid 在新项目列表中不存在则清掉避免幽灵选择
  useEffect(() => {
    void api.listProjects()
      .then((items) => {
        setProjects(items)
        if (pid != null && !items.some((p) => p.id === pid)) setPid(null)
      })
      .catch((e) => setError(String(e)))
    // pid 进依赖会触发反复拉项目；mount 一次就够
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 2. 选项目后拉版本列表；优先复用 vid（如果该版本在新项目里仍存在）
  useEffect(() => {
    if (!pid) { setVersions([]); setVid(null); return }
    void api.getProject(pid)
      .then((p) => {
        const vs = p.versions.map((v) => ({ id: v.id, label: v.label }))
        setVersions(vs)
        if (vid != null && vs.some((v) => v.id === vid)) return  // 旧 vid 仍在 → 保留
        setVid(vs.length > 0 ? vs[0].id : null)
      })
      .catch((e) => setError(String(e)))
    // 同上：vid 只在 effect 内部读，不进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid])

  // 3. 选版本后拉 captions
  useEffect(() => {
    if (!pid || !vid) { setCaptions([]); return }
    setLoading(true)
    setError(null)
    void api.listCaptionsFull(pid, vid)
      .then((r) => { setCaptions(r.items); setLoading(false) })
      .catch((e) => { setError(String(e)); setLoading(false) })
  }, [pid, vid])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return captions
    return captions.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      c.tags.some((t) => t.toLowerCase().includes(q))
    )
  }, [captions, search])

  const selected = filtered.find((c) => `${c.folder}/${c.name}` === selectedKey)

  return (
    <div
      className="rounded-md border border-subtle bg-overlay p-2.5 flex flex-col gap-2"
      data-testid="prompt-dataset-picker"
    >
      {/* header */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-fg-secondary shrink-0">从训练集选 prompt</span>
        <span className="flex-1" />
        <button
          onClick={onClose}
          className="btn btn-ghost btn-sm text-fg-tertiary px-1.5"
          title="关闭"
          aria-label="关闭"
        >
          ×
        </button>
      </div>

      {/* project / version 选择 */}
      <div className="flex gap-2">
        <select
          className="input text-xs flex-1"
          value={pid ?? ''}
          onChange={(e) => setPid(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">选项目…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.title}</option>
          ))}
        </select>
        <select
          className="input text-xs flex-1"
          value={vid ?? ''}
          onChange={(e) => setVid(e.target.value ? Number(e.target.value) : null)}
          disabled={versions.length === 0}
        >
          <option value="">选版本…</option>
          {versions.map((v) => (
            <option key={v.id} value={v.id}>{v.label}</option>
          ))}
        </select>
      </div>

      {/* search */}
      <input
        type="text"
        className="input text-xs"
        placeholder="搜索文件名 / tag…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        disabled={!pid || !vid || captions.length === 0}
      />

      {error && <div className="text-2xs text-err">{error}</div>}

      {/* caption 列表 */}
      <div className="flex flex-col gap-px overflow-y-auto" style={{ maxHeight: 280 }}>
        {loading && <div className="text-2xs text-fg-tertiary">加载中…</div>}
        {!loading && pid && vid && captions.length === 0 && (
          <div className="text-2xs text-fg-tertiary">该版本没有 caption</div>
        )}
        {!loading && filtered.map((c) => {
          const k = `${c.folder}/${c.name}`
          const active = selectedKey === k
          return (
            <button
              key={k}
              onClick={() => setSelectedKey(active ? null : k)}
              className="flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left border-none transition-colors"
              style={{
                background: active ? 'var(--accent-soft)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--fg-secondary)',
                cursor: 'pointer',
              }}
            >
              <span className="font-mono text-2xs shrink-0">{active ? '✓' : '+'}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{c.name}</div>
                <div className="text-2xs text-fg-tertiary truncate">
                  {c.tags.slice(0, 6).join(', ')}{c.tags.length > 6 ? ` (+${c.tags.length - 6})` : ''}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* 选中预览 + 操作 */}
      {selected && (
        <>
          <div
            className="rounded-sm border border-subtle bg-sunken px-2 py-1.5 text-xs font-mono whitespace-pre-wrap"
            style={{ maxHeight: 100, overflowY: 'auto' }}
          >
            {selected.tags.join(', ')}
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { onReplace(selected.tags); onClose() }}
              className="btn btn-ghost btn-sm text-xs"
            >
              替换当前提示词
            </button>
            <button
              onClick={() => { onAppend(selected.tags); onClose() }}
              className="btn btn-primary btn-sm text-xs"
            >
              追加到当前提示词
            </button>
          </div>
        </>
      )}
    </div>
  )
}
