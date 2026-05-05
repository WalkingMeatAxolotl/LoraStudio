// Pages — projects list, project overview, all 6 steps, queue, queue detail, settings
const { useState: uS, useEffect: uE, useMemo: uM } = React;
const Iconz = window.ALSChrome.I;

// ── shared ──
function PageHeader({ eyebrow, title, subtitle, actions, sticky }) {
  return (
    <div style={{
      padding: "20px 24px 16px",
      background: "var(--bg-canvas)",
      borderBottom: "1px solid var(--border-subtle)",
      position: sticky ? "sticky" : "relative",
      top: 0, zIndex: 5,
    }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {eyebrow && <div className="caption" style={{ marginBottom: 6 }}>{eyebrow}</div>}
          <h1 style={{ margin: 0, fontSize: "var(--t-2xl)", fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.15 }}>{title}</h1>
          {subtitle && <p style={{ margin: "6px 0 0", color: "var(--fg-secondary)", fontSize: "var(--t-md)", maxWidth: 720 }}>{subtitle}</p>}
        </div>
        {actions && <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{actions}</div>}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, tone, large, mono = true }) {
  const toneColor = tone === "ok" ? "var(--ok)" : tone === "warn" ? "var(--warn)" : tone === "err" ? "var(--err)" : tone === "accent" ? "var(--accent)" : "var(--fg-primary)";
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="caption" style={{ marginBottom: 10 }}>{label}</div>
      <div style={{
        fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
        fontSize: large ? "var(--t-3xl)" : "var(--t-2xl)",
        fontWeight: 600, letterSpacing: "-0.02em",
        color: toneColor, lineHeight: 1.05,
      }}>{value}</div>
      {sub && <div style={{ marginTop: 6, fontSize: "var(--t-sm)", color: "var(--fg-tertiary)" }}>{sub}</div>}
    </div>
  );
}

