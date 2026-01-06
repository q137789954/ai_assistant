"use client";

import { useCallback, useContext, useEffect, useState, useRef } from "react";
import Chatbot from "./page/components/Chatbot";
import AvatarCommandInput from "./page/AvatarCommandInput";
import AnimationPlayer from "./page/components/AnimationPlayer";
import ModeSwitch from "./page/components/ModeSwitch";
import { useVoiceInputListener, useTtsAudioPlayer, } from "./hooks";
import { GlobalsContext } from "@/app/providers/GlobalsProviders";
import { useWebSocketContext } from "@/app/providers/WebSocketProviders";
import Tabbar from "./page/components/Tabbar";
import { useAnimationPlayer } from "@/app/providers/AnimationProvider";
import BreakMeter, { type BreakMeterHandle } from "./page/components/BreakMeter";

export default function Home() {
  const globals = useContext(GlobalsContext);
  const { chatbotVisible, dispatch } = globals ?? {};

const { allAnimationsLoaded, preloadProgress, resetToFirstFrame, switchToAnimationById } =
    useAnimationPlayer();
  const { stopTtsPlayback } = useTtsAudioPlayer();
  const [showAnimationLoader, setShowAnimationLoader] = useState(true);
  const { emitEvent, subscribe } = useWebSocketContext();

  const requestId = useRef<string>(null);
  const speechStartTimestamp = useRef<number>(null);
  const breakMeterRef = useRef<BreakMeterHandle | null>(null);


  const ensureSpeechSession = useCallback(() => {
  if (!requestId.current) {
    requestId.current = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    speechStartTimestamp.current = Date.now();
    dispatch?.({ type: "SET_TIMESTAMP_WATERMARK", payload: speechStartTimestamp.current });
    // 发送新指令前重置语音播放与动画帧
    stopTtsPlayback();
    // resetToFirstFrame();
    switchToAnimationById('listen')
  }
}, [dispatch, stopTtsPlayback, switchToAnimationById]);

  /**
   * 每次收到 VAD 语音段后通过 socket.io 的自定义事件把音频帧上报给服务端
   */
  const handleVoiceChunk = useCallback(
    (audio: Float32Array) => {
      ensureSpeechSession();
      const chunkMeta = {
        requestId: requestId.current,
        chunkId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        sampleRate: 16000,
        timestamp: Date.now(),
        content: Array.from(audio),
        outputFormat: "speech",
        inputFormat: "speech",
      };
      const sent = emitEvent("chat:input", chunkMeta, audio);
      if (!sent) {
        console.warn("语音帧发送失败，请检查 WebSocket 连接状态");
      }
    },
    [emitEvent, ensureSpeechSession]
  );

  useEffect(() => {
    // 监听 WebSocket 元信息事件，将服务端结算的破防增量映射到 BreakMeter
    const unsubscribe = subscribe((event) => {
      if (typeof event.data !== "string") {
        return;
      }

      let parsed: { event?: string; data?: Record<string, unknown> } | null =
        null;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }

      if (parsed && parsed.event === "chat-response-meta") {
        // damage_delta 可能来自字符串或数字，统一转成数字后再更新破防条
      const payload = parsed.data ?? {};
      console.log(payload, 'payload')
      const damageDeltaRaw = payload.damage_delta;
      const damageDelta =
        typeof damageDeltaRaw === "number"
          ? damageDeltaRaw
          : Number(damageDeltaRaw);
      if (!Number.isFinite(damageDelta)) {
        return;
      }

      breakMeterRef.current?.addRage(damageDelta);
        return;
      }
    });

    return () => {
      unsubscribe();
    };
  }, [subscribe]);

  // 所有动画资源加载完成后或等待时限到达后才隐藏加载中提示，避免因资源慢加载导致界面无反馈
  useEffect(() => {
    if (!allAnimationsLoaded) {
      return undefined;
    }
    const frame = window.setTimeout(() => {
      setShowAnimationLoader(false);
    }, 0);
    return () => clearTimeout(frame);
  }, [allAnimationsLoaded]);

  useEffect(() => {
    if (!showAnimationLoader) {
      return undefined;
    }
    const timeout = setTimeout(() => {
      setShowAnimationLoader(false);
    }, 10000);
    return () => clearTimeout(timeout);
  }, [showAnimationLoader]);
  useTtsAudioPlayer();

  const onSpeechEnd = useCallback(() => {
    emitEvent("chat:input", {
      content: [],
      outputFormat: "speech",
      inputFormat: "speech",
      type: "end",
      timestamp: Date.now(),
      requestId: requestId.current,
    });
    requestId.current = null;
    speechStartTimestamp.current = null;
  }, [emitEvent, dispatch]);

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

  const onOverload = useCallback(() => {
    // 破防值满时自动关闭 Chatbot 抽屉
    if (dispatch) {
      
    }
  }, [dispatch]);

  // 所有动画资源加载完之前展示一个加载中组件（最多10秒）

  return (
    <main className="h-full w-full relative flex flex-col bg-[url('/home/lamplight.jpeg')] bg-cover bg-center bg-no-repeat">
      {showAnimationLoader && (
        <div className="pointer-events-none absolute inset-0 z-40 flex flex-col items-center justify-center gap-2 bg-slate-950/90 text-center text-white">
          <div className="text-xl font-semibold">资源加载中……</div>
          <div className="text-sm text-slate-300">
            已加载 {preloadProgress.loaded}/{preloadProgress.total}，最多等待 10
            秒
          </div>
        </div>
      )}
      <div className="py-4 px-6 shrink-0">
        <Tabbar />
      </div>
      <div className="flex flex-1 justify-center items-center grow shrink max-h-[calc(100%-132px)] relative">
        <BreakMeter ref={breakMeterRef} autoReset={false} onOverload={onOverload} />
        {/* 动画组件区域：占位在页面中央，展示 Spine 动画渲染区域 */}
        <AnimationPlayer />
      </div>
      <div className="py-4 px-6 shrink-0">
        <div className="w-full flex gap-2 items-center">
          <div
            className="h-6 w-6 flex justify-center items-center text-xl"
            onClick={handleTextBtn}
          >
            💬
          </div>
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
      <div className="absolute w-full bottom-16">
        <ModeSwitch />
      </div>
    </main>
  );
}
