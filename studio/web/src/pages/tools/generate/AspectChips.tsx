/** 画幅快选 chips（对齐 Test 重设计.html 的 ASPECTS）。
 *
 * 5 个常用比例 + 自定义选项。chip 内含一个 RatioGlyph（按比例画的小矩形）
 * + 比例文字。点 chip 设 aspect = chip.name 并把 W/H 同步成 chip 预设值；
 * 自定义 chip 让 W/H 数字框生效。
 */

const ASPECTS = [
  { name: '1:1', w: 1024, h: 1024 },
  { name: '3:4', w: 896, h: 1152 },
  { name: '4:3', w: 1152, h: 896 },
  { name: '9:16', w: 768, h: 1344 },
  { name: '16:9', w: 1344, h: 768 },
] as const

export type AspectName = typeof ASPECTS[number]['name'] | 'custom'

function RatioGlyph({ w, h }: { w: number; h: number }) {
  const max = 12
  const ratio = w / h
  const ww = ratio >= 1 ? max : max * ratio
  const hh = ratio >= 1 ? max / ratio : max
  return (
    <span style={{ width: max, height: max, display: 'inline-grid', placeItems: 'center' }}>
      <span style={{
        width: ww, height: hh,
        border: '1.5px solid currentColor',
        borderRadius: 2,
      }} />
    </span>
  )
}

export default function AspectChips({
  aspect, onPick,
}: {
  aspect: AspectName
  onPick: (a: AspectName, w?: number, h?: number) => void
}) {
  const chip = (active: boolean): string =>
    `font-mono inline-flex items-center gap-1.5 ${active ? 'on' : ''}`

  return (
    <div className="flex flex-wrap gap-1.5">
      {ASPECTS.map((a) => {
        const active = aspect === a.name
        return (
          <button
            key={a.name}
            onClick={() => onPick(a.name, a.w, a.h)}
            className={chip(active)}
            style={{
              padding: '4px 9px',
              borderRadius: 999,
              border: active ? '1px solid transparent' : '1px solid var(--border-subtle)',
              background: active ? 'var(--accent-soft)' : 'var(--bg-sunken)',
              color: active ? 'var(--accent)' : 'var(--fg-secondary)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            <RatioGlyph w={a.w} h={a.h} />
            {a.name}
          </button>
        )
      })}
      <button
        onClick={() => onPick('custom')}
        className={chip(aspect === 'custom')}
        style={{
          padding: '4px 9px',
          borderRadius: 999,
          border: aspect === 'custom' ? '1px solid transparent' : '1px solid var(--border-subtle)',
          background: aspect === 'custom' ? 'var(--accent-soft)' : 'var(--bg-sunken)',
          color: aspect === 'custom' ? 'var(--accent)' : 'var(--fg-secondary)',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        自定义
      </button>
    </div>
  )
}
