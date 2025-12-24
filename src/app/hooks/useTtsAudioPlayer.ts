import { useEffect, useRef } from "react";
import { useVideoPlayer } from "@/app/providers/VideoProvider";
import { useWebSocketContext } from "@/app/providers/WebSocketProviders";

/**
 * 用于跟踪每个 TTS 句子的状态，包含格式、Worklet 缓存与播放标识。
 */
type SentenceState = {
  format: string;
  enqueued?: boolean;
  isComplete?: boolean;
  useWorklet?: boolean;
  workletBuffers?: Float32Array[][];
  workletDrained?: boolean;
  firstChunkTimestamp?: number;
  hasLoggedPlayback?: boolean;
};

const base64ToUint8Array = (base64: string) => {
  // 将服务端返回的 Base64 PCM 数据解码为字节数组，后续再转换为 Float32
  const binary = globalThis.atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const buildFloat32ChannelFromPcm = (chunk: Uint8Array) => {
  const sampleCount = Math.floor(chunk.byteLength / Int16Array.BYTES_PER_ELEMENT);
  if (!sampleCount) {
    return null;
  }
  const view = new DataView(chunk.buffer, chunk.byteOffset, sampleCount * Int16Array.BYTES_PER_ELEMENT);
  const float32 = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    float32[i] = Math.max(-1, Math.min(1, view.getInt16(i * 2, true) / 32768));
  }
  return float32;
};

// 统一过滤非字符串的数据，避免后续操作中因 undefined 或 null 引发异常
const safeString = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * 尝试将 WebSocket 收到的消息解析为 JSON，对非字符串或无法解析的 payload 返回 null。
 */
const describeEvent = (event: MessageEvent) => {
  const data = typeof event.data === "string" ? event.data : undefined;
  if (!data) {
    return null;
  }
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
};

const getNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

const logPlaybackLatency = (sentenceId: string, entry: SentenceState) => {
  if (entry.hasLoggedPlayback) {
    return;
  }
  const now = getNow();
  const start = entry.firstChunkTimestamp;
  console.log("ttsAudioPlayer: 句子ID=", sentenceId, "开始播放时间戳=", new Date().toISOString());
  if (start) {
    console.log(
      "ttsAudioPlayer: 句子ID=",
      sentenceId,
      "首块到开始播放耗时=",
      (now - start).toFixed(2),
      "ms",
    );
  } else {
    console.log("ttsAudioPlayer: 句子ID=", sentenceId, "未记录首块时间戳", now);
  }
  entry.hasLoggedPlayback = true;
};

const supportsWorkletFormat = (format: string | undefined) => {
  const raw = (format ?? "mp3").trim().toLowerCase();
  return !!raw && /(?:audio\/)?(wav|pcm|raw|linear16|mp3|mpeg|ogg)/.test(raw);
};

export const useTtsAudioPlayer = () => {
  const { subscribe } = useWebSocketContext();
  const { allVideosLoaded, videos, switchToVideoById, play } = useVideoPlayer();
  const sentencesRef = useRef(new Map<string, SentenceState>());
  const queueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);
  const currentSentenceIdRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const workletPortRef = useRef<MessagePort | null>(null);
  const workletReadyRef = useRef(false);
  const currentWorkletSentenceIdRef = useRef<string | null>(null);
  const currentWorkletEntryRef = useRef<SentenceState | null>(null);

  // 将解码后的 PCM 数据暂存到句子的队列里，等待此句子被激活后再推送到 Worklet。
  const queueWorkletChannels = (entry: SentenceState, channelData: Float32Array[]) => {
    if (!entry.workletBuffers) {
      entry.workletBuffers = [];
    }
    entry.workletBuffers.push(channelData);
  };

  // 把 PCM 通道数据通过 MessagePort 发送给 Worklet，并做好环形缓冲状态重置。
  const sendToWorklet = (entry: SentenceState, channelData: Float32Array[]) => {
    const port = workletPortRef.current;
    if (!port) {
      queueWorkletChannels(entry, channelData);
      return;
    }
    entry.workletDrained = false;
    port.postMessage(
      {
        type: "push",
        channelData,
      },
      channelData.map((channel) => channel.buffer),
    );
  };

  // 如果当前正在播放的句子就是目标句子，立即发送数据，否则入队等待。
  const sendOrQueueWorkletChannels = (
    sentenceId: string,
    entry: SentenceState,
    channelData: Float32Array[],
  ) => {
    if (
      currentSentenceIdRef.current === sentenceId &&
      currentWorkletSentenceIdRef.current === sentenceId
    ) {
      sendToWorklet(entry, channelData);
      return;
    }
    queueWorkletChannels(entry, channelData);
  };

  // 逐条发送累计的 PCM 数据，保证新句子的缓冲在切换时被刷新。
  const flushWorkletBuffers = (entry: SentenceState) => {
    if (!entry.workletBuffers?.length) {
      return;
    }
    entry.workletBuffers.forEach((channels) => {
      sendToWorklet(entry, channels);
    });
    entry.workletBuffers = [];
  };

  // 使用 AudioContext 解码当前 chunk 为 PCM，并交由上面的发送/排队逻辑处理。
