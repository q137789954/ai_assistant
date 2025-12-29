import { Socket } from "socket.io";
import { randomUUID } from "crypto";
import { ConversationMessageRole } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
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
  // 打开“火力全开”模式：不等待写库完成就继续后续流程，但要专门捕获异常避免未处理的 Promise 拒绝
  const userMessageCreatePromise = prisma.conversationMessage.create({
    data: {
      id: randomUUID(),
      conversationId,
      role: ConversationMessageRole.USER,
      content,
      isVoice: false,
      userId,
    },
  });
  userMessageCreatePromise.catch((error) => {
    console.error("textChatFlow: 存储用户输入时异常", { clientId, conversationId, error });
  });
  const responseStream = await socket.data.llmClient.responses.create({
    model: "grok-4-fast-non-reasoning",
    input: [
      {
        role: "system",
        content: irritablePrompt.textChatSystemPrompt,
      },
      {
        role: "user",
        content,
      },
    ],
  });

  console.log(responseStream.output_text, 'responseStream.output[0].content');

  try {
    const text = responseStream.output_text;
    const chunkPayload = serializePayload({
        event: "chat-response-complete",
        data: {
          clientId,
          conversationId,
          role: "assistant",
          content: text,
          timestamp: new Date().toISOString(),
        },
      });
      socket.emit("message", chunkPayload);

      if (text) {
    try {
      await prisma.conversationMessage.create({
        data: {
          id: randomUUID(),
          conversationId,
          role: ConversationMessageRole.ASSISTANT,
          content: text,
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

  } catch (error) {
    console.error("textChatFlow: Grok响应处理失败", {
      clientId,
      conversationId,
      error,
    });
    return false;
  }

  return true;
};
