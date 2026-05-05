import { useEffect, useState } from 'react'
import { api, type BrowseResult } from '../api/client'

interface Props {
  initialPath?: string
  /** true: 只允许选目录；false: 文件也能选 */
  dirOnly?: boolean
  onPick: (path: string) => void
  onClose: () => void
}

/**
 * 模态目录浏览器：通过 /api/browse 拉条目，点目录进入，点文件（或当前目录）选中。
 * 仅允许 REPO_ROOT 下浏览（后端强制）。
 */
export default function PathPicker({
  initialPath,
  dirOnly = false,
  onPick,
  onClose,
}: Props) {
  const [data, setData] = useState<BrowseResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [path, setPath] = useState(initialPath ?? '')

  const load = async (p?: string) => {
    setError(null)
    try {
      const r = await api.browse(p)
      setData(r)
      setPath(r.path)
    } catch (e) {
      setError(String(e))
    }
  }

  useEffect(() => {
    void load(initialPath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--sh-xl)',
          width: 640,
          maxHeight: '80vh',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', gap: 8,
          flexShrink: 0,
        }}>
          <h3 style={{ margin: 0, fontSize: 'var(--t-sm)', fontWeight: 600, flex: 1, color: 'var(--fg-primary)' }}>
            选择路径
          </h3>
          <button
            onClick={onClose}
            style={{
              padding: '2px 6px', background: 'transparent', border: 'none',
              color: 'var(--fg-tertiary)', cursor: 'pointer', fontSize: 'var(--t-md)',
              borderRadius: 'var(--r-sm)',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-overlay)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            ✕
          </button>
        </header>

        {/* Path bar */}
        <div style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', gap: 6,
          flexShrink: 0, background: 'var(--bg-sunken)',
        }}>
          {data?.parent && (
            <button
              onClick={() => void load(data.parent!)}
              className="btn btn-ghost btn-sm"
              style={{ flexShrink: 0 }}
            >
              ← 上级
            </button>
          )}
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void load(path)}
            className="input input-mono"
            style={{ flex: 1, padding: '4px 8px', fontSize: 'var(--t-xs)' }}
          />
          <button
            onClick={() => void load(path)}
            className="btn btn-secondary btn-sm"
            style={{ flexShrink: 0 }}
          >
            前往
          </button>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            padding: '8px 14px',
            color: 'var(--err)', fontSize: 'var(--t-xs)', fontFamily: 'var(--font-mono)',
            background: 'var(--err-soft)', borderBottom: '1px solid var(--err)',
            flexShrink: 0,
          }}>
            {error}
          </div>
        )}

        {/* File list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {data?.entries.map((e) => {
            const childPath =
              data.path.replace(/[/\\]+$/, '') +
              (data.path.endsWith('/') || data.path.endsWith('\\') ? '' : '/') +
              e.name
            const enterable = e.type === 'dir'
            const selectable = enterable || !dirOnly
            return (
              <div
                key={e.name}
                style={{
                  padding: '8px 14px',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex', alignItems: 'center', gap: 10,
                  cursor: 'default',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-overlay)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                className="file-row"
              >
                <span style={{ color: 'var(--fg-tertiary)', width: 16, textAlign: 'center', flexShrink: 0 }}>
                  {e.type === 'dir' ? '📁' : '📄'}
                </span>
                <span style={{
                  flex: 1, fontSize: 'var(--t-sm)', fontFamily: 'var(--font-mono)',
                  color: 'var(--fg-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {e.name}
                </span>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  {enterable && (
                    <button
                      onClick={() => void load(childPath)}
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: 'var(--t-xs)' }}
                    >
                      打开
                    </button>
                  )}
                  {selectable && (
                    <button
                      onClick={() => onPick(childPath)}
                      className="btn btn-primary btn-sm"
                      style={{ fontSize: 'var(--t-xs)' }}
                    >
                      选这个
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <footer style={{
          padding: '10px 14px',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
          flexShrink: 0, background: 'var(--bg-surface)',
        }}>
          <button onClick={onClose} className="btn btn-secondary btn-sm">取消</button>
          <button onClick={() => onPick(path)} className="btn btn-primary btn-sm">
            选择当前目录
          </button>
        </footer>
      </div>
    </div>
  )
}
