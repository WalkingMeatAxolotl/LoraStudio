import { api, type MonitorState } from '../../../api/client'
import { AXIS_LABELS, type XYAxisDraft } from './xy'

type Sample = NonNullable<MonitorState['samples']>[number]

function labelOf(s: Sample, xDraft: XYAxisDraft, yDraft: XYAxisDraft | null): string {
  if (!s.xy) return ''
  const x = `${AXIS_LABELS[xDraft.axis]}=${s.xy.xv}`
  if (yDraft && s.xy.yv !== null) {
    return `${x} · ${AXIS_LABELS[yDraft.axis]}=${s.xy.yv}`
  }
  return x
}

/** 双图对比：从当前 XY 结果选 2 张并排大图。
 *
 * Image 7 重新解读：不是历史 pin，而是当前 XY 的两张 cell 大图对比。
 * 用户从 XY grid 选 2 个 cell → 自动进入此 view → 看完点「← 返回 XY」回 grid。 */
export default function PreviewCompare({
  samples, taskId, selectedIndices, xDraft, yDraft, onBack,
}: {
  samples: NonNullable<MonitorState['samples']>
  taskId: number
  selectedIndices: [number, number]
  xDraft: XYAxisDraft
  yDraft: XYAxisDraft | null
  onBack: () => void
}) {
  const [aIdx, bIdx] = selectedIndices
  const sampleA = samples[aIdx]
  const sampleB = samples[bIdx]

  if (!sampleA || !sampleB) {
    return (
      <div className="flex flex-col gap-3">
        <button onClick={onBack} className="self-start btn btn-ghost btn-sm text-xs">
          ← 返回 XY
        </button>
        <div
          className="grid place-items-center rounded-md border border-subtle bg-sunken text-fg-tertiary text-sm"
          style={{ minHeight: 260 }}
        >
          所选样本已不可用 —— 重新选择 2 张
        </div>
      </div>
    )
  }

  const fnA = sampleA.path.split(/[\\/]/).pop() ?? sampleA.path
  const fnB = sampleB.path.split(/[\\/]/).pop() ?? sampleB.path
  const urlA = api.generateSampleUrl(taskId, fnA)
  const urlB = api.generateSampleUrl(taskId, fnB)

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={onBack}
        className="self-start btn btn-ghost btn-sm text-xs text-fg-secondary"
      >
        ← 返回 XY
      </button>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[
          { sample: sampleA, fn: fnA, url: urlA, side: 'A' as const },
          { sample: sampleB, fn: fnB, url: urlB, side: 'B' as const },
        ].map(({ sample, fn, url, side }) => (
          <div key={side} className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-2xs">
              <span className="badge badge-info shrink-0">{side}</span>
              <span className="font-mono text-fg-tertiary truncate">
                {labelOf(sample, xDraft, yDraft) || fn}
              </span>
            </div>
            <a href={url} target="_blank" rel="noreferrer" className="block">
              <img
                src={url}
                className="w-full rounded-md border border-subtle object-contain bg-sunken"
                style={{ maxHeight: 600 }}
                alt={fn}
              />
            </a>
            <div className="font-mono text-2xs text-fg-tertiary truncate" title={sample.path}>
              {fn}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
