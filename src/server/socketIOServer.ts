import http from "node:http";
import { randomUUID } from "node:crypto";
import { Server, type Socket } from "socket.io";

/**
 * 运行时配置，允许通过环境变量覆盖默认端口和 CORS 源，以便在不同部署环境中复用。
 */
const PORT = Number(process.env.SOCKET_SERVER_PORT) || 4000;
const CORS_ORIGIN = process.env.SOCKET_SERVER_CORS_ORIGIN || "*";

/**
 * 简单的 HTTP 服务器，只承载 Socket.IO 的握手流程。
 */
const httpServer = http.createServer();

/**
 * 创建 Socket.IO 服务端实例，并开启基于 WebSocket 的传输。
 */
const io = new Server(httpServer, {
  cors: {
    origin: CORS_ORIGIN,
  },
  transports: ["websocket"],
});

/**
 * 维护当前连接的客户端，便于广播时统计活跃连接数。
 */
const clients = new Map<string, Socket>();

/**
 * 统一将消息结构序列化为 JSON 字符串，保持客户端接收格式与之前的 Service 兼容。
 */
const serializePayload = (payload: Record<string, unknown>) => JSON.stringify(payload);

/**
 * 将传入的任意数据解码为可读字符串，支持 string、ArrayBuffer、TypedArray 以及普通对象。
 */
const normalizeIncomingPayload = (incoming: unknown) => {
  if (typeof incoming === "string") {
    return incoming;
  }

  if (incoming instanceof ArrayBuffer) {
    return Buffer.from(incoming).toString("utf-8");
  }

  if (
    typeof incoming === "object" &&
    incoming !== null &&
    "buffer" in incoming &&
    "byteLength" in incoming &&
    (incoming as ArrayBufferView).byteLength
  ) {
    const view = incoming as ArrayBufferView;
    return Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString("utf-8");
  }

  try {
    return JSON.stringify(incoming);
  } catch {
    return String(incoming);
  }
};

// 语音段拆分之后再次合并的时间窗口（越小越快，但也可能拆句）
const VOICE_MERGE_WINDOW_MS = 300;

interface VoiceChunkMeta {
  chunkId: string;
  sampleRate: number;
  timestamp: string;
  length: number;
}

type VoiceBucket = {
  segments: Float32Array[];
  timer: ReturnType<typeof setTimeout> | null;
};

// 每个客户端的语音段缓冲区（等待合并）
const voiceSegmentBuckets = new Map<string, VoiceBucket>();

const ensureVoiceBucket = (clientId: string) => {
  if (!voiceSegmentBuckets.has(clientId)) {
    voiceSegmentBuckets.set(clientId, { segments: [], timer: null });
  }
  return voiceSegmentBuckets.get(clientId)!;
};

const clearVoiceBucket = (clientId: string) => {
  const bucket = voiceSegmentBuckets.get(clientId);
  if (!bucket) {
    return;
  }
  if (bucket.timer) {
    clearTimeout(bucket.timer);
  }
  voiceSegmentBuckets.delete(clientId);
};

const isVoiceChunkMeta = (value: unknown): value is VoiceChunkMeta => {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as VoiceChunkMeta).chunkId === "string" &&
    typeof (value as VoiceChunkMeta).sampleRate === "number" &&
    typeof (value as VoiceChunkMeta).timestamp === "string" &&
    typeof (value as VoiceChunkMeta).length === "number"
  );
};

const tryBuildFloat32Array = (
  buffer: ArrayBuffer,
  byteOffset = 0,
  byteLength?: number,
): Float32Array | null => {
  const availableBytes =
    typeof byteLength === "number"
      ? Math.min(byteLength, buffer.byteLength - byteOffset)
      : buffer.byteLength - byteOffset;
  const usableBytes =
    Math.floor(availableBytes / Float32Array.BYTES_PER_ELEMENT) * Float32Array.BYTES_PER_ELEMENT;
  if (usableBytes <= 0) {
    return null;
  }

  return new Float32Array(buffer, byteOffset, usableBytes / Float32Array.BYTES_PER_ELEMENT);
};

const normalizeVoicePayload = (payload: unknown): Float32Array | null => {
  if (payload instanceof Float32Array) {
    return payload;
  }

  if (payload instanceof ArrayBuffer) {
    return tryBuildFloat32Array(payload);
  }

  if (ArrayBuffer.isView(payload)) {
    const view = payload as ArrayBufferView;
    return tryBuildFloat32Array(view.buffer, view.byteOffset, view.byteLength);
  }

  return null;
};

