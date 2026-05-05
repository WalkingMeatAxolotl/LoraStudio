import { useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api, type ProjectDetail, type Version } from '../../api/client'
import PageHeader from '../../components/PageHeader'
import StageBadge from '../../components/StageBadge'
import { useToast } from '../../components/Toast'

interface Ctx {
  project: ProjectDetail
  activeVersion: Version | null
  reload: () => Promise<void>
}

// ── StatCard ────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  tone,
  mono = true,
}: {
  label: string
  value: string | number
  sub?: string
  tone?: 'ok' | 'warn' | 'err' | 'accent'
  mono?: boolean
}) {
  const color =
    tone === 'ok'     ? 'var(--ok)'
    : tone === 'warn' ? 'var(--warn)'
    : tone === 'err'  ? 'var(--err)'
    : tone === 'accent' ? 'var(--accent)'
    : 'var(--fg-primary)'
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="caption" style={{ marginBottom: 10 }}>{label}</div>
      <div style={{
        fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
        fontSize: 'var(--t-2xl)',
        fontWeight: 600,
        letterSpacing: '-0.02em',
        color,
        lineHeight: 1.05,
      }}>{value}</div>
      {sub && (
        <div style={{ marginTop: 6, fontSize: 'var(--t-sm)', color: 'var(--fg-tertiary)' }}>{sub}</div>
      )}
    </div>
  )
}

// ── PipelineTimeline ─────────────────────────────────────────────

type StepStatus = 'done' | 'active' | 'pending'

interface PipelineStep {
  idx: number
  label: string
  status: StepStatus
  meta: string
}

function deriveTimeline(project: ProjectDetail, activeVersion: Version | null): PipelineStep[] {
  const stage = activeVersion?.stage ?? project.stage
  const stageOrder = ['downloading', 'curating', 'tagging', 'regularizing', 'configured', 'training', 'done']
  const stageIdx = stageOrder.indexOf(stage)

  const steps: Array<{ label: string; stages: string[]; meta: () => string }> = [
    {
      label: '下载',
      stages: ['downloading'],
      meta: () => `${project.download_image_count ?? 0} 张`,
    },
    {
      label: '筛选',
      stages: ['curating'],
      meta: () => `train: ${activeVersion?.stats?.train_image_count ?? 0}`,
    },
    {
      label: '打标',
      stages: ['tagging'],
      meta: () => activeVersion?.stats?.train_image_count ? `${activeVersion.stats.train_image_count} 张` : '—',
    },
    {
      label: '标签编辑',
      stages: ['regularizing'],
      meta: () => '—',
    },
    {
      label: '正则集',
      stages: ['configured'],
      meta: () => `reg: ${activeVersion?.stats?.reg_image_count ?? 0}`,
    },
    {
      label: '训练',
      stages: ['training', 'done'],
      meta: () => activeVersion?.stats?.has_output ? '已出 checkpoint' : '—',
    },
  ]

  return steps.map((s, i) => {
    const stepFirstStageIdx = stageOrder.indexOf(s.stages[0])
    let status: StepStatus = 'pending'
    if (stage === 'done' || s.stages.some(st => st === 'done')) {
      status = stage === 'done' ? 'done' : 'pending'
    }
    if (stageIdx > stepFirstStageIdx) status = 'done'
    else if (s.stages.includes(stage)) status = 'active'

    return { idx: i + 1, label: s.label, status, meta: s.meta() }
  })
}

