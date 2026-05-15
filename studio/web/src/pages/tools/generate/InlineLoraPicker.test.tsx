import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, type LoraCkpt } from '../../../api/client'
import InlineLoraPicker, { projectAbbr } from './InlineLoraPicker'
import type { ProjectLora } from './types'

const sample: ProjectLora[] = [
  {
    projectId: 1, projectTitle: 'cute_chibi',
    versionId: 11, versionLabel: 'v3', stage: 'training',
    path: '/loras/cute_chibi/v3.safetensors', createdAt: 300,
  },
  {
    projectId: 1, projectTitle: 'cute_chibi',
    versionId: 12, versionLabel: 'v2', stage: 'done',
    path: '/loras/cute_chibi/v2.safetensors', createdAt: 200,
  },
  {
    projectId: 2, projectTitle: 'noir_portrait',
    versionId: 21, versionLabel: 'v1', stage: 'done',
    path: '/loras/noir/v1.safetensors', createdAt: 100,
  },
]

const ckptsV3: LoraCkpt[] = [
  { kind: 'final', value: 0, label: 'final', path: '/loras/cute_chibi/v3/final.safetensors', mtime: 300 },
  { kind: 'step', value: 2000, label: 'step 2000', path: '/loras/cute_chibi/v3/step_2000.safetensors', mtime: 250 },
  { kind: 'step', value: 1000, label: 'step 1000', path: '/loras/cute_chibi/v3/step_1000.safetensors', mtime: 200 },
]

describe('projectAbbr', () => {
  it('extracts first 2 alphanumerics, uppercase', () => {
    expect(projectAbbr('cute_chibi')).toBe('CU')
    expect(projectAbbr('noir_portrait')).toBe('NO')
    expect(projectAbbr('character_yui')).toBe('CH')
  })
  it('strips non-alphanumeric', () => {
    expect(projectAbbr('___test')).toBe('TE')
  })
  it('falls back to ?? when empty', () => {
    expect(projectAbbr('___')).toBe('??')
    expect(projectAbbr('')).toBe('??')
  })
})

