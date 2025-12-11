import { Buffer } from "node:buffer";
import WebSocket from "ws";
import { getAliyunConfig, getAliyunToken, type AliyunConfig } from "./aliyunToken";

/**
 * 创建一个简单的 deferred，用于在异步事件里暴露 resolve 方法。
 */
const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

/**
 * 保持每个客户端当前的 ASR 会话状态。
 */
type AliyunASRSession = {
  socket: WebSocket;
  sampleRate: number;
  sequence: number;
  format: string;
  transcript: string | null;
  transcriptPromise: Promise<string | null>;
  resolveTranscript: (value: string | null) => void;
  ready: Promise<void>;
  resolved: boolean;
};

const aliyunSessions = new Map<string, AliyunASRSession>();

/**
 * 将 float32 转为 16 位 PCM，符合阿里云 ASR 的上传格式。
 */
const float32ToInt16 = (input: Float32Array) => {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
};

const buildWebSocketUrl = (config: AliyunConfig, sampleRate: number, token: string) => {
  const params = new URLSearchParams({
    appkey: config.appKey,
    token,
    format: config.format,
    sample_rate: String(sampleRate),
  });
  // 临时 Token 鉴权，仅需携带 AppKey、token 与样本信息即可完成连接。
  return `wss://${config.endpoint}${config.path}?${params.toString()}`;
};

/**
 * 解析阿里云回复的 JSON 消息，在多个字段中寻找文本内容。
 */
const extractTranscript = (payload: Record<string, unknown> | undefined) => {
  if (!payload) {
    return null;
  }

  const tryFromResult = (candidate: unknown): string | null => {
    if (typeof candidate !== "object" || candidate === null) {
      return null;
    }
    const asRecord = candidate as Record<string, unknown>;
    if (typeof asRecord.transcript === "string") {
      return asRecord.transcript;
    }
    if (typeof asRecord.text === "string") {
      return asRecord.text;
    }
    if (typeof asRecord.sentence === "string") {
      return asRecord.sentence;
    }
    if (Array.isArray(asRecord.sentences)) {
      const parts = asRecord.sentences
        .map((item) => {
          if (typeof item === "string") {
            return item;
          }
          if (typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).text === "string") {
            return (item as Record<string, unknown>).text;
          }
          return "";
        })
        .filter(Boolean);
      if (parts.length) {
        return parts.join("");
      }
    }
    return null;
  };

  return (
    tryFromResult(payload.result) ??
    tryFromResult(payload.payload as unknown) ??
    tryFromResult((payload.payload as Record<string, unknown>)?.result) ??
    tryFromResult((payload.payload as Record<string, unknown>)?.result?.result) ??
    (typeof payload.sentence === "string" ? payload.sentence : null) ??
    (typeof payload.text === "string" ? payload.text : null)
  );
};

/**
 * 用于避免重复 resolve 的帮助函数。
 */
const completeTranscript = (session: AliyunASRSession, transcript: string | null) => {
  if (session.resolved) {
    return;
  }
  session.resolved = true;
  session.resolveTranscript(transcript);
};

/**
 * WebSocket 收到事件时的统一处理器，保持最新的转写并在完成状态或关闭时 resolve。
 */
const handleSessionMessage = (session: AliyunASRSession, data: WebSocket.RawData) => {
  let payload: Record<string, unknown> | undefined;
  try {
    const text = typeof data === "string" ? data : data.toString("utf-8");
    const message = JSON.parse(text) as Record<string, unknown>;
    payload = (message.payload as Record<string, unknown>) ?? (message.data as Record<string, unknown>);
  } catch (error) {
    console.warn("aliyunASR: 无法解析返回的结构", error);
    return;
  }

  const transcript = extractTranscript(payload);
  if (transcript) {
    session.transcript = transcript;
  }

  const statusValue = payload?.status ?? (payload?.result as Record<string, unknown>)?.status;
  const numericStatus = typeof statusValue === "string" ? Number(statusValue) : statusValue;
  if (typeof numericStatus === "number" && !Number.isNaN(numericStatus) && numericStatus >= 2) {
    completeTranscript(session, transcript ?? session.transcript);
  }
};

