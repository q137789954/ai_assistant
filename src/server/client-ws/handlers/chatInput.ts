import { Server, type Socket } from "socket.io";
import { ChatInputPayload } from "../types";
import { prisma } from "@/server/db/prisma";

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
  io: Server,
) => {
  console.debug("chatInputHandler: 收到输入", {
    clientId,
    conversationId,
    userId,
    payload,
  });

  const { outputFormat, content } = payload;

  console.log("chatInputHandler: 处理输入内容", { outputFormat, content });

  console.log(userId,"userId---");
  console.log(conversationId,"conversationId---");


  if(outputFormat === "text") {
    // 简单示例：将文本输入存储到数据库中的 Message 表
    try {
      await prisma.message.create({
        data: {
          conversationId,
          role: "user",
          content,
          outputFormat,
          isVoice: false,
          userId,
        },
      });
      console.debug("chatInputHandler: 文本消息已存储到数据库", { clientId, conversationId });
    } catch (error) {
      console.error("chatInputHandler: 存储文本消息时出错", { clientId, conversationId, error });
    }
  }

  // 未来可扩展对其他类型输入（如语音、图像等）的处理逻辑

};
