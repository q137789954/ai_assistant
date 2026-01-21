"use client";

import { useCallback, useContext, useEffect, useRef } from "react";
import { GlobalsContext } from "@/app/providers/GlobalsProviders";
import { useWebSocketContext } from "@/app/providers/WebSocketProviders";
import { requestMicrophoneStream } from "@/app/utils/microphone";
import { float32ToInt16 } from "@/app/utils/audio";

type UseVoiceStreamToWebSocketOptions = {
  /**
   * 单帧时长，单位毫秒，默认 40ms。
   */
  frameDurationMs?: number;
  /**
   * 目标采样率，默认 16000Hz。
   */
  sampleRate?: number;
  /**
   * WebSocket 事件名：开始推流。
   */
  startEvent?: string;
  /**
   * WebSocket 事件名：结束推流。
   */
  endEvent?: string;
  /**
   * WebSocket 事件名：音频帧。
   */
  audioEvent?: string;
  /**
   * 启动/运行出错时的回调。
   */
  onError?: (error: Error) => void;
};

const DEFAULT_FRAME_DURATION_MS = 40;
const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_BUFFER_SIZE = 1024;

/**
 * useVoiceStreamToWebSocket
 *
 * 功能：
 * - 监听 voiceInputEnabled
 * - 打开时持续采集麦克风音频
 * - 每 20ms 切成一帧 Int16Array 并通过 WebSocket 推送
 * - 关闭时停止采集并通知服务端
 */
const useVoiceStreamToWebSocket = (
  options: UseVoiceStreamToWebSocketOptions = {},
) => {
  const globals = useContext(GlobalsContext);
  if (!globals) {
    throw new Error("useVoiceStreamToWebSocket 必须在 GlobalsProviders 内部使用");
  }

  const { voiceInputEnabled } = globals;
  const { emitEvent } = useWebSocketContext();

  const {
    frameDurationMs = DEFAULT_FRAME_DURATION_MS,
    sampleRate = DEFAULT_SAMPLE_RATE,
    startEvent = "voice:stream-start",
    endEvent = "voice:stream-end",
    audioEvent = "voice:stream-chunk",
    onError,
  } = options;

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const streamingRef = useRef(false);

  // 以“块队列 + 偏移指针”的方式缓存输入数据，便于按 20ms 切帧。
  const pendingChunksRef = useRef<Float32Array[]>([]);
  const pendingOffsetRef = useRef(0);
  const pendingSamplesRef = useRef(0);

  // 发送失败只提示一次，避免刷屏。
  const sendFailureWarnedRef = useRef(false);

  const resetPendingBuffer = useCallback(() => {
    pendingChunksRef.current = [];
    pendingOffsetRef.current = 0;
    pendingSamplesRef.current = 0;
  }, []);

  const emitOnceWarning = useCallback((message: string) => {
    if (sendFailureWarnedRef.current) {
      return;
    }
    sendFailureWarnedRef.current = true;
    console.warn(message);
  }, []);

  const stopStreaming = useCallback(
    (reason: "toggle-off" | "unmount" | "error") => {
      if (!streamingRef.current) {
        return;
      }
      streamingRef.current = false;

      if (processorNodeRef.current) {
        processorNodeRef.current.onaudioprocess = null;
        try {
          processorNodeRef.current.disconnect();
        } catch {
          // 断开节点失败不影响后续清理
        }
        processorNodeRef.current = null;
      }

      if (sourceNodeRef.current) {
        try {
          sourceNodeRef.current.disconnect();
        } catch {
          // 断开节点失败不影响后续清理
        }
        sourceNodeRef.current = null;
      }

      if (silentGainRef.current) {
        try {
          silentGainRef.current.disconnect();
        } catch {
          // 断开节点失败不影响后续清理
        }
        silentGainRef.current = null;
      }

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }

      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }

      resetPendingBuffer();
      sendFailureWarnedRef.current = false;

      // 通知服务端推流已结束
      const sent = emitEvent(endEvent, { reason });
      if (!sent) {
        emitOnceWarning(
          `[useVoiceStreamToWebSocket] 结束事件发送失败：${endEvent}`,
        );
      }
    },
    [emitEvent, endEvent, emitOnceWarning, resetPendingBuffer],
  );

  const startStreaming = useCallback(async () => {
    if (streamingRef.current) {
      return;
    }

    try {
      // 请求麦克风流（此时 voiceInputEnabled 已通过权限校验）
      const stream = await requestMicrophoneStream({
        audio: {
          channelCount: 1,
          sampleRate,
        },
      });

      const context = new AudioContext({ sampleRate });
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(
        DEFAULT_BUFFER_SIZE,
        1,
        1,
      );
      const silentGain = context.createGain();
      silentGain.gain.value = 0;

      // ScriptProcessorNode 必须连接到 destination 才会持续回调
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(context.destination);

      audioContextRef.current = context;
      mediaStreamRef.current = stream;
      sourceNodeRef.current = source;
      processorNodeRef.current = processor;
      silentGainRef.current = silentGain;
      streamingRef.current = true;
      resetPendingBuffer();
      sendFailureWarnedRef.current = false;

      // 通知服务端推流已开始
      const startSent = emitEvent(startEvent, {
        sampleRate,
        frameDurationMs,
      });
      if (!startSent) {
        emitOnceWarning(
          `[useVoiceStreamToWebSocket] 开始事件发送失败：${startEvent}`,
        );
      }

      const frameSize = Math.round((sampleRate * frameDurationMs) / 1000);

      processor.onaudioprocess = (event) => {
        if (!streamingRef.current) {
          return;
        }

        // 复制一份输入数据，避免后续被 WebAudio 复用覆盖
        const input = event.inputBuffer.getChannelData(0);
        const copy = new Float32Array(input.length);
        copy.set(input);
        pendingChunksRef.current.push(copy);
        pendingSamplesRef.current += copy.length;

        // 按帧长切片，每次凑够 20ms 就推送一次
        while (pendingSamplesRef.current >= frameSize) {
          const frame = new Float32Array(frameSize);
          let filled = 0;

          while (filled < frameSize && pendingChunksRef.current.length > 0) {
            const head = pendingChunksRef.current[0];
            const offset = pendingOffsetRef.current;
            const remaining = head.length - offset;
            const needed = frameSize - filled;
            const toCopy = Math.min(remaining, needed);

            frame.set(head.subarray(offset, offset + toCopy), filled);
            filled += toCopy;

            if (toCopy === remaining) {
              pendingChunksRef.current.shift();
              pendingOffsetRef.current = 0;
            } else {
              pendingOffsetRef.current += toCopy;
            }
          }

          pendingSamplesRef.current -= frameSize;

          const int16Frame = float32ToInt16(frame);
          const sent = emitEvent(audioEvent, int16Frame);
          if (!sent) {
            emitOnceWarning(
              `[useVoiceStreamToWebSocket] 音频帧发送失败：${audioEvent}`,
            );
          }
        }
      };
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      onError?.(err);
      stopStreaming("error");
    }
  }, [
    audioEvent,
    emitEvent,
    emitOnceWarning,
    frameDurationMs,
    onError,
    resetPendingBuffer,
    sampleRate,
    startEvent,
    stopStreaming,
  ]);

  useEffect(() => {
    if (voiceInputEnabled) {
      void startStreaming();
      return () => {
        stopStreaming("unmount");
      };
    }

    stopStreaming("toggle-off");
    return () => {
      // voiceInputEnabled=false 时无需额外清理
    };
  }, [startStreaming, stopStreaming, voiceInputEnabled]);
};

export default useVoiceStreamToWebSocket;
