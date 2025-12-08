'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import {VoiceInputToggle} from '@/app/components'

type MessageRole = 'assistant' | 'user'

interface Message {
  id: number
  role: MessageRole
  content: string
}

const initialMessages: Message[] = [
  {
    id: 1,
    role: 'assistant',
    content: '你好，我是你的 AI 助手，可以随时帮你整理笔记、写代码或聊天。',
  },
  {
    id: 2,
    role: 'user',
    content: '帮我想一个轻松愉快的周末计划。',
  },
  {
    id: 3,
    role: 'assistant',
    content: '可以去近郊徒步，然后在湖边野餐，晚上再看一部放松的电影。需要我帮你列一份清单吗？',
  },
]

export default function Chatbot() {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [draft, setDraft] = useState('')
  const viewportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight })
  }, [messages])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = draft.trim()
    if (!trimmed) {
      return
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
        <div className="mt-4 flex h-[150px] shrink-0 flex-col rounded-b-[28px] bg-sky-100/90 px-6 py-4">
          <div className="text-sm text-sky-500">说点什么...</div>
          <form onSubmit={handleSubmit} className="mt-2 flex items-center gap-3">
            <textarea
              className="flex-1 resize-none rounded-2xl border border-white/70 bg-white/70 px-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
              placeholder="输入消息..."
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={1}
            />
            <button
              type="submit"
              className="h-10 w-10 rounded-full border border-sky-200 bg-white text-sky-600 transition hover:bg-sky-50"
              aria-label="发送消息"
            >
              <span className="text-lg leading-none">↗︎</span>
            </button>
          </form>
          <div className="mt-2 flex items-center justify-between text-[0.65rem] text-slate-400">
            <VoiceInputToggle />
            <div className="flex gap-3">
              <button
                type="button"
                className="text-slate-400 transition hover:text-slate-600"
                aria-label="清理对话"
              >
                🗑
              </button>
              <button
                type="button"
                className="text-slate-400 transition hover:text-slate-600"
                aria-label="更换主题"
              >
                ☀︎
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
