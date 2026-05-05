// Reg, Train, Queue, QueueDetail (monitor grid), Settings
const PHx = window.ALSPages1.PageHeader;
const SCx = window.ALSPages1.StatCard;
const ICX = window.ALSChrome.I;
const { StepShell, Field, Chip, ImgTile } = window.ALSPages2;
const { useState: us3 } = React;

// ── ⑤ Regularization ──
function RegPage() {
  return (
    <StepShell idx="5" title="正则集生成" subtitle="按训练集的 AR 桶分布生成同数量正则图，避免过拟合。"
      actions={<button className="btn btn-primary">{ICX.bolt} 生成 320 张</button>}>
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 20 }}>
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ margin: "0 0 14px", fontSize: "var(--t-md)", fontWeight: 600 }}>生成参数</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="基础模型"><select className="input"><option>animagine-xl-3.1</option><option>noobai-xl-eps-1.1</option></select></Field>
            <Field label="正则 prompt 模板"><textarea className="input input-mono" rows="2" defaultValue="1girl, solo, ((masterpiece)), simple background" /></Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <Field label="每桶倍数"><input className="input input-mono" defaultValue="3×" /></Field>
              <Field label="steps"><input className="input input-mono" defaultValue="28" /></Field>
              <Field label="cfg"><input className="input input-mono" defaultValue="6.5" /></Field>
            </div>
            <Field label="负面词" hint="可选">
              <input className="input input-mono" defaultValue="lowres, bad anatomy, jpeg artifacts" />
            </Field>
          </div>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "var(--t-md)", fontWeight: 600 }}>AR 桶分布</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              ["1024×1024 (1:1)",   42, "var(--accent)"],
              ["896×1152 (3:4)",   38, "var(--accent)"],
              ["768×1280 (3:5)",   28, "var(--accent)"],
              ["1152×896 (4:3)",   22, "var(--accent)"],
              ["1280×768 (5:3)",   12, "var(--accent)"],
            ].map(([name, n, c]) => (
              <div key={name}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--t-sm)", marginBottom: 3 }}>
                  <span className="mono">{name}</span><span className="mono" style={{ color: "var(--fg-tertiary)" }}>{n} / {n * 3}</span>
                </div>
                <div style={{ height: 6, background: "var(--bg-sunken)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${(n / 42) * 100}%`, height: "100%", background: c, opacity: 0.85 }}></div>
                </div>
              </div>
            ))}
          </div>
          <div className="divider" style={{ margin: "16px 0" }}></div>
          <div style={{ fontSize: "var(--t-sm)", color: "var(--fg-secondary)" }}>预计耗时 <b className="mono" style={{ color: "var(--fg-primary)" }}>~38 min</b> · 4090 · batch 4</div>
        </div>
      </div>
    </StepShell>
  );
}

