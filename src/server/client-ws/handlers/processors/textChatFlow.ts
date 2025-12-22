import { Socket } from "socket.io";
import { randomUUID } from "crypto";
import { ConversationMessageRole } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { grokCreateChatCompletionStream } from "@/server/llm";
import { irritablePrompt } from "@/server/llm/prompt";
import { serializePayload } from "../../utils";

interface TextChatFlowParams {
  clientId: string;
  conversationId: string;
  userId: string;
  socket: Socket;
  content: unknown;
}

/**
 * 处理文本输入的全部流程：落库用户输入、调用 Grok 流式接口、持续推送 chunk、落库助手回复。
 * @param params 文本流处理所需的上下文与连接信息
 * @returns 流式处理是否全部完成（遇到异常时返回 false，可用于终止上游逻辑）
 */
export const processTextChatFlow = async ({
  clientId,
  conversationId,
  userId,
  socket,
  content,
}: TextChatFlowParams): Promise<boolean> => {
  // 只有字符串才能写入文本列，先做类型校验以防异常
  if (typeof content !== "string") {
    console.error("textChatFlow: 收到的文本内容非法，要求字符串", {
      clientId,
      conversationId,
      content,
    });
    return false;
  }
  try {
    console.log("textChatFlow: 存储用户输入", {
        id: randomUUID(),
        conversationId,
        role: ConversationMessageRole.USER,
        content,
        isVoice: false,
        userId,
      });
    prisma.conversationMessage.create({
      data: {
        id: randomUUID(),
        conversationId,
        role: ConversationMessageRole.USER,
        content,
        isVoice: false,
        userId,
      },
    });
  } catch (error) {
    // 写库失败不影响后续生成，但需要记录
    console.error("textChatFlow: 存储用户输入时异常", { clientId, conversationId, error });
  }
  const responseStream = await socket.data.llmClient.chat.completions.create({
    model: "grok-4-fast-non-reasoning",
    stream: true, // 开启流式返回以便后续使用 for-await 读取每个 chunk
    messages: [
      {
        role: "system",
        content: irritablePrompt.systemPrompt,
      },
      {
        role: "user",
        content,
      },
    ],
  });

  let assistantContent = "";
  let chunkIndex = 0;
  let firstChunkLogged = false;

  try {
    for await (const chunk of responseStream) {
      const delta = chunk.choices?.[0]?.delta;
      const deltaContent = typeof delta?.content === "string" ? delta.content : "";
      if (!deltaContent) {
        continue;
      }

      if (!firstChunkLogged) {
        firstChunkLogged = true;
      }

      assistantContent += deltaContent;
      chunkIndex += 1;

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
    console.error("textChatFlow: Grok 流式响应处理失败", {
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
    return false;
  }

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
    } catch (error) {
      console.error("textChatFlow: 存储助手回复时出错", {
        clientId,
        conversationId,
        error,
      });
    }
  }

  return true;
};
