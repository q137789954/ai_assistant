'use client'

import { useState } from 'react'

import Chatbot from './page/components/Chatbot'
import { useVoiceInputListener } from './hooks'
// import Wave from './page/components/Wave'

export default function Home() {
  const [chunkCount, setChunkCount] = useState(0)
  const [isRecording, setIsRecording] = useState(false)

  useVoiceInputListener({
    onAudioStart: () => {
      setIsRecording(true)
      setChunkCount(0)
    },
    onAudioStop: () => {
      setIsRecording(false)
    },
    onAudioChunk: () => {
      setChunkCount((prev) => prev + 1)
    },
    onError: console.error,
  })

  return (
    <main className="h-full w-full relative flex flex-col relative">
      {/* <Wave className='shrink-0' height={100} fillColor="color-mix(in srgb, oklch(95% calc(var(--chromatic-chroma-50) * 0.5) var(--chromatic-hue)) 80%, oklch(100% 0 360))"/> */}
      <div className="w-full h-full shrink grow">
        {/* <Live2DClient /> */}
      </div>
      <div className="pointer-events-none absolute top-6 right-6 rounded-2xl border border-sky-300/50 bg-white/90 px-4 py-2 text-xs font-medium text-slate-600 shadow-lg">
        {isRecording ? `录音中 · 已采集 ${chunkCount} 块数据` : '语音输入已关闭'}
      </div>
      <div className="absolute bottom-4 right-4 w-120 h-dvh py-16 pointer-events-auto">
        <Chatbot />
      </div>
    </main>
  )
}
