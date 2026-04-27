import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type CaptionSnapshot } from '../api/client'
import { useToast } from './Toast'

interface Props {
  pid: number
  vid: number
  /** 待保存数：0 = 无 dirty。 */
  dirtyCount: number
  /** 触发保存：父组件提供 commit 实现（已经计算 diff）。 */
  onSave: () => Promise<void>
  /** 触发还原后，父组件需要重新拉缓存。 */
  onAfterRestore: () => Promise<void>
}

function fmtTime(epoch: number): string {
  const d = new Date(epoch * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtSize(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

export default function SaveBar({
  pid,
  vid,
  dirtyCount,
  onSave,
  onAfterRestore,
}: Props) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<CaptionSnapshot[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    try {
      setItems(await api.listCaptionSnapshots(pid, vid))
    } catch (e) {
      toast(String(e), 'error')
    }
  }, [pid, vid, toast])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      await onSave()
    } finally {
      setSaving(false)
    }
  }

  const restore = async (sid: string) => {
    if (
      !confirm(
        '还原会覆盖当前所有 caption（含未保存的本地改动）。确定？'
      )
    )
      return
    setBusyId(sid)
    try {
      const r = await api.restoreCaptionSnapshot(pid, vid, sid)
      toast(`已还原（写入 ${r.written}，删旧 ${r.removed_old}）`, 'success')
      await onAfterRestore()
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setBusyId(null)
    }
  }

  const del = async (sid: string) => {
    if (!confirm(`删除还原点 ${sid}？此操作不可撤销。`)) return
    setBusyId(sid)
    try {
      await api.deleteCaptionSnapshot(pid, vid, sid)
      await refresh()
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <div className="flex items-center gap-1">
        <button
          onClick={save}
          disabled={saving || dirtyCount === 0}
          className="px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs"
          title="把本地编辑写入磁盘；写之前自动生成还原点"
        >
          {saving
            ? '保存中...'
            : dirtyCount > 0
              ? `💾 保存（${dirtyCount}）`
              : '💾 已保存'}
        </button>
        <button
          onClick={() => setOpen(!open)}
          className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs"
        >
          🕒 还原点
        </button>
      </div>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-80 max-h-80 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-lg z-30"
          role="dialog"
          aria-label="snapshot-list"
        >
          {items.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-500">
              还没有还原点。每次「保存」会自动生成一个。
            </p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {items.map((s) => (
                <li
                  key={s.id}
                  className="px-3 py-2 text-xs flex items-center gap-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-slate-200">{fmtTime(s.created_at)}</div>
                    <div className="text-slate-500 text-[10px]">
                      {s.file_count} 文件 · {fmtSize(s.size)}
                    </div>
                  </div>
                  <button
                    onClick={() => restore(s.id)}
                    disabled={busyId === s.id}
                    className="px-2 py-0.5 rounded bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 text-white"
                  >
                    还原
                  </button>
                  <button
                    onClick={() => del(s.id)}
                    disabled={busyId === s.id}
                    className="px-1.5 py-0.5 rounded text-slate-500 hover:text-red-300"
                    aria-label="删除"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
