import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import Sidebar from './Sidebar'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar />
    </MemoryRouter>
  )
}

describe('Sidebar (PP0)', () => {
  it('groups main items + tools panel with all 5 destinations', () => {
    renderAt('/')
    // Main
    expect(screen.getByRole('link', { name: /项目/ })).toHaveAttribute(
      'href',
      '/'
    )
    expect(screen.getByRole('link', { name: /队列/ })).toHaveAttribute(
      'href',
      '/queue'
    )
    // Tools group
    expect(screen.getByText('工具')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /预设/ })).toHaveAttribute(
      'href',
      '/tools/presets'
    )
    expect(screen.getByRole('link', { name: /监控/ })).toHaveAttribute(
      'href',
      '/tools/monitor'
    )
    expect(screen.getByRole('link', { name: /设置/ })).toHaveAttribute(
      'href',
      '/tools/settings'
    )
  })

  it('marks the active route with cyan styling', () => {
    renderAt('/tools/presets')
    const link = screen.getByRole('link', { name: /预设/ })
    expect(link.className).toMatch(/text-cyan-300/)
    // Non-active link does not get the active class
    const queue = screen.getByRole('link', { name: /队列/ })
    expect(queue.className).not.toMatch(/text-cyan-300/)
  })

  it('does not include the removed Datasets link', () => {
    renderAt('/')
    expect(screen.queryByRole('link', { name: /数据集/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /配置/ })).toBeNull()
  })
})
