import { useEffect, useMemo, useState } from 'react'
import { api, type LoraCkpt } from '../../../api/client'
import type { ProjectLora } from './types'

/** 项目缩写图标（2 字符 uppercase，从 title 提字母数字派生）。LoraCard 仍引用。 */
export function projectAbbr(title: string): string {
  const cleaned = title.replace(/[^a-zA-Z0-9]/g, '')
  return (cleaned.slice(0, 2) || '??').toUpperCase()
}

export interface PickedLora {
  path: string
  projectId: number | null
  versionId: number | null
}

/** 内嵌 LoRA 选择器：项目 + 版本下拉 → 列该 version 下的 ckpt 文件 → 单选 / 多选 + 权重。
 *
 * 样式 / 逻辑参照 PromptFromDatasetPicker，只多一个权重 slider。
 * - multi=true（默认，单 LoRA 区用）：toggle 多选 + 权重 + 「添加 N 个」按钮一次性 bulk add
 * - multi=false（XY 轴绑定用）：单击即选即关，无权重 footer（轴卡片有自己的 scale 列）
 *
 * existingPaths 表示 caller loras[] 里已有的 path，显示为 ✓ 禁用（避免重复添加）。
 */
export default function InlineLoraPicker({
  projectLoras,
  existingPaths,
  onPick,
  onClose,
  onPickExternal,
  multi = true,
  defaultWeight = 1.0,
}: {
  projectLoras: ProjectLora[]
  existingPaths: Set<string>
  onPick: (picks: PickedLora[], weight: number) => void
  onClose: () => void
  onPickExternal?: () => void
  multi?: boolean
  defaultWeight?: number
}) {
  // 项目下拉：projectLoras 去重 by projectId
  const projects = useMemo(() => {
    const map = new Map<number, { id: number; title: string }>()
    for (const l of projectLoras) {
      if (!map.has(l.projectId)) map.set(l.projectId, { id: l.projectId, title: l.projectTitle })
    }
    return Array.from(map.values())
  }, [projectLoras])

  const [pid, setPid] = useState<number | null>(() => projects[0]?.id ?? null)

  // 版本下拉：当前 pid 下的 versions
  const versions = useMemo(() => {
    if (pid === null) return []
    return projectLoras
      .filter((l) => l.projectId === pid)
      .map((l) => ({ id: l.versionId, label: l.versionLabel, stage: l.stage }))
  }, [projectLoras, pid])

  const [vid, setVid] = useState<number | null>(() => {
    const first = projectLoras.find((l) => l.projectId === projects[0]?.id)
    return first?.versionId ?? null
  })

  // pid 变化时校准 vid（不在当前 versions 里就重置到第一个）
  useEffect(() => {
    if (versions.length === 0) {
      setVid(null)
    } else if (!versions.some((v) => v.id === vid)) {
      setVid(versions[0].id)
    }
  }, [versions, vid])

  // 拉 ckpt
  const [ckpts, setCkpts] = useState<LoraCkpt[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (pid === null || vid === null) {
      setCkpts([])
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void api.listVersionLoraCkpts(pid, vid)
      .then((items) => {
        if (cancelled) return
        setCkpts(items)
        setLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setCkpts([])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [pid, vid])

  // 搜索过滤（ckpt label / 文件名后缀）
  const [search, setSearch] = useState('')
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return ckpts
    return ckpts.filter((c) =>
      c.label.toLowerCase().includes(q) || c.path.toLowerCase().includes(q)
    )
  }, [ckpts, search])

  // 当前会话选中（multi 模式）
  const [picked, setPicked] = useState<Set<string>>(new Set())
  // pid/vid 切换时清空选择
  useEffect(() => { setPicked(new Set()) }, [pid, vid])

  const [weight, setWeight] = useState<number>(defaultWeight)

  // 当前 version 标签 + stage（用于训练中 badge）
  const currentVersion = versions.find((v) => v.id === vid)

  const togglePick = (path: string) => {
    if (existingPaths.has(path)) return
    if (!multi) {
      // 单选：立即触发 onPick + 关闭
      onPick([{ path, projectId: pid, versionId: vid }], weight)
      onClose()
      return
    }
    setPicked((s) => {
      const next = new Set(s)
      if (next.has(path)) next.delete(path); else next.add(path)
      return next
    })
  }

  const commitMulti = () => {
    if (picked.size === 0) return
    const picks: PickedLora[] = Array.from(picked).map((path) => ({
      path,
      projectId: pid,
      versionId: vid,
    }))
    onPick(picks, weight)
    onClose()
  }

  return (
    <div
      className="rounded-md border border-subtle bg-overlay p-2.5 flex flex-col gap-2"
      data-testid="inline-lora-picker"
    >
      {/* header */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-fg-secondary shrink-0">选 LoRA</span>
        <span className="flex-1" />
        {onPickExternal && (
          <button
            onClick={onPickExternal}
            className="btn btn-ghost btn-sm text-2xs text-fg-tertiary"
            title="选系统中任意 .safetensors 文件"
          >
            外部文件
          </button>
        )}
        <button
          onClick={onClose}
          className="btn btn-ghost btn-sm text-fg-tertiary px-1.5"
          title="关闭"
          aria-label="关闭挑选区"
        >
          ×
        </button>
      </div>

      {/* project / version 下拉 */}
      <div className="flex gap-2">
        <select
          className="input text-xs flex-1"
          value={pid ?? ''}
          onChange={(e) => setPid(e.target.value ? Number(e.target.value) : null)}
          aria-label="选项目"
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
          aria-label="选版本"
        >
          <option value="">选版本…</option>
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}{v.stage === 'training' ? '（训练中）' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* search */}
      <input
        type="text"
        className="input text-xs"
        placeholder="搜索 ckpt 文件名…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        disabled={!pid || !vid || ckpts.length === 0}
      />

      {error && <div className="text-2xs text-err">{error}</div>}
      {currentVersion?.stage === 'training' && (
        <div className="text-2xs text-fg-tertiary">
          <span className="badge badge-info" style={{ fontSize: 10, marginRight: 4 }}>训练中</span>
          ckpt 列表会随训练进度刷新
        </div>
      )}

      {/* ckpt 列表 */}
      <div className="flex flex-col gap-px overflow-y-auto" style={{ maxHeight: 280 }}>
        {loading && <div className="text-2xs text-fg-tertiary px-2 py-2">加载中…</div>}
        {!loading && projects.length === 0 && (
          <div className="text-fg-tertiary text-xs px-2 py-4 text-center">
            还没有训练好的 LoRA —— 先去训练一个{onPickExternal ? '，或用「外部文件」' : ''}
          </div>
        )}
        {!loading && projects.length > 0 && pid !== null && vid !== null && ckpts.length === 0 && !error && (
          <div className="text-2xs text-fg-tertiary px-2 py-4 text-center">
            该版本没扫到 ckpt 文件（output/ 下需 *.safetensors）
          </div>
        )}
        {!loading && filtered.map((c) => {
          const isExisting = existingPaths.has(c.path)
          const isPicked = picked.has(c.path)
          const marker = isExisting ? '✓' : (isPicked ? '✓' : '+')
          return (
            <button
              key={c.path}
              onClick={() => togglePick(c.path)}
              disabled={isExisting}
              className="flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left border-none transition-colors"
              style={{
                background: isExisting
                  ? 'var(--bg-sunken)'
                  : (isPicked ? 'var(--accent-soft)' : 'transparent'),
                color: isExisting
                  ? 'var(--fg-tertiary)'
                  : (isPicked ? 'var(--accent)' : 'var(--fg-secondary)'),
                cursor: isExisting ? 'not-allowed' : 'pointer',
              }}
              title={c.path}
            >
              <span className="font-mono text-2xs shrink-0">{marker}</span>
              <div className="flex-1 min-w-0 flex items-center gap-2">
                <span className="font-medium">{c.label}</span>
                <span className="text-2xs text-fg-tertiary font-mono truncate">{c.path.split(/[\\/]/).pop()}</span>
              </div>
              {isExisting && (
                <span className="text-2xs text-fg-tertiary shrink-0">已添加</span>
              )}
            </button>
          )
        })}
        {!loading && ckpts.length > 0 && filtered.length === 0 && (
          <div className="text-fg-tertiary text-xs px-2 py-4 text-center">没有匹配的 ckpt</div>
        )}
      </div>

      {/* multi 模式的权重 + 提交 footer */}
      {multi && picked.size > 0 && (
        <>
          <div className="flex items-center gap-2 pt-1" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <span
              className="font-mono text-fg-tertiary shrink-0"
              style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}
            >
              权重
            </span>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.05}
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value))}
              className="flex-1"
              aria-label="新 LoRA 默认权重"
              style={{ accentColor: 'var(--accent)' }}
            />
            <input
              type="number"
              min={0}
              max={1.5}
              step={0.05}
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value))}
              className="input font-mono text-center"
              style={{ width: 54, padding: '3px 6px', fontSize: 12 }}
              aria-label="新 LoRA 权重数值"
            />
          </div>
          <div className="flex items-center gap-2 justify-end">
            <span className="text-2xs text-fg-tertiary mr-auto">已选 {picked.size}</span>
            <button
              onClick={() => setPicked(new Set())}
              className="btn btn-ghost btn-sm text-xs"
            >
              取消
            </button>
            <button
              onClick={commitMulti}
              className="btn btn-primary btn-sm text-xs"
            >
              添加 {picked.size} 个
            </button>
          </div>
        </>
      )}
    </div>
  )
}
