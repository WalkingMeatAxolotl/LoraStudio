import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { Version, VersionStage } from '../api/client'

/** Map version stage → 0-based index of the current active step.
 *
 * 注意：后端 stage 集合是 {curating, tagging, regularizing, ready, training,
 * done}，**没有 editing 这个值**——打标完成后到正则启动前，stage 一直停在
 * "tagging"。所以单看 stage，tag(2) 和 edit(3) 都不会变 done 状态。下方
 * `isStepDone` 用 version.stats 派生覆盖，做到打完标 → tag/edit 立刻打勾。
 */
const STAGE_TO_STEP_IDX: Record<VersionStage, number> = {
  curating: 1,     // download done, curate active
  tagging: 2,      // download+curate done, tag active
  regularizing: 4, // download+curate+tag+edit done, reg active
  ready: 5,        // download+curate+tag+edit+reg done, train active
  training: 5,     // same, train running
  done: 6,         // all 6 steps done
}
import { useProjectCtx } from '../context/ProjectContext'

// ── icons ──────────────────────────────────────────────────────────────────
const I = {
  folder:  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>,
  queue:   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h10M4 18h16"/><circle cx="18" cy="12" r="2" fill="currentColor"/></svg>,
  preset:  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="4" x2="6" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="18" y1="4" x2="18" y2="20"/><circle cx="6" cy="9" r="2" fill="var(--bg-sunken)"/><circle cx="12" cy="15" r="2" fill="var(--bg-sunken)"/><circle cx="18" cy="7" r="2" fill="var(--bg-sunken)"/></svg>,
  monitor: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l4-6 4 3 5-9 5 7"/></svg>,
  cog:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  check:   <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m4 12 5 5 11-12"/></svg>,
  chevL:   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 6l-6 6 6 6"/></svg>,
  chevR:   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 6l6 6-6 6"/></svg>,
  download:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v12m0 0-4-4m4 4 4-4M4 20h16"/></svg>,
  filter:  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h18l-7 9v6l-4-2v-4z"/></svg>,
  tag:     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12 12 20l-9-9V3h8z"/><circle cx="7" cy="7" r="1.5" fill="currentColor"/></svg>,
  edit:    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h4l11-11-4-4L3 17z"/><path d="m14 5 4 4"/></svg>,
  reg:     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/></svg>,
  train:   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 18 9 12l4 4 8-9"/><path d="M15 7h6v6"/></svg>,
  export:  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>,
  plus:    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>,
}

// ── version stage dot ──────────────────────────────────────────────────────
const STAGE_DOT: Record<VersionStage, string> = {
  curating:     'dot dot-warn',
  tagging:      'dot dot-warn',
  regularizing: 'dot dot-warn',
  ready:        'dot dot-ok',
  training:     'dot dot-running',
  done:         'dot dot-ok',
}

// ── logo ───────────────────────────────────────────────────────────────────
function Logo({ collapsed }: { collapsed: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
        <rect x="2" y="2" width="22" height="22" rx="5" fill="var(--accent)" />
        <path d="M8 18 L13 7 L18 18" stroke="var(--accent-fg)" strokeWidth="2" fill="none" strokeLinejoin="round" strokeLinecap="round" />
        <line x1="10.5" y1="14" x2="15.5" y2="14" stroke="var(--accent-fg)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
          <span style={{ fontWeight: 600, fontSize: 'var(--t-md)', letterSpacing: '-0.01em' }}>Anima</span>
          <span style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-tertiary)', fontFamily: 'var(--font-mono)' }}>lora studio · 0.4</span>
        </div>
      )}
    </div>
  )
}

// ── nav item ───────────────────────────────────────────────────────────────
function NavItem({ to, label, icon, active, collapsed }: {
  to: string; label: string; icon: React.ReactNode; active: boolean; collapsed: boolean
}) {
  return (
    <Link
      to={to}
      title={collapsed ? label : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: collapsed ? '9px 0' : '8px 12px',
        justifyContent: collapsed ? 'center' : 'flex-start',
        borderRadius: 'var(--r-md)',
        background: active ? 'var(--bg-surface)' : 'transparent',
        color: active ? 'var(--fg-primary)' : 'var(--fg-secondary)',
        fontSize: 'var(--t-sm)', fontWeight: active ? 600 : 500,
        boxShadow: active ? 'var(--sh-sm)' : 'none',
        position: 'relative', textDecoration: 'none',
        transition: 'background 100ms ease, color 100ms ease',
      }}
      onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--bg-overlay)' }}
      onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
    >
      {active && !collapsed && (
        <span style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, background: 'var(--accent)', borderRadius: 2 }} />
      )}
      {icon}
      {!collapsed && <span style={{ flex: 1 }}>{label}</span>}
    </Link>
  )
}

