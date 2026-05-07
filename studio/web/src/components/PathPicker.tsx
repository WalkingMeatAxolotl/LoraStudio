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
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-elevated border border-dim rounded-lg shadow-xl w-[640px] max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="px-4 py-3 border-b border-subtle flex items-center gap-2 shrink-0">
          <h3 className="m-0 text-sm font-semibold flex-1 text-fg-primary">
            选择路径
          </h3>
          <button
            onClick={onClose}
            className="btn btn-ghost btn-sm"
          >
            ✕
          </button>
        </header>

        {/* Path bar */}
        <div className="px-3 py-2 border-b border-subtle flex items-center gap-1.5 shrink-0 bg-sunken">
          {data?.parent && (
            <button
              onClick={() => void load(data.parent!)}
              className="btn btn-ghost btn-sm shrink-0"
            >
              ← 上级
            </button>
          )}
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void load(path)}
            className="input input-mono flex-1"
            style={{ padding: '4px 8px', fontSize: 'var(--t-xs)' }}
          />
          <button
            onClick={() => void load(path)}
            className="btn btn-secondary btn-sm shrink-0"
          >
            前往
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="px-3.5 py-2 text-err text-xs font-mono bg-err-soft border-b border-err shrink-0">
            {error}
          </div>
        )}

        {/* File list */}
        <div className="flex-1 overflow-y-auto">
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
                className="px-3.5 py-2 border-b border-subtle flex items-center gap-2.5 cursor-default hover:bg-overlay transition-colors"
              >
                <span className="text-fg-tertiary w-4 text-center shrink-0">
                  {e.type === 'dir' ? '📁' : '📄'}
                </span>
                <span className="flex-1 text-sm font-mono text-fg-primary overflow-hidden text-ellipsis whitespace-nowrap">
                  {e.name}
                </span>
                <div className="flex gap-1 shrink-0">
                  {enterable && (
                    <button
                      onClick={() => void load(childPath)}
                      className="btn btn-ghost btn-sm"
                    >
                      打开
                    </button>
                  )}
                  {selectable && (
                    <button
                      onClick={() => onPick(childPath)}
                      className="btn btn-primary btn-sm"
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
        <footer className="px-3.5 py-2.5 border-t border-subtle flex justify-end gap-2 shrink-0 bg-surface">
          <button onClick={onClose} className="btn btn-secondary btn-sm">取消</button>
          <button onClick={() => onPick(path)} className="btn btn-primary btn-sm">
            选择当前目录
          </button>
        </footer>
      </div>
    </div>
  )
}
