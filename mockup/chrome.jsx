// Shared chrome — sidebar, topbar, layout shell
const { useState, useEffect, useMemo, useRef } = React;

// — icons (24×24 stroke, original) —
const I = {
  folder: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>,
  queue:  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h10M4 18h16"/><circle cx="18" cy="12" r="2" fill="currentColor"/></svg>,
  preset: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="4" x2="6" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="18" y1="4" x2="18" y2="20"/><circle cx="6" cy="9" r="2" fill="var(--bg-canvas)"/><circle cx="12" cy="15" r="2" fill="var(--bg-canvas)"/><circle cx="18" cy="7" r="2" fill="var(--bg-canvas)"/></svg>,
  monitor:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l4-6 4 3 5-9 5 7"/></svg>,
  cog:    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  search: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>,
  plus:   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>,
  check:  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m4 12 5 5 11-12"/></svg>,
  arrow:  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>,
  bolt:   <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>,
  download: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v12m0 0-4-4m4 4 4-4M4 20h16"/></svg>,
  filter: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h18l-7 9v6l-4-2v-4z"/></svg>,
  tag:    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12 12 20l-9-9V3h8z"/><circle cx="7" cy="7" r="1.5" fill="currentColor"/></svg>,
  edit:   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h4l11-11-4-4L3 17z"/><path d="m14 5 4 4"/></svg>,
  reg:    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/></svg>,
  train:  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 18 9 12l4 4 8-9"/><path d="M15 7h6v6"/></svg>,
};

// — Logo —
function Logo({ collapsed }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
        <rect x="2" y="2" width="22" height="22" rx="5" fill="var(--accent)"/>
        <path d="M8 18 L13 7 L18 18" stroke="var(--accent-fg)" strokeWidth="2" fill="none" strokeLinejoin="round" strokeLinecap="round"/>
        <line x1="10.5" y1="14" x2="15.5" y2="14" stroke="var(--accent-fg)" strokeWidth="2" strokeLinecap="round"/>
      </svg>
      {!collapsed && (
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
          <span style={{ fontWeight: 600, fontSize: "var(--t-md)", letterSpacing: "-0.01em" }}>Anima</span>
          <span style={{ fontSize: "var(--t-xs)", color: "var(--fg-tertiary)", fontFamily: "var(--font-mono)" }}>lora studio · 0.4</span>
        </div>
      )}
    </div>
  );
}

// — Sidebar —
function Sidebar({ active, onNav, collapsed, onToggle, project }) {
  const main = [
    { key: "projects", label: "项目", icon: I.folder, badge: null },
    { key: "queue",    label: "队列", icon: I.queue,  badge: { text: "1", tone: "running" } },
  ];
  const tools = [
    { key: "presets",  label: "预设",   icon: I.preset },
    { key: "monitor",  label: "监控",   icon: I.monitor },
    { key: "settings", label: "设置",   icon: I.cog },
  ];

  const isProjectScope = active.startsWith("step:") || active === "project-overview";

  return (
    <aside style={{
      width: collapsed ? "var(--sidebar-collapsed-w)" : "var(--sidebar-w)",
      flexShrink: 0,
      background: "var(--bg-sunken)",
      borderRight: "1px solid var(--border-subtle)",
      display: "flex", flexDirection: "column",
      transition: "width 160ms ease",
      height: "100%",
    }}>
      <div style={{ height: "var(--topbar-h)", padding: "0 14px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border-subtle)" }}>
        <Logo collapsed={collapsed} />
        {!collapsed && (
          <button onClick={onToggle} className="btn-ghost" style={{ padding: 4, color: "var(--fg-tertiary)", background: "transparent", border: "none", borderRadius: 4 }} title="折叠">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 6l-6 6 6 6"/></svg>
          </button>
        )}
      </div>

      <nav style={{ flex: 1, padding: collapsed ? "10px 6px" : "14px 10px", display: "flex", flexDirection: "column", gap: 2, overflow: "auto" }}>
        {main.map(item => <NavItem key={item.key} item={item} active={active === item.key} collapsed={collapsed} onClick={() => onNav(item.key)} />)}

        {isProjectScope && project && (
          <div style={{ marginTop: 10 }}>
            {!collapsed && (
              <div style={{ padding: "8px 10px 6px", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: "var(--t-xs)", color: "var(--fg-tertiary)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.06em" }}>项目</span>
                <span style={{ flex: 1, height: 1, background: "var(--border-subtle)" }}></span>
              </div>
            )}
            <div style={{
              padding: collapsed ? 0 : "8px 10px",
              margin: collapsed ? "8px 4px" : "0 4px 8px",
              borderRadius: "var(--r-md)",
              background: collapsed ? "transparent" : "var(--bg-overlay)",
              fontSize: "var(--t-sm)",
            }}>
              {!collapsed && (
                <>
                  <div style={{ fontWeight: 600, color: "var(--fg-primary)" }}>{project.title}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--t-xs)", color: "var(--fg-tertiary)", marginTop: 2 }}>v / {project.version}</div>
                </>
              )}
            </div>
            <ProjectStepperNav active={active} collapsed={collapsed} onNav={onNav} project={project} />
          </div>
        )}
      </nav>

      <div style={{ padding: collapsed ? "8px 6px" : "10px", borderTop: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 2 }}>
        {tools.map(item => <NavItem key={item.key} item={item} active={active === item.key} collapsed={collapsed} onClick={() => onNav(item.key)} />)}
        {collapsed && (
          <button onClick={onToggle} className="btn-ghost" style={{ padding: 8, marginTop: 4, color: "var(--fg-tertiary)", background: "transparent", border: "none", borderRadius: 4, display: "flex", justifyContent: "center" }} title="展开">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 6l6 6-6 6"/></svg>
          </button>
        )}
      </div>
    </aside>
  );
}

