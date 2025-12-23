import { useEffect, useRef } from "react";
import { useWebSocketContext } from "@/app/providers/WebSocketProviders";

/**
 * 用于跟踪每个 TTS 句子的状态，包含音频块、格式、MediaSource 以及播放相关的引用。
 */
type SentenceState = {
  chunks: string[];
  format: string;
  chunkBuffers: Uint8Array[];
  enqueued?: boolean;
  isComplete?: boolean;
  mediaSource?: MediaSource;
  sourceBuffer?: SourceBuffer;
  audioElement?: HTMLAudioElement;
  supportsMediaSource?: boolean;
};

const base64ToUint8Array = (base64: string) => {
  // 将服务端返回的 Base64 音频数据解码为浏览器可直接处理的 Uint8Array
  const binary = globalThis.atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

// 统一过滤非字符串的数据，避免后续操作中因 undefined 或 null 引发异常
const safeString = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * 根据 TTS 返回的格式构造浏览器可识别的 audio MIME 类型，避免空值导致 NotSupportedError。
 */
const buildAudioMimeType = (format: string | undefined) => {
  const raw = (format ?? "mp3").trim().toLowerCase();
  if (!raw) {
    return "audio/mpeg; codecs=\"mp3\"";
  }

  if (raw.startsWith("audio/")) {
    return raw;
  }

  const sanitized = raw.replace(/[^a-z0-9]+/g, "");
  switch (sanitized) {
    case "mp3":
      return "audio/mpeg; codecs=\"mp3\"";
    case "mpeg":
      return "audio/mpeg";
    case "wav":
    case "wave":
      return "audio/wav";
    case "ogg":
      return "audio/ogg";
    default:
      return sanitized ? `audio/${sanitized}` : "audio/mpeg; codecs=\"mp3\"";
  }
};

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

/**
 * 尝试立刻调用 HTMLAudioElement 的 play 方法，确保当前音频一旦有缓冲就进入播放态。
 */
const attemptPlay = (audio?: HTMLAudioElement) => {
  if (!audio) {
    return;
  }
  const playPromise = audio.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch((error) => {
      console.warn("ttsAudioPlayer: 自动播放被浏览器阻止", error);
    });
  }
};

