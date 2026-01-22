import { randomUUID } from "crypto";
import { Socket } from "socket.io";
import { FishAudioClient, RealtimeEvents } from "fish-audio";
import { serializePayload } from "../../utils";

export type TtsEmotion = "contempt" | "angry";

const isEmotion = (v: unknown): v is TtsEmotion => v === "contempt" || v === "angry";

// Fish 的情绪控制是文本 tag（不是 request 字段）
const EMOTION_TAG: Record<TtsEmotion, string> = {
  angry: "(angry)",
  contempt: "(contemptuous)",
};

class AsyncTextQueue {
  private queue: string[] = [];
  private resolvers: Array<(v: IteratorResult<string>) => void> = [];
  private closed = false;

  push(text: string) {
    if (this.closed) return;
    if (!text) return;

    const r = this.resolvers.shift();
    if (r) r({ value: text, done: false });
    else this.queue.push(text);
  }

  close() {
    if (this.closed) return;
    this.closed = true;

    while (this.resolvers.length) {
      const r = this.resolvers.shift()!;
      r({ value: "" as any, done: true });
    }
  }

  async *stream() {
    while (true) {
      if (this.queue.length) {
        yield this.queue.shift()!;
        continue;
      }
      if (this.closed) return;

      const next = await new Promise<IteratorResult<string>>((resolve) => {
        this.resolvers.push(resolve);
      });
      if (next.done) return;
      yield next.value;
    }
  }
}

let _fishClient: FishAudioClient | null = null;
const getFishClient = () => {
  if (_fishClient) return _fishClient;

  const apiKey = process.env.FISH_API_KEY || "";
  if (!apiKey) {
    throw new Error("TTS 请求失败：缺少 FISH_API_KEY");
  }
  _fishClient = new FishAudioClient({ apiKey });
  return _fishClient;
};

export type TtsStreamController = {
  /** 继续往 TTS 里喂文本（来自 LLM 的 delta 或你缓冲后的片段） */
  pushText: (text: string) => void;
  /** 告诉 TTS：文本输入结束（必须调用，否则可能一直等） */
  closeText: () => void;
  /** 等待音频流结束（服务端 close/finish） */
  done: () => Promise<void>;
  /** 本次流的 id（沿用 sentenceId 字段名，避免你前端改字段） */
  sentenceId: string;
};

/**
 * ✅ 真正流式：一条 reply 建立 1 条 Fish Realtime TTS 连接。
 * - 输入：通过 controller.pushText() 持续喂入文本
 * - 输出：RealtimeEvents.AUDIO_CHUNK 连续吐音频 chunk，你按 base64 推给前端
 *
 * ✅ 修改点：
 * - tts-audio-start 不再在“建立流”时立刻 emit
 * - 而是在“第一次真正推送 tts-audio-chunk 之前”再 emit（保证时序：start -> first chunk）
 */
