/**
 * useLocalStorageState — 通用 localStorage 持久化 state hook。
 *
 * 项目里此前散落 4+ 处手搓 localStorage 读写 (preset-helpers / Settings /
 * Regularization / Curation / PromptFromDatasetPicker)；签名分歧导致后续
 * 不好统一加 cross-tab sync / SSR 守护。本 hook 是统一入口。
 *
 * 行为：
 *   - mount 时从 localStorage 读初值，没读到用 defaultValue
 *   - setValue(v) 立即写回 localStorage
 *   - 监听 'storage' 事件做跨 tab 同步（参考 useAdvancedMode）
 *   - SSR 安全：typeof window === 'undefined' 时静默用 default
 *   - JSON.stringify / JSON.parse 序列化；parse 失败用 default
 *
 * 命名约定：key 用 `studio:scope:field` 前缀（参考 useAdvancedMode 的
 * `studio:advanced_mode`），避免和其他 web app / 老版本冲突。
 */
import { useCallback, useEffect, useState } from 'react'

export function useLocalStorageState<T>(
  key: string,
  defaultValue: T,
): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readPersisted(key, defaultValue))

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (e: StorageEvent) => {
      if (e.key !== key) return
      if (e.newValue === null) {
        setValue(defaultValue)
        return
      }
      try {
        setValue(JSON.parse(e.newValue) as T)
      } catch {
        // 其他 tab 写了非 JSON 值（外部脚本？）→ 忽略，本 tab 保留当前值
      }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [key, defaultValue])

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved =
          typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.setItem(key, JSON.stringify(resolved))
          } catch {
            // quota exceeded / private mode → 静默；state 仍在内存里有效
          }
        }
        return resolved
      })
    },
    [key],
  )

  return [value, update]
}

function readPersisted<T>(key: string, defaultValue: T): T {
  if (typeof window === 'undefined') return defaultValue
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return defaultValue
    return JSON.parse(raw) as T
  } catch {
    return defaultValue
  }
}
