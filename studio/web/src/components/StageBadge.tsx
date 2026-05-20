import { useTranslation } from 'react-i18next'
import type { ProjectStage, VersionStage } from '../api/client'

const DOT_RUNNING = (
  <span className="dot dot-running" style={{ flexShrink: 0 }} />
)

type AnyStage = ProjectStage | VersionStage

type StageEntry = { badge: string; key: string; dot?: true }

const STAGE_MAP: Record<string, StageEntry> = {
  created:      { badge: 'badge-neutral', key: 'stageBadge.created' },
  downloading:  { badge: 'badge-warn',   key: 'stageBadge.downloading', dot: true },
  curating:     { badge: 'badge-warn',   key: 'stageBadge.curating' },
  tagging:      { badge: 'badge-warn',   key: 'stageBadge.tagging' },
  regularizing: { badge: 'badge-warn',   key: 'stageBadge.regularizing' },
  configured:   { badge: 'badge-info',   key: 'stageBadge.configured' },
  ready:        { badge: 'badge-info',   key: 'stageBadge.ready' },
  training:     { badge: 'badge-accent', key: 'stageBadge.training', dot: true },
  done:         { badge: 'badge-ok',     key: 'stageBadge.done' },
}

export default function StageBadge({ stage }: { stage: AnyStage }) {
  const { t } = useTranslation()
  const s = STAGE_MAP[stage] ?? { badge: 'badge-neutral', key: stage }
  return (
    <span className={`badge ${s.badge}`}>
      {s.dot && DOT_RUNNING}
      {STAGE_MAP[stage] ? t(s.key) : stage}
    </span>
  )
}
