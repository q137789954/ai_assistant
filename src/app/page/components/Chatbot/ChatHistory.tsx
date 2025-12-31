'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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

/**
 * ChatHistory 负责拉取历史、维护消息列表、处理流式助手更新并渲染虚拟化列表。
 * - 首次打开：拉取最新一页，自动滚到底部（仅一次）
 * - 上滑到顶部：加载更多（cursor 分页），prepend 且不跳动
 * - 顶部固定小 loading / 失败点击重试
 * - followOutput：仅在用户位于底部时跟随新消息
 */
export default function ChatHistory({
  open,
  pendingUserMessage,
  onPendingUserMessageRendered,
}: ChatHistoryProps) {
  const { subscribe } = useWebSocketContext()

  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const streamingAssistantMessageIdRef = useRef<string | null>(null)

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

  // 防 StrictMode / 重复触发：用 open session id 忽略过期请求
  const openSessionIdRef = useRef(0)

  // startReached 防抖
  const debounceTimerRef = useRef<number | null>(null)

  const normalize = useCallback((rows: ApiMessage[]): Message[] => {
    // API 是倒序（最新->更旧），UI 要正序（更旧->最新）所以 reverse
    return (Array.isArray(rows) ? rows : [])
      .map((m) => ({
        id: String(m.id ?? createMessageId()),
        role: m.role === 'ASSISTANT' ? 'ASSISTANT' : 'USER',
        content: typeof m.content === 'string' ? m.content : '',
      }))
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
      const json = (await res.json())?.data as ApiPayload
      return json
    },
    [],
  )

  const resetState = useCallback(() => {
    streamingAssistantMessageIdRef.current = null
    didAutoScrollToBottomRef.current = false

    setMessages([])
    setFirstItemIndex(FIRST_ITEM_INDEX)

    setIsInitLoading(false)
    setInitError(null)

    setIsLoadingMore(false)
    setLoadMoreError(null)

    setHasMore(false)
    setNextCursor(null)
  }, [])

  // 打开时：拉取最新一页
  useEffect(() => {
    if (!open) {
      resetState()
      return
    }

    openSessionIdRef.current += 1
    const sessionId = openSessionIdRef.current

    const controller = new AbortController()
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

        const page = normalize(payload?.messages ?? [])
        setMessages(page)
        setFirstItemIndex(FIRST_ITEM_INDEX - page.length)

        const p = payload?.pagination
        setHasMore(Boolean(p?.hasMore))
        setNextCursor(p?.nextCursor ?? null)

        streamingAssistantMessageIdRef.current = null
      } catch (e) {
        if (controller.signal.aborted) return
        console.error('加载聊天记录失败：', e)
        setInitError(e instanceof Error ? e.message : '加载聊天记录失败，请稍后重试')
      } finally {
        if (!controller.signal.aborted) setIsInitLoading(false)
      }
    })()

    return () => controller.abort()
  }, [open, fetchHistory, normalize, resetState])

  // 首次加载完成后：只滚到底部一次
  useEffect(() => {
    if (!open) return
    if (isInitLoading) return
    if (messages.length === 0) return
    if (didAutoScrollToBottomRef.current) return

    didAutoScrollToBottomRef.current = true
    virtuosoRef.current?.scrollToIndex({
      index: firstItemIndex + messages.length - 1,
      align: 'end',
      behavior: 'auto',
    })
  }, [open, isInitLoading, messages.length, firstItemIndex])

  // 追加待发送的用户消息
  useEffect(() => {
    if (!pendingUserMessage) return
    setMessages((prev) => [...prev, pendingUserMessage])
    onPendingUserMessageRendered?.()
  }, [pendingUserMessage, onPendingUserMessageRendered])

  // 顶部加载更多（上滑至顶部）
  const loadMore = useCallback(async () => {
    if (!open) return
    if (isInitLoading || isLoadingMore) return
    if (!hasMore) return
    if (!nextCursor) return

    setIsLoadingMore(true)
    setLoadMoreError(null)

    const controller = new AbortController()

    try {
      const payload = await fetchHistory({
        limit: HISTORY_FETCH_LIMIT,
        cursor: nextCursor,
        signal: controller.signal,
      })
      if (controller.signal.aborted) return

      const page = normalize(payload?.messages ?? [])

      // prepend：过滤重复（保险）+ 调整 firstItemIndex 保持位置不跳动
      setMessages((prev) => {
        const exist = new Set(prev.map((m) => m.id))
        const unique = page.filter((m) => !exist.has(m.id))
        if (unique.length > 0) {
          setFirstItemIndex((fi) => fi - unique.length)
          return [...unique, ...prev]
        }
        return prev
      })

      const p = payload?.pagination
      setHasMore(Boolean(p?.hasMore))
      setNextCursor(p?.nextCursor ?? null)
    } catch (e) {
      console.error('加载更多失败：', e)
      setLoadMoreError(e instanceof Error ? e.message : '加载更多失败，点击重试')
    } finally {
      setIsLoadingMore(false)
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
    }
  }, [])

  // websocket：只处理 complete（你现在的逻辑）
  useEffect(() => {
    if (!open) {
      streamingAssistantMessageIdRef.current = null
      return
    }

    const appendOrUpdateAssistantMessage = (text: string) => {
      if (!text) return

      setMessages((prev) => {
        const existingId = streamingAssistantMessageIdRef.current
        const idx = existingId ? prev.findIndex((m) => m.id === existingId) : -1

        if (idx !== -1) {
          const next = [...prev]
          next[idx] = { ...next[idx], content: text }
          return next
        }

        const newId = createMessageId()
        streamingAssistantMessageIdRef.current = newId
        return [...prev, { id: newId, role: 'ASSISTANT', content: text }]
      })
    }

    const unsubscribe = subscribe((event) => {
      if (typeof event.data !== 'string') return

      let parsed: { event?: string; data?: Record<string, unknown> } | null = null
      try {
        parsed = JSON.parse(event.data)
      } catch {
        return
      }
      if (!parsed?.event) return

      const payloadData = parsed.data ?? {}

      if (parsed.event === 'chat-response-complete') {
        const finalContent = payloadData.content
        if (typeof finalContent === 'string') {
          appendOrUpdateAssistantMessage(finalContent)
        }
        streamingAssistantMessageIdRef.current = null
      }
    })

    return () => {
      streamingAssistantMessageIdRef.current = null
      unsubscribe()
    }
  }, [open, subscribe])

  const showTopBar = open && (isLoadingMore || loadMoreError)

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5 py-4 px-2 text-sm text-slate-900 shadow-inner my-6">
      {/* 顶部固定小状态条：加载更多 / 点击重试 */}
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
        computeItemKey={(index, message) => message.id}
        // 上滑到顶部：触发加载更多（防抖）
        startReached={() => {
          if (isInitLoading || isLoadingMore || !hasMore) return
          debouncedLoadMore()
        }}
        // 只有在底部时才跟随新消息
        followOutput={(isAtBottom) => (isAtBottom ? 'smooth' : false)}
        itemContent={(index, message) => {
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
                  'max-w-[20rem] rounded-[22px] px-4 py-3 leading-relaxed shadow-sm mb-4 whitespace-pre-line text-sm',
                  isAssistant ? 'bg-slate-100 text-slate-900' : 'bg-sky-100 text-sky-900',
                )}
              >
                {message.content}
              </div>
            </div>
          )
        }}
      />

      {/* 首次加载：遮罩 */}
      {isInitLoading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-500">
          正在加载聊天记录...
        </div>
      )}

      {/* 首次加载失败 */}
      {!isInitLoading && initError && (
        <div className="absolute inset-x-0 bottom-2 flex items-center justify-center text-xs text-rose-500">
          {initError}
        </div>
      )}

      {/* 空态 */}
      {!isInitLoading && !initError && messages.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-500">
          暂无聊天记录，开始新的对话吧
        </div>
      )}
    </div>
  )
}