// ── 1. Projects list ──
function ProjectsPage({ onOpen }) {
  const projects = [
    { id: 1, title: "犬山玉藻 · v3 风格学习", slug: "inuyama-tamamo", version: "high-lr", stage: "training", images: 142, regs: 320, lastRun: "12 分钟前", status: "running", progress: 0.42 },
    { id: 2, title: "胡桃 · 战斗动作", slug: "hutao-action", version: "baseline", stage: "ready", images: 88, regs: 0, lastRun: "昨天 23:14", status: "ready" },
    { id: 3, title: "刻晴 · 服装精修", slug: "keqing-outfit", version: "v2-finetune", stage: "tagging", images: 56, regs: 0, lastRun: "3 天前", status: "tagging" },
    { id: 4, title: "原创角色 · OC-aria", slug: "oc-aria", version: "baseline", stage: "done", images: 240, regs: 480, lastRun: "5 天前", status: "done" },
    { id: 5, title: "宫崎骏画风模仿", slug: "ghibli-style", version: "baseline", stage: "curating", images: 312, regs: 0, lastRun: "1 周前", status: "curating" },
  ];
  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="工作台 · projects"
        title="项目"
        subtitle="每个项目对应一个 LoRA 训练目标 — 角色、风格或概念。新建一个项目开始流水线。"
        actions={<>
          <button className="btn btn-secondary btn-sm">导入 zip</button>
          <button className="btn btn-primary">{Iconz.plus}<span>新建项目</span></button>
        </>}
      />
      <div style={{ padding: 24, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
        {projects.map(p => (
          <button key={p.id} onClick={() => onOpen(p)} className="card card-hover" style={{
            padding: 18, textAlign: "left", border: "1px solid var(--border-subtle)",
            background: "var(--bg-surface)",
            cursor: "pointer", display: "flex", flexDirection: "column", gap: 14,
            position: "relative",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "var(--t-md)", fontWeight: 600, letterSpacing: "-0.01em" }}>{p.title}</div>
                <div className="mono" style={{ fontSize: "var(--t-xs)", color: "var(--fg-tertiary)", marginTop: 2 }}>{p.slug} / {p.version}</div>
              </div>
              <StageBadge stage={p.stage} />
            </div>

            {p.status === "running" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--t-xs)", color: "var(--fg-tertiary)", fontFamily: "var(--font-mono)", marginBottom: 4 }}>
                  <span>step 4,200 / 10,000</span><span>{Math.round(p.progress * 100)}%</span>
                </div>
                <div style={{ height: 4, background: "var(--bg-overlay)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ width: `${p.progress * 100}%`, height: "100%", background: "var(--accent)" }}></div>
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 18, fontSize: "var(--t-sm)", color: "var(--fg-secondary)", marginTop: "auto" }}>
              <Stat label="train" value={p.images} />
              <Stat label="reg"   value={p.regs} />
              <span style={{ flex: 1 }}></span>
              <span style={{ color: "var(--fg-tertiary)", fontSize: "var(--t-xs)" }}>{p.lastRun}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "baseline" }}>
      <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--fg-primary)" }}>{value}</span>
      <span style={{ fontSize: "var(--t-xs)", color: "var(--fg-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
    </span>
  );
}

function StageBadge({ stage }) {
  const map = {
    training: { tone: "accent", icon: <span className="dot dot-running"></span>, label: "训练中" },
    ready:    { tone: "info",   label: "就绪" },
    tagging:  { tone: "warn",   label: "打标中" },
    curating: { tone: "warn",   label: "筛选中" },
    done:     { tone: "ok",     label: "已完成" },
  };
  const s = map[stage] || { tone: "neutral", label: stage };
  return <span className={`badge badge-${s.tone}`}>{s.icon}{s.label}</span>;
}

// ── 2. Project overview ──
function ProjectOverview({ project, onStep }) {
  const stats = [
    { label: "train images",   value: 142, sub: "已打标 142 / 142" },
    { label: "reg images",     value: 320, sub: "AR 桶: 5" },
    { label: "tag count",      value: "1,847", sub: "去重后 412 唯一" },
    { label: "已完成步骤",     value: "3 / 6", sub: "下一步 → 标签编辑", tone: "accent", mono: false },
  ];
  return (
    <div className="fade-in">
      <PageHeader
        eyebrow={`项目 · ${project.slug}`}
        title={project.title}
        subtitle="数据已下载并完成自动打标。继续编辑标签，或跳到正则集生成。"
        actions={<>
          <button className="btn btn-secondary btn-sm">{Iconz.download}<span>导出训练集</span></button>
          <button className="btn btn-primary" onClick={() => onStep("step:edit")}>继续 → 标签编辑 {Iconz.arrow}</button>
        </>}
      />
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          {stats.map((s, i) => <StatCard key={i} {...s} />)}
        </div>

        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 style={{ margin: 0, fontSize: "var(--t-md)", fontWeight: 600 }}>流水线进度</h2>
            <span className="caption">stages</span>
          </div>
          <div style={{ padding: 18 }}>
            <PipelineTimeline />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20 }}>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border-subtle)" }}>
              <h2 style={{ margin: 0, fontSize: "var(--t-md)", fontWeight: 600 }}>近期任务</h2>
            </div>
            <div>
              {[
                { id: 412, kind: "train", v: "high-lr",    status: "running", time: "12m" },
                { id: 408, kind: "tag",   v: "high-lr",    status: "done",    time: "2h" },
                { id: 401, kind: "train", v: "baseline",   status: "done",    time: "1d" },
                { id: 388, kind: "reg",   v: "baseline",   status: "failed",  time: "2d" },
              ].map((t, i) => (
                <div key={i} style={{ padding: "12px 18px", display: "flex", alignItems: "center", gap: 12, borderTop: i ? "1px solid var(--border-subtle)" : "none" }}>
                  <span className={`dot dot-${t.status === "running" ? "running" : t.status === "done" ? "ok" : "err"}`}></span>
                  <span className="mono" style={{ fontSize: "var(--t-sm)", color: "var(--fg-tertiary)" }}>#{t.id}</span>
                  <span style={{ fontWeight: 500 }}>{t.kind}</span>
                  <span className="mono" style={{ fontSize: "var(--t-sm)", color: "var(--fg-tertiary)" }}>{t.v}</span>
                  <span style={{ flex: 1 }}></span>
                  <span style={{ fontSize: "var(--t-sm)", color: "var(--fg-tertiary)" }}>{t.time}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 18 }}>
            <h2 style={{ margin: "0 0 14px", fontSize: "var(--t-md)", fontWeight: 600 }}>版本</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { label: "high-lr", active: true,  desc: "lr 8e-4 · LoRA rank 32", stage: "training" },
                { label: "baseline", active: false, desc: "lr 2e-4 · LoKr factor 8", stage: "done" },
              ].map(v => (
                <div key={v.label} style={{
                  padding: 12,
                  borderRadius: "var(--r-md)",
                  border: v.active ? "1px solid var(--accent)" : "1px solid var(--border-subtle)",
                  background: v.active ? "var(--accent-soft)" : "transparent",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{v.label}</span>
                    <StageBadge stage={v.stage} />
                  </div>
                  <div style={{ marginTop: 4, fontSize: "var(--t-sm)", color: "var(--fg-secondary)", fontFamily: "var(--font-mono)" }}>{v.desc}</div>
                </div>
              ))}
              <button className="btn btn-ghost btn-sm" style={{ justifyContent: "center", marginTop: 4, border: "1px dashed var(--border-default)" }}>{Iconz.plus} 新版本</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PipelineTimeline() {
  const steps = [
    { idx: 1, label: "下载",     status: "done",   meta: "142 images · gelbooru" },
    { idx: 2, label: "筛选",     status: "done",   meta: "142 / 168 retained" },
    { idx: 3, label: "打标",     status: "done",   meta: "WD14 vit-v3 · 0.35" },
    { idx: 4, label: "标签编辑", status: "active", meta: "412 unique tags" },
    { idx: 5, label: "正则集",   status: "pending", meta: "—" },
    { idx: 6, label: "训练",     status: "pending", meta: "preset: anime-r32" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${steps.length}, 1fr)`, gap: 0 }}>
      {steps.map((s, i) => (
        <div key={i} style={{ position: "relative", padding: "0 8px" }}>
          {i > 0 && (
            <div style={{
              position: "absolute", top: 14, left: 0, width: "calc(50% - 16px)",
              height: 2, background: s.status !== "pending" && steps[i-1].status === "done" ? "var(--ok)" : "var(--border-subtle)",
            }}></div>
          )}
          {i < steps.length - 1 && (
            <div style={{
              position: "absolute", top: 14, right: 0, width: "calc(50% - 16px)",
              height: 2, background: s.status === "done" ? "var(--ok)" : "var(--border-subtle)",
            }}></div>
          )}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", position: "relative" }}>
            <div style={{
              width: 30, height: 30, borderRadius: "50%",
              background: s.status === "done" ? "var(--ok)" : s.status === "active" ? "var(--accent)" : "var(--bg-overlay)",
              color: s.status === "pending" ? "var(--fg-tertiary)" : "white",
              display: "grid", placeItems: "center",
              fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 12,
              border: s.status === "active" ? "3px solid var(--accent-soft)" : "none",
            }}>{s.status === "done" ? "✓" : s.idx}</div>
            <div style={{ marginTop: 8, fontSize: "var(--t-sm)", fontWeight: s.status === "active" ? 600 : 500 }}>{s.label}</div>
            <div className="mono" style={{ fontSize: "var(--t-xs)", color: "var(--fg-tertiary)", marginTop: 2 }}>{s.meta}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

window.ALSPages1 = { ProjectsPage, ProjectOverview, PageHeader, StatCard, StageBadge, PipelineTimeline };
