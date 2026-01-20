import { Socket } from "socket.io";
import { randomUUID } from "crypto";
import { ConversationMessageRole } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { getToSpeechPrompt } from "@/server/llm/prompt";
import { serializePayload } from "../../utils";
import { compressClientConversations } from "../clientConversationsProcessors";
import { refreshRecentUserDailyThreads } from "../userContextLoader";
import { applyRoastBattleDamageDelta } from "./roastBattleProcessor";
import { extractFirstJson } from "./streamJsonExtractor";
import {
  extractCompletedSentences,
  stripActionMarker,
} from "./ttsSentenceUtils";
import { streamSentenceToTts } from "./ttsStreamSender";

interface textToSpeechChatFlowParams {
  clientId: string;
  conversationId: string;
  userId: string;
  socket: Socket;
  content: unknown;
  requestId: string;
  timestamp: number;
}

const STREAM_REPLY_DELIMITER = "<<<END_REPLY>>>";
const FREE_TTS_USAGE_LIMIT = 20;

// 查询订阅状态与免费额度，包含到期兜底处理
const resolveSubscriptionState = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      isSubscribed: true,
      subscriptionExpiresAt: true,
      ttsUsageCount: true,
    },
  });

  if (!user) {
    throw new Error("未找到用户订阅信息");
  }

  const now = new Date();
  const isExpired =
    user.subscriptionExpiresAt !== null && user.subscriptionExpiresAt <= now;
  const isSubscribed = user.isSubscribed && !isExpired;

  if (user.isSubscribed && isExpired) {
    await prisma.user.update({
      where: { id: userId },
      data: { isSubscribed: false },
    });
  }

  return {
    isSubscribed,
    ttsUsageCount: user.ttsUsageCount,
  };
};

// 免费额度消耗以服务端为准，避免前端绕过
const consumeFreeTtsQuota = async (userId: string) => {
  await prisma.user.update({
    where: { id: userId },
    data: { ttsUsageCount: { increment: 1 } },
  });
};

/**
 * 处理文本输入的全部流程：落库用户输入、调用 Grok 流式接口、持续推送 chunk、落库助手回复。
 * @param params 文本流处理所需的上下文与连接信息
 * @returns 流式处理是否全部完成（遇到异常时返回 false，可用于终止上游逻辑）
 */
