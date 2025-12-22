import { useEffect, useRef } from "react";
import { useWebSocketContext } from "@/app/providers/WebSocketProviders";

type SentenceState = {
  chunks: string[];
  format: string;
  audioUrl?: string;
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
    return "audio/mp3";
  }
  if (raw.startsWith("audio/")) {
    return raw;
  }
  const sanitized = raw.replace(/[^a-z0-9]+/g, "");
  return sanitized ? `audio/${sanitized}` : "audio/mp3";
};

const describeEvent = (event: MessageEvent) => {
  const data = typeof event.data === "string" ? event.data : undefined;
  if (data) {
    console.log("ttsAudioPlayer: 原始服务端消息", data.slice(0, 300));
  }
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

  useEffect(() => {
    const cleanup = () => {
      sentencesRef.current.forEach((state) => {
        if (state.audioUrl) {
          URL.revokeObjectURL(state.audioUrl);
        }
      });
      sentencesRef.current.clear();
    };

    const dismantle = subscribe((event) => {
      const parsed = describeEvent(event);
      if (!parsed || typeof parsed.event !== "string") {
        return;
      }

      const payload = parsed.data ?? {};
      const sentenceId = safeString(payload.sentenceId);
      console.log("ttsAudioPlayer: 收到事件", {
        event: parsed.event,
        sentenceId,
        payload,
      });
      switch (parsed.event) {
        case "tts-audio-start": {
        if (!sentenceId) {
          break;
        }
        sentencesRef.current.set(sentenceId, {
          chunks: [],
          format: safeString(payload.format) || "mp3",
        });
        console.log("ttsAudioPlayer: 收到 tts-audio-start", {
          sentenceId,
          format: safeString(payload.format),
        });
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
          entry.chunks.push(base64);
          console.log("ttsAudioPlayer: chunk len", {
            sentenceId,
            index: entry.chunks.length - 1,
            snippet: base64.slice(0, 32),
          });
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

          const byteArrays = entry.chunks.map((chunk) => base64ToUint8Array(chunk));
          const mimeType = buildAudioMimeType(entry.format);
          console.log("ttsAudioPlayer: 组合完成", {
            sentenceId,
            mimeType,
            chunks: entry.chunks.length,
          });
          const blob = new Blob(byteArrays, {
            type: mimeType,
          });
          const audioUrl = URL.createObjectURL(blob);
          entry.audioUrl = audioUrl;

          const audio = new Audio(audioUrl);
          audio.addEventListener("ended", () => {
            URL.revokeObjectURL(audioUrl);
            sentencesRef.current.delete(sentenceId);
          });

          const playPromise = audio.play();
          if (playPromise && typeof playPromise.catch === "function") {
            playPromise.catch((error) => {
              console.warn("ttsAudioPlayer: 音频播放被浏览器阻止", error);
            });
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
  }, [subscribe]);
};
