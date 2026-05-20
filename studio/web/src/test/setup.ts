import '@testing-library/jest-dom/vitest'

// 测试环境里默认 locale = zh（i18n/index.ts 读 localStorage 取不到就 fallback 'zh'）。
// 不 import 这个,useTranslation 返回 raw key,所有断言中文字面量全打挂。
import '../i18n'
