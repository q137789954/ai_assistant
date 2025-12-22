
import { Buffer } from "node:buffer";
import type WebSocket from "ws";
import { Server, type Socket } from "socket.io";

interface speechChatFlowParams {
  clientId: string;
  conversationId: string;
  userId: string;
  socket: Socket;
  content: Float32Array;
  chunkId: string | undefined;
}

export const processSpeechToSpeechChatFlow = async (params: speechChatFlowParams) => {
  const {socket, content, chunkId } = params;

  const audioBuffer = Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  const payload = JSON.stringify({
    type: "audio",
    data: audioBuffer.toString("base64"),
    sample_rate: 16000,
    chunk_id: chunkId,
  });
  socket.data.asrSocket.send(payload);

  return true;
};
