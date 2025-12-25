import { type Socket } from "socket.io";

interface speechChatFlowParams {
  clientId: string;
  conversationId: string;
  userId: string;
  socket: Socket;
  content: Float32Array;
  chunkId: string | undefined;
  type: string;
  timestamp: number
  requestId: string
}

export const processSpeechToSpeechChatFlow = async (params: speechChatFlowParams) => {
  const { socket, content, chunkId, type, timestamp, requestId } = params;

  // 客户端主动发送 end，服务端无需再等待，立即转发第三方结束命令
  if (type === "end") {
    const payload = JSON.stringify({
      type: "end",
      timestamp,
      requestId
    });
    socket.data.asrSocket.send(payload);
    return true;
  }

  // 新音频片段直接转发给第三方
  const payload = JSON.stringify({
    type: "audio",
    data: content,
    sample_rate: 16000,
    chunk_id: chunkId,
    timestamp,
    requestId
  });
  socket.data.asrSocket.send(payload);

  return true;
};
