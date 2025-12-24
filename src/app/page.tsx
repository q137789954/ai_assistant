"use client";

import { useCallback, useContext, useEffect } from "react";
import Chatbot from "./page/components/Chatbot";
import AvatarCommandInput from "./page/AvatarCommandInput";
import VideoPlayer from "./page/components/VideoPlayer";
import { useVoiceInputListener, useTtsAudioPlayer } from "./hooks";
import { GlobalsContext } from "@/app/providers/GlobalsProviders";
import { useWebSocketContext } from "@/app/providers/WebSocketProviders";
import Tabbar from './page/components/Tabbar';

export default function Home() {
  const globals = useContext(GlobalsContext);
  const { chatbotVisible, dispatch } = globals ?? {};

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
      <div className="py-4 px-6 shrink-0">
        <Tabbar />
      </div>
      <div className="flex flex-1 justify-center items-center px-6 py-8 grow shrink">
        {/* 视频组件区域：占位在页面中央，展示可快速筛选和切换的播放器 */}
        <VideoPlayer />
      </div>
      <div className="py-4 px-6 shrink-0">
        <div className="w-full flex gap-2 items-center">
          <div className="h-6 w-6 flex justify-center items-center text-xl" onClick={handleTextBtn}>💬</div>
          <AvatarCommandInput />
        </div>
      </div>
      {/* Chatbot 通过抽屉形式展示，交由 open 状态控制动画 */}
      <Chatbot
        open={chatbotVisible || false}
        onOpenChange={(next) => {
          if (dispatch) {
            dispatch({ type: "SET_CHATBOT_VISIBILITY", payload: next });
          }
        }}
      />
    </main>
  );
}