const decodeChunkForWorklet = (sentenceId: string, entry: SentenceState, chunk: Uint8Array) => {
    if (!entry.useWorklet) {
      return;
    }
    const floatChannel = buildFloat32ChannelFromPcm(chunk);
    if (!floatChannel) {
      console.warn("ttsAudioPlayer: PCM chunk 无法转换，丢弃", sentenceId);
      entry.useWorklet = false;
      return;
    }
    sendOrQueueWorkletChannels(sentenceId, entry, [floatChannel]);
  };
  
  const cleanupEntry = (sentenceId: string) => {
    // 当前句子播放结束或被清理时释放资源，并从状态集合移除。
    const entry = sentencesRef.current.get(sentenceId);
    if (!entry) {
      return;
    }
    entry.workletBuffers = [];
    entry.useWorklet = undefined;
    entry.workletDrained = false;
    sentencesRef.current.delete(sentenceId);
  };

  const enqueueSentence = (sentenceId: string) => {
    // 将状态完整的句子放入播放队列，避免重复入列
    const entry = sentencesRef.current.get(sentenceId);
    if (!entry || entry.enqueued) {
      return;
    }
    entry.enqueued = true;
    queueRef.current.push(sentenceId);
    playNextFromQueue();
  };

  // 启动 Worklet 路径，恢复上下文并把当前句子的缓存推到音频处理器。
  const startWorkletPlayback = (sentenceId: string, entry: SentenceState) => {
    const context = audioContextRef.current;
    const port = workletPortRef.current;
    if (!context || !port) {
      return false;
    }
    context.resume().catch(() => {
      // 继续播放即使 resume 被阻止
    });
    currentWorkletSentenceIdRef.current = sentenceId;
    currentWorkletEntryRef.current = entry;
    entry.workletDrained = false;
    port.postMessage({ type: "resetState" });
    flushWorkletBuffers(entry);
    isPlayingRef.current = true;
    currentSentenceIdRef.current = sentenceId;
    return true;
  };

  // 根据当前播放状态调度 Worklet，只在 Worklet 可用时播放。
  const playNextFromQueue = () => {
    if (isPlayingRef.current) {
      return;
    }

    while (queueRef.current.length) {
      const nextId = queueRef.current[0];
      const entry = sentencesRef.current.get(nextId);
      if (!entry) {
        queueRef.current.shift();
        continue;
      }

      if (!entry.useWorklet) {
        console.warn("ttsAudioPlayer: 当前格式不支持 Worklet，忽略句子", nextId, entry.format);
        queueRef.current.shift();
        cleanupEntry(nextId);
        continue;
      }

      if (!workletReadyRef.current || !workletPortRef.current) {
        // 等待 AudioWorklet 初始化完成再播放
        return;
      }

      const started = startWorkletPlayback(nextId, entry);
      if (started) {
        queueRef.current.shift();
        return;
      }
      entry.useWorklet = false;
      queueRef.current.shift();
      cleanupEntry(nextId);
    }
  };

  // Worklet 播放完成后的回调，释放状态并继续队列。
  const finalizeWorkletPlayback = () => {
    const sentenceId = currentWorkletSentenceIdRef.current;
    if (!sentenceId) {
      return;
    }
    cleanupEntry(sentenceId);
    currentWorkletSentenceIdRef.current = null;
    currentWorkletEntryRef.current = null;
    isPlayingRef.current = false;
    currentSentenceIdRef.current = null;
    playNextFromQueue();
  };

  // 监听 Worklet 发来的事件，用于记录开始时延或监听缓冲耗尽。
  const handleWorkletMessage = (event: MessageEvent) => {
    const data = event.data;
    if (!data || typeof data.type !== "string") {
      return;
    }
    const entry = currentWorkletEntryRef.current;
    const sentenceId = currentWorkletSentenceIdRef.current;
    if (data.type === "started" && entry && sentenceId) {
      logPlaybackLatency(sentenceId, entry);
    }
    if (data.type === "buffer-drained" && entry) {
      entry.workletDrained = true;
      if (entry.isComplete) {
        finalizeWorkletPlayback();
      }
    }
  };

  useEffect(() => {
    if (typeof AudioContext === "undefined") {
      console.warn("ttsAudioPlayer: 当前浏览器不支持 AudioContext / AudioWorklet");
      return undefined;
    }
    let canceled = false;
    const context = new AudioContext({ sampleRate: 16000 });
    audioContextRef.current = context;
    const initWorklet = async () => {
      try {
        await context.audioWorklet.addModule("/audio-worklets/tts-ring-processor.js");
        if (canceled) {
          return;
        }
        const node = new AudioWorkletNode(context, "tts-ring-processor", {
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        node.port.onmessage = handleWorkletMessage;
        node.connect(context.destination);
        workletNodeRef.current = node;
        workletPortRef.current = node.port;
        workletReadyRef.current = true;
        playNextFromQueue();
      } catch (error) {
        console.warn("ttsAudioPlayer: 初始化 AudioWorklet 失败", error);
      }
    };
    initWorklet();
    return () => {
      canceled = true;
      workletReadyRef.current = false;
      workletNodeRef.current?.disconnect();
      workletNodeRef.current = null;
      workletPortRef.current = null;
      audioContextRef.current = null;
      context.close();
    };
  }, []);

  useEffect(() => {
    const cleanup = () => {
      queueRef.current = [];
      currentSentenceIdRef.current = null;
      isPlayingRef.current = false;
      Array.from(sentencesRef.current.keys()).forEach((id) => cleanupEntry(id));
      sentencesRef.current.clear();
    };

    const dismantle = subscribe((event) => {
      const parsed = describeEvent(event);
      if (!parsed || typeof parsed.event !== "string") {
        return;
      }

      const payload = parsed.data ?? {};
      const sentenceId = safeString(payload.sentenceId);
      switch (parsed.event) {
        case "tts-audio-start": {
          if (!sentenceId) {
            break;
          }
          console.log(payload, 'payload')
          const actionId = safeString(payload.action);
          if (actionId && allVideosLoaded) {
            const animationExists = videos.some((video) => video.id === actionId);
            if (animationExists) {
              // 动作字段对应的动画 id 在所有资源加载完成后直接切换并播放，增强交互体验
              switchToVideoById(actionId);
              play();
            }
          }
          const format = safeString(payload.format) || "mp3";
          sentencesRef.current.set(sentenceId, {
            format,
            useWorklet: supportsWorkletFormat(format),
            workletBuffers: [],
            workletDrained: false,
          });
          enqueueSentence(sentenceId);
          break;
        }
        case "tts-audio-chunk": {
          if (!sentenceId) {
            break;
          }
          const entry = sentencesRef.current.get(sentenceId);
          const base64 = safeString(payload.base64);
          if (!base64 || !entry) {
            break;
          }
          if (!entry.firstChunkTimestamp) {
            entry.firstChunkTimestamp = getNow();
          }
          const chunk = base64ToUint8Array(base64);
          decodeChunkForWorklet(sentenceId, entry, chunk);
          if (!isPlayingRef.current) {
            playNextFromQueue();
          }
          break;
        }
        case "tts-audio-complete": {
          if (!sentenceId) {
            break;
          }
          const entry = sentencesRef.current.get(sentenceId);
          if (!entry) {
            break;
          }
          entry.isComplete = true;
          if (entry.useWorklet && entry.workletDrained) {
            finalizeWorkletPlayback();
          } else if (!entry.useWorklet) {
            cleanupEntry(sentenceId);
            queueRef.current = queueRef.current.filter((id) => id !== sentenceId);
          }
          break;
        }
        default:
          break;
      }
    });

    return () => {
      dismantle();
      cleanup();
    };
  }, [subscribe, allVideosLoaded, videos, switchToVideoById, play]);
};
