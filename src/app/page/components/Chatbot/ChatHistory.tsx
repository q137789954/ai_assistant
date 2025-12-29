'use client'

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'

import { useWebSocketContext } from '@/app/providers/WebSocketProviders'

import type { Message } from './types'
import { createMessageId } from './types'

const HISTORY_FETCH_LIMIT = 60

interface ChatHistoryProps {
  open: boolean
  pendingUserMessage?: Message | null
  onPendingUserMessageRendered?: () => void
}

/**
 * ChatHistory 负责拉取历史、维护消息列表、处理流式助手更新并渲染虚拟化列表。
 */
export default function ChatHistory({
  open,
  pendingUserMessage,
  onPendingUserMessageRendered,
}: ChatHistoryProps) {
  const { subscribe } = useWebSocketContext()
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const streamingAssistantMessageIdRef = useRef<string | null>(null)

  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // 拉取聊天历史
  useEffect(() => {
    if (!open) {
      return
    }

    const controller = new AbortController()
    setIsLoading(true)
    setErrorMessage(null)

    const loadHistory = async () => {
      try {
        const response = await fetch(`/api/chat/history?limit=${HISTORY_FETCH_LIMIT}`, {
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new Error('加载聊天记录失败，请稍后重试')
        }

        const payload =(await response.json()).data
        if (controller.signal.aborted) {
          return
        }

        const normalized: Message[] = Array.isArray(payload.messages)
          ? payload.messages
              .map((item: Record<string, unknown>) => ({
                id: String(item.id ?? createMessageId()),
                role: item.role === 'ASSISTANT' ? 'ASSISTANT' : 'USER',
                content: typeof item.content === 'string' ? item.content : '',
              }))
              .reverse()
          : []

        setMessages((prev) => {
          const appended = prev.filter(
            (item) => !normalized.some((history) => history.id === item.id),
          )
          return [...normalized, ...appended]
        })
        streamingAssistantMessageIdRef.current = null
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }
        console.error('加载聊天记录失败：', error)
        setErrorMessage(
          error instanceof Error ? error.message : '加载聊天记录失败，请稍后重试',
        )
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      }
    }

    loadHistory()
    return () => controller.abort()
  }, [open])

  // 将待发送的用户消息追加到列表中
  useEffect(() => {
    if (!pendingUserMessage) {
      return
    }

    setMessages((prev) => [...prev, pendingUserMessage])
    onPendingUserMessageRendered?.()
  }, [pendingUserMessage, onPendingUserMessageRendered])

  useEffect(() => {
    if (!open) {
      streamingAssistantMessageIdRef.current = null
      return
    }

    const appendOrUpdateAssistantMessage = (text: string) => {
      if (!text) {
        return
      }

      setMessages((prev) => {
        const existingId = streamingAssistantMessageIdRef.current
        const existingIndex =
          existingId !== null ? prev.findIndex((item) => item.id === existingId) : -1

        if (existingIndex !== -1) {
          const updated = [...prev]
          updated[existingIndex] = { ...updated[existingIndex], content: text }
          return updated
        }

        const newId = createMessageId()
        streamingAssistantMessageIdRef.current = newId
        return [
          ...prev,
          {
            id: newId,
            role: 'ASSISTANT',
            content: text,
          },
        ]
      })
    }

    const unsubscribe = subscribe((event) => {
      if (typeof event.data !== 'string') {
        return
      }

      let parsed: { event?: string; data?: Record<string, unknown> } | null = null
      try {
        parsed = JSON.parse(event.data)
      } catch {
        return
      }

      if (!parsed?.event) {
        return
      }

      const payloadData = parsed.data ?? {}

      if (parsed.event === 'chat-response-complete') {
        const finalContent = payloadData.content
        if (typeof finalContent === 'string') {
          appendOrUpdateAssistantMessage(finalContent)
        }
        streamingAssistantMessageIdRef.current = null
        return
      }
    })

    return () => {
      streamingAssistantMessageIdRef.current = null
      unsubscribe()
    }
  }, [open, subscribe])

  // 自动滚动到底部
  useEffect(() => {
    if (messages.length === 0) {
      return
    }

    virtuosoRef.current?.scrollToIndex({
      index: messages.length - 1,
      align: 'end',
      behavior: 'auto',
    })
  }, [messages.length])

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-900 shadow-inner my-6">
      <Virtuoso
        ref={virtuosoRef}
        style={{ height: '100%', width: '100%' }}
        data={messages}
        computeItemKey={(index, message) => message.id}
        itemContent={(index, message) => {
          console.log(message)
          const isAssistant = message.role === 'ASSISTANT'
          return (
            <div
              className={clsx(
                'flex w-full items-end px-1',
                isAssistant ? 'justify-start' : 'justify-end',
              )}
            >
              {/* 聊天气泡布局：助手靠左并显示默认头像，用户靠右展示无头像 */}
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
        className="h-full"
      />

      {isLoading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-500">
          正在加载聊天记录...
        </div>
      )}

      {!isLoading && errorMessage && (
        <div className="pointer-events-none absolute inset-x-0 -bottom-1 flex items-center justify-center text-xs text-rose-500">
          {errorMessage}
        </div>
      )}

      {!isLoading && !errorMessage && messages.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-500">
          暂无聊天记录，开始新的对话吧
        </div>
      )}
    </div>
  )
}
