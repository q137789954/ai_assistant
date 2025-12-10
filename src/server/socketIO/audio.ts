import { Socket } from "socket.io";
import { serializePayload } from "./utils";
import { VoiceBucket, VoiceChunkMeta } from "./types";
import { finalizeAliyunStream, streamAudioToAliyun } from "./aliyunASR";

/**
 * 合并窗口时间，超过该时间仍未收到新的片段就会触发一次合并并发出事件。
 */
const VOICE_MERGE_WINDOW_MS = 200;

/**
 * 每个客户端的语音段缓冲区，确保合并时能够获取所有片段与定时器控制。
 */
const voiceSegmentBuckets = new Map<string, VoiceBucket>();

/**
 * 获取或创建特定客户端的语音桶，确保随时能追加新片段。
 */
const ensureVoiceBucket = (clientId: string) => {
  if (!voiceSegmentBuckets.has(clientId)) {
    voiceSegmentBuckets.set(clientId, { segments: [], timer: null });
  }
  return voiceSegmentBuckets.get(clientId)!;
};

/**
 * 清理客户端的语音缓存和定时器，避免内存泄漏。
 */
export const clearVoiceBucket = (clientId: string) => {
  const bucket = voiceSegmentBuckets.get(clientId);
  if (!bucket) {
    return;
  }

  if (bucket.timer) {
    clearTimeout(bucket.timer);
  }
  voiceSegmentBuckets.delete(clientId);
};

/**
 * 用于校验接收到的 meta 是否符合期望的语音片段元信息结构。
 */
export const isVoiceChunkMeta = (value: unknown): value is VoiceChunkMeta => {
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
  buffer: ArrayBufferLike,
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
 * 占位的 ASR 组合逻辑，目前仅用于验证片段合并后的数据。
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

const flushVoiceSegments = async (clientId: string, socket: Socket, sampleRate: number) => {
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

  const asrTranscript = await finalizeAliyunStream(clientId);
  if (asrTranscript) {
    console.info("aliyunASR: 转写完成，准备发给大语言模型", {
      clientId,
      transcript: asrTranscript,
    });
    // TODO: 在此处把 asrTranscript 转给大语言模型，并处理返回的命令或文本结果
  }
};

/**
 * 将收到的片段交给 buffer，超过窗口后自动触发合并事件。
 */
export const queueVoiceSegment = (
  clientId: string,
  socket: Socket,
  meta: unknown,
  audio: unknown,
) => {
  if (!isVoiceChunkMeta(meta)) {
    console.warn("收到不符合格式的 voice-chunk meta", { clientId, meta });
    return;
  }

  const normalized = normalizeVoicePayload(audio);
  if (!normalized) {
    console.warn("无法解析 voice-chunk 音频数据", { clientId, chunkId: meta.chunkId });
    return;
  }

  void streamAudioToAliyun(clientId, normalized, meta.sampleRate);

  const bucket = ensureVoiceBucket(clientId);
  bucket.segments.push(normalized);

  if (bucket.timer) {
    clearTimeout(bucket.timer);
  }

  bucket.timer = setTimeout(() => {
    void flushVoiceSegments(clientId, socket, meta.sampleRate);
  }, VOICE_MERGE_WINDOW_MS);
};
