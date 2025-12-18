'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import { Button } from '@/app/components/ui'
import { Send } from 'lucide-react'
import { useWebSocketContext } from "@/app/providers/WebSocketProviders";

type MessageRole = 'assistant' | 'user'

interface Message {
  id: number
  role: MessageRole
  content: string
}

const initialMessages: Message[] = [
  
]

export default function Chatbot() {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [draft, setDraft] = useState('')
  const viewportRef = useRef<HTMLDivElement>(null)

  const {
    emitEvent,
  } = useWebSocketContext();

  useEffect(() => {
    viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight })
  }, [messages])


  

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = draft.trim()
    if (!trimmed) {
      return
    }

    const messageMeta = {
          messageId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          sampleRate: 16000,
          timestamp: new Date().toISOString(),
          content: trimmed,
          outputFormat: "text",
        };
        const sent = emitEvent("chat:input", messageMeta);
        if (!sent) {
          console.warn("消息发送失败，请检查 WebSocket 连接状态");
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
    <div className="flex h-full max-h-full w-full flex-col rounded-[32px] border border-sky-200/80 bg-sky-50/80 p-4 shadow-[0_12px_40px_rgba(15,118,255,0.15)] backdrop-blur">
      <div className="flex flex-1 flex-col rounded-[28px] border border-sky-100/60 bg-white text-sm shadow-inner">
        <div
          ref={viewportRef}
          className="flex flex-1 flex-col gap-4 overflow-y-auto rounded-[28px] border border-transparent bg-white/50 p-6 text-slate-900"
        >
          {messages.map((message) => (
            <div
              key={message.id}
              className={`max-w-[20rem] rounded-[22px] px-4 py-3 leading-relaxed shadow-sm ${
                message.role === 'assistant'
                  ? 'bg-slate-100 text-slate-900'
                  : 'ml-auto bg-sky-100 text-sky-900'
              }`}
            >
              {message.content}
            </div>
          ))}
        </div>
        <div className="mt-4 flex h-20 shrink-0 flex-col rounded-b-[28px] bg-sky-100/90 px-6 py-4">
          <form onSubmit={handleSubmit} className="mt-2 flex items-center gap-3">
            <textarea
              className="flex-1 resize-none rounded-2xl border border-white/70 bg-white/70 px-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
              placeholder="输入消息..."
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={1}
            />
            {/* rounded-full border border-sky-200 bg-white text-sky-600 transition hover:bg-sky-50 */}
            <Button
              variant="outline"
              className="h-10 w-10 p-0! flex items-center justify-center rounded-full! text-lg!"
              aria-label="发送消息"
            >
              <Send size={18} />
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
