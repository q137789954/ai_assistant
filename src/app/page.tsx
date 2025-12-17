"use client";

import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";

import Chatbot from "./page/components/Chatbot";
import AvatarCommandInput from "./page/AvatarCommandInput";
import { VoiceInputToggle } from "@/app/components/features";
import { useVoiceInputListener } from "./hooks";
import { GlobalsContext } from "@/app/providers/GlobalsProviders";
import { useWebSocketContext } from "@/app/providers/WebSocketProviders";
import { Button } from "./components/ui";
import { MessageSquareMore } from "lucide-react";

export default function Home() {
  const globals = useContext(GlobalsContext);
  const { chatbotVisible, dispatch } = globals ?? {};
  const [messageLog, setMessageLog] = useState<string[]>([]);
  const { data: session, status: authStatus } = useSession();

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
      })
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
    [emitEvent]
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
    [lastMessage]
  );

  const handleTextBtn = useCallback(() => {
    if(dispatch) {
      dispatch({ type: "SET_CHATBOT_VISIBILITY", payload: !chatbotVisible });
    }
  }, [chatbotVisible, dispatch]);

  return (
    <main className="h-full w-full relative flex flex-col">
      {/* 右上角：登录/登出入口（便于快速验证登录注册功能） */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        {authStatus === "authenticated" ? (
          <>
            <span className="rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-xs text-slate-700 shadow-sm">
              {session.user?.name || session.user?.email || "已登录"}
            </span>
            <button
              type="button"
              className="rounded-full border border-slate-300 bg-white/90 px-3 py-1 text-xs font-medium text-slate-700 shadow-sm hover:border-slate-500"
              onClick={() => signOut({ callbackUrl: "/" })}
            >
              退出
            </button>
          </>
        ) : (
          <button
            type="button"
            className="rounded-full border border-slate-300 bg-white/90 px-3 py-1 text-xs font-medium text-slate-700 shadow-sm hover:border-slate-500"
            onClick={() => signIn(undefined, { callbackUrl: "/" })}
          >
            登录
          </button>
        )}
      </div>

      {/* <Wave className='shrink-0' height={100} fillColor="color-mix(in srgb, oklch(95% calc(var(--chromatic-chroma-50) * 0.5) var(--chromatic-hue)) 80%, oklch(100% 0 360))"/> */}
      {globals?.isUserSpeaking && (
        <div className="pointer-events-none absolute top-16 right-6 rounded-2xl border border-green-300/50 bg-white/90 px-4 py-2 text-xs font-medium text-slate-600 shadow-lg">
          检测到用户说话中...
        </div>
      )}

      <div className="absolute top-4 left-4 w-72 rounded-2xl border border-slate-200/60 bg-white/90 p-4 text-sm text-slate-700 shadow-xl">
        <p className="text-xs uppercase tracking-wide text-slate-500">
          WebSocket 连接
        </p>
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

      {/* 根据全局配置控制 Chatbot 是否渲染，默认保持隐藏 */}
      {chatbotVisible && (
        <div className="absolute bottom-4 right-4 w-120 h-dvh py-32 pointer-events-auto">
          <Chatbot />
        </div>
      )}
      <div className="absolute bottom-4 left-6 right-6">
        <div className="w-full flex gap-2">
          <VoiceInputToggle />
          <AvatarCommandInput />
          <Button className="flex gap-2" size="lg" variant="outline" onClick={handleTextBtn}>
            <MessageSquareMore />
            <span>Text</span>
          </Button>
        </div>
      </div>
    </main>
  );
}
