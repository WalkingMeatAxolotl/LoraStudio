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
  pid, vid, dirtyCount, onSave, onAfterRestore,
}: Props) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<CaptionSnapshot[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    try { setItems(await api.listCaptionSnapshots(pid, vid)) }
    catch (e) { toast(String(e), 'error') }
  }, [pid, vid, toast])

  useEffect(() => { if (open) void refresh() }, [open, refresh])

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const save = async () => {
    setSaving(true)
    try { await onSave() } finally { setSaving(false) }
  }

  const restore = async (sid: string) => {
    if (!confirm('还原会覆盖当前所有 caption（含未保存的本地改动）。确定？')) return
    setBusyId(sid)
    try {
      const r = await api.restoreCaptionSnapshot(pid, vid, sid)
      toast(`已还原（写入 ${r.written}，删旧 ${r.removed_old}）`, 'success')
      await onAfterRestore()
    } catch (e) { toast(String(e), 'error') }
    finally { setBusyId(null) }
  }

  const del = async (sid: string) => {
    if (!confirm(`删除还原点 ${sid}？此操作不可撤销。`)) return
    setBusyId(sid)
    try { await api.deleteCaptionSnapshot(pid, vid, sid); await refresh() }
    catch (e) { toast(String(e), 'error') }
    finally { setBusyId(null) }
  }

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button
          onClick={save}
          disabled={saving || dirtyCount === 0}
          className={dirtyCount > 0 ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
          title="把本地编辑写入磁盘；写之前自动生成还原点"
        >
          {saving ? '保存中…' : dirtyCount > 0 ? `💾 保存（${dirtyCount}）` : '💾 已保存'}
        </button>
        <button
          onClick={() => setOpen(!open)}
          className="btn btn-ghost btn-sm"
        >
          🕒 还原点
        </button>
      </div>

      {open && (
        <div
          role="dialog"
          aria-label="snapshot-list"
          style={{
            position: 'absolute', right: 0, top: 'calc(100% + 4px)',
            width: 320, maxHeight: 320, overflowY: 'auto',
            borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)',
            background: 'var(--bg-elevated)', boxShadow: 'var(--sh-xl)',
            zIndex: 30,
          }}
        >
          {items.length === 0 ? (
            <p style={{ padding: '12px 14px', fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)', margin: 0 }}>
              还没有还原点。每次「保存」会自动生成一个。
            </p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {items.map((s) => (
                <li
                  key={s.id}
                  style={{
                    padding: '8px 12px', fontSize: 'var(--t-xs)',
                    display: 'flex', alignItems: 'center', gap: 8,
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: 'var(--fg-primary)', fontFamily: 'var(--font-mono)' }}>
                      {fmtTime(s.created_at)}
                    </div>
                    <div style={{ color: 'var(--fg-tertiary)', fontSize: '10px', marginTop: 2 }}>
                      {s.file_count} 文件 · {fmtSize(s.size)}
                    </div>
                  </div>
                  <button
                    onClick={() => restore(s.id)}
                    disabled={busyId === s.id}
                    className="btn btn-primary btn-sm"
                  >
                    还原
                  </button>
                  <button
                    onClick={() => del(s.id)}
                    disabled={busyId === s.id}
                    className="btn btn-ghost btn-sm"
                    aria-label="删除"
                    style={{ color: 'var(--fg-tertiary)' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--err)' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--fg-tertiary)' }}
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
