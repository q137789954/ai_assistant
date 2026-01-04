"use client";

import { useEffect, useMemo, useRef } from "react";
import { useTtsAudioPlayer } from "@/app/hooks";
import { useWebSocketContext } from "@/app/providers/WebSocketProviders";

const ModeSwitch = () => {
  const { stopTtsPlayback, playSpeechBuffer } = useTtsAudioPlayer();
  const { emitEvent, subscribe } = useWebSocketContext();
  // 复用解码用的 AudioContext，减少频繁创建带来的开销
  const decodeContextRef = useRef<AudioContext | null>(null);
  // 跟踪当前点击的播放令牌，防止旧请求完成后抢占播放
  const latestPlayTokenRef = useRef<string | null>(null);

  const modes = useMemo(
    () => [
      { name: "Roast battle", introVoice: "/voice/roast_battle_Intro.mp3" },
      { name: "Let’s rant together", introVoice: "/voice/rant_together_Intro.mp3" },
    ],
    []
  );

  useEffect(() => {
    const unsubscribe = subscribe(() => {});
    return unsubscribe;
  }, [subscribe]);

  /**
   * 拉取并解码 mp3 资源后，通过 playSpeechBuffer 交给 Worklet 播放。
   * 令牌校验可避免快速点击时旧解码结果插队。
   */
  const playIntro = async (introVoice: string) => {
    stopTtsPlayback();
    const playToken = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    latestPlayTokenRef.current = playToken;
    try {
      const response = await fetch(introVoice);
      if (!response.ok) {
        throw new Error(`获取音频失败: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const decodeContext =
        decodeContextRef.current ?? new AudioContext({ sampleRate: 16000 });
      decodeContextRef.current = decodeContext;
      // decodeAudioData 输出 Float32 PCM，直接取首个声道
      const audioBuffer = await decodeContext.decodeAudioData(arrayBuffer.slice(0));
      if (latestPlayTokenRef.current !== playToken) {
        return;
      }
      const firstChannel = audioBuffer.numberOfChannels
        ? audioBuffer.getChannelData(0)
        : null;
      if (!firstChannel?.length) {
        console.warn("ModeSwitch: 解码后的音频为空，已跳过播放");
        return;
      }
      const bufferCopy = new Float32Array(firstChannel);
      playSpeechBuffer(bufferCopy, { format: "mp3" });
    } catch (error) {
      console.warn("ModeSwitch: 播放开场语音失败", error);
    }
  };

  useEffect(() => {
    // 组件卸载时关闭解码用的 AudioContext，防止资源泄漏
    return () => {
      latestPlayTokenRef.current = null;
      decodeContextRef.current?.close().catch(() => {});
      decodeContextRef.current = null;
    };
  }, []);

  return (
    <div className="flex justify-center items-center gap-2 overflow-x-scroll pl-8 py-2">
        {
        modes.map((mode) => (
          <div
            key={mode.name}
            className="px-4 py-2 bg-black/10 backdrop-blur-lg! rounded-full text-sm cursor-pointer shrink-0 whitespace-nowrap hover:bg-black/20 transition"
            onClick={() => {
              void playIntro(mode.introVoice);
            }}
          >
            {mode.name}
          </div>
        ))
        }
    </div>
  );
};

export default ModeSwitch;
