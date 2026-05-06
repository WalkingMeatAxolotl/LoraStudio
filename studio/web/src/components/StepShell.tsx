import type { ReactNode } from 'react'
import PageHeader from './PageHeader'

interface Props {
  idx: number | string
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
  eyebrow?: string | false
}

export default function StepShell({ idx, title, subtitle, actions, children, eyebrow }: Props) {
  const eb = eyebrow ?? (idx === -1 ? false : `第 ${idx} 步`)
  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PageHeader
        eyebrow={eb || undefined}
        title={title}
        subtitle={subtitle}
        actions={actions}
        sticky
      />
      {/* flex column container: overflow:hidden stops page scroll; children use flex:1 to fill */}
      <div style={{ flex: 1, minHeight: 0, padding: 24, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  )
}
