// Step pages — Download, Curation, Tagging, TagEdit, Regularization, Train
const PH = window.ALSPages1.PageHeader;
const SC = window.ALSPages1.StatCard;
const ICN = window.ALSChrome.I;
const { useState: us2 } = React;

// shared step layout: top eyebrow + content area
function StepShell({ idx, title, subtitle, actions, children }) {
  return (
    <div className="fade-in">
      <PH eyebrow={`第 ${idx} 步 · pipeline`} title={title} subtitle={subtitle} actions={actions} sticky />
      <div style={{ padding: 24 }}>{children}</div>
    </div>
  );
}

// — placeholder image tile —
function ImgTile({ idx, selected, tagged, onClick, ar = "1 / 1" }) {
  const hue = (idx * 47) % 360;
  return (
    <button onClick={onClick} style={{
      position: "relative",
      aspectRatio: ar,
      borderRadius: "var(--r-md)",
      border: selected ? "2px solid var(--accent)" : "1px solid var(--border-subtle)",
      background: `linear-gradient(135deg, hsl(${hue}, 30%, 70%), hsl(${(hue + 40) % 360}, 25%, 60%))`,
      padding: 0, overflow: "hidden", cursor: "pointer",
      boxShadow: selected ? "0 0 0 3px var(--accent-soft)" : "none",
    }}>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.5), transparent 40%)" }}></div>
      <div style={{ position: "absolute", top: 6, left: 6, fontFamily: "var(--font-mono)", fontSize: 10, color: "white", background: "rgba(0,0,0,0.4)", padding: "1px 5px", borderRadius: 3 }}>{`#${(idx + 1).toString().padStart(3, "0")}`}</div>
      {tagged && <div style={{ position: "absolute", top: 6, right: 6 }}><span className="badge badge-ok" style={{ fontSize: 9, padding: "1px 5px" }}>tagged</span></div>}
      {selected && <div style={{ position: "absolute", top: 6, right: 6, width: 18, height: 18, borderRadius: "50%", background: "var(--accent)", color: "white", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700 }}>✓</div>}
    </button>
  );
}

// ── ① Download ──
function DownloadPage() {
  const [tab, setTab] = us2("booru");
  const sources = [
    { id: "gelbooru", name: "Gelbooru", count: 142 },
    { id: "danbooru", name: "Danbooru", count: 88 },
  ];
  return (
    <StepShell idx="1" title="下载图片" subtitle="从 Booru 抓图，或上传本地 zip / 文件夹。所有图落到 download/，再到下一步分流到 train/。"
      actions={<><button className="btn btn-secondary btn-sm">查看 download/</button><button className="btn btn-primary">{ICN.download} 开始抓取</button></>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 20 }}>
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", borderBottom: "1px solid var(--border-subtle)", padding: "0 16px" }}>
            {["booru", "upload", "url"].map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: "12px 14px", border: "none", background: "transparent",
                fontSize: "var(--t-sm)", fontWeight: tab === t ? 600 : 500,
                color: tab === t ? "var(--fg-primary)" : "var(--fg-tertiary)",
                borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
                marginBottom: -1,
              }}>{t === "booru" ? "Booru 抓取" : t === "upload" ? "本地上传" : "URL 列表"}</button>
            ))}
          </div>
          <div style={{ padding: 20 }}>
            {tab === "booru" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <Field label="标签查询" hint="Booru 风格标签语法。空格分隔 → AND。前缀 - → NOT。">
                  <input className="input input-mono" defaultValue="inuyama_tamamo solo -lowres -monochrome rating:safe" />
                </Field>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <Field label="数据源"><select className="input">{sources.map(s => <option key={s.id}>{s.name}</option>)}</select></Field>
                  <Field label="最多张数"><input className="input input-mono" defaultValue="200" /></Field>
                  <Field label="最低分"><input className="input input-mono" defaultValue="10" /></Field>
                </div>
                <Field label="质量过滤"><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {["≥ 1024px", "排除 monochrome", "排除 multi-girl", "去重 (md5)"].map(c => <Chip key={c} label={c} on />)}
                  {["排除 sketch", "仅 sfw"].map(c => <Chip key={c} label={c} />)}
                </div></Field>
              </div>
            )}
            {tab === "upload" && <UploadDropZone />}
            {tab === "url" && <Field label="URL 列表 (一行一个)"><textarea className="input input-mono" rows="8" defaultValue="https://example.com/image1.png&#10;https://example.com/image2.jpg" /></Field>}
          </div>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <h3 style={{ margin: 0, fontSize: "var(--t-md)", fontWeight: 600, marginBottom: 12 }}>当前 download/</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <SC label="已下载" value="142" sub="过去 24 小时新增 18" tone="ok" />
            <SC label="去重命中" value="6" sub="md5 重复，已跳过" />
          </div>
          <div className="divider" style={{ margin: "16px 0" }}></div>
          <h4 className="caption" style={{ marginBottom: 8 }}>最近来源</h4>
          {sources.map(s => (
            <div key={s.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: "var(--t-sm)" }}>
              <span>{s.name}</span><span className="mono" style={{ color: "var(--fg-tertiary)" }}>{s.count}</span>
            </div>
          ))}
        </div>
      </div>
    </StepShell>
  );
}

