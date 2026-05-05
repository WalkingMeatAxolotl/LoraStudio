import type { ReactNode } from 'react'
import PageHeader from './PageHeader'

interface Props {
  idx: number | string
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
}

export default function StepShell({ idx, title, subtitle, actions, children }: Props) {
  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PageHeader
        eyebrow={`第 ${idx} 步 · pipeline`}
        title={title}
        subtitle={subtitle}
        actions={actions}
        sticky
      />
      {/* flex: 1 + minHeight: 0 lets fixed-height children (dual-pane grids) fill remaining space */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {children}
      </div>
    </div>
  )
}
