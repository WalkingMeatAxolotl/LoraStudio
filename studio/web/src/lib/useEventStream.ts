import { useEffect, useRef } from 'react'

export interface StudioEvent {
  type: string
  task_id?: number
  status?: string
  [key: string]: unknown
}

interface Options {
  /** 连接（含每次重连）成功时回调。EventSource 自动重连，断开期间事件会丢，
   * 这里给消费者一个口子重新 cold-fetch 补齐。第一次 onopen 也会触发；
   * 想区分「初次 vs 重连」消费者自己用 ref 计数。 */
  onOpen?: () => void
}

/**
 * 订阅 /api/events SSE 流。回调每次拿到一条事件。
 * 自动断线重连（EventSource 行为已经是这样）。
 */
export function useEventStream(
  onEvent: (evt: StudioEvent) => void,
  options?: Options,
): void {
  // 用 ref 接闭包，让 useEffect 只在 mount 时绑一次，但 handler 内永远拿最新
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent
  const onOpenRef = useRef(options?.onOpen)
  onOpenRef.current = options?.onOpen

  useEffect(() => {
    // jsdom / SSR / 老浏览器没有 EventSource — 不连 SSE 让组件在测试环境也能挂载
    if (typeof EventSource === 'undefined') return
    const es = new EventSource('/api/events')
    es.onopen = () => {
      onOpenRef.current?.()
    }
    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data) as StudioEvent
        onEventRef.current(evt)
      } catch {
        // 忽略畸形帧
      }
    }
    es.onerror = () => {
      // EventSource 自动重连；这里只是个钩子，不主动关闭
    }
    return () => es.close()
  }, [])
}
