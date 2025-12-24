"use client";

import { useCallback, useContext, useEffect} from "react";
import { signIn, signOut, useSession } from "next-auth/react";

import Chatbot from "./page/components/Chatbot";
import AvatarCommandInput from "./page/AvatarCommandInput";
import { useVoiceInputListener, useTtsAudioPlayer } from "./hooks";
import { GlobalsContext } from "@/app/providers/GlobalsProviders";
import { useWebSocketContext } from "@/app/providers/WebSocketProviders";
import Tabbar from './page/components/Tabbar';

export default function Home() {
  const globals = useContext(GlobalsContext);
  const { chatbotVisible, dispatch } = globals ?? {};
  const { data: session, status: authStatus } = useSession();

  const { emitEvent, subscribe } = useWebSocketContext();

  /**
   * 每次收到 VAD 语音段后通过 socket.io 的自定义事件把音频帧上报给服务端
   */
  const handleVoiceChunk = useCallback(
    (audio: Float32Array) => {
      const chunkMeta = {
        chunkId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        sampleRate: 16000,
        timestamp: new Date().toISOString(),
        content: Array.from(audio),
        outputFormat: "speech",
        inputFormat: "speech",
      };
      const sent = emitEvent("chat:input", chunkMeta, audio);
      if (!sent) {
        console.warn("语音帧发送失败，请检查 WebSocket 连接状态");
      }
    },
    [emitEvent]
  );

  useEffect(() => {
    const unsubscribe = subscribe(() => {});
    return unsubscribe;
  }, [subscribe]);

  useTtsAudioPlayer();

  const onSpeechEnd = useCallback(() => {
    emitEvent("chat:input", {
      content: [],
      outputFormat: "speech",
      inputFormat: "speech",
      type: "end",
    });
  }, [emitEvent]);

  useVoiceInputListener({
    onSpeechSegment: handleVoiceChunk,
    onSpeechEnd,
    onError(error) {
      console.error("VAD 错误：", error);
    },
    vadOptions: {
      // 例如调整开始/结束阈值：
      // positiveSpeechThreshold: 0.7,
      // negativeSpeechThreshold: 0.3,
    },
  });

  const handleTextBtn = useCallback(() => {
    if (dispatch) {
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
      <Tabbar />
      {globals?.isUserSpeaking && (
        <div className="pointer-events-none absolute top-16 right-6 rounded-2xl border border-green-300/50 bg-white/90 px-4 py-2 text-xs font-medium text-slate-600 shadow-lg">
          检测到用户说话中...
        </div>
      )}

      {/* Chatbot 通过抽屉形式展示，交由 open 状态控制动画 */}
      <Chatbot
        open={chatbotVisible || false}
        onOpenChange={(next) => {
          if (dispatch) {
            dispatch({ type: "SET_CHATBOT_VISIBILITY", payload: next });
          }
        }}
      />
      <div className="absolute bottom-4 left-6 right-6">
        <div className="w-full flex gap-2 items-center">
          <div className="h-6 w-6 flex justify-center items-center text-xl" onClick={handleTextBtn}>💬</div>
          <AvatarCommandInput />
        </div>
      </div>
    </main>
  );
}