// ── ⑥ Train ──
function TrainPage({ onLaunch }) {
  return (
    <StepShell idx="6" title="训练" subtitle="选预设 → 调几个关键参数 → 入队。完整 toml 在「高级」中编辑。"
      actions={<><button className="btn btn-secondary btn-sm">保存为预设…</button><button className="btn btn-primary" onClick={onLaunch}>{ICX.train} 入队 (high-lr)</button></>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: "var(--t-md)", fontWeight: 600 }}>预设</h3>
              <button className="btn btn-ghost btn-sm">管理预设…</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              {[
                { id: "anime-r32", name: "anime-r32",     sub: "LoRA · rank 32 · lr 5e-4", tag: "默认" },
                { id: "high-lr",   name: "high-lr",       sub: "LoRA · rank 32 · lr 8e-4", on: true },
                { id: "lokr-8",    name: "lokr-factor-8", sub: "LoKr · factor 8 · lr 2e-4" },
              ].map(p => (
                <div key={p.id} className={p.on ? "" : "card-hover"} style={{
                  padding: 14, borderRadius: "var(--r-md)",
                  border: p.on ? "1px solid var(--accent)" : "1px solid var(--border-subtle)",
                  background: p.on ? "var(--accent-soft)" : "var(--bg-surface)",
                  cursor: "pointer",
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{p.name}</span>
                    {p.tag && <span className="badge badge-neutral">{p.tag}</span>}
                    {p.on && <span className="badge badge-accent">使用中</span>}
                  </div>
                  <div className="mono" style={{ fontSize: "var(--t-xs)", color: "var(--fg-tertiary)", marginTop: 4 }}>{p.sub}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ margin: "0 0 14px", fontSize: "var(--t-md)", fontWeight: 600 }}>关键参数</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <Field label="learning rate"><input className="input input-mono" defaultValue="8e-4" /></Field>
              <Field label="rank (network dim)"><input className="input input-mono" defaultValue="32" /></Field>
              <Field label="alpha"><input className="input input-mono" defaultValue="16" /></Field>
              <Field label="batch size"><input className="input input-mono" defaultValue="4" /></Field>
              <Field label="max steps"><input className="input input-mono" defaultValue="10000" /></Field>
              <Field label="save every"><input className="input input-mono" defaultValue="500" /></Field>
              <Field label="optimizer"><select className="input"><option>AdamW8bit</option><option>Lion</option><option>Prodigy</option></select></Field>
              <Field label="scheduler"><select className="input"><option>cosine</option><option>constant_with_warmup</option></select></Field>
              <Field label="resolution"><select className="input"><option>1024</option><option>768</option></select></Field>
            </div>
            <div className="divider" style={{ margin: "14px 0" }}></div>
            <details>
              <summary style={{ cursor: "pointer", fontSize: "var(--t-sm)", fontWeight: 500, color: "var(--fg-secondary)" }}>高级 — 完整 toml…</summary>
              <pre className="mono" style={{ background: "var(--bg-sunken)", padding: 12, borderRadius: "var(--r-md)", marginTop: 10, fontSize: "var(--t-xs)", color: "var(--fg-secondary)", maxHeight: 200, overflow: "auto" }}>{`[network_arguments]
network_module = "networks.lora"
network_dim = 32
network_alpha = 16

[optimizer_arguments]
optimizer_type = "AdamW8bit"
learning_rate = 8e-4
lr_scheduler = "cosine"
...`}</pre>
            </details>
          </div>
        </div>

        <div className="card" style={{ padding: 18, alignSelf: "start", position: "sticky", top: 20 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "var(--t-md)", fontWeight: 600 }}>预估</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <SCx label="dataset" value="142" sub="train · 320 reg" />
            <SCx label="steps / epoch" value="35" />
            <SCx label="预计时长" value="3h 42m" sub="RTX 4090 · 24 GB" tone="accent" />
            <SCx label="vram peak" value="18.4 GB" sub="留 5.6 GB 余量" tone="ok" />
          </div>
          <div className="divider" style={{ margin: "14px 0" }}></div>
          <div style={{ fontSize: "var(--t-xs)", color: "var(--fg-tertiary)", fontFamily: "var(--font-mono)", lineHeight: 1.6 }}>
            数据集校验 ✓<br/>显存检查 ✓<br/>队列空闲 ✓ — 可立即开始
          </div>
        </div>
      </div>
    </StepShell>
  );
}

// ── Queue ──
function QueuePage({ onOpen }) {
  const tasks = [
    { id: 412, name: "犬山玉藻 / high-lr", kind: "train", status: "running", started: "12 min ago", progress: 0.42, step: "4,200 / 10,000", eta: "2h 14m" },
    { id: 411, name: "胡桃 / baseline",    kind: "tag",   status: "queued",  eta: "等 2h 14m" },
    { id: 410, name: "犬山玉藻 / baseline",kind: "train", status: "done",    finished: "1d ago", duration: "3h 21m" },
    { id: 409, name: "OC-aria / baseline", kind: "reg",   status: "done",    finished: "2d ago", duration: "38m" },
    { id: 408, name: "刻晴 / v2",          kind: "train", status: "failed",  finished: "3d ago", err: "OOM at step 1820" },
  ];
  return (
    <div className="fade-in">
      <PHx eyebrow="全局 · queue" title="队列" subtitle="同一时刻仅运行一个任务。下一个任务等当前完成后自动开始。"
        actions={<><button className="btn btn-ghost btn-sm">清理已完成</button><button className="btn btn-secondary btn-sm">暂停队列</button></>} />
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        {tasks.map(t => (
          <button key={t.id} onClick={() => onOpen && t.status === "running" && onOpen(t)} className="card card-hover" style={{
            padding: 0, textAlign: "left", border: t.status === "running" ? "1px solid var(--accent)" : "1px solid var(--border-subtle)",
            cursor: t.status === "running" ? "pointer" : "default", overflow: "hidden", display: "block",
          }}>
            <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "60px 1fr 100px 1fr 160px", gap: 16, alignItems: "center" }}>
              <span className="mono" style={{ fontSize: "var(--t-sm)", color: "var(--fg-tertiary)" }}>#{t.id}</span>
              <div>
                <div style={{ fontWeight: 600 }}>{t.name}</div>
                <div className="mono" style={{ fontSize: "var(--t-xs)", color: "var(--fg-tertiary)", marginTop: 2 }}>{t.kind}</div>
              </div>
              <span className={`badge badge-${t.status === "running" ? "accent" : t.status === "queued" ? "neutral" : t.status === "done" ? "ok" : "err"}`}>
                {t.status === "running" && <span className="dot dot-running"></span>}
                {t.status === "running" ? "进行中" : t.status === "queued" ? "排队" : t.status === "done" ? "完成" : "失败"}
              </span>
              <div style={{ fontSize: "var(--t-sm)", color: "var(--fg-secondary)" }}>
                {t.status === "running" ? <><span className="mono">{t.step}</span><div style={{ height: 4, background: "var(--bg-overlay)", borderRadius: 2, overflow: "hidden", marginTop: 4 }}><div style={{ width: `${t.progress * 100}%`, height: "100%", background: "var(--accent)" }}></div></div></> : t.err ? <span style={{ color: "var(--err)" }}>{t.err}</span> : t.duration ? `用时 ${t.duration}` : ""}
              </div>
              <span className="mono" style={{ fontSize: "var(--t-sm)", color: "var(--fg-tertiary)", textAlign: "right" }}>
                {t.status === "running" ? `eta ${t.eta}` : t.started || t.finished || t.eta}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Queue detail = monitor grid ──
function MonitorPage({ task }) {
  // generate fake loss curve
  const points = Array.from({ length: 60 }).map((_, i) => {
    const x = i / 59;
    return 0.78 * Math.exp(-2.4 * x) + 0.05 + 0.04 * Math.sin(i * 0.6) + 0.02 * Math.random();
  });
  return (
    <div className="fade-in">
      <PHx
        eyebrow={`任务 #${task?.id || 412} · 训练中`}
        title={task?.name || "犬山玉藻 / high-lr"}
        subtitle="grid 仪表盘 — 关键指标并列；右侧采样轮播每 500 step 更新一次。"
        actions={<><button className="btn btn-secondary btn-sm">中止</button><button className="btn btn-ghost btn-sm">查看 toml</button><button className="btn btn-ghost btn-sm">tensorboard ↗</button></>}
      />
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* big stats row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
          <SCx label="step" value="4,200" sub="of 10,000" mono large tone="accent" />
          <SCx label="loss" value="0.0824" sub="↓ 0.0021 (60s)" mono large tone="ok" />
          <SCx label="lr" value="6.4e-4" sub="cosine · 42% decay" mono large />
          <SCx label="vram" value="18.4 GB" sub="of 24 GB · 76%" mono large tone="warn" />
          <SCx label="eta" value="2h 14m" sub="3.21 it/s" mono large />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16 }}>
          <div className="card" style={{ padding: 20, minHeight: 320 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: "var(--t-md)", fontWeight: 600 }}>loss</h3>
              <div style={{ display: "flex", gap: 6 }}>
                {["1h", "全部", "smooth"].map((l, i) => <Chip key={l} label={l} on={i === 1} />)}
              </div>
            </div>
            <LossChart points={points} />
          </div>

          <div className="card" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: "var(--t-md)", fontWeight: 600 }}>采样 — step 4,000</h3>
              <span className="mono" style={{ fontSize: "var(--t-xs)", color: "var(--fg-tertiary)" }}>4 / 8</span>
            </div>
            <div style={{ padding: 12, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, flex: 1 }}>
              {[100, 101, 102, 103].map(i => <ImgTile key={i} idx={i} ar="1 / 1" />)}
            </div>
            <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border-subtle)", display: "flex", gap: 6 }}>
              <button className="btn btn-ghost btn-sm" style={{ flex: 1 }}>‹ step 3500</button>
              <button className="btn btn-ghost btn-sm" style={{ flex: 1 }}>step 4500 ›</button>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.4fr", gap: 16 }}>
          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ margin: "0 0 10px", fontSize: "var(--t-md)", fontWeight: 600 }}>throughput</h3>
            <div className="mono" style={{ fontSize: "var(--t-3xl)", fontWeight: 600, letterSpacing: "-0.02em" }}>3.21 <span style={{ fontSize: "var(--t-md)", color: "var(--fg-tertiary)" }}>it/s</span></div>
            <Sparkline values={Array.from({ length: 30 }).map(() => 3.0 + Math.random() * 0.4)} color="var(--info)" />
          </div>
          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ margin: "0 0 10px", fontSize: "var(--t-md)", fontWeight: 600 }}>gpu temp</h3>
            <div className="mono" style={{ fontSize: "var(--t-3xl)", fontWeight: 600, letterSpacing: "-0.02em" }}>72<span style={{ fontSize: "var(--t-md)", color: "var(--fg-tertiary)" }}>°C</span></div>
            <Sparkline values={Array.from({ length: 30 }).map((_, i) => 65 + Math.sin(i * 0.4) * 4 + i * 0.15)} color="var(--warn)" />
          </div>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontSize: "var(--t-md)", fontWeight: 600 }}>checkpoints</h3>
              <span className="caption">最近 4 个</span>
            </div>
            <div>
              {[
                { step: 4000, size: "144 MB", time: "2 min ago", best: false },
                { step: 3500, size: "144 MB", time: "10 min ago", best: true },
                { step: 3000, size: "144 MB", time: "20 min ago" },
                { step: 2500, size: "144 MB", time: "30 min ago" },
              ].map((c, i) => (
                <div key={i} style={{ padding: "10px 18px", display: "flex", alignItems: "center", gap: 12, borderTop: i ? "1px solid var(--border-subtle)" : "none" }}>
                  <span className="mono" style={{ fontSize: "var(--t-sm)", fontWeight: 600 }}>step {c.step.toLocaleString()}</span>
                  {c.best && <span className="badge badge-ok">best</span>}
                  <span style={{ flex: 1 }}></span>
                  <span className="mono" style={{ fontSize: "var(--t-xs)", color: "var(--fg-tertiary)" }}>{c.size}</span>
                  <span style={{ fontSize: "var(--t-xs)", color: "var(--fg-tertiary)" }}>{c.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h3 style={{ margin: 0, fontSize: "var(--t-md)", fontWeight: 600 }}>训练日志</h3>
            <div style={{ display: "flex", gap: 6 }}>{["INFO", "WARN", "ERR"].map((l, i) => <Chip key={l} label={l} on={i < 2} />)}</div>
          </div>
          <pre className="mono" style={{ margin: 0, padding: 16, background: "var(--bg-sunken)", fontSize: "var(--t-xs)", color: "var(--fg-secondary)", maxHeight: 220, overflow: "auto", lineHeight: 1.7 }}>{`[14:22:41] step 4200/10000 loss=0.0824 lr=6.4e-4 ⏱  3.21 it/s
[14:22:14] step 4150/10000 loss=0.0843 lr=6.5e-4
[14:21:48] step 4100/10000 loss=0.0838 lr=6.5e-4
[14:21:21] step 4050/10000 loss=0.0851 lr=6.6e-4
[14:20:55] step 4000/10000 loss=0.0859 lr=6.7e-4 [✓] saved tamamo-step4000.safetensors
[14:20:55] sample: 8 images @ 768×1024 → samples/step4000/
[14:20:28] step 3950/10000 loss=0.0867 lr=6.7e-4
[14:20:01] step 3900/10000 loss=0.0871 lr=6.8e-4`}</pre>
        </div>
      </div>
    </div>
  );
}

function LossChart({ points }) {
  const w = 760, h = 220, pad = 24;
  const max = Math.max(...points), min = Math.min(...points);
  const x = i => pad + (i / (points.length - 1)) * (w - 2 * pad);
  const y = v => pad + (1 - (v - min) / (max - min)) * (h - 2 * pad);
  const path = points.map((p, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join(" ");
  const area = path + ` L ${x(points.length - 1)} ${h - pad} L ${x(0)} ${h - pad} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: 240 }}>
      {[0.25, 0.5, 0.75].map(t => (
        <line key={t} x1={pad} y1={pad + t * (h - 2 * pad)} x2={w - pad} y2={pad + t * (h - 2 * pad)} stroke="var(--border-subtle)" strokeDasharray="3 3"/>
      ))}
      <path d={area} fill="var(--accent-soft)" opacity="0.6"/>
      <path d={path} stroke="var(--accent)" strokeWidth="2" fill="none" strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx={x(points.length - 1)} cy={y(points[points.length - 1])} r="4" fill="var(--accent)" stroke="var(--bg-surface)" strokeWidth="2"/>
      <text x={pad} y={pad - 6} fontSize="10" fill="var(--fg-tertiary)" fontFamily="var(--font-mono)">{max.toFixed(3)}</text>
      <text x={pad} y={h - 8} fontSize="10" fill="var(--fg-tertiary)" fontFamily="var(--font-mono)">{min.toFixed(3)}</text>
    </svg>
  );
}

function Sparkline({ values, color }) {
  const w = 200, h = 50;
  const max = Math.max(...values), min = Math.min(...values);
  const x = i => (i / (values.length - 1)) * w;
  const y = v => h - ((v - min) / (max - min || 1)) * h;
  const path = values.map((p, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: 50, marginTop: 8 }}>
      <path d={path} stroke={color} strokeWidth="1.5" fill="none"/>
    </svg>
  );
}

// ── Settings ──
function SettingsPage() {
  return (
    <div className="fade-in">
      <PHx eyebrow="全局 · settings" title="设置" subtitle="路径、模型、数据源、外部服务。" />
      <div style={{ padding: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, maxWidth: 1200 }}>
        {[
          { title: "工作目录", rows: [["projects 根目录", "/home/zoe/lora-projects"], ["缓存目录", "/var/cache/anima"], ["模型库", "/data/models"]] },
          { title: "训练后端", rows: [["sd-scripts 路径", "../sd-scripts"], ["python", "venv/bin/python3.11"], ["默认 GPU", "cuda:0 (RTX 4090 24GB)"]] },
          { title: "Booru 凭证", rows: [["Gelbooru API key", "*** *** ce92"], ["Danbooru login", "tamamo_lover"], ["代理", "socks5://127.0.0.1:7890"]] },
          { title: "JoyCaption", rows: [["vLLM 端点", "http://localhost:8000/v1"], ["模型", "joycaption-alpha-two"]] },
        ].map(s => (
          <div key={s.title} className="card" style={{ padding: 0 }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border-subtle)" }}>
              <h3 style={{ margin: 0, fontSize: "var(--t-md)", fontWeight: 600 }}>{s.title}</h3>
            </div>
            <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
              {s.rows.map(([k, v]) => (
                <div key={k} style={{ display: "grid", gridTemplateColumns: "180px 1fr", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: "var(--t-sm)", color: "var(--fg-secondary)" }}>{k}</span>
                  <input className="input input-mono" defaultValue={v} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.ALSPages3 = { RegPage, TrainPage, QueuePage, MonitorPage, SettingsPage };
