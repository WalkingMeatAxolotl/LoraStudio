import type { LoraEntry } from '../../../api/client'
import { projectAbbr } from './InlineLoraPicker'

/** 已添加的 LoRA 卡片：图标 + 标签 + 权重滑杆 + 删除按钮。
 *
 * label 优先用 "项目 / 版本"（picker 选的）；外部 PathPicker 的兜底成
 * 文件名 basename，path 全路径放第二行。 */
export default function LoraCard({
  lora, label, onScaleChange, onRemove,
}: {
  lora: LoraEntry
  label: string
  onScaleChange: (scale: number) => void
  onRemove: () => void
}) {
  const filename = lora.path.split(/[\\/]/).pop() ?? lora.path

  return (
    <div className="bg-sunken border border-subtle rounded-md px-2.5 py-2 flex flex-col gap-1.5">
      <div className="flex items-start gap-2">
        <div className="shrink-0 w-7 h-7 rounded bg-bg text-fg-tertiary text-2xs font-mono flex items-center justify-center border border-subtle mt-0.5">
          {projectAbbr(label || filename)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate">{label || filename}</div>
          <div className="text-2xs text-fg-tertiary truncate font-mono" title={lora.path}>
            {lora.path}
          </div>
        </div>
        <button
          onClick={onRemove}
          className="btn btn-ghost btn-sm text-fg-tertiary hover:text-err shrink-0 px-1.5"
          title="移除"
          aria-label="移除 LoRA"
        >
          ×
        </button>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-2xs text-fg-tertiary shrink-0">权重 ×</span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={lora.scale}
          onChange={(e) => onScaleChange(Number(e.target.value))}
          className="flex-1"
          aria-label="权重滑杆"
        />
        <input
          type="number"
          min={0}
          max={2}
          step={0.05}
          value={lora.scale}
          onChange={(e) => onScaleChange(Number(e.target.value))}
          className="input text-center text-xs"
          style={{ width: 56, padding: '4px 6px' }}
          aria-label="权重数值"
        />
      </div>
    </div>
  )
}
