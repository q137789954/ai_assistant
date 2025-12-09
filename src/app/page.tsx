"use client";

import { useContext } from "react";

import Chatbot from "./page/components/Chatbot";
import { useVoiceInputListener } from "./hooks";
import { GlobalsContext } from '@/app/providers/GlobalsProviders'
// import Wave from './page/components/Wave'
// import Live2DClient from './page/components/Live2DClient'

export default function Home() {

  const globals = useContext(GlobalsContext)

  useVoiceInputListener({
    onSpeechSegment(audio) {
      // console.log("本次说话帧数：", audio.length); // 采样率 16k
    },
    onError(error) {
      console.error("VAD 错误：", error);
    },
    vadOptions: {
      // 例如调整开始/结束阈值：
      // positiveSpeechThreshold: 0.7,
      // negativeSpeechThreshold: 0.3,
    },
  });

  console.log('globals in Home page:', globals?.isUserSpeaking);

  return (
    <main className="h-full w-full relative flex flex-col">
      {/* <Wave className='shrink-0' height={100} fillColor="color-mix(in srgb, oklch(95% calc(var(--chromatic-chroma-50) * 0.5) var(--chromatic-hue)) 80%, oklch(100% 0 360))"/> */}
      {/* <div className="w-full h-full shrink grow"><Live2DClient /></div> */}
      {
          globals?.isUserSpeaking && (
            <div className="pointer-events-none absolute top-16 right-6 rounded-2xl border border-green-300/50 bg-white/90 px-4 py-2 text-xs font-medium text-slate-600 shadow-lg">
              检测到用户说话中...
            </div>
          )
        }
      <div className="absolute bottom-4 right-4 w-120 h-dvh py-16 pointer-events-auto">
        <Chatbot />
      </div>
    </main>
  );
}
