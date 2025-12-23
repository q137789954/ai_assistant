import { type Socket } from "socket.io";

interface speechChatFlowParams {
  clientId: string;
  conversationId: string;
  userId: string;
  socket: Socket;
  content: Float32Array;
  chunkId: string | undefined;
  type: string;
}

export const processSpeechToSpeechChatFlow = async (params: speechChatFlowParams) => {
  const { socket, content, chunkId, type } = params;

  // 客户端主动发送 end，服务端无需再等待，立即转发第三方结束命令
  if (type === "end") {
    console.log("用户语音输入结束");
    const payload = JSON.stringify({
      type: "end",
    });
    console.log("发送 ASR 结束命令：", payload);
    socket.data.asrSocket.send(payload);
    return true;
  }

  // 新音频片段直接转发给第三方
  const payload = JSON.stringify({
    type: "audio",
    data: content,
    sample_rate: 16000,
    chunk_id: chunkId,
  });
  socket.data.asrSocket.send(payload);

  return true;
};
