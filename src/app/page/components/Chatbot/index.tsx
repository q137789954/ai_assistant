'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  Button,
  Drawer,
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
  // 当前会话中的所有消息列表，展示时按顺序渲染
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  // 当前输入框中的草稿内容，用于实时编辑
  const [draft, setDraft] = useState('')
  // 聊天内容容器的 DOM 引用，方便实现自动滚动
  const viewportRef = useRef<HTMLDivElement>(null)
  // 记录正在流式更新的助手消息 ID，避免重复插入
  const streamingAssistantMessageIdRef = useRef<number | null>(null)

  const { emitEvent, subscribe } = useWebSocketContext()

  // 消息更新后自动滚动到底部，保持最新内容布局可见
  useEffect(() => {
    viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight })
  }, [messages])

  useEffect(() => {
    if (!open) {
      streamingAssistantMessageIdRef.current = null
      return
    }

    // 订阅 WebSocket 消息，当聊天抽屉打开时接收助手回应
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

      // 内部复用逻辑：追加或更新当前正在流式输出的助手消息
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

      // 处理助手的分段响应，保持流式更新
      if (parsed.event === 'chat-response-chunk') {
        const aggregated = payloadData.aggregated
        if (typeof aggregated === 'string') {
          appendOrUpdateAssistantMessage(aggregated)
        }
        return
      }

      // 当助手返回完整内容后，重新设置最终文本并结束流式监听
      if (parsed.event === 'chat-response-complete') {
        const finalContent = payloadData.assistantContent
        if (typeof finalContent === 'string') {
          appendOrUpdateAssistantMessage(finalContent)
        }
        streamingAssistantMessageIdRef.current = null
        return
      }

      // 打印错误日志，方便排查接口异常
      if (parsed.event === 'chat-response-error') {
        console.error('助手响应错误：', payloadData.message)
      }
    })

    return () => {
      streamingAssistantMessageIdRef.current = null
      unsubscribe()
    }
  }, [open, subscribe])

  // 表单提交即向服务端发送用户输入的消息
  function handleSubmit() {
    const trimmed = draft.trim()
    if (!trimmed) {
      return
    }

    // 构建消息元数据，包含唯一 ID 及格式要求
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

    // 先在本地展示用户消息，等待助手回应
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

  // 通过抽屉组件展示整个聊天界面
  return (
    <Drawer
      open={open}
      onClose={() => onOpenChange(false)}
      placement="bottom"
      size="large"
      closable={false}
      maskClosable
      className="chatbot-drawer"
    >
      <div className="flex h-full flex-col rounded-t-[32px] border border-slate-200/80 bg-slate-50 shadow-2xl">
        <DrawerHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <DrawerTitle>AI 助手</DrawerTitle>
              <DrawerDescription>实时语音 + 文本交互，支持持续对话。</DrawerDescription>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
              aria-label="关闭聊天抽屉"
            >
              <X size={16} />
            </button>
          </div>
        </DrawerHeader>

        <div className="flex flex-1 flex-col gap-4 px-6 pb-2">
          {/* 聊天内容展示区域：根据 role 分别渲染左右气泡 */}
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

        {/* 底部固定的输入栏，保持输入框在视口可见 */}
        <DrawerFooter className="sticky bottom-0 w-full border-t border-slate-200/70 bg-slate-100/70 px-6 py-4">
          {/* 用户输入区域：支持多行输入和发送按钮 */}
          <div onSubmit={handleSubmit} className="flex w-full items-center gap-3">
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
              onClick={handleSubmit}
            >
              <Send size={18} />
            </Button>
          </div>
        </DrawerFooter>
      </div>
    </Drawer>
  )
}
