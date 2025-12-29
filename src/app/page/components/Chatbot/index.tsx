'use client'

import { useEffect, useState } from 'react'
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

import ChatHistory from './ChatHistory'
import type { Message } from './types'
import { createMessageId } from './types'

interface ChatbotProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function Chatbot({ open, onOpenChange }: ChatbotProps) {
  const [draft, setDraft] = useState('')
  const [pendingUserMessage, setPendingUserMessage] = useState<Message | null>(null)
  const [drawerPlacement, setDrawerPlacement] = useState<'bottom' | 'right'>('bottom')

  const { emitEvent } = useWebSocketContext()

  useEffect(() => {
    if (!open) {
      setPendingUserMessage(null)
    }
  }, [open])

  useEffect(() => {
    const updatePlacement = () => {
      const isLargeScreen = window.innerWidth >= 1024
      setDrawerPlacement(isLargeScreen ? 'right' : 'bottom')
    }

    updatePlacement()
    window.addEventListener('resize', updatePlacement)
    return () => window.removeEventListener('resize', updatePlacement)
  }, [])

  const handleSubmit = () => {
    const trimmed = draft.trim()
    if (!trimmed) {
      return
    }

    const messageId = createMessageId()
    const messageMeta = {
      messageId,
      sampleRate: 16000,
      content: trimmed,
      outputFormat: 'text',
      inputFormat: 'text',
    }

    const sent = emitEvent('chat:input', messageMeta)
    if (!sent) {
      console.warn('消息发送失败，请检查 WebSocket 连接状态')
    }

    setPendingUserMessage({
      id: messageId,
      role: 'user',
      content: trimmed,
    })
    setDraft('')
  }

  return (
    <Drawer
      open={open}
      onClose={() => onOpenChange(false)}
      placement={drawerPlacement}
      size="large"
      closable={false}
      maskClosable
      className="chatbot-drawer"
      classNames={{
        section: 'bg-[rgba(30,30,30,1)]!',
        mask: 'backdrop-blur-lg!',
      }}
    >
      <div className="flex h-full flex-col rounded-t-[32px]">
        <DrawerHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <DrawerTitle>AI 助手</DrawerTitle>
              <DrawerDescription>实时语音 + 文本交互，支持持续对话。</DrawerDescription>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-full border border-slate-200/10 bg-white/10 p-2 text-slate-500! transition hover:border-slate-300/10 hover:text-slate-900!"
              aria-label="关闭聊天抽屉"
            >
              <X size={16} />
            </button>
          </div>
        </DrawerHeader>

        <div className="flex flex-1 flex-col gap-4 px-6 pb-2">
          <ChatHistory
            open={open}
            pendingUserMessage={pendingUserMessage}
            onPendingUserMessageRendered={() => setPendingUserMessage(null)}
          />
        </div>

        <DrawerFooter className="sticky bottom-0 w-full border-t px-6 py-4">
          <div onSubmit={handleSubmit} className="flex w-full items-center gap-3">
            <textarea
              className="flex-1 resize-none rounded-2xl border border-white/70 px-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
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
