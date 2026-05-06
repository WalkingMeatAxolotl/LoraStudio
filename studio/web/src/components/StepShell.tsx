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
    <div className="fade-in flex flex-col h-full">
      <PageHeader
        eyebrow={eb || undefined}
        title={title}
        subtitle={subtitle}
        actions={actions}
        sticky
      />
      {/* flex column container: overflow:hidden stops page scroll; children use flex:1 to fill */}
      <div className="flex-1 min-h-0 p-6 flex flex-col overflow-hidden">
        {children}
      </div>
    </div>
  )
}
