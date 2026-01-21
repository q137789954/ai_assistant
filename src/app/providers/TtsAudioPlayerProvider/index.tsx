"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useTtsAudioPlayer } from "@/app/hooks/useTtsAudioPlayer";

/**
 * 统一 TTS 播放控制的上下文类型。
 */
type TtsAudioPlayerContextValue = {
  // 立即停止当前播放并清空队列
  stopTtsPlayback: () => void;
  // 直接播放一段语音数据（用于开场音效等场景）
  playSpeechBuffer: (
    audio: Float32Array | Int16Array | Uint8Array | number[],
    options?: {
      format?: string;
      requestId?: string;
    },
  ) => void;
  // 动态注册“requestId 播放完成”回调，确保只保留单一实例
  setOnRequestPlaybackComplete: (
    callback?: (requestId: string) => void,
  ) => void;
};

const TtsAudioPlayerContext = createContext<TtsAudioPlayerContextValue | undefined>(
  undefined,
);

/**
 * 将 useTtsAudioPlayer 包装为全局 Provider，避免多个组件重复订阅 WebSocket。
 */
const TtsAudioPlayerProvider = ({ children }: { children: React.ReactNode }) => {
  // 保存外部注册的播放完成回调，便于在 Provider 内统一注入
  const [onRequestPlaybackComplete, setOnRequestPlaybackComplete] = useState<
    ((requestId: string) => void) | undefined
  >(undefined);

  // 只初始化一次播放管线，内部会订阅 WebSocket 并驱动动画/音频
  const { stopTtsPlayback, playSpeechBuffer } = useTtsAudioPlayer({
    onRequestPlaybackComplete,
  });

  const stableSetter = useCallback(
    (callback?: (requestId: string) => void) => {
      // 用函数包裹，避免 React 将 callback 误判为 setState 的 updater
      setOnRequestPlaybackComplete(() => callback);
    },
    [],
  );

  const value = useMemo(
    () => ({
      stopTtsPlayback,
      playSpeechBuffer,
      setOnRequestPlaybackComplete: stableSetter,
    }),
    [playSpeechBuffer, stopTtsPlayback, stableSetter],
  );

  return (
    <TtsAudioPlayerContext.Provider value={value}>
      {children}
    </TtsAudioPlayerContext.Provider>
  );
};

/**
 * 通过 Context 获取全局唯一的 TTS 播放控制实例。
 */
export const useTtsAudioPlayerContext = () => {
  const context = useContext(TtsAudioPlayerContext);
  if (!context) {
    throw new Error("useTtsAudioPlayerContext 必须在 TtsAudioPlayerProvider 内使用");
  }
  return context;
};

export default TtsAudioPlayerProvider;