function UploadDropZone() {
  return (
    <div style={{
      border: "2px dashed var(--border-default)",
      borderRadius: "var(--r-lg)", padding: 40, textAlign: "center",
      background: "var(--bg-sunken)",
    }}>
      <div style={{ fontSize: "var(--t-lg)", fontWeight: 600, marginBottom: 6 }}>拖拽 zip / 文件夹 / 多张图至此</div>
      <div style={{ color: "var(--fg-tertiary)", fontSize: "var(--t-sm)", marginBottom: 14 }}>支持 jpg · png · webp · zip。最大 2 GB。</div>
      <button className="btn btn-secondary">选择文件…</button>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: "var(--t-sm)", fontWeight: 500, color: "var(--fg-primary)" }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: "var(--t-xs)", color: "var(--fg-tertiary)", fontFamily: "var(--font-mono)" }}>{hint}</span>}
    </label>
  );
}

function Chip({ label, on, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "4px 10px",
      border: `1px solid ${on ? "var(--accent)" : "var(--border-default)"}`,
      borderRadius: "var(--r-pill)",
      background: on ? "var(--accent-soft)" : "var(--bg-surface)",
      color: on ? "var(--accent)" : "var(--fg-secondary)",
      fontSize: "var(--t-xs)", fontFamily: "var(--font-mono)",
      cursor: "pointer",
    }}>{label}</button>
  );
}

// ── ② Curation ──
function CurationPage() {
  const [sel, setSel] = us2(new Set([2, 5, 8, 11]));
  const toggle = (i) => { const n = new Set(sel); n.has(i) ? n.delete(i) : n.add(i); setSel(n); };
  return (
    <StepShell idx="2" title="筛选 — download/ → train/" subtitle="左侧 download/ 选要训的图，复制到 train/。两边都可多选；空格预览，⌫ 删除。"
      actions={<><span style={{ fontSize: "var(--t-sm)", color: "var(--fg-tertiary)" }}>已选 <b className="mono" style={{ color: "var(--accent)" }}>{sel.size}</b> 张</span><button className="btn btn-secondary btn-sm">↑ 上传更多</button><button className="btn btn-primary" disabled={!sel.size}>{ICN.arrow} 复制到 train/ ({sel.size})</button></>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, height: "calc(100vh - 240px)" }}>
        <Pane title="download/" count="168 张" filterChips={["1024+", "sfw", "去重"]}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
            {Array.from({ length: 24 }).map((_, i) => <ImgTile key={i} idx={i} selected={sel.has(i)} onClick={() => toggle(i)} />)}
          </div>
        </Pane>
        <Pane title="train/" count="142 张" filterChips={["全部已打标"]} accent>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
            {Array.from({ length: 18 }).map((_, i) => <ImgTile key={i} idx={i + 30} tagged />)}
          </div>
        </Pane>
      </div>
    </StepShell>
  );
}

function Pane({ title, count, filterChips, accent, children }) {
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", overflow: "hidden", border: accent ? "1px solid var(--accent)" : "1px solid var(--border-subtle)" }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", gap: 10, background: accent ? "var(--accent-soft)" : "var(--bg-sunken)" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: accent ? "var(--accent)" : "var(--fg-primary)" }}>{title}</span>
        <span className="mono" style={{ color: "var(--fg-tertiary)", fontSize: "var(--t-xs)" }}>{count}</span>
        <span style={{ flex: 1 }}></span>
        {filterChips.map(c => <Chip key={c} label={c} on />)}
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 12 }}>{children}</div>
    </div>
  );
}

