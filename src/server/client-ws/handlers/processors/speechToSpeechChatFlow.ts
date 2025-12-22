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
  const {socket, content, chunkId, type } = params;

  if(type === "end") {
    console.log("用户语音输入结束");
    // 通知 ASR 服务结束当前语音输入
    const payload = JSON.stringify({
      type: "end",
    });
    socket.data.asrSocket.send(payload);
    return true;
  }

  const payload = JSON.stringify({
    type: "audio",
    data: content,
    sample_rate: 16000,
    chunk_id: chunkId,
  });
  socket.data.asrSocket.send(payload);

  return true;
};
