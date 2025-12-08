'use client'

import { useState } from 'react'

import Chatbot from './page/components/Chatbot'
import { useVoiceInputListener } from './hooks'
// import Wave from './page/components/Wave'

export default function Home() {
  const [latestTranscript, setLatestTranscript] = useState('')

  useVoiceInputListener({
    onResult: (transcript) => {
      setLatestTranscript(transcript)
    },
    onError: console.error,
  })

  return (
    <main className="h-full w-full relative flex flex-col relative">
      {/* <Wave className='shrink-0' height={100} fillColor="color-mix(in srgb, oklch(95% calc(var(--chromatic-chroma-50) * 0.5) var(--chromatic-hue)) 80%, oklch(100% 0 360))"/> */}
      <div className="w-full h-full shrink grow">
        {/* <Live2DClient /> */}
      </div>
      {latestTranscript && (
        <div className="pointer-events-none absolute top-6 right-6 rounded-2xl border border-sky-300/50 bg-white/90 px-4 py-2 text-xs font-medium text-slate-600 shadow-lg">
          识别结果：{latestTranscript}
        </div>
      )}
      <div className="absolute bottom-4 right-4 w-120 h-dvh py-16 pointer-events-auto">
        <Chatbot />
      </div>
    </main>
  )
}
