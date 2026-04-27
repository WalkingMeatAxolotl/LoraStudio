import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  api,
  type CurationView,
  type ProjectDetail,
  type Version,
} from '../../../api/client'
import ImageGrid, { applySelection } from '../../../components/ImageGrid'
import ImagePreviewModal from '../../../components/ImagePreviewModal'
import { useToast } from '../../../components/Toast'
import { useEventStream } from '../../../lib/useEventStream'

interface Ctx {
  project: ProjectDetail
  activeVersion: Version | null
  reload: () => Promise<void>
}

interface Preview {
  url: string
  caption: string
  list: string[]
  index: number
  resolve: (name: string) => string
}

type Focus =
  | { side: 'left'; name: string; url: string }
  | { side: 'right'; folder: string; name: string; url: string }

const FOLDER_PATTERN = /^([0-9]+_)?[A-Za-z][A-Za-z0-9_-]*$/

// 网格内部滚动：让面板撑满外层可用高度（外层是 flex-col h-full），
// 页面头 / 共享预览 / 面板 header 不动，仅图片区域滚。
const SCROLL_BOX = 'flex-1 min-h-0 overflow-y-auto pr-1'

export default function CurationPage() {
  const { project, activeVersion, reload } = useOutletContext<Ctx>()
  const { toast } = useToast()
  const [view, setView] = useState<CurationView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 选中状态
  const [leftSel, setLeftSel] = useState<Set<string>>(new Set())
  const [leftAnchor, setLeftAnchor] = useState<string | null>(null)
  const [rightFolder, setRightFolder] = useState<string>('')
  const [rightSel, setRightSel] = useState<Set<string>>(new Set())
  const [rightAnchor, setRightAnchor] = useState<string | null>(null)

  // 共享大图预览
  const [focus, setFocus] = useState<Focus | null>(null)

  // 复制目标 = rightFolder（当前查看的就是复制目标），不再单独维护。
  const [newFolder, setNewFolder] = useState<string>('')
  const [renaming, setRenaming] = useState<{
    target: string
    value: string
  } | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)

  const versionId = activeVersion?.id ?? null

  const refresh = useCallback(async () => {
    if (versionId == null) return
    try {
      const v = await api.getCuration(project.id, versionId)
      setView(v)
      setError(null)
      const fallback = v.folders.includes('1_data')
        ? '1_data'
        : v.folders[0] ?? ''
      if (!rightFolder || !v.folders.includes(rightFolder)) {
        setRightFolder(fallback)
        setRightSel(new Set())
        setRightAnchor(null)
      }
    } catch (e) {
      setError(String(e))
    }
  }, [project.id, versionId, rightFolder])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEventStream((evt) => {
    if (
      evt.type === 'version_state_changed' &&
      evt.project_id === project.id &&
      versionId != null &&
      evt.version_id === versionId
    ) {
      void refresh()
    }
  })

  const folderNames = view?.folders ?? []
  const trainList = (view && rightFolder ? view.right[rightFolder] : []) ?? []

  const leftItems = useMemo(
    () =>
      (view?.left ?? []).map((n) => ({
        name: n,
        thumbUrl: api.projectThumbUrl(project.id, n),
      })),
    [view, project.id]
  )
  const rightItems = useMemo(
    () =>
      versionId == null
        ? []
        : trainList.map((n) => ({
            name: n,
            thumbUrl: api.versionThumbUrl(
              project.id,
              versionId,
              'train',
              n,
              rightFolder
            ),
          })),
    [trainList, project.id, versionId, rightFolder]
  )

  // 大图预览用 768px 缓存版本（足够清晰，文件比原图小一两个数量级）
  // 这两个 useCallback 必须在所有 early-return 之前调用，否则不同 render
  // 之间 hook 数量会变 → React #310。
  const onLeftHover = useCallback(
    (name: string) =>
      setFocus({
        side: 'left',
        name,
        url: api.projectThumbUrl(project.id, name, 'download', 768),
      }),
    [project.id]
  )

  const onRightHover = useCallback(
    (name: string) => {
      if (versionId == null || !rightFolder) return
      setFocus({
        side: 'right',
        folder: rightFolder,
        name,
        url: api.versionThumbUrl(
          project.id,
          versionId,
          'train',
          name,
          rightFolder,
          768
        ),
      })
    },
    [versionId, project.id, rightFolder]
  )

  if (!activeVersion) {
    return (
      <p className="text-slate-500">
        请先选择 / 创建一个版本（左上 VersionTabs）
      </p>
    )
  }
  if (error) {
    return (
      <div className="p-3 rounded bg-red-900/40 border border-red-700 text-red-300 font-mono text-sm">
        {error}
      </div>
    )
  }
  if (!view) return <p className="text-slate-500">加载...</p>

  const switchRightFolder = (next: string) => {
    setRightFolder(next)
    setRightSel(new Set())
    setRightAnchor(null)
  }

  // ---------- handlers ----------
  const handleLeftClick = (name: string, e: React.MouseEvent) => {
    const r = applySelection(leftSel, name, e, view.left, leftAnchor)
    setLeftSel(r.next)
    setLeftAnchor(r.anchor)
  }

  const handleRightClick = (name: string, e: React.MouseEvent) => {
    const r = applySelection(rightSel, name, e, trainList, rightAnchor)
    setRightSel(r.next)
    setRightAnchor(r.anchor)
  }

  const togglePreviewSelection = () => {
    if (!focus) return
    if (focus.side === 'left') {
      const r = applySelection(
        leftSel,
        focus.name,
        { shiftKey: false } as React.MouseEvent,
        view.left,
        leftAnchor
      )
      setLeftSel(r.next)
      setLeftAnchor(r.anchor)
    } else {
      // 预览的 folder 可能不是当前查看的 folder（用户切了 folder 但 focus 还指旧的）
      // 这种情况下提示用户先切回去；正常情况 folder == rightFolder
      if (focus.folder !== rightFolder) return
      const r = applySelection(
        rightSel,
        focus.name,
        { shiftKey: false } as React.MouseEvent,
        trainList,
        rightAnchor
      )
      setRightSel(r.next)
      setRightAnchor(r.anchor)
    }
  }

  const previewIsSelected = focus
    ? focus.side === 'left'
      ? leftSel.has(focus.name)
      : focus.folder === rightFolder && rightSel.has(focus.name)
    : false

  // ---------- copy / remove / folder ops ----------
  const doCopy = async () => {
    if (!rightFolder) return toast('请先在右侧 Train 选一个文件夹', 'error')
    if (!FOLDER_PATTERN.test(rightFolder))
      return toast('文件夹名非法', 'error')
    if (leftSel.size === 0) return
    setBusy(true)
    try {
      const r = await api.copyToTrain(project.id, activeVersion.id, {
        files: Array.from(leftSel),
        dest_folder: rightFolder,
      })
      toast(
        `已复制 ${r.copied.length} 张${
          r.skipped.length ? `（跳过 ${r.skipped.length}）` : ''
        }`,
        'success'
      )
      setLeftSel(new Set())
      await refresh()
      await reload()
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const doRemove = async () => {
    if (!rightFolder || rightSel.size === 0) return
    if (!confirm(`从 ${rightFolder}/ 移除 ${rightSel.size} 张?`)) return
    setBusy(true)
    try {
      const r = await api.removeFromTrain(project.id, activeVersion.id, {
        folder: rightFolder,
        files: Array.from(rightSel),
      })
      toast(`已移除 ${r.removed.length} 张`, 'success')
      setRightSel(new Set())
      await refresh()
      await reload()
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const doCreateFolder = async () => {
    const name = newFolder.trim()
    if (!name) return
    if (!FOLDER_PATTERN.test(name)) return toast('文件夹名非法', 'error')
    setBusy(true)
    try {
      await api.folderOp(project.id, activeVersion.id, {
        op: 'create',
        name,
      })
      setNewFolder('')
      switchRightFolder(name)
      await refresh()
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const doRenameFolder = async () => {
    if (!renaming) return
    const target = renaming.target
    const next = renaming.value.trim()
    if (!next || next === target) {
      setRenaming(null)
      return
    }
    if (!FOLDER_PATTERN.test(next)) return toast('文件夹名非法', 'error')
    setBusy(true)
    try {
      await api.folderOp(project.id, activeVersion.id, {
        op: 'rename',
        name: target,
        new_name: next,
      })
      if (rightFolder === target) switchRightFolder(next)
      setRenaming(null)
      toast(`${target} → ${next}`, 'success')
      await refresh()
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const doDeleteFolder = async (name: string) => {
    const cnt = view.right[name]?.length ?? 0
    if (
      !confirm(
        `删除文件夹 ${name}? 将清掉 ${cnt} 张训练副本（download/ 不动）`
      )
    )
      return
    setBusy(true)
    try {
      await api.folderOp(project.id, activeVersion.id, {
        op: 'delete',
        name,
      })
      if (rightFolder === name) switchRightFolder('')
      await refresh()
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  // ---------- modal preview ----------
  const openLeftPreview = (name: string) => {
    setPreview({
      url: api.projectThumbUrl(project.id, name),
      caption: name,
      list: view.left,
      index: view.left.indexOf(name),
      resolve: (n) => api.projectThumbUrl(project.id, n),
    })
  }
  const openRightPreview = (name: string) => {
    if (versionId == null) return
    setPreview({
      url: api.versionThumbUrl(
        project.id,
        versionId,
        'train',
        name,
        rightFolder
      ),
      caption: `${rightFolder}/${name}`,
      list: trainList,
      index: trainList.indexOf(name),
      resolve: (n) =>
        api.versionThumbUrl(project.id, versionId, 'train', n, rightFolder),
    })
  }
  const stepPreview = (delta: number) => {
    if (!preview) return
    const idx = preview.index + delta
    if (idx < 0 || idx >= preview.list.length) return
    const name = preview.list[idx]
    setPreview({
      ...preview,
      url: preview.resolve(name),
      caption: name,
      index: idx,
    })
  }

  return (
    <div className="flex flex-col h-full w-full gap-3">
      {/* 标题压缩成单行：题号 + 步骤 + 一句说明 */}
      <header className="flex items-baseline gap-2 flex-wrap shrink-0">
        <h2 className="text-base font-semibold">② 筛选</h2>
        <span className="text-xs text-slate-500">
          download → train · download 永远保留，复制/移除只动 train 副本
        </span>
      </header>

      {/* 三列同行：预览（630，比之前的 420 宽 50%）+ Download + Train（剩余平分）。
       * flex-1 min-h-0 让这一行吃掉剩余可视高度，配合面板内部 SCROLL_BOX flex-1，
       * 缩略图区会自动延伸到屏幕底部。 */}
      <div className="grid grid-cols-1 xl:grid-cols-[630px_1fr_1fr] gap-3 items-stretch flex-1 min-h-0">
        <SharedPreview
          focus={focus}
          isSelected={previewIsSelected}
          onToggle={focus ? togglePreviewSelection : undefined}
        />
        <PanelCard
          accent="emerald"
          title="Download — 全量备份"
          subtitle={`${view.left.length} 未用 / ${view.download_total} 全量 · 已选 ${leftSel.size}`}
          actions={
            <>
              <BtnSecondary
                onClick={() => setLeftSel(new Set(view.left))}
                disabled={busy || view.left.length === 0}
              >
                全选
              </BtnSecondary>
              <BtnSecondary
                onClick={() => setLeftSel(new Set())}
                disabled={busy || leftSel.size === 0}
              >
                清空
              </BtnSecondary>
              <BtnPrimary
                onClick={doCopy}
                disabled={busy || leftSel.size === 0 || !rightFolder}
                title={
                  rightFolder
                    ? `复制到 train/${rightFolder}/`
                    : '请先在右侧 Train 选一个文件夹'
                }
              >
                → 复制 {leftSel.size} → {rightFolder || '?'}
              </BtnPrimary>
            </>
          }
        >
          <div className={SCROLL_BOX}>
            <ImageGrid
              items={leftItems}
              selected={leftSel}
              onSelect={handleLeftClick}
              onHover={onLeftHover}
              onPreview={openLeftPreview}
              ariaLabel="download-grid"
              emptyHint="download/ 已经全部用完，或还没下载"
            />
          </div>
        </PanelCard>

        <PanelCard
          accent="cyan"
          title="Train — 当前版本"
          subtitle={`${view.train_total} 张 · ${folderNames.length} 个文件夹 · 已选 ${rightSel.size}`}
          actions={
            <>
              <input
                value={newFolder}
                onChange={(e) => setNewFolder(e.target.value)}
                placeholder="+ 新建:5_concept"
                className="px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs w-36"
              />
              <BtnSecondary
                onClick={doCreateFolder}
                disabled={busy || !newFolder.trim()}
              >
                创建
              </BtnSecondary>
              <BtnSecondary
                onClick={() => setRightSel(new Set(trainList))}
                disabled={busy || trainList.length === 0}
              >
                全选
              </BtnSecondary>
              <BtnSecondary
                onClick={() => setRightSel(new Set())}
                disabled={busy || rightSel.size === 0}
              >
                清空
              </BtnSecondary>
              <BtnDanger
                onClick={doRemove}
                disabled={busy || rightSel.size === 0 || !rightFolder}
              >
                ← 移除 {rightSel.size}
              </BtnDanger>
            </>
          }
        >
          {/* 文件夹 chip 行：active = 当前查看 = 复制目标；hover 显示 ✎/× */}
          <FolderSummary
            folders={folderNames}
            counts={Object.fromEntries(
              folderNames.map((f) => [f, view.right[f]?.length ?? 0])
            )}
            activeFolder={rightFolder}
            busy={busy}
            onSwitch={switchRightFolder}
            onRename={(name) => setRenaming({ target: name, value: name })}
            onDelete={doDeleteFolder}
          />

          {renaming && (
            <div className="flex items-center gap-2 my-3 text-xs">
              <span className="text-slate-400">改名 {renaming.target} →</span>
              <input
                autoFocus
                value={renaming.value}
                onChange={(e) =>
                  setRenaming({ ...renaming, value: e.target.value })
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') doRenameFolder()
                  if (e.key === 'Escape') setRenaming(null)
                }}
                className="px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs w-44"
              />
              <BtnPrimary onClick={doRenameFolder} disabled={busy}>
                确认
              </BtnPrimary>
              <button
                onClick={() => setRenaming(null)}
                className="text-xs px-2 py-1 rounded text-slate-400 hover:text-slate-200"
              >
                取消
              </button>
            </div>
          )}

          <div className={`${SCROLL_BOX} mt-3`}>
            <ImageGrid
              items={rightItems}
              selected={rightSel}
              onSelect={handleRightClick}
              onHover={onRightHover}
              onPreview={openRightPreview}
              ariaLabel="train-grid"
              emptyHint={
                rightFolder
                  ? `${rightFolder}/ 还是空的`
                  : '上方点一个文件夹 chip 切换查看'
              }
            />
          </div>
        </PanelCard>
      </div>

      {preview && (
        <ImagePreviewModal
          src={preview.url}
          caption={preview.caption}
          hasPrev={preview.index > 0}
          hasNext={preview.index < preview.list.length - 1}
          onClose={() => setPreview(null)}
          onPrev={() => stepPreview(-1)}
          onNext={() => stepPreview(1)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 子组件
// ---------------------------------------------------------------------------

function FolderSummary({
  folders,
  counts,
  activeFolder,
  busy,
  onSwitch,
  onRename,
  onDelete,
}: {
  folders: string[]
  counts: Record<string, number>
  activeFolder: string
  busy: boolean
  onSwitch: (name: string) => void
  onRename: (name: string) => void
  onDelete: (name: string) => void
}) {
  if (folders.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        还没有训练文件夹（默认应有 1_data，可在右上「+ 新建」）
      </p>
    )
  }
  const total = folders.reduce((s, f) => s + (counts[f] ?? 0), 0)
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {folders.map((f) => {
        const isActive = f === activeFolder
        return (
          <span
            key={f}
            className={
              'group inline-flex items-center rounded border transition-colors ' +
              (isActive
                ? 'border-cyan-600 bg-cyan-950/30'
                : 'border-slate-700 bg-slate-900/40 hover:border-slate-500')
            }
          >
            <button
              onClick={() => onSwitch(f)}
              title={
                isActive ? '当前查看（也是复制目标）' : '点击切换查看 + 复制目标'
              }
              className={
                'px-2 py-1 ' +
                (isActive
                  ? 'text-cyan-200'
                  : 'text-slate-300 hover:text-slate-100')
              }
            >
              <span className="font-mono">{f}</span>
              <span className="text-slate-500"> ({counts[f] ?? 0})</span>
            </button>
            <button
              onClick={() => onRename(f)}
              disabled={busy}
              title="改名"
              className="px-1 py-1 text-[10px] text-slate-600 opacity-0 group-hover:opacity-100 hover:text-slate-200"
            >
              ✎
            </button>
            <button
              onClick={() => onDelete(f)}
              disabled={busy}
              title="删除文件夹"
              className="px-1 py-1 text-[10px] text-slate-600 opacity-0 group-hover:opacity-100 hover:text-red-400"
            >
              ×
            </button>
          </span>
        )
      })}
      <span className="text-slate-500 ml-2">总 {total} 张</span>
    </div>
  )
}

function SharedPreview({
  focus,
  isSelected,
  onToggle,
}: {
  focus: Focus | null
  isSelected: boolean
  onToggle?: () => void
}) {
  const sourceLabel =
    focus?.side === 'left'
      ? 'download'
      : focus?.side === 'right'
        ? `train / ${focus.folder}`
        : '—'
  return (
    <div
      className="rounded-lg border border-slate-700 bg-slate-900/60 flex flex-col overflow-hidden"
      title="点击缩略图 = 切换选中 · shift+点击 = 区间多选 · ⤢ = 全屏预览"
    >
      {/* 图片：占满列高（min-h-[420px] 保证小屏也看得清） */}
      <div className="flex-1 min-h-[420px] bg-black/40 flex items-center justify-center">
        {focus ? (
          <img
            src={focus.url}
            alt={focus.name}
            className="max-w-full max-h-full object-contain"
          />
        ) : (
          <span className="text-xs text-slate-600">悬停缩略图查看大图</span>
        )}
      </div>
      {/* 底部 info bar：source / 文件名 / 选中按钮，单行 */}
      <div className="border-t border-slate-700 px-2 py-2 flex items-center gap-2 text-xs">
        <span
          className={
            'text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 ' +
            (focus?.side === 'left'
              ? 'bg-emerald-700/40 text-emerald-200'
              : focus?.side === 'right'
                ? 'bg-cyan-700/40 text-cyan-200'
                : 'bg-slate-700/60 text-slate-500')
          }
        >
          {sourceLabel}
        </span>
        <code className="text-slate-200 truncate flex-1 min-w-0">
          {focus?.name ?? '—'}
        </code>
        {focus && onToggle && (
          <button
            onClick={onToggle}
            className={
              'px-2.5 py-1 rounded shrink-0 text-xs ' +
              (isSelected
                ? 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                : 'bg-cyan-600 hover:bg-cyan-500 text-white')
            }
          >
            {isSelected ? '✓ 已选' : '加入选中'}
          </button>
        )}
      </div>
    </div>
  )
}

const ACCENT_BAR: Record<'emerald' | 'cyan', string> = {
  emerald: 'bg-emerald-500/70',
  cyan: 'bg-cyan-500/70',
}

function PanelCard({
  accent,
  title,
  subtitle,
  actions,
  children,
}: {
  accent: 'emerald' | 'cyan'
  title: string
  subtitle: string
  actions: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-slate-700 bg-slate-800/30 overflow-hidden flex flex-col min-h-0">
      <div className={`h-0.5 w-full ${ACCENT_BAR[accent]}`} />
      <header className="px-3 py-1.5 border-b border-slate-700 flex flex-wrap items-center gap-1.5">
        <h3 className="text-xs font-semibold text-slate-100">{title}</h3>
        <span className="text-[11px] text-slate-500">{subtitle}</span>
        <span className="flex-1" />
        {actions}
      </header>
      <div className="p-2 flex-1 min-h-0 flex flex-col">{children}</div>
    </section>
  )
}

function BtnPrimary({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className="text-xs px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500"
    >
      {children}
    </button>
  )
}

function BtnSecondary({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-500"
    >
      {children}
    </button>
  )
}

function BtnDanger({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className="text-xs px-3 py-1 rounded bg-red-700/80 hover:bg-red-600 disabled:bg-slate-700 disabled:text-slate-500"
    >
      {children}
    </button>
  )
}
