// ExportBundleDialog — 选择 bundle.zip 导出内容后触发下载。
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface BundleExportOpts {
  train: boolean
  trainCaptions: boolean
  reg: boolean
  regCaptions: boolean
  includeConfig: boolean
}

interface Props {
  onConfirm: (opts: BundleExportOpts) => void
  onCancel: () => void
}

export default function ExportBundleDialog({ onConfirm, onCancel }: Props) {
  const { t } = useTranslation()
  const [train, setTrain] = useState(true)
  const [trainCaptions, setTrainCaptions] = useState(true)
  const [reg, setReg] = useState(false)
  const [regCaptions, setRegCaptions] = useState(false)
  const [includeConfig, setIncludeConfig] = useState(false)

  const nothingSelected = !train && !reg && !includeConfig

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (nothingSelected) return
    onConfirm({ train, trainCaptions, reg, regCaptions, includeConfig })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <form
        onSubmit={handleSubmit}
        className="bg-elevated border border-dim rounded-lg w-[90%] max-w-[420px] p-6 flex flex-col gap-5 shadow-xl"
      >
        <h2 className="m-0 text-lg font-semibold text-fg-primary">
          {t('layout.exportBundleTitle')}
        </h2>

        {/* 训练集 */}
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={train}
              onChange={(e) => setTrain(e.target.checked)}
            />
            <span className="text-sm text-fg-primary font-medium">
              {t('layout.exportBundleTrain')}
            </span>
          </label>
          {train && (
            <label className="flex items-center gap-2 cursor-pointer pl-5">
              <input
                type="checkbox"
                checked={trainCaptions}
                onChange={(e) => setTrainCaptions(e.target.checked)}
              />
              <span className="text-sm text-fg-secondary">
                {t('layout.exportBundleCaptions')}
              </span>
            </label>
          )}
        </div>

        {/* 正则集 */}
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={reg}
              onChange={(e) => setReg(e.target.checked)}
            />
            <span className="text-sm text-fg-primary font-medium">
              {t('layout.exportBundleReg')}
            </span>
          </label>
          {reg && (
            <label className="flex items-center gap-2 cursor-pointer pl-5">
              <input
                type="checkbox"
                checked={regCaptions}
                onChange={(e) => setRegCaptions(e.target.checked)}
              />
              <span className="text-sm text-fg-secondary">
                {t('layout.exportBundleCaptions')}
              </span>
            </label>
          )}
        </div>

        {/* 训练配置 */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={includeConfig}
            onChange={(e) => setIncludeConfig(e.target.checked)}
          />
          <span className="text-sm text-fg-primary font-medium">
            {t('layout.exportBundleConfig')}
          </span>
          <span className="text-xs text-fg-tertiary">{t('layout.exportBundleConfigHint')}</span>
        </label>

        {nothingSelected && (
          <p className="text-xs text-err m-0">{t('layout.exportBundleAtLeastOne')}</p>
        )}

        <div className="flex gap-2 justify-end mt-1">
          <button type="button" onClick={onCancel} className="btn btn-secondary">
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={nothingSelected}>
            {t('common.export')}
          </button>
        </div>
      </form>
    </div>
  )
}
