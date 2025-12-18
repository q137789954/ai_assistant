import { Server, type Socket } from "socket.io";
import { randomUUID } from "crypto";
import { ConversationMessageRole } from "@prisma/client";
import { ChatInputPayload } from "../types";
import { prisma } from "@/server/db/prisma";
import { grokCreateChatCompletionStream } from "@/server/llm";
import { irritablePrompt } from "@/server/llm/prompt";
import { serializePayload } from "../utils";

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

  const { outputFormat, inputFormat, content } = payload;

  console.log("chatInputHandler: 处理输入内容", { outputFormat, inputFormat, content });

  console.log(userId,"userId---");
  console.log(conversationId,"conversationId---");


  if (outputFormat === "text" && inputFormat === "text") {
    // 简单示例：将文本输入存储到数据库中的 ConversationMessage 表
    try {
      // 使用 Prisma 的 ConversationMessage 模型存储聊天记录
      // 确保文本输入内容为字符串，避免 Float32Array 数据写入文本字段导致类型报错
      if (typeof content !== "string") {
        throw new Error("文本输入必须为字符串");
      }
      await prisma.conversationMessage.create({
        data: {
          id: randomUUID(),
          conversationId,
          role: ConversationMessageRole.USER,
          content,
          isVoice: false,
          userId,
        },
      });
      console.debug("chatInputHandler: 文本消息已存储到数据库", { clientId, conversationId });
    } catch (error) {
      console.error("chatInputHandler: 存储文本消息时出错", { clientId, conversationId, error });
    }
    // 直接调用 Grok 的流式接口，后续通过 for-await-of 持续拉取 chunk
    const responseStream = await grokCreateChatCompletionStream({
      messages: [
        {
          role: "system",
          content: irritablePrompt.systemPrompt,
        },
        {
          role: "user",
          content: content as string,
        },
      ],
    });
    console.log("chatInputHandler: 已调用 grokCreateChatCompletionStream 进行响应生成");

    let assistantContent = "";
    let chunkIndex = 0;

    try {
      // 遍历返回的流式 chunk，逐步聚合生成的文本，并推送每次增量给客户端
      for await (const chunk of responseStream) {
        const delta = chunk.choices?.[0]?.delta;
        const deltaContent = typeof delta?.content === "string" ? delta.content : "";
        if (!deltaContent) {
          continue;
        }

        assistantContent += deltaContent;
        chunkIndex += 1;

        // 每个 chunk 的增量内容封装为统一结构，供前端（chatbot）实时渲染
        const chunkPayload = serializePayload({
          event: "chat-response-chunk",
          data: {
            clientId,
            conversationId,
            role: "assistant",
            delta: deltaContent,
            aggregated: assistantContent,
            chunkIndex,
            timestamp: new Date().toISOString(),
          },
        });

        socket.emit("message", chunkPayload);
      }
    } catch (error) {
      // 一旦流式处理中断，发送错误事件供前端展示并终止当前处理
      console.error("chatInputHandler: Grok 流式响应处理失败", {
        clientId,
        conversationId,
        error,
      });
      const errorPayload = serializePayload({
        event: "chat-response-error",
        data: {
          clientId,
          conversationId,
          message: error instanceof Error ? error.message : "未知的 Grok 流式响应异常",
        },
      });
      socket.emit("message", errorPayload);
      return;
    }

    // 在流结束后再发送一次完成事件，包含汇总的助手文本与 chunk 总数
    const completionPayload = serializePayload({
      event: "chat-response-complete",
      data: {
        clientId,
        conversationId,
        assistantContent,
        chunkCount: chunkIndex,
        timestamp: new Date().toISOString(),
      },
    });

    socket.emit("message", completionPayload);

    if (assistantContent) {
      // 将最终助手回复落库，便于后续历史回溯或审计
      try {
        await prisma.conversationMessage.create({
          data: {
            id: randomUUID(),
            conversationId,
            role: ConversationMessageRole.ASSISTANT,
            content: assistantContent,
            isVoice: false,
            userId,
          },
        });
        console.debug("chatInputHandler: 助手回复已写入数据库", {
          clientId,
          conversationId,
        });
      } catch (error) {
        console.error("chatInputHandler: 存储助手回复时出错", {
          clientId,
          conversationId,
          error,
        });
      }
    }
  }

  // 未来可扩展对其他类型输入（如语音、图像等）的处理逻辑

};
