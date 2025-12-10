"use client";

import { useCallback, useContext, useEffect, useMemo, useState } from "react";

import Chatbot from "./page/components/Chatbot";
import { useVoiceInputListener } from "./hooks";
import { GlobalsContext } from "@/app/providers/GlobalsProviders";
import { useWebSocketContext } from "@/app/providers/WebSocketProviders";
import Wave from './page/components/Wave'
import Live2DClient from './page/components/Live2DClient'

export default function Home() {
  const globals = useContext(GlobalsContext);
  const [messageLog, setMessageLog] = useState<string[]>([]);

  const {
    status,
    lastMessage,
    lastError,
    connect,
    disconnect,
    sendMessage,
    emitEvent,
    subscribe,
  } = useWebSocketContext();

  const handleSendPing = useCallback(() => {
    sendMessage(
      JSON.stringify({
        type: "ping",
        timestamp: new Date().toISOString(),
      }),
    );
  }, [sendMessage]);

  /**
   * 每次收到 VAD 语音段后通过 socket.io 的自定义事件把音频帧上报给服务端
   */
  const handleVoiceChunk = useCallback(
    (audio: Float32Array) => {
      const chunkMeta = {
        chunkId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        sampleRate: 16000,
        timestamp: new Date().toISOString(),
        length: audio.length,
      };
      const sent = emitEvent("voice-chunk", chunkMeta, audio);
      if (!sent) {
        console.warn("语音帧发送失败，请检查 WebSocket 连接状态");
      }
    },
    [emitEvent],
  );

  useEffect(() => {
    const unsubscribe = subscribe((event) => {
      const payload =
        typeof event.data === "string"
          ? event.data
          : `[binary:${event.data?.byteLength ?? "unknown"}]`;
      setMessageLog((prev) => [payload, ...prev].slice(0, 5));
    });
    return unsubscribe;
  }, [subscribe]);

  useVoiceInputListener({
    onSpeechSegment: handleVoiceChunk,
    onError(error) {
      console.error("VAD 错误：", error);
    },
    vadOptions: {
      // 例如调整开始/结束阈值：
      // positiveSpeechThreshold: 0.7,
      // negativeSpeechThreshold: 0.3,
    },
  });

  const friendlyMessage = useMemo(
    () => (lastMessage ? String(lastMessage.data) : "等待消息..."),
    [lastMessage],
  );

  return (
    <main className="h-full w-full relative flex flex-col">
      <Wave className='shrink-0' height={100} fillColor="color-mix(in srgb, oklch(95% calc(var(--chromatic-chroma-50) * 0.5) var(--chromatic-hue)) 80%, oklch(100% 0 360))"/>
      <div className="w-full h-full shrink grow"><Live2DClient /></div>
      {globals?.isUserSpeaking && (
        <div className="pointer-events-none absolute top-16 right-6 rounded-2xl border border-green-300/50 bg-white/90 px-4 py-2 text-xs font-medium text-slate-600 shadow-lg">
          检测到用户说话中...
        </div>
      )}

      <div className="absolute top-4 left-4 w-72 rounded-2xl border border-slate-200/60 bg-white/90 p-4 text-sm text-slate-700 shadow-xl">
        <p className="text-xs uppercase tracking-wide text-slate-500">WebSocket 连接</p>
        <p className="text-base font-semibold">
          状态：
          <span className="ml-2 font-normal text-slate-600">{status}</span>
        </p>
        {lastError && (
          <p className="text-xs text-red-500">
            错误：
            <span className="ml-1">{lastError.type}</span>
          </p>
        )}
        <p className="text-xs text-slate-500">上一条消息：{friendlyMessage}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-500 hover:text-slate-900"
            type="button"
            onClick={connect}
          >
            连接
          </button>
          <button
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-500 hover:text-slate-900"
            type="button"
            onClick={disconnect}
          >
            断开
          </button>
          <button
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-500 hover:text-slate-900"
            type="button"
            onClick={handleSendPing}
          >
            发送测试消息
          </button>
        </div>
        {messageLog.length > 0 && (
          <div className="mt-3 max-h-28 overflow-auto rounded-xl border border-slate-200/60 bg-slate-50/80 p-2 text-xs text-slate-600">
            {messageLog.map((item, index) => (
              <p key={`${item}-${index}`} className="truncate">
                {item}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="absolute bottom-4 right-4 w-120 h-dvh py-16 pointer-events-auto">
        <Chatbot />
      </div>
    </main>
  );
}
