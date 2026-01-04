import { Socket } from "socket.io";

/**
 * 压缩 socket.data.clientConversations 中最早的对话消息。
 * 当累计消息条数超过阈值（默认 100）时，调用 LLM 将这批消息合成为一条摘要，
 * 生成成功后用摘要替换掉被压缩的那部分消息，避免上下文无限膨胀。
 * 可选的旧摘要会作为额外输入一起生成新的汇总，以保持历史连续性。
 */
export const compressClientConversations = async ({
  socket,
  previousSummary,
  batchSize = 100,
  model = "grok-4-fast-non-reasoning",
}: {
  socket: Socket;
  previousSummary?: string;
  batchSize?: number;
  model?: string;
}): Promise<string | null> => {
  // 利用 socket 上的状态位避免重复触发压缩
  if (socket.data.clientConversationsCompressing) {
    return null;
  }
  socket.data.clientConversationsCompressing = true;

  // 安全兜底，确保 clientConversations 始终是数组，避免后续 splice 触发异常
  const conversations = Array.isArray(socket.data.clientConversations)
    ? socket.data.clientConversations
    : [];
  if (!socket.data.llmClient) {
    console.error(
      "compressClientConversations: 缺少 llmClient，无法生成摘要",
      {
        conversationLength: conversations.length,
      }
    );
    return null;
  }

  // 未超过阈值时无需压缩，直接返回
  if (conversations.length <= batchSize) {
    return null;
  }

  // 取出需要压缩的最早一批消息，保留后续消息原样用于继续对话
  const chunk = conversations.slice(0, batchSize);
  const summaryPrompt = [
    {
      role: "system",
      content:
        "你是对话整理助手，需要把提供的多轮对话压缩成一条中文摘要，保留人物关系、关键事实、决策与未解决问题，避免冗余与情绪化措辞。",
    },
    ...(previousSummary
      ? [
          {
            role: "user",
            content: `这是此前的对话摘要，请在新的摘要中延续其关键信息：${previousSummary}`,
          },
        ]
      : []),
    ...chunk,
    {
      role: "user",
      content:
        "请综合以上内容输出一条不超过 150 字的精简摘要，便于后续继续对话。",
    },
  ];

  try {
    const response = await socket.data.llmClient.responses.create({
      model,
      input: summaryPrompt,
    });
    const summaryText =
      typeof response?.output_text === "string"
        ? response.output_text.trim()
        : "";

    if (!summaryText) {
      console.error("compressClientConversations: LLM 未返回有效摘要", {
        conversationLength: conversations.length,
      });
      return null;
    }

    // 用摘要替换掉被压缩的历史消息，避免上下文无限增长
    conversations.splice(0, chunk.length, {
      role: "assistant",
      content: `对话摘要：${summaryText}`,
    });

    return summaryText;
  } catch (error) {
    console.error("compressClientConversations: 调用 LLM 生成摘要失败", {
      error,
    });
    return null;
  } finally {
    socket.data.clientConversationsCompressing = false;
  }
};