// ── ③ Tagging ──
function TaggingPage() {
  return (
    <StepShell idx="3" title="自动打标" subtitle="WD14 ONNX 本地推理，或 JoyCaption 远程 vLLM。每张图生成 .txt caption。"
      actions={<button className="btn btn-primary">{ICN.bolt} 开始打标 (142 张)</button>}>
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 20 }}>
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ margin: "0 0 14px", fontSize: "var(--t-md)", fontWeight: 600 }}>模型与阈值</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="WD14 模型">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[
                  { id: "vit-v3",     name: "wd-vit-tagger-v3",      sub: "默认 · 通用",          on: true },
                  { id: "swinv2-v3",  name: "wd-swinv2-tagger-v3",   sub: "更慢 · 角色细节强" },
                  { id: "convnext-v3", name: "wd-convnext-tagger-v3", sub: "平衡" },
                  { id: "eva02",      name: "wd-eva02-large-v3",     sub: "最准 · 显存高" },
                ].map(m => (
                  <div key={m.id} style={{
                    padding: 12, borderRadius: "var(--r-md)",
                    border: m.on ? "1px solid var(--accent)" : "1px solid var(--border-subtle)",
                    background: m.on ? "var(--accent-soft)" : "transparent",
                    cursor: "pointer",
                  }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--t-sm)", fontWeight: 600 }}>{m.name}</div>
                    <div style={{ fontSize: "var(--t-xs)", color: "var(--fg-tertiary)", marginTop: 2 }}>{m.sub}</div>
                  </div>
                ))}
              </div>
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="general 阈值" hint="低 → 标签更多"><input className="input input-mono" defaultValue="0.35" /></Field>
              <Field label="character 阈值" hint="角色识别"><input className="input input-mono" defaultValue="0.85" /></Field>
            </div>
            <Field label="附加 prompt"><textarea className="input input-mono" rows="2" defaultValue="masterpiece, best quality, detailed" /></Field>
          </div>
        </div>

        <div className="card" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: "var(--t-md)", fontWeight: 600 }}>预览 — img_042.png</h3>
            <button className="btn btn-ghost btn-sm">重新预测</button>
          </div>
          <div style={{ padding: 18, display: "grid", gridTemplateColumns: "180px 1fr", gap: 16 }}>
            <ImgTile idx={42} ar="3 / 4" />
            <div>
              <div className="caption" style={{ marginBottom: 8 }}>预测标签 · top 18</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {[
                  ["1girl", 0.99], ["solo", 0.98], ["fox ears", 0.96], ["fox tail", 0.94],
                  ["white hair", 0.92], ["yellow eyes", 0.88], ["kimono", 0.85], ["smile", 0.78],
                  ["outdoors", 0.71], ["forest", 0.65], ["sitting", 0.62], ["barefoot", 0.55],
                  ["red kimono", 0.51], ["long hair", 0.49], ["large breasts", 0.42], ["leaves", 0.38],
                  ["closed eyes", 0.34], ["holding fan", 0.31],
                ].map(([t, c]) => (
                  <span key={t} style={{
                    padding: "3px 8px", borderRadius: "var(--r-pill)",
                    background: c > 0.7 ? "var(--ok-soft)" : c > 0.4 ? "var(--accent-soft)" : "var(--bg-overlay)",
                    color: c > 0.7 ? "var(--ok)" : c > 0.4 ? "var(--accent)" : "var(--fg-tertiary)",
                    fontFamily: "var(--font-mono)", fontSize: "var(--t-xs)",
                  }}>{t} <span style={{ opacity: 0.7 }}>{c.toFixed(2)}</span></span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </StepShell>
  );
}

// ── ④ Tag Edit ──
function TagEditPage() {
  return (
    <StepShell idx="4" title="标签编辑" subtitle="批量替换 / 删除 / 添加；缓存模式自动保存还原点。所有变更在「应用」后落到磁盘。"
      actions={<><span style={{ fontSize: "var(--t-sm)", color: "var(--warn)" }}>⏷ 12 处未保存</span><button className="btn btn-secondary btn-sm">还原</button><button className="btn btn-primary">应用 (12)</button></>}>
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr 320px", gap: 16, height: "calc(100vh - 240px)" }}>
        <div className="card" style={{ padding: 16, overflow: "auto" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "var(--t-sm)", fontWeight: 600 }}>批量操作</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Field label="查找"><input className="input input-mono" defaultValue="white hair" /></Field>
            <Field label="替换为"><input className="input input-mono" defaultValue="silver hair" /></Field>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-secondary btn-sm" style={{ flex: 1 }}>预览</button>
              <button className="btn btn-primary btn-sm" style={{ flex: 1 }}>替换 (24)</button>
            </div>
          </div>
          <div className="divider" style={{ margin: "14px 0" }}></div>
          <h4 className="caption" style={{ marginBottom: 8 }}>添加触发词</h4>
          <Field label=""><input className="input input-mono" defaultValue="tamamo_inuyama" /></Field>
          <button className="btn btn-secondary btn-sm" style={{ width: "100%", marginTop: 6 }}>插入到所有 caption 开头</button>
        </div>

        <div className="card" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)", display: "flex", gap: 10, alignItems: "center" }}>
            <span className="mono" style={{ fontWeight: 600 }}>img_042.txt</span>
            <span className="mono" style={{ fontSize: "var(--t-xs)", color: "var(--fg-tertiary)" }}>22 / 142</span>
            <span style={{ flex: 1 }}></span>
            <button className="btn btn-ghost btn-sm">‹ 上一张</button>
            <button className="btn btn-ghost btn-sm">下一张 ›</button>
          </div>
          <div style={{ padding: 16, display: "grid", gridTemplateColumns: "200px 1fr", gap: 16, flex: 1, overflow: "auto" }}>
            <ImgTile idx={42} ar="3 / 4" />
            <div>
              <div className="caption" style={{ marginBottom: 8 }}>当前标签 (18)</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 14 }}>
                {["tamamo_inuyama", "1girl", "solo", "fox ears", "fox tail", "silver hair", "yellow eyes", "kimono", "smile", "outdoors", "forest", "sitting", "barefoot", "red kimono", "long hair", "leaves", "closed eyes", "holding fan"].map((t, i) => (
                  <span key={t} style={{
                    padding: "4px 10px 4px 10px", borderRadius: "var(--r-pill)",
                    background: i === 0 ? "var(--accent)" : i === 5 ? "var(--warn-soft)" : "var(--bg-overlay)",
                    color: i === 0 ? "white" : i === 5 ? "var(--warn)" : "var(--fg-primary)",
                    fontFamily: "var(--font-mono)", fontSize: "var(--t-sm)",
                    display: "inline-flex", gap: 6, alignItems: "center",
                  }}>{t}<button style={{ background: "transparent", border: "none", color: "inherit", padding: 0, opacity: 0.6 }}>×</button></span>
                ))}
                <button style={{ padding: "4px 10px", borderRadius: "var(--r-pill)", border: "1px dashed var(--border-default)", background: "transparent", color: "var(--fg-tertiary)", fontFamily: "var(--font-mono)", fontSize: "var(--t-sm)" }}>+ 加标签</button>
              </div>
              <div className="caption" style={{ marginBottom: 6 }}>原文</div>
              <textarea className="input input-mono" rows="4" readOnly defaultValue="tamamo_inuyama, 1girl, solo, fox ears, fox tail, silver hair, yellow eyes, kimono, smile, outdoors..." />
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 16, overflow: "auto" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "var(--t-sm)", fontWeight: 600 }}>标签分布</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {[
              ["1girl", 142, 1.00], ["solo", 138, 0.97], ["fox ears", 130, 0.92],
              ["fox tail", 128, 0.90], ["silver hair", 110, 0.77], ["yellow eyes", 98, 0.69],
              ["kimono", 76, 0.54], ["outdoors", 54, 0.38], ["smile", 46, 0.32],
              ["holding fan", 22, 0.15], ["barefoot", 18, 0.13], ["closed eyes", 12, 0.08],
            ].map(([t, n, p]) => (
              <div key={t} style={{ display: "grid", gridTemplateColumns: "1fr 60px", gap: 8, alignItems: "center", fontSize: "var(--t-xs)" }}>
                <div style={{ position: "relative", height: 18, background: "var(--bg-sunken)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ position: "absolute", inset: 0, width: `${p * 100}%`, background: p > 0.8 ? "var(--accent-soft)" : "var(--bg-overlay)" }}></div>
                  <span style={{ position: "absolute", left: 6, top: 1, fontFamily: "var(--font-mono)" }}>{t}</span>
                </div>
                <span className="mono" style={{ color: "var(--fg-tertiary)", textAlign: "right" }}>{n}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </StepShell>
  );
}

window.ALSPages2 = { DownloadPage, CurationPage, TaggingPage, TagEditPage, StepShell, Field, Chip, ImgTile };