export function streamSentenceToTts(params: {
  clientId: string;
  conversationId: string;
  socket: Socket;
  userId: string;
  requestId: string;
  timestamp: number;

  /** 用于前端展示/动作透传（可选） */
  action?: string;
  llmAction?: string;

  /** LLM 的情绪（contempt/angry），只影响语气，不换音色 */
  emotion?: TtsEmotion | null;
}): TtsStreamController {
  const { clientId, conversationId, socket, requestId, timestamp, action, llmAction, emotion } =
    params;

  const sentenceId = randomUUID(); // 这里代表“一条 reply 的 tts stream”，但字段名继续叫 sentenceId

  const actionField = llmAction ?? action;

  // startData 仍然在这里组装好，但不立即发
  const startData: Record<string, unknown> = {
    clientId,
    conversationId,
    sentenceId,
    format: "pcm",
    sample_rate: 24000,
    timestamp: new Date().toISOString(),
    requestId,
    echoTimestamp: timestamp,
  };
  if (actionField) startData.action = actionField;

  // ✅ 改：仅在首次音频 chunk 推送前触发一次 start
  let startSignaled = false;
  const signalStart = () => {
    if (startSignaled) return;
    startSignaled = true;

    socket.emit(
      "message",
      serializePayload({
        event: "tts-audio-start",
        data: startData,
      })
    );
  };

  const textQueue = new AsyncTextQueue();

  // 情绪 tag：只在开头注入一次（可选）
  if (emotion) {
    textQueue.push(`${EMOTION_TAG[emotion]} `);
  }

  let chunkIndex = 0;
  let completionSignaled = false;

  // PCM 16-bit 对齐
  let pendingByte: Uint8Array | null = null;

  // 超时兜底：防止卡死
  const MAX_STREAM_IDLE_MS = 30_000;
  let timeout: NodeJS.Timeout | null = null;

  const cleanup = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    pendingByte = null;
  };

  const signalCompletion = () => {
    if (completionSignaled) return;
    completionSignaled = true;

    cleanup();

    socket.emit(
      "message",
      serializePayload({
        event: "tts-audio-complete",
        data: {
          clientId,
          conversationId,
          sentenceId,
          chunkCount: chunkIndex,
          timestamp: new Date().toISOString(),
          requestId,
          echoTimestamp: timestamp,
        },
      })
    );
  };

  const armTimeout = (closeFn?: () => void) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      try {
        closeFn?.();
      } catch {}
      signalCompletion();
    }, MAX_STREAM_IDLE_MS);
  };

  const fish = getFishClient();

  const request: Record<string, unknown> = {
    text: "",
    format: "pcm",
    sample_rate: 24000,
    latency: "balanced",
    chunk_length: 200,
    reference_id: "802e3bc2b27e49c2995d23ef70e6ac89",
  };

  const run = async () => {
    const conn: any = await fish.textToSpeech.convertRealtime(request as any, textQueue.stream());

    const closeConnSafely = () => {
      try {
        if (typeof conn?.close === "function") conn.close();
        else if (typeof conn?.disconnect === "function") conn.disconnect();
        else if (typeof conn?.socket?.close === "function") conn.socket.close();
      } catch {
        // ignore
      }
    };

    armTimeout(closeConnSafely);

    conn.on(RealtimeEvents.AUDIO_CHUNK, (audio: unknown) => {
      armTimeout(closeConnSafely);

      if (!(audio instanceof Uint8Array) && !Buffer.isBuffer(audio)) return;

      let aligned = audio instanceof Uint8Array ? audio : new Uint8Array(audio);

      if (pendingByte) {
        const merged = new Uint8Array(pendingByte.length + aligned.length);
        merged.set(pendingByte, 0);
        merged.set(aligned, pendingByte.length);
        aligned = merged;
        pendingByte = null;
      }

      if (aligned.length % 2 === 1) {
        pendingByte = aligned.slice(aligned.length - 1);
        aligned = aligned.slice(0, aligned.length - 1);
      }

      if (!aligned.length) return;

      // ✅ 关键：第一次真正推送音频前，先通知前端 start
      signalStart();

      const base64 = Buffer.from(aligned).toString("base64");

      socket.emit(
        "message",
        serializePayload({
          event: "tts-audio-chunk",
          data: {
            clientId,
            conversationId,
            sentenceId,
            chunkIndex,
            base64,
            timestamp: new Date().toISOString(),
            requestId,
            echoTimestamp: timestamp,
          },
        })
      );

      chunkIndex += 1;
    });

    conn.on(RealtimeEvents.ERROR, (err: unknown) => {
      console.error("ttsStreamSender(fish): realtime error", {
        clientId,
        conversationId,
        sentenceId,
        requestId,
        err,
      });
      closeConnSafely();
      signalCompletion();
    });

    conn.on(RealtimeEvents.CLOSE, () => {
      pendingByte = null;
      signalCompletion();
    });

    // 有些 SDK 会发 OPEN
    if ((RealtimeEvents as any).OPEN) {
      conn.on((RealtimeEvents as any).OPEN, () => armTimeout(closeConnSafely));
    }

    // 等到 close/complete（由事件触发）
    // 这里没有 await-able 的“结束事件”，所以用一个 Promise 等待 completionSignaled
    await new Promise<void>((resolve) => {
      const check = () => {
        if (completionSignaled) return resolve();
        setTimeout(check, 30);
      };
      check();
    });
  };

  const donePromise = run().catch((err) => {
    console.error("ttsStreamSender(fish): run failed", {
      clientId,
      conversationId,
      sentenceId,
      requestId,
      err,
    });
    signalCompletion();
  });

  return {
    sentenceId,
    pushText: (text: string) => textQueue.push(text),
    closeText: () => textQueue.close(),
    done: () => donePromise,
  };
}
