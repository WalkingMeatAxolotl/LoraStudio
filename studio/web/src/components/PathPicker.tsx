import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, type BrowseResult } from '../api/client'

interface Props {
  initialPath?: string
  /** true: 只允许选目录；false: 文件也能选 */
  dirOnly?: boolean
  onPick: (path: string) => void
  onClose: () => void
}

export default function PathPicker({
  initialPath,
  dirOnly = false,
  onPick,
  onClose,
}: Props) {
  const { t } = useTranslation()
  const [data, setData] = useState<BrowseResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [path, setPath] = useState(initialPath ?? '')
  const selectedRef = useRef<HTMLDivElement | null>(null)

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

  // initialPath 是文件时后端会回退到父目录并返回 selected，把那个文件
  // 滚到可见区域，让用户能直接看到"刚才点开的文件在这里"。
  useEffect(() => {
    if (data?.selected && selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [data])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-elevated border border-dim rounded-lg shadow-xl w-[640px] max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-4 py-3 border-b border-subtle flex items-center gap-2 shrink-0">
          <h3 className="m-0 text-sm font-semibold flex-1 text-fg-primary">
            {t('pathPicker.title')}
          </h3>
          <button onClick={onClose} className="btn btn-ghost btn-sm">✕</button>
        </header>

        <div className="px-3 py-2 border-b border-subtle flex items-center gap-1.5 shrink-0 bg-sunken">
          {data?.parent && (
            <button
              onClick={() => void load(data.parent!)}
              className="btn btn-ghost btn-sm shrink-0"
            >
              {t('pathPicker.parent')}
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
            {t('pathPicker.go')}
          </button>
        </div>

        {error && (
          <div className="px-3.5 py-2 text-err text-xs font-mono bg-err-soft border-b border-err shrink-0">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {data?.entries.map((e) => {
            // 后端统一返回 POSIX 路径，前端拼接直接用 `/`。根目录（Linux `/`、
            // Windows `C:/`）trim 尾 slash 后仍合法（`C:` / 空串），再补 `/` 即可。
            const base = data.path.replace(/\/+$/, '')
            const childPath = (base || '') + '/' + e.name
            const enterable = e.type === 'dir'
            const selectable = enterable || !dirOnly
            const isSelected = data.selected === e.name
            return (
              <div
                key={e.name}
                ref={isSelected ? selectedRef : null}
                className={
                  'px-3.5 py-2 border-b border-subtle flex items-center gap-2.5 cursor-default transition-colors '
                  + (isSelected ? 'bg-overlay' : 'hover:bg-overlay')
                }
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
                      {t('common.open')}
                    </button>
                  )}
                  {selectable && (
                    <button
                      onClick={() => onPick(childPath)}
                      className="btn btn-primary btn-sm"
                    >
                      {t('pathPicker.selectThis')}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <footer className="px-3.5 py-2.5 border-t border-subtle flex justify-end gap-2 shrink-0 bg-surface">
          <button onClick={onClose} className="btn btn-secondary btn-sm">{t('common.cancel')}</button>
          <button onClick={() => onPick(path)} className="btn btn-primary btn-sm">
            {t('pathPicker.selectCurrentDir')}
          </button>
        </footer>
      </div>
    </div>
  )
}
