import { Server, type Socket } from "socket.io";
import { ChatInputPayload } from "../types";
import { prisma } from "@/server/db/prisma";

/**
 * 处理 chat:input 事件的逻辑入口，后续可在此完成复杂的业务流程。
 *
 * @param clientId 客户端唯一标识
 * @param socket 当前连接的 socket 实例
 * @param payload 客户端传递的事件载荷
 * @param io 全局 Socket.IO 实例，用于广播或推送
 */
export const handleChatInput = async (
  clientId: string,
  socket: Socket,
  payload: ChatInputPayload,
  io: Server,
) => {
  console.debug("chatInputHandler: 收到输入", { clientId, payload });

  const { type, outputFormat, content } = payload;

  
};