const mergeFloat32Segments = (segments: Float32Array[]) => {
  const totalLength = segments.reduce((sum, seg) => sum + seg.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;

  for (const segment of segments) {
    merged.set(segment, offset);
    offset += segment.length;
  }

  return merged;
};

/**
 * 占位函数：将来会接入流式 ASR，目前只打印信息作为调试用
 */
const processMergedSpeechForASR = (
  clientId: string,
  audio: Float32Array,
  sampleRate: number,
) => {
  console.debug("voice chunk merged - placeholder for ASR", {
    clientId,
    sampleRate,
    length: audio.length,
  });
};

/**
 * 在合并窗口超时后将当前缓存的片段拼接成一条整体语音，并发送确认事件
 */
const flushVoiceSegments = (clientId: string, socket: Socket, sampleRate: number) => {
  const bucket = voiceSegmentBuckets.get(clientId);
  if (!bucket) {
    return;
  }

  bucket.timer = null;

  if (!bucket.segments.length) {
    return;
  }

  const mergedAudio = mergeFloat32Segments(bucket.segments);
  bucket.segments = [];

  const payload = serializePayload({
    event: "voice-chunk-merged",
    data: {
      clientId,
      sampleRate,
      length: mergedAudio.length,
      timestamp: new Date().toISOString(),
    },
  });
  socket.emit("message", payload);

  processMergedSpeechForASR(clientId, mergedAudio, sampleRate);
};

/**
 * 收到 voice-chunk 事件后进行校验、缓存并安排合并/处理
 */
const queueVoiceSegment = (clientId: string, socket: Socket, meta: unknown, audio: unknown) => {
  if (!isVoiceChunkMeta(meta)) {
    console.warn("收到不符合格式的 voice-chunk meta", { clientId, meta });
    return;
  }

  const normalized = normalizeVoicePayload(audio);
  if (!normalized) {
    console.warn("无法解析 voice-chunk 音频数据", { clientId, chunkId: meta.chunkId });
    return;
  }

  const bucket = ensureVoiceBucket(clientId);
  bucket.segments.push(normalized);

  if (bucket.timer) {
    clearTimeout(bucket.timer);
  }

  bucket.timer = setTimeout(() => {
    flushVoiceSegments(clientId, socket, meta.sampleRate);
  }, VOICE_MERGE_WINDOW_MS);
};

/**
 * 记录客户端上线/下线的公共信息，方便各类事件复用。
 */
const createClientMetadata = (clientId: string) => ({
  clientId,
  activeClients: clients.size,
  timestamp: new Date().toISOString(),
});

/**
 * 连接成功后，仅向新客户端回复欢迎消息，避免干扰其它连接。
 */
const sendJoinNotifications = (clientId: string) => {
  const metadata = createClientMetadata(clientId);
  const welcomePayload = serializePayload({
    event: "welcome",
    data: metadata,
  });

  const socket = clients.get(clientId);
  if (socket) {
    socket.emit("message", welcomePayload);
  }
};

/**
 * 清理断开的连接并广播离线事件。
 */
const cleanupClient = (clientId: string) => {
  if (!clients.has(clientId)) {
    return;
  }

  clients.delete(clientId);
  clearVoiceBucket(clientId);

  const metadata = createClientMetadata(clientId);
  const payload = serializePayload({
    event: "client-left",
    data: metadata,
  });

  io.emit("message", payload);
};

/**
 * 将客户端上传的原始数据统一转为消息格式，便于广播。
 */
const handleClientMessage = (clientId: string, rawData: unknown) => {
  const normalized = normalizeIncomingPayload(rawData);
  let parsed: unknown = normalized;

  try {
    parsed = JSON.parse(normalized);
  } catch {
    // 解析失败时保持原始字符串
  }

  const payload = serializePayload({
    event: "client-message",
    data: {
      clientId,
      raw: normalized,
      parsed,
      timestamp: new Date().toISOString(),
    },
  });

  io.emit("message", payload);
};

/**
 * 每当有客户端发起连接，就注册处理逻辑。
 */
io.on("connection", (socket) => {
  const clientId = randomUUID();
  clients.set(clientId, socket);

  console.debug("socketIOServer: 新客户端连接", {
    clientId,
    activeClients: clients.size,
  });

  sendJoinNotifications(clientId);

  socket.on("message", (payload) => {
    handleClientMessage(clientId, payload);
  });

  socket.on("voice-chunk", (meta, audio) => {
    queueVoiceSegment(clientId, socket, meta, audio);
  });

  socket.on("disconnect", (reason) => {
    console.debug("socketIOServer: 客户端断开连接", { clientId, reason });
    cleanupClient(clientId);
  });

  socket.on("error", (error) => {
    console.error("socketIOServer: 连接错误", { clientId, error });
    cleanupClient(clientId);
  });
});

/**
 * 启动 HTTP 服务监听指定端口。
 */
httpServer.listen(PORT, () => {
  console.info(`socketIOServer: 正在监听端口 ${PORT}，允许的 CORS 源为 ${CORS_ORIGIN}`);
});

/**
 * 在进程即将退出时优雅关闭 Socket.IO 实例。
 */
const shutdown = () => {
  console.info("socketIOServer: 收到退出信号，正在关闭服务...");
  io.close();
  httpServer.close(() => {
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