function PipelineTimeline({ steps }: { steps: PipelineStep[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${steps.length}, 1fr)`, gap: 0 }}>
      {steps.map((s, i) => (
        <div key={i} style={{ position: 'relative', padding: '0 8px' }}>
          {/* left connector */}
          {i > 0 && (
            <div style={{
              position: 'absolute', top: 14, left: 0,
              width: 'calc(50% - 16px)', height: 2,
              background: s.status !== 'pending' ? 'var(--ok)' : 'var(--border-subtle)',
            }} />
          )}
          {/* right connector */}
          {i < steps.length - 1 && (
            <div style={{
              position: 'absolute', top: 14, right: 0,
              width: 'calc(50% - 16px)', height: 2,
              background: s.status === 'done' ? 'var(--ok)' : 'var(--border-subtle)',
            }} />
          )}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', position: 'relative' }}>
            <div style={{
              width: 30, height: 30, borderRadius: '50%',
              background: s.status === 'done' ? 'var(--ok)' : s.status === 'active' ? 'var(--accent)' : 'var(--bg-overlay)',
              color: s.status === 'pending' ? 'var(--fg-tertiary)' : 'white',
              display: 'grid', placeItems: 'center',
              fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12,
              border: s.status === 'active' ? '3px solid var(--accent-soft)' : 'none',
            }}>
              {s.status === 'done' ? '✓' : s.idx}
            </div>
            <div style={{ marginTop: 8, fontSize: 'var(--t-sm)', fontWeight: s.status === 'active' ? 600 : 500 }}>
              {s.label}
            </div>
            <div className="mono" style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)', marginTop: 2 }}>
              {s.meta}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Overview ─────────────────────────────────────────────────────

export default function ProjectOverview() {
  const { project, activeVersion, reload } = useOutletContext<Ctx>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [newVersionBusy, setNewVersionBusy] = useState(false)

  const handleActivate = async (v: Version) => {
    try {
      await api.activateVersion(project.id, v.id)
      await reload()
      navigate(`/projects/${project.id}/v/${v.id}/curate`)
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const handleNewVersion = async () => {
    const label = prompt('版本标签', `v${project.versions.length + 1}`)
    if (!label) return
    setNewVersionBusy(true)
    try {
      await api.createVersion(project.id, { label })
      await reload()
      toast(`已创建版本 ${label}`, 'success')
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setNewVersionBusy(false)
    }
  }

  const stats = [
    {
      label: 'download images',
      value: project.download_image_count ?? 0,
      sub: '总下载量',
    },
    {
      label: 'train images',
      value: activeVersion?.stats?.train_image_count ?? 0,
      sub: `当前版本: ${activeVersion?.label ?? '—'}`,
    },
    {
      label: 'reg images',
      value: activeVersion?.stats?.reg_image_count ?? 0,
      sub: activeVersion?.stats?.has_output ? '✓ 已出 checkpoint' : '尚未训练',
      tone: activeVersion?.stats?.has_output ? 'ok' as const : undefined,
    },
    {
      label: '版本数',
      value: project.versions.length,
      sub: `活跃: ${activeVersion?.label ?? '—'}`,
      tone: 'accent' as const,
      mono: false,
    },
  ]

  const steps = deriveTimeline(project, activeVersion)

  const nextStep = steps.find(s => s.status === 'active')
  const nextStepPaths: Record<string, string> = {
    '下载': 'download',
    '筛选': `v/${activeVersion?.id}/curate`,
    '打标': `v/${activeVersion?.id}/tag`,
    '标签编辑': `v/${activeVersion?.id}/edit`,
    '正则集': `v/${activeVersion?.id}/reg`,
    '训练': `v/${activeVersion?.id}/train`,
  }
  const nextPath = nextStep ? nextStepPaths[nextStep.label] : undefined

  return (
    <div className="fade-in">
      <PageHeader
        eyebrow={`项目 · ${project.slug}`}
        title={project.title}
        subtitle={project.note || `${project.download_image_count ?? 0} 张下载 · ${project.versions.length} 个版本`}
        actions={
          nextPath ? (
            <button
              className="btn btn-primary"
              onClick={() => navigate(`/projects/${project.id}/${nextPath}`)}
            >
              继续 → {nextStep?.label}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          ) : undefined
        }
      />

      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          {stats.map((s, i) => (
            <StatCard key={i} {...s} />
          ))}
        </div>

        {/* Pipeline timeline */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <h2 style={{ margin: 0, fontSize: 'var(--t-md)', fontWeight: 600 }}>流水线进度</h2>
            <span className="caption">stages</span>
          </div>
          <div style={{ padding: 18 }}>
            <PipelineTimeline steps={steps} />
          </div>
        </div>

        {/* Versions panel */}
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
            <h2 style={{ margin: 0, fontSize: 'var(--t-md)', fontWeight: 600, flex: 1 }}>版本</h2>
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleNewVersion}
              disabled={newVersionBusy}
              style={{ border: '1px dashed var(--border-default)' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              {newVersionBusy ? '创建中…' : '新版本'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {project.versions.map((v) => {
              const isActive = v.id === project.active_version_id
              return (
                <div
                  key={v.id}
                  style={{
                    padding: 14,
                    borderRadius: 'var(--r-md)',
                    border: isActive ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
                    background: isActive ? 'var(--accent-soft)' : 'transparent',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{v.label}</span>
                    <StageBadge stage={v.stage} />
                  </div>
                  <div style={{ marginTop: 6, display: 'flex', gap: 14, fontSize: 'var(--t-sm)', color: 'var(--fg-secondary)' }}>
                    <span>{v.stats?.train_image_count ?? 0} 训练图</span>
                    <span>{v.stats?.reg_image_count ?? 0} 正则图</span>
                    {v.stats?.has_output && (
                      <span style={{ color: 'var(--ok)' }}>✓ 已训练</span>
                    )}
                  </div>
                  {v.note && (
                    <p style={{ margin: '6px 0 0', fontSize: 'var(--t-sm)', color: 'var(--fg-secondary)' }}>{v.note}</p>
                  )}
                  <div style={{ marginTop: 10 }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleActivate(v)}
                    >
                      {isActive ? '打开' : '激活并打开'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
