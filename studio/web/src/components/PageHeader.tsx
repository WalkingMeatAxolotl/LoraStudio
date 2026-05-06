import type { ReactNode } from 'react'

interface Props {
  eyebrow?: string
  title: string
  subtitle?: string
  actions?: ReactNode
  sticky?: boolean
}

export default function PageHeader({ eyebrow, title, subtitle, actions, sticky }: Props) {
  return (
    <div className={`px-6 pt-5 pb-4 bg-canvas border-b border-subtle ${sticky ? 'sticky top-0 z-[5]' : 'relative'}`}>
      <div className="flex items-end gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          {eyebrow && <div className="caption mb-1.5">{eyebrow}</div>}
          <h1 className="m-0 text-2xl font-semibold tracking-tight leading-[1.15]">{title}</h1>
          {subtitle && (
            <p className="mt-1.5 text-fg-secondary text-md max-w-[720px] m-0">{subtitle}</p>
          )}
        </div>
        {actions && (
          <div className="flex gap-2 items-center">{actions}</div>
        )}
      </div>
    </div>
  )
}
