import { Server, type Socket } from "socket.io";
import { ChatInputPayload } from "../types";
import { processTextChatFlow } from "./processors/textChatFlow";
import { processTextToSpeechChatFlow } from "./processors/textToSpeechChatFlow";
import { processSpeechToSpeechChatFlow } from "./processors/speechToSpeechChatFlow";

/**
 * 处理 chat:input 事件的逻辑入口，后续可在此完成复杂的业务流程。
 *
 * @param clientId 客户端唯一标识
 * @param conversationId 本次连接对应的 conversationId，用于上下文追踪
 * @param userId 当前登录的 userId，可用于写入多轮上下文或权限校验
 * @param socket 当前连接的 socket 实例
 * @param payload 客户端传递的事件载荷
 * @param io 全局 Socket.IO 实例，用于广播或推送
 */
export const handleChatInput = async (
  clientId: string,
  conversationId: string,
  userId: string,
  socket: Socket,
  payload: ChatInputPayload,
) => {

  const { outputFormat, inputFormat, content, chunkId, requestId, timestamp } = payload;

  if (outputFormat === "text" && inputFormat === "text") {
    const flowSuccess = await processTextChatFlow({
      clientId,
      conversationId,
      userId,
      socket,
      content,
      timestamp,
    });
    if (!flowSuccess) {
      return;
    }
  }
  if(outputFormat === "speech" && inputFormat === "text") {
    const flowSuccess = await processTextToSpeechChatFlow({
      clientId,
      conversationId,
      userId,
      socket,
      content,
      requestId,
      timestamp,
    });
    if (!flowSuccess) {
      return;
    }
  }

  if((outputFormat === "speech" && inputFormat === "speech")) {
    const flowSuccess = await processSpeechToSpeechChatFlow({
      clientId,
      conversationId,
      userId,
      socket,
      content,
      chunkId,
      type: payload.type,
      requestId,
      timestamp
    });
    if (!flowSuccess) {
      return;
    } 
  }

  // 未来可扩展对其他类型输入（如语音、图像等）的处理逻辑

};
