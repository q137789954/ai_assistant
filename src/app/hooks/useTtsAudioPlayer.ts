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
      switch (parsed.event) {
        case "tts-audio-start": {
          if (!sentenceId) {
            break;
          }
          sentencesRef.current.set(sentenceId, {
            chunks: [],
            format: safeString(payload.format) || "mp3",
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
          const blob = new Blob(byteArrays, {
            type: `audio/${entry.format.replace(/[^a-z0-9]+/gi, "")}` || "audio/mp3",
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