describe('InlineLoraPicker', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function renderPicker(overrides: Partial<{
    projectLoras: ProjectLora[]
    existingPaths: Set<string>
    multi: boolean
    ckpts: LoraCkpt[]
  }> = {}) {
    vi.spyOn(api, 'listVersionLoraCkpts').mockResolvedValue(overrides.ckpts ?? ckptsV3)
    const onPick = vi.fn()
    const onClose = vi.fn()
    const onPickExternal = vi.fn()
    const utils = render(
      <InlineLoraPicker
        projectLoras={overrides.projectLoras ?? sample}
        existingPaths={overrides.existingPaths ?? new Set()}
        onPick={onPick}
        onClose={onClose}
        onPickExternal={onPickExternal}
        multi={overrides.multi ?? true}
      />
    )
    return { ...utils, onPick, onClose, onPickExternal }
  }

  it('renders project + version dropdowns from projectLoras', async () => {
    renderPicker()
    // project select 应该包含两个项目
    expect(screen.getByLabelText('选项目')).toBeInTheDocument()
    expect(screen.getByText('cute_chibi')).toBeInTheDocument()
    expect(screen.getByText('noir_portrait')).toBeInTheDocument()
    // 训练中版本带（训练中）标记（默认 pid=1，default vid=v3 training）
    await waitFor(() => expect(screen.getByText(/v3（训练中）/)).toBeInTheDocument())
  })

  it('auto-loads ckpts for the default project/version', async () => {
    renderPicker()
    await waitFor(() => {
      expect(screen.getByText('final')).toBeInTheDocument()
      expect(screen.getByText('step 2000')).toBeInTheDocument()
      expect(screen.getByText('step 1000')).toBeInTheDocument()
    })
  })

  it('multi=true: click ckpt toggles picked, weight + 添加 footer appears', async () => {
    const user = userEvent.setup()
    const { onPick, onClose } = renderPicker()
    await waitFor(() => expect(screen.getByText('step 2000')).toBeInTheDocument())
    await user.click(screen.getByText('step 2000').closest('button')!)
    await user.click(screen.getByText('step 1000').closest('button')!)
    expect(screen.getByText(/已选 2/)).toBeInTheDocument()
    await user.click(screen.getByText(/添加 2 个/))
    expect(onPick).toHaveBeenCalledTimes(1)
    const [picks, weight] = onPick.mock.calls[0]
    expect(picks).toHaveLength(2)
    expect(picks.map((p: { path: string }) => p.path).sort()).toEqual([
      '/loras/cute_chibi/v3/step_1000.safetensors',
      '/loras/cute_chibi/v3/step_2000.safetensors',
    ])
    expect(weight).toBe(1.0)
    expect(onClose).toHaveBeenCalled()
  })

  it('multi=false: click ckpt single-picks + auto-closes', async () => {
    const user = userEvent.setup()
    const { onPick, onClose } = renderPicker({ multi: false })
    await waitFor(() => expect(screen.getByText('step 2000')).toBeInTheDocument())
    await user.click(screen.getByText('step 2000').closest('button')!)
    expect(onPick).toHaveBeenCalledTimes(1)
    const [picks] = onPick.mock.calls[0]
    expect(picks).toHaveLength(1)
    expect(picks[0].path).toBe('/loras/cute_chibi/v3/step_2000.safetensors')
    expect(picks[0].projectId).toBe(1)
    expect(picks[0].versionId).toBe(11)
    expect(onClose).toHaveBeenCalled()
  })

  it('existingPaths marks ckpt as 已添加 and disables it', async () => {
    const user = userEvent.setup()
    const { onPick } = renderPicker({
      existingPaths: new Set(['/loras/cute_chibi/v3/step_2000.safetensors']),
    })
    await waitFor(() => expect(screen.getByText('step 2000')).toBeInTheDocument())
    const btn = screen.getByText('step 2000').closest('button')!
    expect(btn).toBeDisabled()
    expect(screen.getByText('已添加')).toBeInTheDocument()
    await user.click(btn)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('shows empty state when projectLoras is empty', () => {
    renderPicker({ projectLoras: [] })
    expect(screen.getByText(/还没有训练好的 LoRA/)).toBeInTheDocument()
  })

  it('shows no-ckpt hint when version has no ckpts', async () => {
    renderPicker({ ckpts: [] })
    await waitFor(() =>
      expect(screen.getByText(/该版本没扫到 ckpt 文件/)).toBeInTheDocument()
    )
  })

  it('search filters ckpt list', async () => {
    const user = userEvent.setup()
    renderPicker()
    await waitFor(() => expect(screen.getByText('step 2000')).toBeInTheDocument())
    await user.type(screen.getByPlaceholderText('搜索 ckpt 文件名…'), '2000')
    expect(screen.queryByText('final')).not.toBeInTheDocument()
    expect(screen.queryByText('step 1000')).not.toBeInTheDocument()
    expect(screen.getByText('step 2000')).toBeInTheDocument()
  })

  it('triggers onClose when × is clicked', async () => {
    const user = userEvent.setup()
    const { onClose } = renderPicker()
    await user.click(screen.getByLabelText('关闭挑选区'))
    expect(onClose).toHaveBeenCalled()
  })

  it('triggers onPickExternal when 外部文件 is clicked', async () => {
    const user = userEvent.setup()
    const { onPickExternal } = renderPicker()
    await user.click(screen.getByText('外部文件'))
    expect(onPickExternal).toHaveBeenCalled()
  })

  it('changing project resets picked + version', async () => {
    const user = userEvent.setup()
    renderPicker()
    await waitFor(() => expect(screen.getByText('step 2000')).toBeInTheDocument())
    await user.click(screen.getByText('step 2000').closest('button')!)
    expect(screen.getByText(/已选 1/)).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('选项目'), '2')
    // 切到 noir_portrait → v1，picked 清空
    expect(screen.queryByText(/已选 1/)).not.toBeInTheDocument()
  })

  it('multi mode: weight value used in onPick call', async () => {
    const user = userEvent.setup()
    const { onPick } = renderPicker()
    await waitFor(() => expect(screen.getByText('step 2000')).toBeInTheDocument())
    await user.click(screen.getByText('step 2000').closest('button')!)

    const weightInput = screen.getByLabelText('新 LoRA 权重数值')
    await user.clear(weightInput)
    await user.type(weightInput, '0.75')
    await user.click(screen.getByText(/添加 1 个/))
    const [, weight] = onPick.mock.calls[0]
    expect(weight).toBe(0.75)
  })
})
