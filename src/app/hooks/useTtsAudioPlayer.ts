import { useEffect, useRef } from "react";
import { useWebSocketContext } from "@/app/providers/WebSocketProviders";

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
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

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

export const useTtsAudioPlayer = () => {
  const { subscribe } = useWebSocketContext();
  const sentencesRef = useRef(new Map<string, SentenceState>());
  const queueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);
  const currentSentenceIdRef = useRef<string | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  const appendPending = (entry: SentenceState) => {
    const sourceBuffer = entry.sourceBuffer;
    if (!sourceBuffer || sourceBuffer.updating) {
      return;
    }
    const nextChunk = entry.chunkBuffers.shift();
    if (nextChunk) {
      try {
        sourceBuffer.appendBuffer(nextChunk);
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
    const entry = sentencesRef.current.get(sentenceId);
    if (!entry || entry.enqueued) {
      return;
    }
    entry.enqueued = true;
    queueRef.current.push(sentenceId);
    playNextFromQueue();
  };

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
      const mimeType = buildAudioMimeType(entry.format);
      const supportsMediaSource =
        typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(mimeType);
      entry.supportsMediaSource = supportsMediaSource;

      if (!supportsMediaSource && !entry.isComplete) {
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
      const audio = new Audio();
      audio.autoplay = true;
      const objectUrl = URL.createObjectURL(mediaSource);
      audio.src = objectUrl;
      entry.audioElement = audio;
      currentAudioRef.current = audio;

      const finalize = () => {
        cleanupEntry(nextId);
        currentSentenceIdRef.current = null;
        currentAudioRef.current = null;
        isPlayingRef.current = false;
        playNextFromQueue();
      };

      audio.addEventListener("ended", finalize, { once: true });

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
    const audio = new Audio(audioUrl);
    audio.autoplay = true;
    entry.audioElement = audio;
    currentAudioRef.current = audio;
    currentSentenceIdRef.current = sentenceId;
    isPlayingRef.current = true;

    const finalize = () => {
      cleanupEntry(sentenceId);
      currentSentenceIdRef.current = null;
      currentAudioRef.current = null;
      isPlayingRef.current = false;
      playNextFromQueue();
    };

    audio.addEventListener("ended", finalize, { once: true });
    audio.addEventListener("error", finalize, { once: true });

    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch((error) => {
        console.warn("ttsAudioPlayer: 音频播放被浏览器阻止", error);
        finalize();
      });
    }
  };

  useEffect(() => {
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
