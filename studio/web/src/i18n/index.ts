import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zh from './locales/zh.json'
import en from './locales/en.json'

const STORAGE_KEY = 'studio.lang'

export function getStoredLang(): string | null {
  try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
}

export function getStoredLangWithDefault(): string {
  return getStoredLang() ?? 'zh'
}

export function setStoredLang(lang: string) {
  try { localStorage.setItem(STORAGE_KEY, lang) } catch { /* ignore */ }
}

void i18n
  .use(initReactI18next)
  .init({
    resources: { zh: { translation: zh }, en: { translation: en } },
    lng: getStoredLangWithDefault(),
    fallbackLng: 'zh',
    interpolation: { escapeValue: false },
  })

export default i18n
