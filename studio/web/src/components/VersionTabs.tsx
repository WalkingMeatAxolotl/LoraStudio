import type { Version, VersionStage } from '../api/client'

const STAGE_DOT: Record<VersionStage, string> = {
  curating:     'bg-warn',
  tagging:      'bg-warn',
  regularizing: 'bg-warn',
  ready:        'bg-accent',
  training:     'bg-info',
  done:         'bg-ok',
}

interface Props {
  versions: Version[]
  activeId: number | null
  onSelect: (vid: number) => void
  onCreate: () => void
  onDelete: (vid: number) => void
}

export default function VersionTabs({
  versions,
  activeId,
  onSelect,
  onCreate,
  onDelete,
}: Props) {
  return (
    <div
      className="flex flex-wrap items-center gap-1 border-b border-subtle pb-2"
      role="tablist"
      aria-label="versions"
    >
      {versions.map((v) => {
        const active = v.id === activeId
        return (
          <div
            key={v.id}
            className={
              'flex items-center gap-1 rounded px-1 ' +
              (active ? 'bg-surface' : '')
            }
          >
            <button
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(v.id)}
              className={
                'flex items-center gap-1.5 px-2 py-1 text-xs ' +
                (active
                  ? 'text-accent'
                  : 'text-fg-tertiary hover:text-fg-primary')
              }
            >
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ${STAGE_DOT[v.stage]}`}
                aria-hidden
              />
              <span className="font-mono">{v.label}</span>
            </button>
            {active && versions.length > 1 && (
              <button
                onClick={() => onDelete(v.id)}
                className="text-[10px] text-fg-tertiary hover:text-err px-1"
                aria-label={`删除版本 ${v.label}`}
                title="删除该版本（移到回收站）"
              >
                ×
              </button>
            )}
          </div>
        )
      })}
      <button
        onClick={onCreate}
        className="text-xs px-2 py-1 rounded text-fg-tertiary hover:text-accent hover:bg-surface ml-1"
        title="新建版本"
      >
        + 新版本
      </button>
    </div>
  )
}