// ── version panel ──────────────────────────────────────────────────────────
function VersionPanel({ collapsed }: { collapsed: boolean }) {
  const ctx = useProjectCtx()
  if (!ctx) return null
  const { project, activeVersion, onSelectVersion, onCreateVersion, onExportTrain, onDeleteVersion, exporting } = ctx

  if (collapsed) {
    return (
      <button
        onClick={onExportTrain}
        disabled={!activeVersion || exporting}
        title={exporting ? '打包中...' : '导出训练集'}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '7px 0', width: '100%',
          color: 'var(--fg-tertiary)', background: 'transparent',
          borderRadius: 'var(--r-md)', border: 'none', cursor: 'pointer',
          opacity: !activeVersion ? 0.4 : 1,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-overlay)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
      >
        {I.export}
      </button>
    )
  }

  return (
    <div style={{
      margin: '0 4px',
      borderRadius: 'var(--r-md)',
      border: '1px solid var(--border-subtle)',
      background: 'var(--bg-overlay)',
      padding: '8px 8px 6px',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      {/* Project name header */}
      <div style={{ padding: '0 2px' }}>
        <div style={{ fontWeight: 600, color: 'var(--fg-primary)', fontSize: 'var(--t-sm)' }}>
          {project.title}
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)',
          color: 'var(--fg-tertiary)', marginTop: 2,
        }}>
          v / {activeVersion?.label ?? '—'}
        </div>
      </div>

      {/* Version list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {project.versions.map((v) => {
          const isActive = v.id === project.active_version_id
          return (
            <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <button
                onClick={() => onSelectVersion(v.id)}
                style={{
                  flex: 1, textAlign: 'left', padding: '3px 6px',
                  borderRadius: 'var(--r-sm)',
                  background: isActive ? 'var(--accent-soft)' : 'transparent',
                  color: isActive ? 'var(--accent)' : 'var(--fg-secondary)',
                  fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)',
                  fontWeight: isActive ? 600 : 400,
                  display: 'flex', alignItems: 'center', gap: 6,
                  border: 'none', cursor: 'pointer',
                }}
                onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--bg-surface)' }}
                onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <span className={STAGE_DOT[v.stage]} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.label}</span>
              </button>
              {isActive && project.versions.length > 1 && (
                <button
                  onClick={() => onDeleteVersion(v.id)}
                  title="删除此版本（移到回收站）"
                  style={{ padding: '2px 5px', color: 'var(--fg-tertiary)', fontSize: 'var(--t-xs)', background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: 'var(--r-sm)', flexShrink: 0 }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--err)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--fg-tertiary)' }}
                >
                  ×
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Actions row */}
      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
        <button
          onClick={onCreateVersion}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            padding: '4px 6px', fontSize: 'var(--t-xs)', color: 'var(--fg-secondary)',
            background: 'transparent', border: '1px dashed var(--border-default)',
            borderRadius: 'var(--r-sm)', cursor: 'pointer',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-surface)'; (e.currentTarget as HTMLElement).style.color = 'var(--accent)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--fg-secondary)' }}
        >
          {I.plus} 新版本
        </button>
        <button
          onClick={onExportTrain}
          disabled={!activeVersion || exporting}
          title={exporting ? '打包中...' : '导出当前版本训练集 (.zip)'}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            padding: '4px 8px', fontSize: 'var(--t-xs)', color: 'var(--fg-secondary)',
            background: 'transparent', border: '1px solid var(--border-default)',
            borderRadius: 'var(--r-sm)', cursor: 'pointer',
            opacity: !activeVersion ? 0.4 : 1,
          }}
          onMouseEnter={(e) => { if (activeVersion) { (e.currentTarget as HTMLElement).style.background = 'var(--bg-surface)'; (e.currentTarget as HTMLElement).style.color = 'var(--fg-primary)' } }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--fg-secondary)' }}
        >
          {I.export}
          {exporting ? '打包...' : '导出'}
        </button>
      </div>
    </div>
  )
}