function NavItem({ item, active, collapsed, onClick }) {
  return (
    <button onClick={onClick} title={collapsed ? item.label : undefined}
      style={{
        display: "flex", alignItems: "center",
        gap: 10,
        padding: collapsed ? "9px 0" : "8px 12px",
        justifyContent: collapsed ? "center" : "flex-start",
        borderRadius: "var(--r-md)",
        background: active ? "var(--bg-surface)" : "transparent",
        color: active ? "var(--fg-primary)" : "var(--fg-secondary)",
        fontSize: "var(--t-sm)", fontWeight: active ? 600 : 500,
        border: "none",
        boxShadow: active ? "var(--sh-sm)" : "none",
        position: "relative",
        textAlign: "left",
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--bg-overlay)"; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}>
      {active && !collapsed && <span style={{ position: "absolute", left: 0, top: 8, bottom: 8, width: 3, background: "var(--accent)", borderRadius: 2 }}></span>}
      {item.icon}
      {!collapsed && <span style={{ flex: 1 }}>{item.label}</span>}
      {!collapsed && item.badge && (
        <span className={`dot dot-${item.badge.tone}`}></span>
      )}
    </button>
  );
}

function ProjectStepperNav({ active, collapsed, onNav, project }) {
  const steps = [
    { key: "step:download", label: "下载",     idx: "1", icon: I.download, status: "done" },
    { key: "step:curate",   label: "筛选",     idx: "2", icon: I.filter,   status: "done" },
    { key: "step:tag",      label: "打标",     idx: "3", icon: I.tag,      status: "done" },
    { key: "step:edit",     label: "标签编辑", idx: "4", icon: I.edit,     status: "active" },
    { key: "step:reg",      label: "正则集",   idx: "5", icon: I.reg,      status: "pending" },
    { key: "step:train",    label: "训练",     idx: "6", icon: I.train,    status: "pending" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, padding: collapsed ? "0 4px" : "0 4px" }}>
      {steps.map((s, i) => {
        const isActive = active === s.key;
        const tone = s.status === "done" ? "var(--ok)" : s.status === "active" ? "var(--accent)" : "var(--fg-tertiary)";
        return (
          <button key={s.key} onClick={() => onNav(s.key)} title={collapsed ? `${s.idx}. ${s.label}` : undefined}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: collapsed ? "7px 0" : "7px 10px",
              justifyContent: collapsed ? "center" : "flex-start",
              borderRadius: "var(--r-md)",
              background: isActive ? "var(--bg-surface)" : "transparent",
              border: "none",
              color: isActive ? "var(--fg-primary)" : "var(--fg-secondary)",
              fontSize: "var(--t-sm)",
              fontWeight: isActive ? 600 : 400,
              position: "relative",
              boxShadow: isActive ? "var(--sh-sm)" : "none",
            }}
            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-overlay)"; }}
            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}>
            <span style={{
              width: 20, height: 20, borderRadius: "50%",
              background: s.status === "done" ? "var(--ok-soft)" : s.status === "active" ? "var(--accent-soft)" : "var(--bg-overlay)",
              color: tone,
              display: "grid", placeItems: "center",
              fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)",
              flexShrink: 0,
            }}>
              {s.status === "done" ? I.check : s.idx}
            </span>
            {!collapsed && <span style={{ flex: 1, textAlign: "left" }}>{s.label}</span>}
            {!collapsed && s.status === "active" && <span className="dot dot-running"></span>}
          </button>
        );
      })}
    </div>
  );
}

// — Topbar —
function Topbar({ breadcrumbs, projectStatus, onCommand }) {
  return (
    <header style={{
      height: "var(--topbar-h)",
      padding: "0 20px",
      display: "flex", alignItems: "center", gap: 16,
      borderBottom: "1px solid var(--border-subtle)",
      background: "var(--bg-canvas)",
      flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
        {breadcrumbs.map((b, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span style={{ color: "var(--fg-tertiary)" }}>/</span>}
            <span style={{
              fontSize: "var(--t-sm)",
              fontFamily: b.mono ? "var(--font-mono)" : "var(--font-sans)",
              color: i === breadcrumbs.length - 1 ? "var(--fg-primary)" : "var(--fg-secondary)",
              fontWeight: i === breadcrumbs.length - 1 ? 600 : 400,
            }}>{b.label}</span>
          </React.Fragment>
        ))}
      </div>

      <button onClick={onCommand} style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "5px 10px 5px 12px",
        background: "var(--bg-surface)", border: "1px solid var(--border-default)",
        borderRadius: "var(--r-md)", color: "var(--fg-tertiary)",
        fontSize: "var(--t-sm)", minWidth: 200,
      }}>
        {I.search}
        <span style={{ flex: 1, textAlign: "left" }}>跳转 / 搜索…</span>
        <span className="kbd">⌘K</span>
      </button>

      {projectStatus && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "5px 12px",
          background: "var(--accent-soft)",
          borderRadius: "var(--r-md)",
          border: "1px solid var(--accent)",
          color: "var(--accent)",
          fontSize: "var(--t-sm)", fontWeight: 500,
        }}>
          <span className="dot dot-running"></span>
          <span>训练中 · {projectStatus.task}</span>
          <span className="mono" style={{ color: "var(--fg-secondary)" }}>{projectStatus.step}</span>
        </div>
      )}
    </header>
  );
}

window.ALSChrome = { Sidebar, Topbar, I, Logo };