export const useTtsAudioPlayer = () => {
  const { subscribe } = useWebSocketContext();
  const sentencesRef = useRef(new Map<string, SentenceState>());
  const queueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);
  const currentSentenceIdRef = useRef<string | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const sharedAudioRef = useRef<HTMLAudioElement | null>(null);

  /**
   * 保证全局唯一的 audio 元素存在，避免每次播放都重新创建带来的延迟。
   */
  const ensureAudioElement = () => {
    if (!sharedAudioRef.current) {
      const audio = new Audio();
      audio.autoplay = true;
      sharedAudioRef.current = audio;
    }
    return sharedAudioRef.current;
  };

  useEffect(() => {
    // 进入页面时立即实例化 Audio，并在离开时释放
    const audio = ensureAudioElement();
    return () => {
      audio.pause();
      audio.src = "";
      sharedAudioRef.current = null;
    };
  }, []);

  const appendPending = (entry: SentenceState) => {
    // 每次尝试从缓冲队列取出下一段音频缓冲并交给 SourceBuffer 处理，或在数据发送完成后关闭流
    const sourceBuffer = entry.sourceBuffer;
    if (!sourceBuffer || sourceBuffer.updating) {
      return;
    }
    const nextChunk = entry.chunkBuffers.shift();
    if (nextChunk) {
      try {
        sourceBuffer.appendBuffer(nextChunk);
        attemptPlay(entry.audioElement);
      } catch (error) {
        console.error("ttsAudioPlayer: 追加音频块失败", error);
      }
      return;
    }
    if (entry.isComplete && entry.mediaSource?.readyState === "open") {
      try {
        entry.mediaSource.endOfStream();
      } catch (error) {
        console.error("ttsAudioPlayer: 结束流式播放失败", error);
      }
    }
  };

  const cleanupEntry = (sentenceId: string) => {
    // 当前句子播放结束或被清理时释放资源，并从全局地图中移除对应 entry
    const entry = sentencesRef.current.get(sentenceId);
    if (!entry) {
      return;
    }
    if (entry.audioElement) {
      URL.revokeObjectURL(entry.audioElement.src);
      entry.audioElement.pause();
      entry.audioElement.src = "";
      entry.audioElement = undefined;
    }
    if (entry.sourceBuffer) {
      try {
        if (entry.mediaSource?.readyState === "open") {
          entry.mediaSource.endOfStream();
        }
      } catch {
        // 忽略流式结束异常
      }
      entry.sourceBuffer = undefined;
    }
    if (entry.mediaSource) {
      entry.mediaSource = undefined;
    }
    entry.chunkBuffers = [];
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

  const playNextFromQueue = () => {
    // 遍历队列寻找下一个可以播放的句子，优先使用 MediaSource 流式播放
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
      const mimeType = buildAudioMimeType(entry.format);
      const supportsMediaSource =
        typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(mimeType);
      entry.supportsMediaSource = supportsMediaSource;

      if (!supportsMediaSource && !entry.isComplete) {
        // 若浏览器不支持当前格式的 MediaSource 且数据尚未接收完成，则等待后续块再尝试
        return;
      }

      queueRef.current.shift();

      if (!supportsMediaSource) {
        startFallbackPlayback(nextId, entry, mimeType);
        return;
      }

      isPlayingRef.current = true;
      currentSentenceIdRef.current = nextId;
      const mediaSource = new MediaSource();
      entry.mediaSource = mediaSource;
      const audio = ensureAudioElement();
      const objectUrl = URL.createObjectURL(mediaSource);
      audio.src = objectUrl;
      entry.audioElement = audio;
      currentAudioRef.current = audio;

      const finalize = () => {
        // 播放结束后的清理逻辑，用于触发下一条语音
        cleanupEntry(nextId);
        currentSentenceIdRef.current = null;
        currentAudioRef.current = null;
        isPlayingRef.current = false;
        playNextFromQueue();
      };

      audio.onended = finalize;
      audio.onerror = finalize;

      mediaSource.addEventListener(
        "sourceopen",
        () => {
          try {
            entry.sourceBuffer = mediaSource.addSourceBuffer(mimeType);
            entry.sourceBuffer.addEventListener("updateend", () => appendPending(entry));
            appendPending(entry);
          } catch (error) {
            console.error("ttsAudioPlayer: 初始化 SourceBuffer 失败", error);
            if (entry.audioElement) {
              URL.revokeObjectURL(entry.audioElement.src);
              entry.audioElement = undefined;
            }
            entry.mediaSource = undefined;
            entry.sourceBuffer = undefined;
            isPlayingRef.current = false;
            currentSentenceIdRef.current = null;
            currentAudioRef.current = null;
            startFallbackPlayback(nextId, entry, mimeType);
          }
        },
        { once: true },
      );
      return;
    }
  };

  /**
   * 当 MediaSource 无法使用时的回退方案：将已有音频块打包为单个 Blob 并通过传统 audio 元素播放。
   */
  const startFallbackPlayback = (
    sentenceId: string,
    entry: SentenceState,
    mimeType: string,
  ) => {
    if (!entry.chunkBuffers.length) {
      cleanupEntry(sentenceId);
      currentSentenceIdRef.current = null;
      currentAudioRef.current = null;
      isPlayingRef.current = false;
      playNextFromQueue();
      return;
    }
    const blob = new Blob(entry.chunkBuffers, { type: mimeType });
    const audioUrl = URL.createObjectURL(blob);
    const audio = ensureAudioElement();
    audio.src = audioUrl;
    entry.audioElement = audio;
    currentAudioRef.current = audio;
    currentSentenceIdRef.current = sentenceId;
    isPlayingRef.current = true;

    const finalize = () => {
      // 回退方案的结束处理，保证队列状态被恢复
      cleanupEntry(sentenceId);
      currentSentenceIdRef.current = null;
      currentAudioRef.current = null;
      isPlayingRef.current = false;
      playNextFromQueue();
    };

    audio.onended = finalize;
    audio.onerror = finalize;
    attemptPlay(audio);
  };

  useEffect(() => {
    // 组件卸载或依赖变化时统一释放播放队列和正在进行的播放资源
    const cleanup = () => {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current.src = "";
        currentAudioRef.current = null;
      }
      queueRef.current = [];
      currentSentenceIdRef.current = null;
      isPlayingRef.current = false;
      Array.from(sentencesRef.current.keys()).forEach((id) => cleanupEntry(id));
      sentencesRef.current.clear();
    };

    // 订阅 WebSocket 消息以驱动 TTS 播放流程
    const dismantle = subscribe((event) => {
      const parsed = describeEvent(event);
      if (!parsed || typeof parsed.event !== "string") {
        return;
      }

      const payload = parsed.data ?? {};
      const sentenceId = safeString(payload.sentenceId);
      // 根据 event 字段决定当前收到的是 TTS 何种阶段的数据
      switch (parsed.event) {
        case "tts-audio-start": {
          if (!sentenceId) {
            break;
          }
          sentencesRef.current.set(sentenceId, {
            chunks: [],
            chunkBuffers: [],
            format: safeString(payload.format) || "mp3",
          });
          enqueueSentence(sentenceId);
          break;
        }
        case "tts-audio-chunk": {
          if (!sentenceId) {
            break;
          }
          console.log("ttsAudioPlayer: 收到音频块，句子ID=", sentenceId);
          const entry = sentencesRef.current.get(sentenceId);
          const base64 = safeString(payload.base64);
          if (!base64 || !entry) {
            break;
          }
          entry.chunks.push(base64);
          const chunk = base64ToUint8Array(base64);
          entry.chunkBuffers.push(chunk);
          appendPending(entry);
          break;
        }
        case "tts-audio-complete": {
          if (!sentenceId) {
            break;
          }
          const entry = sentencesRef.current.get(sentenceId);
          if (!entry || !entry.chunks.length) {
            break;
          }
          entry.isComplete = true;
          appendPending(entry);
          playNextFromQueue();
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
  }, [subscribe]);
};