// ── project stepper nav ────────────────────────────────────────────────────
const STEPS = [
  { key: 'download', label: '下载',     idx: '1', icon: I.download },
  { key: 'curate',   label: '筛选',     idx: '2', icon: I.filter },
  { key: 'tag',      label: '打标',     idx: '3', icon: I.tag },
  { key: 'edit',     label: '标签编辑', idx: '4', icon: I.edit },
  { key: 'reg',      label: '正则集',   idx: '5', icon: I.reg },
  { key: 'train',    label: '训练',     idx: '6', icon: I.train },
]

function ProjectStepperNav({ pid, activeVid, currentStep, version, collapsed }: {
  pid: string
  activeVid: string | null
  currentStep: string | null
  version: Version | null
  collapsed: boolean
}) {
  const overviewActive = currentStep === null
  const stage: VersionStage = version?.stage ?? 'curating'
  const stageStepIdx = STAGE_TO_STEP_IDX[stage] ?? 0
  const stats = version?.stats

  // 派生覆盖（stats / output_lora_path）：打完标 → tag+edit 立即 done；
  // 正则集生成 → reg 立即 done；output_lora_path 存在 → train done。
  // 这样不依赖后端 stage 跳转就能让侧边的勾勾跟上数据真相。
  const isStepDone = (key: string, idx: number): boolean => {
    if (idx < stageStepIdx) return true
    if (
      (key === 'tag' || key === 'edit') &&
      stats &&
      stats.train_image_count > 0 &&
      stats.tagged_image_count >= stats.train_image_count
    ) return true
    if (
      key === 'reg' &&
      stats &&
      stats.reg_meta_exists &&
      stats.reg_image_count > 0
    ) return true
    if (key === 'train' && version?.output_lora_path) return true
    return false
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '0 4px' }}>
      {/* 概览 */}
      <Link
        to={`/projects/${pid}`}
        title={collapsed ? '概览' : undefined}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: collapsed ? '7px 0' : '7px 10px',
          justifyContent: collapsed ? 'center' : 'flex-start',
          borderRadius: 'var(--r-md)',
          background: overviewActive ? 'var(--bg-surface)' : 'transparent',
          color: overviewActive ? 'var(--fg-primary)' : 'var(--fg-secondary)',
          fontSize: 'var(--t-sm)', fontWeight: overviewActive ? 600 : 400,
          boxShadow: overviewActive ? 'var(--sh-sm)' : 'none',
          textDecoration: 'none',
          transition: 'background 100ms ease',
          marginBottom: 4,
        }}
        onMouseEnter={(e) => { if (!overviewActive) (e.currentTarget as HTMLElement).style.background = 'var(--bg-overlay)' }}
        onMouseLeave={(e) => { if (!overviewActive) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
      >
        <span style={{
          width: 20, height: 20, borderRadius: '50%',
          background: overviewActive ? 'var(--accent-soft)' : 'var(--bg-overlay)',
          color: overviewActive ? 'var(--accent)' : 'var(--fg-tertiary)',
          display: 'grid', placeItems: 'center',
          fontSize: 12, flexShrink: 0,
        }}>≡</span>
        {!collapsed && <span style={{ flex: 1 }}>概览</span>}
      </Link>

      {STEPS.map((s, i) => {
        const isActive = s.key === currentStep
        const isDone = isStepDone(s.key, i)

        const href = s.key === 'download'
          ? `/projects/${pid}/download`
          : activeVid ? `/projects/${pid}/v/${activeVid}/${s.key}` : null

        // Step status colors: done=green, current(active)=accent, pending=gray
        const stepBg = isDone ? 'var(--ok-soft)'
          : isActive ? 'var(--accent-soft)'
          : 'var(--bg-overlay)'
        const stepColor = isDone ? 'var(--ok)'
          : isActive ? 'var(--accent)'
          : 'var(--fg-tertiary)'

        const inner = (
          <>
            <span style={{
              width: 20, height: 20, borderRadius: '50%',
              background: stepBg, color: stepColor,
              display: 'grid', placeItems: 'center',
              fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)',
              flexShrink: 0,
            }}>
              {isDone ? I.check : s.idx}
            </span>
            {!collapsed && <span style={{ flex: 1, textAlign: 'left' }}>{s.label}</span>}
            {!collapsed && isActive && <span className="dot dot-running" />}
          </>
        )

        const commonStyle: React.CSSProperties = {
          display: 'flex', alignItems: 'center', gap: 10,
          padding: collapsed ? '7px 0' : '7px 10px',
          justifyContent: collapsed ? 'center' : 'flex-start',
          borderRadius: 'var(--r-md)',
          background: isActive ? 'var(--bg-surface)' : 'transparent',
          color: isActive ? 'var(--fg-primary)' : 'var(--fg-secondary)',
          fontSize: 'var(--t-sm)', fontWeight: isActive ? 600 : 400,
          boxShadow: isActive ? 'var(--sh-sm)' : 'none',
          transition: 'background 100ms ease',
          textDecoration: 'none',
        }

        if (!href) {
          return (
            <span key={s.key} title={collapsed ? `${s.idx}. ${s.label}` : undefined}
              style={{ ...commonStyle, opacity: 0.4, cursor: 'default' }}>
              {inner}
            </span>
          )
        }

        return (
          <Link
            key={s.key}
            to={href}
            title={collapsed ? `${s.idx}. ${s.label}` : undefined}
            style={commonStyle}
            onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--bg-overlay)' }}
            onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            {inner}
          </Link>
        )
      })}
    </div>
  )
}