/**
 * 确保某个客户端对应的 ASR 会话准备就绪。
 */
const ensureAliyunSession = async (clientId: string, sampleRate: number) => {
  const existing = aliyunSessions.get(clientId);
  if (existing) {
    if (existing.sampleRate === sampleRate) {
      await existing.ready;
      return existing;
    }
    existing.socket.close();
    aliyunSessions.delete(clientId);
  }

  const config = getAliyunConfig();
  let token: string;
  try {
    token = await getAliyunToken(config);
  } catch (error) {
    console.error("aliyunASR: 获取阿里云 Token 失败", error);
    throw error;
  }
  const url = buildWebSocketUrl(config, sampleRate, token);
  const socket = new WebSocket(url, { perMessageDeflate: false });
  const deferred = createDeferred<string | null>();
  const ready = new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", (error) => reject(error));
  });

  const session: AliyunASRSession = {
    socket,
    sampleRate,
    sequence: 0,
    format: config.format,
    transcript: null,
    transcriptPromise: deferred.promise,
    resolveTranscript: deferred.resolve,
    ready,
    resolved: false,
  };

  socket.on("message", (raw) => handleSessionMessage(session, raw));
  socket.on("close", () => completeTranscript(session, session.transcript));
  socket.on("error", (error) => {
    console.error("aliyunASR: WebSocket 错误", error);
    completeTranscript(session, session.transcript);
  });

  ready.catch((error) => {
    console.error("aliyunASR: WebSocket 初始化失败", error);
    completeTranscript(session, null);
    aliyunSessions.delete(clientId);
  });

  aliyunSessions.set(clientId, session);
  await ready;
  return session;
};

/**
 * 将单个音频片段流式上传到阿里云 ASR。
 */
export const streamAudioToAliyun = async (
  clientId: string,
  audio: Float32Array,
  sampleRate: number,
) => {
  let session: AliyunASRSession;
  try {
    session = await ensureAliyunSession(clientId, sampleRate);
  } catch (error) {
    console.error("aliyunASR: 创建会话失败", error);
    return;
  }

  const pcm16 = float32ToInt16(audio);
  const payload = Buffer.from(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength).toString("base64");
  const nextSeq = session.sequence + 1;
  const status = session.sequence === 0 ? 0 : 1;
  session.sequence = nextSeq;

  try {
    session.socket.send(
      JSON.stringify({
        header: {},
        payload: {
          status,
          seq: nextSeq,
          format: session.format,
          sample_rate: session.sampleRate,
          audio: payload,
        },
      }),
    );
  } catch (error) {
    console.error("aliyunASR: 片段上传失败", error);
  }
};

/**
 * 发送结束帧并等待最终转写结果。
 */
export const finalizeAliyunStream = async (clientId: string) => {
  const session = aliyunSessions.get(clientId);
  if (!session) {
    return null;
  }

  if (session.socket.readyState === WebSocket.OPEN) {
    const nextSeq = session.sequence + 1;
    session.sequence = nextSeq;
    try {
      session.socket.send(
        JSON.stringify({
          header: {},
          payload: {
            status: 2,
            seq: nextSeq,
            format: session.format,
            sample_rate: session.sampleRate,
          },
        }),
      );
    } catch (error) {
      console.error("aliyunASR: 结束帧发送失败", error);
    }
  }

  const transcript = await Promise.race([
    session.transcriptPromise,
    new Promise<string | null>((resolve) => setTimeout(() => resolve(session.transcript), 4000)),
  ]);

  completeTranscript(session, transcript ?? session.transcript);
  try {
    session.socket.close();
  } catch (error) {
    console.warn("aliyunASR: 关闭连接失败", error);
  }
  aliyunSessions.delete(clientId);
  return transcript;
};
