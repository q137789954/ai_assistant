/**
 * VoiceChunkMeta 描述客户端上传语音上传的元信息字段，确保运行时可用于校验。
 */
export interface VoiceChunkMeta {
  chunkId: string;
  sampleRate: number;
  timestamp: string;
  length: number;
}

/**
 * VoiceBucket 用于暂存某个客户端正在上传的语音缓冲区以及定时器。
 */
export type VoiceBucket = {
  segments: Float32Array[];
  timer: ReturnType<typeof setTimeout> | null;
};

type Format = "text" | "speech";

export interface ChatInputPayload {
  type: "chat:input";
  outputFormat: Format;
  inputFormat: Format;
  content: string | Float32Array;
}