export const processTextToSpeechChatFlow = async ({
  clientId,
  conversationId,
  userId,
  socket,
  content,
  requestId,
  timestamp,
}: textToSpeechChatFlowParams): Promise<boolean> => {
  // 只有字符串才能写入文本列，先做类型校验以防异常
  if (typeof content !== "string") {
    console.error("textChatFlow: 收到的文本内容非法，要求字符串", {
      clientId,
      conversationId,
      content,
    });
    return false;
  }
  // 语音识别可能出现空白或纯空格结果，避免写库与下游调用触发约束错误
  const normalizedContent = content.trim();
  if (!normalizedContent) {
    console.warn("textChatFlow: 收到空白文本内容，已忽略本次请求", {
      clientId,
      conversationId,
    });
    return false;
  }
  // 校验订阅与免费额度，超过限额时直接拦截本次请求
  try {
    const { isSubscribed, ttsUsageCount } =
      await resolveSubscriptionState(userId);
      console.log(isSubscribed, ttsUsageCount)
    if (!isSubscribed) {
      if (ttsUsageCount >= FREE_TTS_USAGE_LIMIT) {
        socket.emit(
          "message",
          serializePayload({
            event: "subscription-required",
            data: {
              requestId,
              limit: FREE_TTS_USAGE_LIMIT,
              used: ttsUsageCount,
              remaining: 0,
              message: "免费额度已用完，请订阅后继续使用",
            },
          })
        );
        return false;
      }
      await consumeFreeTtsQuota(userId);
    }
  } catch (error) {
    console.error("textToSpeechChatFlow: 订阅状态校验失败", {
      clientId,
      conversationId,
      error,
    });
    socket.emit(
      "message",
      serializePayload({
        event: "chat-response-error",
        data: {
          clientId,
          conversationId,
          message: "订阅状态校验失败，请稍后重试",
        },
      })
    );
    return false;
  }
  // 验证成功后立即将用户输入写入数据库，便于会话记录与问题追踪
  // 读取 Grok 流式响应，累计文本并在每次收到 chunk 后尝试分句。
  try {
    // 尝试把用户输入写入消息表，便于后续会话追踪
    await prisma.conversationMessage.create({
      data: {
        id: randomUUID(),
        conversationId,
        role: ConversationMessageRole.USER,
        content: normalizedContent,
        isVoice: false,
        userId,
        createdAt: new Date(timestamp),
      },
    });
  } catch (error) {
    console.error("textToSpeechChatFlow: 存储用户输入失败", {
      clientId,
      conversationId,
      error,
    });
  }

  // 组装“前情提要”：合并最近 7 天与历史高分 threads 的 text 内容
  const recentThreads = Array.isArray(socket.data.userDailyThreadsRecent)
    ? socket.data.userDailyThreadsRecent
    : [];
  const legacyRecentThreads = Array.isArray(socket.data.userDailyThreadsRecen)
    ? socket.data.userDailyThreadsRecen
    : [];
  const topThreads = Array.isArray(socket.data.userDailyThreadsTop)
    ? socket.data.userDailyThreadsTop
    : [];
  const runningSummary = [
    ...recentThreads,
    ...legacyRecentThreads,
    ...topThreads,
  ]
    .map((thread) => (typeof thread?.text === "string" ? thread.text : ""))
    .filter(Boolean)
    .join("\n");

  // 最近对话与用户画像需要序列化为字符串，以便完整传给提示词模板
  const recentMessagesSource = Array.isArray(socket.data.clientConversations)
    ? socket.data.clientConversations
    : [];
  const recentMessages = JSON.stringify(recentMessagesSource);
  console.log(recentMessages, 'recentMessages')
  const userProfile = JSON.stringify(socket.data.userProfile ?? {});
  const systemPrompt = getToSpeechPrompt({
    running_summary: runningSummary,
    recent_messages: recentMessages,
    user_profile: userProfile,
  });

  // 连接中断时需要重试，否则流式请求会直接中止，前端只收到连接错误
  const sleep = (ms: number) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  const createChatStreamWithRetry = async () => {
    const maxAttempts = 3;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await socket.data.llmClient.chat.completions.create({
          model: "grok-4-fast-non-reasoning",
          // model: "qwen-turbo",
          stream: true, // 开启流式返回以便后续使用 for-await 读取每个 chunk
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: normalizedContent,
            },
          ],
        });
      } catch (error) {
        lastError = error;
        console.error("textToSpeechChatFlow: 创建流式连接失败，将尝试重连", {
          clientId,
          conversationId,
          attempt,
          maxAttempts,
          error,
        });
        if (attempt < maxAttempts) {
          const delayMs = 500 * 2 ** (attempt - 1);
          await sleep(delayMs);
        }
      }
    }
    throw lastError;
  };

  // 下面的状态变量用于积累助手的回答、维护 chunk 序号以及串行化 TTS 调用
  let assistantContent = "";
  let pendingSentence = "";
  let ttsPipeline: Promise<void> = Promise.resolve();
  let actionHandledByTts = false;
  // reply/json 是流式混合输出，需要拆分后分别处理
  let replyEnded = false;
  // replyBuffer 用于缓存未完全确认的文本，避免分隔符被拆段误判
  let replyBuffer = "";
  // 先输出的 JSON（只包含 damage_delta、suggested_emotion）需要缓冲拼接并提前解析
  let headJsonBuffer = "";
  let headJsonParsed = false;
  let damageDelta: number | null = null;
  let pendingAction: string | null = null;
  // 分隔符之后的结构化输出需要完整缓冲，等流式结束统一解析
  let tailJsonBuffer = "";

  // 通过 Promise 链把所有需要转换的句子串行化，避免 TTS 请求并发导致顺序错乱。
  const enqueueSentence = (sentence: string) => {
    const normalized = sentence.trim();
    if (!normalized) {
      return;
    }

    const actionForSentence =
      !actionHandledByTts && pendingAction ? pendingAction : undefined;
    if (actionForSentence) {
      actionHandledByTts = true;
    }

    ttsPipeline = ttsPipeline
      .then(() =>
        streamSentenceToTts({
          sentence: normalized,
          clientId,
          conversationId,
          socket,
          userId,
          action: actionForSentence,
          llmAction: pendingAction ?? undefined,
          requestId,
          timestamp,
        })
      )
      .catch((error) => {
        console.error("textToSpeechChatFlow: TTS 服务处理失败", {
          clientId,
          conversationId,
          sentence: normalized,
          error,
        });
      });
  };

  const handleReplyChunk = (textChunk: string) => {
    if (!textChunk) {
      return;
    }
    assistantContent += textChunk;
    // 把当前 chunk 和上一轮未完成的片段拼接，提取出已经完整的句子并送入 TTS 管线
    const combinedText = pendingSentence + textChunk;
    const { sanitized, action } = stripActionMarker(combinedText);
    if (action && !pendingAction) {
      pendingAction = action;
    }
    const { sentences, remainder } = extractCompletedSentences(sanitized);
    pendingSentence = remainder;
    sentences.forEach(enqueueSentence);
  };

  /**
   * 处理“reply + 分隔符 + 尾部 JSON”的流式拼接逻辑。
   * - 在 reply 阶段持续送入 TTS 分句
   * - 捕获分隔符后将剩余内容写入尾部 JSON 缓冲区
   */
  const handleReplyStream = (textChunk: string) => {
    if (!textChunk) {
      return;
    }

    if (!replyEnded) {
      // reply 阶段：寻找分隔符
      replyBuffer += textChunk;
      const delimiterIndex = replyBuffer.indexOf(STREAM_REPLY_DELIMITER);
      if (delimiterIndex !== -1) {
        // 找到分隔符：分隔符前是 reply，分隔符后是尾部 JSON
        const replyPart = replyBuffer.slice(0, delimiterIndex);
        handleReplyChunk(replyPart);
        const remaining = replyBuffer.slice(
          delimiterIndex + STREAM_REPLY_DELIMITER.length
        );
        tailJsonBuffer += remaining;
        replyBuffer = "";
        replyEnded = true;
        return;
      }

      // 未找到分隔符时，保留可能是分隔符前缀的尾巴，避免误切
      const safeLength =
        replyBuffer.length - (STREAM_REPLY_DELIMITER.length - 1);
      if (safeLength > 0) {
        const replyPart = replyBuffer.slice(0, safeLength);
        replyBuffer = replyBuffer.slice(safeLength);
        handleReplyChunk(replyPart);
      }
      return;
    }

    // reply 已结束，剩余流量全部并入尾部 JSON 缓冲区
    tailJsonBuffer += textChunk;
  };

  const isIgnorableStreamError = (error: unknown) => {
    if (!(error instanceof Error)) {
      return false;
    }
    const normalizedMessage = error.message.toLowerCase();
    // 某些流式连接会以 terminated/aborted 结束，视为正常中止，避免前端误报
    return (
      normalizedMessage === "terminated" ||
      normalizedMessage.includes("terminated") ||
      normalizedMessage.includes("aborted") ||
      normalizedMessage.includes("abort")
    );
  };

  let streamError: unknown = null;
  try {
    const responseStream = await createChatStreamWithRetry();
    // 遍历的流式响应，逐步构建助手回复并推送 chunk
    for await (const chunk of responseStream) {
      const delta = chunk.choices?.[0]?.delta;
      const deltaContent =
        typeof delta?.content === "string" ? delta.content : "";
      if (!deltaContent) {
        continue;
      }

      if (!headJsonParsed) {
        // 先解析头部 JSON（仅包含 damage_delta），解析成功后才进入 reply 阶段
        headJsonBuffer += deltaContent;
        const { jsonText, rest } = extractFirstJson(headJsonBuffer);
        if (!jsonText) {
          continue;
        }
        try {
          const parsed = JSON.parse(jsonText) as Record<string, unknown>;
          console.log(parsed, 'parsed')
          const candidate = parsed.damage_delta || 0;
          pendingAction = parsed.suggested_emotion as string || '';
          if (typeof candidate === "number") {
            damageDelta = candidate;
            try {
              const shouldStop = await applyRoastBattleDamageDelta({
                socket,
                clientId,
                conversationId,
                damageDelta: candidate,
              });
              if (shouldStop) {
                return true;
              }
            } catch (error) {
              console.error("textToSpeechChatFlow: 更新对战回合失败", error);
            }
          }
          headJsonParsed = true;
          headJsonBuffer = "";
        } catch (error) {
          console.error("textToSpeechChatFlow: 解析头部 JSON 失败", {
            clientId,
            conversationId,
            error,
            jsonText,
            rawBuffer: headJsonBuffer,
          });
          // 解析失败时保留缓冲区，继续等待后续数据补齐
          continue;
        }
        // 头部 JSON 解析完成后，剩余内容可能包含 reply 或分隔符
        if (rest) {
          handleReplyStream(rest);
        }
        continue;
      }

      handleReplyStream(deltaContent);
    }
  } catch (error) {
    streamError = error;
  }

  if (streamError && !isIgnorableStreamError(streamError)) {
    console.error("textChatFlow: Grok 流式响应处理失败", {
      clientId,
      conversationId,
      error: streamError,
    });
    const errorPayload = serializePayload({
      event: "chat-response-error",
      data: {
        clientId,
        conversationId,
        message:
          streamError instanceof Error
            ? streamError.message
            : "未知的 Grok 流式响应异常",
      },
    });
    socket.emit("message", errorPayload);
    return false;
  }

  if (streamError) {
    console.warn("textChatFlow: Grok 流式连接提前终止，尝试收尾处理", {
      clientId,
      conversationId,
      error: streamError,
    });
  }

  if (!headJsonParsed && headJsonBuffer.trim()) {
    // 流式结束仍未解析到头部 JSON，尝试最后再提取一次
    const { jsonText, rest } = extractFirstJson(headJsonBuffer);
    if (jsonText) {
      try {
        const parsed = JSON.parse(jsonText) as Record<string, unknown>;
        const candidate = parsed.damage_delta;
        if (typeof candidate === "number") {
          damageDelta = candidate;
        }
        headJsonParsed = true;
        if (rest) {
          handleReplyStream(rest);
        }
      } catch (error) {
        console.error("textToSpeechChatFlow: 解析头部 JSON 失败", {
          clientId,
          conversationId,
          error,
          jsonText,
          rawBuffer: headJsonBuffer,
        });
      }
    }
  }

  if (!replyEnded && replyBuffer) {
    // 流式结束仍未遇到分隔符时，把剩余内容当作 reply 处理
    handleReplyChunk(replyBuffer);
    replyBuffer = "";
  }

  if (pendingSentence.trim()) {
    // 循环结束后如果还有残留片段，也需要转换为语音
    enqueueSentence(pendingSentence);
    pendingSentence = "";
  }

  if (tailJsonBuffer.trim()) {
    // JSON 必须完整后再解析并下发给客户端
    const jsonTextRaw = tailJsonBuffer.trim();
    let jsonText = jsonTextRaw;
    const strayDelimiterIndex = jsonText.indexOf(STREAM_REPLY_DELIMITER);
    if (strayDelimiterIndex !== -1) {
      // 兜底处理：如果 JSON 后又混入分隔符，截断后再解析
      jsonText = jsonText.slice(0, strayDelimiterIndex).trim();
    }
    if (!jsonText) {
      return true;
    }
    // 尝试只解析首个完整 JSON，避免尾部夹杂多余 JSON 导致解析失败
    const { jsonText: extractedJson } = extractFirstJson(jsonText);
    if (!extractedJson) {
      return true;
    }
    jsonText = extractedJson.trim();
    if (!jsonText) {
      return true;
    }
    try {
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      if (damageDelta !== null && typeof parsed.damage_delta !== "number") {
        // 头部 JSON 已解析到 damage_delta 时补回，保持下游结构兼容
        parsed.damage_delta = damageDelta;
      }
      socket.emit(
        "message",
        serializePayload({
          event: "chat-response-meta",
          data: {
            requestId,
            ...parsed,
          },
        })
      );
    } catch (error) {
      console.error("textToSpeechChatFlow: 解析 LLM 结构化输出失败", {
        clientId,
        conversationId,
        error,
        jsonText,
        jsonTextRaw,
      });
    }
  }

  // 等待所有排队的 TTS 请求完成后再继续后续流程
  await ttsPipeline;

  if (assistantContent) {
    const assistantTimestamp = Date.now();
    // 如果助手生成了文字回复，同步写入数据库以完整记录会话
    try {
      await prisma.conversationMessage.create({
        data: {
          id: randomUUID(),
          conversationId,
          role: ConversationMessageRole.ASSISTANT,
          content: assistantContent,
          isVoice: false,
          userId,
          createdAt: new Date(assistantTimestamp),
        },
      });
    } catch (error) {
      console.error("textToSpeechChatFlow: 存储助手回复时出错", {
        clientId,
        conversationId,
        error,
      });
    }

    // 把完整助手回复追加到 socket.data.clientConversations 以保持上下文
    socket.data.clientConversations.push(
      { role: "user", content: normalizedContent, timestamp },
      {
        role: "assistant",
        content: assistantContent,
        timestamp: assistantTimestamp,
      }
    );
    if (socket.data.clientConversations.length >= 10) {
      // 异步触发线程压缩，压缩成功后刷新本次连接的最近 7 天 threads
      compressClientConversations({
        socket,
        batchSize: 10,
      })
        .then((result) => {
          if (!result) {
            return;
          }
          return refreshRecentUserDailyThreads(socket);
        })
        .catch((error) => {
          console.error("textToSpeechChatFlow: 线程压缩触发失败", {
            clientId,
            conversationId,
            error,
          });
        });
    }
  }

  return true;
};

/**
 * 从积累的文本中提取以句末标点结束的完整句子，返回句子列表及剩余未封装的尾部。
 */
