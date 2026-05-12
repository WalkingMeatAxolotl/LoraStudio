import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SystemStats from './SystemStats'
import { api, type SystemStats as Stats } from '../api/client'

function makeStats(overrides: Partial<Stats> = {}): Stats {
  return {
    cpu_pct: 12.5,
    ram_used_gb: 8.0,
    ram_total_gb: 32.0,
    gpu: [
      {
        index: 0,
        name: 'Test GPU',
        util_pct: 50,
        vram_used_gb: 4.0,
        vram_total_gb: 24.0,
        temp_c: 55,
      },
    ],
    ...overrides,
  }
}

describe('SystemStats', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders nothing before first fetch resolves', () => {
    vi.spyOn(api, 'systemStats').mockReturnValue(new Promise(() => {}))
    const { container } = render(<SystemStats />)
    expect(container.firstChild).toBeNull()
  })

  it('shows CPU / MEM / GPU / VRAM pills with values', async () => {
    vi.spyOn(api, 'systemStats').mockResolvedValue(makeStats())
    render(<SystemStats />)
    await waitFor(() => expect(screen.getByText('CPU')).toBeInTheDocument())
    expect(screen.getByText('13%')).toBeInTheDocument()
    expect(screen.getByText('MEM')).toBeInTheDocument()
    expect(screen.getByText('8.0/32G')).toBeInTheDocument()
    expect(screen.getByText('GPU')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('VRAM')).toBeInTheDocument()
    expect(screen.getByText('4.0/24G')).toBeInTheDocument()
  })

  it('hides GPU / VRAM when stats.gpu is null', async () => {
    vi.spyOn(api, 'systemStats').mockResolvedValue(makeStats({ gpu: null }))
    render(<SystemStats />)
    await waitFor(() => expect(screen.getByText('CPU')).toBeInTheDocument())
    expect(screen.queryByText('GPU')).toBeNull()
    expect(screen.queryByText('VRAM')).toBeNull()
  })

  it('hides GPU / VRAM when stats.gpu is empty array', async () => {
    vi.spyOn(api, 'systemStats').mockResolvedValue(makeStats({ gpu: [] }))
    render(<SystemStats />)
    await waitFor(() => expect(screen.getByText('CPU')).toBeInTheDocument())
    expect(screen.queryByText('GPU')).toBeNull()
    expect(screen.queryByText('VRAM')).toBeNull()
  })

  it('shows high-tone class when util exceeds 90%', async () => {
    vi.spyOn(api, 'systemStats').mockResolvedValue(makeStats({ cpu_pct: 95 }))
    render(<SystemStats />)
    const el = await screen.findByText('95%')
    expect(el.className).toContain('text-err')
  })

  it('keeps last value when polling fails', async () => {
    const spy = vi
      .spyOn(api, 'systemStats')
      .mockResolvedValueOnce(makeStats({ cpu_pct: 5.0 }))
      .mockRejectedValueOnce(new Error('network'))
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<SystemStats />)
    await waitFor(() => expect(screen.getByText('5%')).toBeInTheDocument())
    await vi.advanceTimersByTimeAsync(3000)
    // 第二次轮询失败：仍然显示上次的 5%
    expect(screen.getByText('5%')).toBeInTheDocument()
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('polls on interval', async () => {
    const spy = vi.spyOn(api, 'systemStats').mockResolvedValue(makeStats())
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<SystemStats />)
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(spy).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(spy).toHaveBeenCalledTimes(3)
  })
})
