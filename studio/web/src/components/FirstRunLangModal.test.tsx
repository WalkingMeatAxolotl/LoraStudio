/**
 * FirstRunLangModal 单元测试。
 *
 * 验证：
 *   - localStorage 没值时弹 modal
 *   - localStorage 有值时不渲染（一次性）
 *   - 点 English / 中文 卡片各自写 localStorage + 调 i18n.changeLanguage + 关 modal
 *   - navigator.language 命中 zh 时 zh 卡片初始聚焦；否则 en 卡片初始聚焦
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const changeLanguage = vi.fn().mockResolvedValue(undefined)
vi.mock('../i18n', () => ({
  __esModule: true,
  default: { changeLanguage: (lang: string) => changeLanguage(lang) },
  getStoredLang: () => localStorage.getItem('studio.lang'),
  setStoredLang: (lang: string) => localStorage.setItem('studio.lang', lang),
}))

import { FirstRunLangModal } from './FirstRunLangModal'

describe('FirstRunLangModal', () => {
  beforeEach(() => {
    localStorage.clear()
    changeLanguage.mockClear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('renders when localStorage has no stored language', () => {
    render(<FirstRunLangModal />)
    expect(screen.getByTestId('first-run-lang-modal')).toBeInTheDocument()
    expect(screen.getByTestId('first-run-lang-en')).toBeInTheDocument()
    expect(screen.getByTestId('first-run-lang-zh')).toBeInTheDocument()
  })

  it('does not render when localStorage already has a stored language', () => {
    localStorage.setItem('studio.lang', 'en')
    render(<FirstRunLangModal />)
    expect(screen.queryByTestId('first-run-lang-modal')).toBeNull()
  })

  it('clicking English writes localStorage, calls changeLanguage, and dismisses', () => {
    render(<FirstRunLangModal />)
    fireEvent.click(screen.getByTestId('first-run-lang-en'))
    expect(localStorage.getItem('studio.lang')).toBe('en')
    expect(changeLanguage).toHaveBeenCalledWith('en')
    expect(screen.queryByTestId('first-run-lang-modal')).toBeNull()
  })

  it('clicking 中文 writes localStorage, calls changeLanguage, and dismisses', () => {
    render(<FirstRunLangModal />)
    fireEvent.click(screen.getByTestId('first-run-lang-zh'))
    expect(localStorage.getItem('studio.lang')).toBe('zh')
    expect(changeLanguage).toHaveBeenCalledWith('zh')
    expect(screen.queryByTestId('first-run-lang-modal')).toBeNull()
  })

  it('initial keyboard focus lands on the zh card when navigator.language is zh-CN', () => {
    vi.stubGlobal('navigator', { ...navigator, language: 'zh-CN' })
    render(<FirstRunLangModal />)
    expect(document.activeElement).toBe(screen.getByTestId('first-run-lang-zh'))
    vi.unstubAllGlobals()
  })

  it('initial keyboard focus lands on the en card when navigator.language is en-US', () => {
    vi.stubGlobal('navigator', { ...navigator, language: 'en-US' })
    render(<FirstRunLangModal />)
    expect(document.activeElement).toBe(screen.getByTestId('first-run-lang-en'))
    vi.unstubAllGlobals()
  })
})
