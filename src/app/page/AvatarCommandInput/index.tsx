import React, { useEffect, useState } from "react";
import { Textarea, Button } from "@/app/components/ui";
import { useWebSocketContext } from '@/app/providers/WebSocketProviders'
import { SendHorizontal } from "lucide-react";
import { VoiceInputToggle } from "@/app/components/features";


const AvatarCommandInput = () => {

  const [input, setInput] = useState('')
  const { emitEvent, subscribe } = useWebSocketContext();

  useEffect(() => {
  
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
  
        // 打印错误日志，方便排查接口异常
        if (parsed.event === 'chat-response-error') {
          console.error('助手响应错误：', payloadData.message)
        }
      })
  
      return () => {
        unsubscribe()
      }
    }, [subscribe])

    const handleSubmit = () => {
        const trimmed = input.trim()
        if (!trimmed) {
          return
        }

        // 构建消息元数据，包含唯一 ID 及格式要求
        const messageMeta = {
          messageId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          sampleRate: 16000,
          content: trimmed,
          outputFormat: 'speech',
          inputFormat: 'text',
        }
        const sent = emitEvent('chat:input', messageMeta)
        if (!sent) {
          console.warn('消息发送失败，请检查 WebSocket 连接状态')
        }
        setInput('')
      }

    const handleTextareaKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // 按下 Enter 且未按住 Shift 时提交，避免默认换行行为
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        handleSubmit()
      }
    }

  return (
    <div className="w-full flex gap-1 items-center">
        <Textarea
          className="h-11! rounded-full! resize-none!"
          placeholder="请输入指令"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleTextareaKeyDown}
        />
        <VoiceInputToggle />
        <div className="flex items-center justify-center h-10! w-10! rounded-full! p-0! shrink-0 bg-[rgb(204,255,0)] text-black text-sm cursor-pointer" onClick={handleSubmit}>
          ➤
        </div>
    </div>
  );
};

export default AvatarCommandInput;
