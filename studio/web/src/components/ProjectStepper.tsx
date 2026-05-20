import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import type { ProjectDetail, Version } from '../api/client'

interface Step {
  key: string
  labelKey: string
  scope: 'project' | 'version'
}

const STEPS: Step[] = [
  { key: 'download',   labelKey: 'projectStepper.download',   scope: 'project' },
  { key: 'preprocess', labelKey: 'projectStepper.preprocess', scope: 'project' },
  { key: 'curate',     labelKey: 'projectStepper.curate',     scope: 'version' },
  { key: 'tag',        labelKey: 'projectStepper.tag',        scope: 'version' },
  { key: 'edit',       labelKey: 'projectStepper.tagEdit',    scope: 'version' },
  { key: 'reg',        labelKey: 'projectStepper.reg',        scope: 'version' },
  { key: 'train',      labelKey: 'projectStepper.train',      scope: 'version' },
]

/** 根据 project.stage 推断各步状态：✓ 完成 / ● 当前 / ○ 未开始 */
function statusFor(
  step: Step,
  project: ProjectDetail,
  version: Version | null
): 'done' | 'active' | 'pending' {
  const order = ['created', 'downloading', 'preprocessing', 'curating', 'tagging', 'regularizing', 'configured', 'training', 'done']
  const stepIdx: Record<string, number> = {
    download: 1,
    preprocess: 2,
    curate: 3,
    tag: 4,
    edit: 4,
    reg: 5,
    train: 7,
  }
  const projIdx = order.indexOf(project.stage)
  const target = stepIdx[step.key] ?? 0
  let status: 'done' | 'active' | 'pending' = 'pending'
  if (projIdx > target) status = 'done'
  else if (projIdx === target) status = 'active'

  if (step.key === 'preprocess') {
    const cnt = (project as ProjectDetail & { preprocess_image_count?: number }).preprocess_image_count ?? 0
    return cnt > 0 ? 'done' : 'pending'
  }

  if (status !== 'done' && step.scope === 'version' && version) {
    const vorder = ['curating', 'tagging', 'regularizing', 'ready', 'training', 'done']
    const vstepIdx: Record<string, number> = {
      curate: 0, tag: 1, edit: 1, reg: 2, train: 3,
    }
    const vIdx = vorder.indexOf(version.stage)
    const vt = vstepIdx[step.key] ?? -1
    if (vt >= 0) {
      if (vIdx > vt) status = 'done'
      else if (vIdx === vt && status === 'pending') status = 'active'
    }
  }

  if ((step.key === 'tag' || step.key === 'edit') && version?.stats) {
    const s = version.stats
    if (s.train_image_count > 0 && s.tagged_image_count >= s.train_image_count) return 'done'
  }
  if (step.key === 'reg' && version?.stats) {
    const s = version.stats
    if (s.reg_meta_exists && s.reg_image_count > 0) return 'done'
  }
  if (step.key === 'train' && version) {
    if (version.output_lora_path) return 'done'
    if (version.stage === 'training') return 'active'
  }
  return status
}

export default function ProjectStepper({
  project,
  version,
}: {
  project: ProjectDetail
  version: Version | null
}) {
  const { t } = useTranslation()
  const loc = useLocation()
  return (
    <ul className="space-y-1" aria-label="pipeline-stepper">
      {STEPS.map((s) => {
        const status = statusFor(s, project, version)
        const icon = status === 'done' ? '✓' : status === 'active' ? '●' : '○'
        const path =
          s.scope === 'project'
            ? `/projects/${project.id}/${s.key}`
            : version
              ? `/projects/${project.id}/v/${version.id}/${s.key}`
              : null
        const isActiveRoute = path !== null && loc.pathname.startsWith(path)
        const baseCls = 'flex items-center gap-2 px-3 py-1.5 rounded text-sm transition'
        const stateCls =
          status === 'done'
            ? 'text-ok'
            : status === 'active'
              ? 'text-accent'
              : 'text-fg-tertiary'
        const activeCls = isActiveRoute ? 'bg-surface' : 'hover:bg-overlay'
        if (path === null) {
          return (
            <li key={s.key}>
              <span
                className={`${baseCls} ${stateCls} cursor-not-allowed opacity-50`}
                title={t('projectStepper.selectVersion')}
              >
                <span className="font-mono w-4 text-center">{icon}</span>
                {t(s.labelKey)}
              </span>
            </li>
          )
        }
        return (
          <li key={s.key}>
            <Link to={path} className={`${baseCls} ${stateCls} ${activeCls}`}>
              <span className="font-mono w-4 text-center">{icon}</span>
              {t(s.labelKey)}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