// ── sidebar ────────────────────────────────────────────────────────────────
const SIDEBAR_KEY = 'studio.sidebar.expanded'

export default function Sidebar() {
  const location = useLocation()
  const ctx = useProjectCtx()

  const pid = location.pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null
  const urlVid = location.pathname.match(/\/v\/([^/]+)/)?.[1] ?? null
  const stepMatch = location.pathname.match(/\/v\/[^/]+\/([^/]+)$/)
  const currentStep = stepMatch?.[1] ?? (location.pathname.endsWith('/download') ? 'download' : null)

  // Prefer active version from context; fall back to URL vid (handles page reload)
  const activeVid = ctx?.activeVersion?.id?.toString() ?? urlVid

  const inProject = pid !== null

  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(() => {
    try {
      const v = sessionStorage.getItem(SIDEBAR_KEY)
      return v === '1' ? true : v === '0' ? false : null
    } catch { return null }
  })

  const expanded = expandedOverride ?? !inProject
  const collapsed = !expanded

  const toggle = () => {
    const next = !expanded
    setExpandedOverride(next)
    try { sessionStorage.setItem(SIDEBAR_KEY, next ? '1' : '0') } catch { /* ignore */ }
  }

  const isMain = (path: string) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  return (
    <aside style={{
      width: collapsed ? 'var(--sidebar-collapsed-w)' : 'var(--sidebar-w)',
      flexShrink: 0,
      background: 'var(--bg-sunken)',
      borderRight: '1px solid var(--border-subtle)',
      display: 'flex', flexDirection: 'column',
      transition: 'width 160ms ease',
      overflow: 'hidden',
      height: '100%',
    }}>
      {/* header / logo */}
      <div style={{
        height: 'var(--topbar-h)', padding: '0 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0,
      }}>
        <Logo collapsed={collapsed} />
        {!collapsed && (
          <button
            onClick={toggle}
            title="折叠"
            style={{ padding: 4, color: 'var(--fg-tertiary)', background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer', display: 'flex' }}
          >
            {I.chevL}
          </button>
        )}
      </div>

      {/* main nav */}
      <nav style={{ flex: 1, padding: collapsed ? '10px 6px' : '14px 10px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
        <NavItem to="/" label="项目" icon={I.folder} active={!inProject && location.pathname === '/'} collapsed={collapsed} />
        <NavItem to="/queue" label="队列" icon={I.queue} active={isMain('/queue')} collapsed={collapsed} />

        {inProject && pid && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {/* Version selector + export with project name embedded */}
            <VersionPanel collapsed={collapsed} />

            <ProjectStepperNav pid={pid} activeVid={activeVid} currentStep={currentStep} version={ctx?.activeVersion ?? null} collapsed={collapsed} />
          </div>
        )}
      </nav>

      {/* tools + collapse toggle */}
      <div style={{ padding: collapsed ? '8px 6px' : '10px', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
        <NavItem to="/tools/presets" label="预设" icon={I.preset} active={isMain('/tools/presets')} collapsed={collapsed} />
        <NavItem to="/tools/monitor" label="监控" icon={I.monitor} active={isMain('/tools/monitor')} collapsed={collapsed} />
        <NavItem to="/tools/settings" label="设置" icon={I.cog} active={isMain('/tools/settings')} collapsed={collapsed} />
        {collapsed && (
          <button
            onClick={toggle}
            title="展开"
            style={{ padding: 8, marginTop: 4, color: 'var(--fg-tertiary)', background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer', display: 'flex', justifyContent: 'center' }}
          >
            {I.chevR}
          </button>
        )}
      </div>
    </aside>
  )
}
