'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'

import { useWebSocketContext } from '@/app/providers/WebSocketProviders'

import type { Message } from './types'
import { createMessageId } from './types'

const HISTORY_FETCH_LIMIT = 60
const START_REACHED_DEBOUNCE_MS = 250

// 不知道总数时，用一个很大的 firstItemIndex，避免 prepend 后变成负数
const FIRST_ITEM_INDEX = 10_000_000

type ApiMessage = {
  id: string
  role: 'ASSISTANT' | 'USER' | string
  content: string
}

type ApiPayload = {
  messages: ApiMessage[]
  pagination?: {
    hasMore: boolean
    nextCursor: string | null
    limit: number
  }
}

interface ChatHistoryProps {
  open: boolean
  pendingUserMessage?: Message | null
  onPendingUserMessageRendered?: () => void
}

export default function ChatHistory({
  open,
  pendingUserMessage,
  onPendingUserMessageRendered,
}: ChatHistoryProps) {
  const { subscribe } = useWebSocketContext()

  const virtuosoRef = useRef<VirtuosoHandle>(null)

  // 让 prepend 时保持滚动位置稳定
  const [firstItemIndex, setFirstItemIndex] = useState(FIRST_ITEM_INDEX)
  const [messages, setMessages] = useState<Message[]>([])

  // 首次加载（最新一页）
  const [isInitLoading, setIsInitLoading] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)

  // 顶部加载更多（更旧）
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)

  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)

  // 只在“打开后首次加载完成”滚到底部一次
  const didAutoScrollToBottomRef = useRef(false)

  // open session 防过期回写
  const openSessionIdRef = useRef(0)

  // Abort 管理
  const initAbortRef = useRef<AbortController | null>(null)
  const loadMoreAbortRef = useRef<AbortController | null>(null)

  // startReached 防抖
  const debounceTimerRef = useRef<number | null>(null)

  // 全局去重
  const idsRef = useRef<Set<string>>(new Set())

  // 用于“延后滚到底”调度（确保 Virtuoso 完成测量）
  const raf1Ref = useRef<number | null>(null)
  const raf2Ref = useRef<number | null>(null)
  const timeoutRef = useRef<number | null>(null)

  const normalize = useCallback((rows: ApiMessage[]): Message[] => {
    // API 倒序（最新->更旧），UI 要正序（更旧->最新）所以 reverse
    const list = Array.isArray(rows) ? rows : []
    return list
      .map((m) => {
        const id = String(m.id ?? createMessageId())
        const role = m.role === 'ASSISTANT' ? 'ASSISTANT' : 'USER'
        const content = typeof m.content === 'string' ? m.content : ''
        return { id, role, content } as Message
      })
      .reverse()
  }, [])

  const fetchHistory = useCallback(
    async (params: { limit: number; cursor?: string | null; signal: AbortSignal }) => {
      const { limit, cursor, signal } = params
      const url = cursor
        ? `/api/chat/history?limit=${limit}&cursor=${encodeURIComponent(cursor)}`
        : `/api/chat/history?limit=${limit}`

      const res = await fetch(url, { signal })
      if (!res.ok) throw new Error('加载聊天记录失败，请稍后重试')

      const json = await res.json()
      const payload = json?.data as ApiPayload | undefined
      if (!payload || !Array.isArray(payload.messages)) {
        throw new Error('加载聊天记录失败：返回数据格式不正确')
      }
      return payload
    },
    [],
  )

  const cancelScheduledScroll = useCallback(() => {
    if (raf1Ref.current) {
      cancelAnimationFrame(raf1Ref.current)
      raf1Ref.current = null
    }
    if (raf2Ref.current) {
      cancelAnimationFrame(raf2Ref.current)
      raf2Ref.current = null
    }
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const scrollToBottomNow = useCallback(
    (behavior: 'auto' | 'smooth' = 'auto') => {
      if (messages.length === 0) return
      const lastAbsIndex = firstItemIndex + messages.length - 1
      virtuosoRef.current?.scrollToIndex({
        index: lastAbsIndex,
        align: 'end',
        behavior,
      })
    },
    [firstItemIndex, messages.length],
  )

  /**
   * 核心修复：
   * - Virtuoso 初次 data 进入时还在测量，立刻 scrollToIndex 会有概率不到底。
   * - 用“双 rAF + setTimeout 兜底”在下一轮/下下轮布局完成后再滚。
   */
  const scheduleScrollToBottomOnce = useCallback(() => {
    cancelScheduledScroll()

    raf1Ref.current = requestAnimationFrame(() => {
      raf2Ref.current = requestAnimationFrame(() => {
        scrollToBottomNow('auto')
      })
    })

    // 极端情况下（字体加载、图片撑高、布局抖动），再补一次兜底
    timeoutRef.current = window.setTimeout(() => {
      scrollToBottomNow('auto')
    }, 200)
  }, [cancelScheduledScroll, scrollToBottomNow])

  const resetState = useCallback(() => {
    initAbortRef.current?.abort()
    initAbortRef.current = null

    loadMoreAbortRef.current?.abort()
    loadMoreAbortRef.current = null

    cancelScheduledScroll()

    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }

    didAutoScrollToBottomRef.current = false

    idsRef.current = new Set()
    setMessages([])
    setFirstItemIndex(FIRST_ITEM_INDEX)

    setIsInitLoading(false)
    setInitError(null)

    setIsLoadingMore(false)
    setLoadMoreError(null)

    setHasMore(false)
    setNextCursor(null)
  }, [cancelScheduledScroll])

  // 打开时：拉取最新一页
  useEffect(() => {
    if (!open) {
      resetState()
      return
    }

    openSessionIdRef.current += 1
    const sessionId = openSessionIdRef.current

    initAbortRef.current?.abort()
    const controller = new AbortController()
    initAbortRef.current = controller

    setIsInitLoading(true)
    setInitError(null)
    setLoadMoreError(null)

    ;(async () => {
      try {
        const payload = await fetchHistory({
          limit: HISTORY_FETCH_LIMIT,
          cursor: null,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        if (sessionId !== openSessionIdRef.current) return

        const page = normalize(payload.messages)

        // 初始化去重集合
        const nextIds = new Set<string>()
        for (const m of page) nextIds.add(m.id)
        idsRef.current = nextIds

        setMessages(page)
        setFirstItemIndex(FIRST_ITEM_INDEX - page.length)

        const p = payload.pagination
        setHasMore(Boolean(p?.hasMore))
        setNextCursor(p?.nextCursor ?? null)
      } catch (e) {
        if (controller.signal.aborted) return
        console.error('加载聊天记录失败：', e)
        setInitError(e instanceof Error ? e.message : '加载聊天记录失败，请稍后重试')
      } finally {
        if (!controller.signal.aborted) setIsInitLoading(false)
      }
    })()

    return () => {
      controller.abort()
      if (initAbortRef.current === controller) initAbortRef.current = null
    }
  }, [open, fetchHistory, normalize, resetState])

  // 首次加载完成后：只滚到底部一次（关键：用 schedule 延后）
  useLayoutEffect(() => {
    if (!open) return
    if (isInitLoading) return
    if (messages.length === 0) return
    if (didAutoScrollToBottomRef.current) return

    didAutoScrollToBottomRef.current = true
    scheduleScrollToBottomOnce()
  }, [open, isInitLoading, messages.length, scheduleScrollToBottomOnce])

  // 追加待发送的用户消息（去重）
  useEffect(() => {
    if (!open) return
    if (!pendingUserMessage) return

    const id = pendingUserMessage.id
    if (idsRef.current.has(id)) {
      onPendingUserMessageRendered?.()
      return
    }

    idsRef.current.add(id)
    setMessages((prev) => [...prev, pendingUserMessage])

    requestAnimationFrame(() => {
      onPendingUserMessageRendered?.()
    })
  }, [open, pendingUserMessage, onPendingUserMessageRendered])

  const loadMore = useCallback(async () => {
    if (!open) return
    if (isInitLoading || isLoadingMore) return
    if (!hasMore) return
    if (!nextCursor) return

    openSessionIdRef.current += 1
    const sessionId = openSessionIdRef.current

    loadMoreAbortRef.current?.abort()
    const controller = new AbortController()
    loadMoreAbortRef.current = controller

    setIsLoadingMore(true)
    setLoadMoreError(null)

    try {
      const payload = await fetchHistory({
        limit: HISTORY_FETCH_LIMIT,
        cursor: nextCursor,
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      if (sessionId !== openSessionIdRef.current) return

      const page = normalize(payload.messages)

      const unique: Message[] = []
      for (const m of page) {
        if (!idsRef.current.has(m.id)) {
          idsRef.current.add(m.id)
          unique.push(m)
        }
      }

      if (unique.length > 0) {
        setFirstItemIndex((fi) => fi - unique.length)
        setMessages((prev) => [...unique, ...prev])
      }

      const p = payload.pagination
      setHasMore(Boolean(p?.hasMore))
      setNextCursor(p?.nextCursor ?? null)
    } catch (e) {
      if (controller.signal.aborted) return
      console.error('加载更多失败：', e)
      setLoadMoreError(e instanceof Error ? e.message : '加载更多失败，点击重试')
    } finally {
      if (!controller.signal.aborted) setIsLoadingMore(false)
    }
  }, [open, isInitLoading, isLoadingMore, hasMore, nextCursor, fetchHistory, normalize])

  const debouncedLoadMore = useCallback(() => {
    if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = window.setTimeout(() => {
      loadMore()
    }, START_REACHED_DEBOUNCE_MS)
  }, [loadMore])

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
      cancelScheduledScroll()
    }
  }, [cancelScheduledScroll])

  // websocket：只处理 complete（更健壮：优先用后端 id，尾部重复保护）
  useEffect(() => {
    if (!open) return

    const unsubscribe = subscribe((event) => {
      if (typeof event.data !== 'string') return

      let parsed: { event?: string; data?: Record<string, unknown> } | null = null
      try {
        parsed = JSON.parse(event.data)
      } catch {
        return
      }
      if (!parsed?.event) return

      if (parsed.event === 'chat-response-complete') {
        const payloadData = parsed.data ?? {}
        const finalContent = payloadData.content
        if (typeof finalContent !== 'string' || !finalContent) return

        const maybeId = payloadData.id
        const id = typeof maybeId === 'string' && maybeId ? maybeId : createMessageId()

        if (idsRef.current.has(id)) return

        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (last?.role === 'ASSISTANT' && last.content === finalContent) return prev

          idsRef.current.add(id)
          return [...prev, { id, role: 'ASSISTANT', content: finalContent }]
        })
      }
    })

    return () => {
      unsubscribe()
    }
  }, [open, subscribe])

  const showTopBar = open && (isLoadingMore || loadMoreError)

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5 py-4 px-2 text-sm text-slate-900 shadow-inner">
      {showTopBar && (
        <div className="absolute left-0 right-0 top-2 z-10 flex justify-center pointer-events-none">
          {isLoadingMore ? (
            <div className="pointer-events-none rounded-full bg-white/70 px-3 py-1 text-xs text-slate-700 shadow">
              正在加载更多...
            </div>
          ) : (
            <button
              type="button"
              className="pointer-events-auto rounded-full bg-white/70 px-3 py-1 text-xs text-rose-600 shadow hover:bg-white"
              onClick={loadMore}
            >
              {loadMoreError ?? '加载更多失败，点击重试'}
            </button>
          )}
        </div>
      )}

      <Virtuoso
        ref={virtuosoRef}
        style={{ height: '100%', width: '100%' }}
        className="h-full"
        data={messages}
        firstItemIndex={firstItemIndex}
        computeItemKey={(_, message) => message.id}
        startReached={() => {
          if (isInitLoading || isLoadingMore || !hasMore) return
          debouncedLoadMore()
        }}
        followOutput={(isAtBottom) => (isAtBottom ? 'smooth' : false)}
        itemContent={(_, message) => {
          const isAssistant = message.role === 'ASSISTANT'
          return (
            <div
              className={clsx(
                'flex w-full items-end px-1',
                isAssistant ? 'justify-start' : 'justify-end',
              )}
            >
              {isAssistant && (
                <div className="mr-2 flex-shrink-0">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-700">
                    AI
                  </div>
                </div>
              )}

              <div
                className={clsx(
                  'max-w-[85%] lg:max-w-[20rem] rounded-[22px] px-4 py-3 leading-relaxed shadow-sm mb-4 whitespace-pre-line text-sm',
                  isAssistant
                    ? 'bg-slate-100 text-slate-900 max-w-[calc(85%-40px)] lg:max-w-[20rem]'
                    : 'bg-sky-100 text-sky-900',
                )}
              >
                {message.content}
              </div>
            </div>
          )
        }}
      />

      {isInitLoading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-500">
          正在加载聊天记录...
        </div>
      )}

      {!isInitLoading && initError && (
        <div className="absolute inset-x-0 bottom-2 flex items-center justify-center text-xs text-rose-500">
          {initError}
        </div>
      )}

      {!isInitLoading && !initError && messages.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-500">
          暂无聊天记录，开始新的对话吧
        </div>
      )}
    </div>
  )
}
