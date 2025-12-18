'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  Button,
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/app/components/ui'
import { Send, X } from 'lucide-react'
import { useWebSocketContext } from '@/app/providers/WebSocketProviders'

type MessageRole = 'assistant' | 'user'

interface Message {
  id: number
  role: MessageRole
  content: string
}

const initialMessages: Message[] = []

interface ChatbotProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function Chatbot({ open, onOpenChange }: ChatbotProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [draft, setDraft] = useState('')
  const viewportRef = useRef<HTMLDivElement>(null)
  const streamingAssistantMessageIdRef = useRef<number | null>(null)

  const { emitEvent, subscribe } = useWebSocketContext()

  useEffect(() => {
    viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight })
  }, [messages])

  useEffect(() => {
    if (!open) {
      streamingAssistantMessageIdRef.current = null
      return
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

          const newId = prev.length + 1
          streamingAssistantMessageIdRef.current = newId
          return [
            ...prev,
            {
              id: newId,
              role: 'assistant',
              content: text,
            },
          ]
        })
      }

      if (parsed.event === 'chat-response-chunk') {
        const aggregated = payloadData.aggregated
        if (typeof aggregated === 'string') {
          appendOrUpdateAssistantMessage(aggregated)
        }
        return
      }

      if (parsed.event === 'chat-response-complete') {
        const finalContent = payloadData.assistantContent
        if (typeof finalContent === 'string') {
          appendOrUpdateAssistantMessage(finalContent)
        }
        streamingAssistantMessageIdRef.current = null
        return
      }

      if (parsed.event === 'chat-response-error') {
        console.error('助手响应错误：', payloadData.message)
      }
    })

    return () => {
      streamingAssistantMessageIdRef.current = null
      unsubscribe()
    }
  }, [open, subscribe])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = draft.trim()
    if (!trimmed) {
      return
    }

    const messageMeta = {
      messageId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      sampleRate: 16000,
      content: trimmed,
      outputFormat: 'text',
      inputFormat: 'text',
    }
    const sent = emitEvent('chat:input', messageMeta)
    if (!sent) {
      console.warn('消息发送失败，请检查 WebSocket 连接状态')
    }

    setMessages((prev) => [
      ...prev,
      {
        id: prev.length + 1,
        role: 'user',
        content: trimmed,
      },
    ])
    setDraft('')
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        placement="bottom"
        size="lg"
        className="chatbot-drawer-animated flex max-h-[70vh] flex-col rounded-t-[32px] border border-slate-200/80 bg-slate-50 shadow-2xl"
      >
        <DrawerHeader className="px-6 pt-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <DrawerTitle>AI 助手</DrawerTitle>
              <DrawerDescription>实时语音 + 文本交互，支持持续对话。</DrawerDescription>
            </div>
            <DrawerClose asChild>
              <button
                type="button"
                className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
                aria-label="关闭聊天抽屉"
              >
                <X size={16} />
              </button>
            </DrawerClose>
          </div>
        </DrawerHeader>

        <div className="flex flex-1 flex-col gap-4 px-6 pb-2">
          <div
            ref={viewportRef}
            className="flex flex-1 flex-col gap-4 overflow-y-auto rounded-2xl border border-white/70 bg-white/60 p-4 text-sm text-slate-900 shadow-inner"
          >
            {messages.map((message) => (
              <div
                key={message.id}
                className={clsx(
                  'max-w-[20rem] rounded-[22px] px-4 py-3 leading-relaxed shadow-sm',
                  message.role === 'assistant'
                    ? 'bg-slate-100 text-slate-900'
                    : 'ml-auto bg-sky-100 text-sky-900'
                )}
              >
                {message.content}
              </div>
            ))}
          </div>
        </div>

        <DrawerFooter className="sticky bottom-0 w-full border-t border-slate-200/70 bg-slate-100/70 px-6 py-4">
          <form onSubmit={handleSubmit} className="flex w-full items-center gap-3">
            <textarea
              className="flex-1 resize-none rounded-2xl border border-white/70 bg-white/70 px-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
              placeholder="输入消息..."
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={1}
            />
            <Button
              variant="outline"
              className="h-10 w-10 rounded-full p-0 text-lg"
              aria-label="发送消息"
            >
              <Send size={18} />
            </Button>
          </form>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
