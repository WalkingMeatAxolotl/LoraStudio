/** 种子输入 cluster（对齐 Test 重设计.html .seed-cluster）：
 *
 *   [   123456   ]  [🎲]  [🔒]
 *
 * - dice 按钮：random 一个新种子（1..1e6）
 * - lock 按钮：toggle seed locked 状态（后续 XY/扫描 时所有图共享一个种子）
 *   commit B：UI 上的 lock 暂时不接业务逻辑（XY 矩阵已经有 seed=0 → 共享
 *   随机种子的语义）；保留视觉形态便于后续接入。
 */

interface Props {
  value: number
  onChange: (v: number) => void
  locked: boolean
  onToggleLock: () => void
}

function IconBtn({
  active, title, onClick, children,
}: {
  active?: boolean
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        width: 32, height: 32,
        display: 'grid', placeItems: 'center',
        borderRadius: 'var(--r-md)',
        border: active ? '1px solid transparent' : '1px solid var(--border-subtle)',
        background: active ? 'var(--accent-soft)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--fg-tertiary)',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

export default function SeedCluster({ value, onChange, locked, onToggleLock }: Props) {
  return (
    <div className="flex gap-1.5 items-stretch">
      <input
        className="input font-mono flex-1"
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        placeholder="0 = 随机"
        aria-label="种子"
      />
      <IconBtn title="随机种子" onClick={() => onChange(Math.floor(Math.random() * 1_000_000))}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <circle cx="8" cy="8" r="1.5"/>
          <circle cx="16" cy="8" r="1.5"/>
          <circle cx="12" cy="12" r="1.5"/>
          <circle cx="8" cy="16" r="1.5"/>
          <circle cx="16" cy="16" r="1.5"/>
        </svg>
      </IconBtn>
      <IconBtn
        active={locked}
        title={locked ? '解锁种子' : '锁定种子（XY/扫描时所有图共享）'}
        onClick={onToggleLock}
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="11" width="16" height="10" rx="2"/>
          {locked
            ? <path d="M8 11V7a4 4 0 0 1 8 0v4"/>
            : <path d="M8 11V7a4 4 0 0 1 7-1"/>
          }
        </svg>
      </IconBtn>
    </div>
  )
}
