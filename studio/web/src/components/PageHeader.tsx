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
    <div style={{
      padding: '20px 24px 16px',
      background: 'var(--bg-canvas)',
      borderBottom: '1px solid var(--border-subtle)',
      position: sticky ? 'sticky' : 'relative',
      top: 0,
      zIndex: 5,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {eyebrow && (
            <div className="caption" style={{ marginBottom: 6 }}>{eyebrow}</div>
          )}
          <h1 style={{
            margin: 0,
            fontSize: 'var(--t-2xl)',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            lineHeight: 1.15,
          }}>{title}</h1>
          {subtitle && (
            <p style={{
              margin: '6px 0 0',
              color: 'var(--fg-secondary)',
              fontSize: 'var(--t-md)',
              maxWidth: 720,
            }}>{subtitle}</p>
          )}
        </div>
        {actions && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{actions}</div>
        )}
      </div>
    </div>
  )
}
