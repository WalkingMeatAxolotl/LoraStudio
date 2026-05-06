import type { ProjectStage, VersionStage } from '../api/client'

const DOT_RUNNING = (
  <span className="dot dot-running" style={{ flexShrink: 0 }} />
)

type AnyStage = ProjectStage | VersionStage

const STAGE_MAP: Record<string, { badge: string; label: string; dot?: true }> = {
  created:      { badge: 'badge-neutral', label: '已创建' },
  downloading:  { badge: 'badge-warn',   label: '下载中',  dot: true },
  curating:     { badge: 'badge-warn',   label: '筛选中' },
  tagging:      { badge: 'badge-warn',   label: '打标中' },
  regularizing: { badge: 'badge-warn',   label: '正则集中' },
  configured:   { badge: 'badge-info',   label: '已配置' },
  ready:        { badge: 'badge-info',   label: '就绪' },
  training:     { badge: 'badge-accent', label: '训练中',  dot: true },
  done:         { badge: 'badge-ok',     label: '完成' },
}

export default function StageBadge({ stage }: { stage: AnyStage }) {
  const s = STAGE_MAP[stage] ?? { badge: 'badge-neutral', label: stage }
  return (
    <span className={`badge ${s.badge}`}>
      {s.dot && DOT_RUNNING}
      {s.label}
    </span>
  )
}
