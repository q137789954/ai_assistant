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
import { stripActionMarker } from "./ttsSentenceUtils";
import { streamSentenceToTts, type TtsEmotion, type TtsStreamController } from "./ttsStreamSender";

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

const isTtsEmotion = (v: unknown): v is TtsEmotion => v === "contempt" || v === "angry";

/**
 * 处理文本输入的全部流程：落库用户输入、调用 LLM 流式接口、把 reply 直接流式喂给 Fish TTS。
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
  if (typeof content !== "string") {
    console.error("textChatFlow: 收到的文本内容非法，要求字符串", {
      clientId,
      conversationId,
      content,
    });
    return false;
  }

  const normalizedContent = content.trim();
  if (!normalizedContent) {
    console.warn("textChatFlow: 收到空白文本内容，已忽略本次请求", {
      clientId,
      conversationId,
    });
    return false;
  }

  // ✅ 每次新请求都刷新 TTS 流的“最新序号”，并主动中止旧的 TTS 连接
  // 目的：保证只有最后一次请求的 TTS 会继续播报，旧请求直接废弃
  const ttsFlowId = (() => {
    const currentId =
      typeof socket.data.ttsFlowCounter === "number" ? socket.data.ttsFlowCounter : 0;
    const nextId = currentId + 1;
    socket.data.ttsFlowCounter = nextId;
    socket.data.latestTtsFlowId = nextId;

    const previousController = socket.data.activeTtsController as
      | TtsStreamController
      | null
      | undefined;
    if (previousController) {
      previousController.abort();
    }
    socket.data.activeTtsController = null;
    return nextId;
  })();

  const isLatestTtsFlow = () => socket.data.latestTtsFlowId === ttsFlowId;

  // 校验订阅与免费额度
  try {
    const { isSubscribed, ttsUsageCount } = await resolveSubscriptionState(userId);
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

  // 写入用户输入
  try {
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

  // running summary
  const recentThreads = Array.isArray(socket.data.userDailyThreadsRecent)
    ? socket.data.userDailyThreadsRecent
    : [];
  const legacyRecentThreads = Array.isArray(socket.data.userDailyThreadsRecen)
    ? socket.data.userDailyThreadsRecen
    : [];
  const topThreads = Array.isArray(socket.data.userDailyThreadsTop)
    ? socket.data.userDailyThreadsTop
    : [];
  const runningSummary = [...recentThreads, ...legacyRecentThreads, ...topThreads]
    .map((thread) => (typeof thread?.text === "string" ? thread.text : ""))
    .filter(Boolean)
    .join("\n");

  const recentMessagesSource = Array.isArray(socket.data.clientConversations)
    ? socket.data.clientConversations
    : [];
  const recentMessages = JSON.stringify(recentMessagesSource);
  const userProfile = JSON.stringify(socket.data.userProfile ?? {});
  const systemPrompt = getToSpeechPrompt({
    running_summary: runningSummary,
    recent_messages: recentMessages,
    user_profile: userProfile,
  });

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const createChatStreamWithRetry = async () => {
    const maxAttempts = 3;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await socket.data.llmClient.chat.completions.create({
          model: "grok-4-fast-non-reasoning",
          stream: true,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: normalizedContent },
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

  // 状态变量：累计助手回复
  let assistantContent = "";

  // reply/json 拆分
  let replyEnded = false;
  let replyBuffer = "";
  let headJsonBuffer = "";
  let headJsonParsed = false;
  let damageDelta: number | null = null;

  // 你原先把 suggested_emotion 放进 pendingAction（命名有点混，但先不动外层）
  let pendingAction: string | null = null;

  let tailJsonBuffer = "";

  // ✅ 新：真正流式 TTS controller（一条 reply 一条连接）
  let ttsController: TtsStreamController | null = null;

  // ✅ 新：把 LLM 的细碎 delta 轻量合并再喂给 TTS（避免 push 太碎）
  let ttsTextBuffer = "";
  let lastTtsFlushAt = 0;
  const FLUSH_INTERVAL_MS = 120;
  const MIN_BUFFER_CHARS = 12;

  const flushTtsBuffer = () => {
    if (!isLatestTtsFlow()) {
      if (ttsController) {
        ttsController.abort();
        ttsController = null;
      }
      return;
    }
    if (!ttsController) return;
    const text = ttsTextBuffer;
    if (!text) return;
    ttsTextBuffer = "";
    ttsController.pushText(text);
    lastTtsFlushAt = Date.now();
  };

  const pushToTts = (text: string) => {
    if (!isLatestTtsFlow()) {
      if (ttsController) {
        ttsController.abort();
        ttsController = null;
      }
      return;
    }
    if (!ttsController) return;
    if (!text) return;

    ttsTextBuffer += text;

    const now = Date.now();
    const hasPunc = /[。！？!?，,.;；:\n]/.test(text);
    if (ttsTextBuffer.length >= MIN_BUFFER_CHARS || hasPunc || now - lastTtsFlushAt >= FLUSH_INTERVAL_MS) {
      flushTtsBuffer();
    }
  };

  const handleReplyChunk = (textChunk: string) => {
    if (!textChunk) return;
    assistantContent += textChunk;

    // 保留你原来的动作/标记剥离
    const { sanitized, action } = stripActionMarker(textChunk);
    if (action && !pendingAction) pendingAction = action;

    // ✅ 真正流式：直接喂给 TTS（sanitized）
    if (sanitized) pushToTts(sanitized);
  };

  const handleReplyStream = (textChunk: string) => {
    if (!textChunk) return;

    if (!replyEnded) {
      replyBuffer += textChunk;
      const delimiterIndex = replyBuffer.indexOf(STREAM_REPLY_DELIMITER);
      if (delimiterIndex !== -1) {
        const replyPart = replyBuffer.slice(0, delimiterIndex);
        handleReplyChunk(replyPart);

        // reply 结束：flush + close TTS 输入
        flushTtsBuffer();
        ttsController?.closeText();

        const remaining = replyBuffer.slice(delimiterIndex + STREAM_REPLY_DELIMITER.length);
        tailJsonBuffer += remaining;
        replyBuffer = "";
        replyEnded = true;
        return;
      }

      // safe cut：保留 delimiter 前缀尾巴
      const safeLength = replyBuffer.length - (STREAM_REPLY_DELIMITER.length - 1);
      if (safeLength > 0) {
        const replyPart = replyBuffer.slice(0, safeLength);
        replyBuffer = replyBuffer.slice(safeLength);
        handleReplyChunk(replyPart);
      }
      return;
    }

    // reply 已结束，剩余流量并入尾部 JSON
    tailJsonBuffer += textChunk;
  };

  const isIgnorableStreamError = (error: unknown) => {
    if (!(error instanceof Error)) return false;
    const normalizedMessage = error.message.toLowerCase();
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

    for await (const chunk of responseStream) {
      const delta = chunk.choices?.[0]?.delta;
      const deltaContent = typeof delta?.content === "string" ? delta.content : "";
      if (!deltaContent) continue;

      if (!headJsonParsed) {
        headJsonBuffer += deltaContent;
        const { jsonText, rest } = extractFirstJson(headJsonBuffer);
        if (!jsonText) continue;

        try {
          const parsed = JSON.parse(jsonText) as Record<string, unknown>;

          // damage
          const candidate = parsed.damage_delta || 0;
          // suggested_emotion（你原来叫 pendingAction，这里继续沿用）
          pendingAction = (parsed.suggested_emotion as string) || "";

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
                // 如果你要中止，也要确保 TTS 不会挂起
                ttsController?.closeText();
                await ttsController?.done().catch(() => {});
                return true;
              }
            } catch (error) {
              console.error("textToSpeechChatFlow: 更新对战回合失败", error);
            }
          }

          headJsonParsed = true;
          headJsonBuffer = "";

          // ✅ 头部 JSON 解析完成后，立刻启动“一条 reply 一条 TTS 连接”
          const emotion: TtsEmotion | null = isTtsEmotion(pendingAction) ? pendingAction : null;

          if (isLatestTtsFlow()) {
            ttsController = streamSentenceToTts({
              clientId,
              conversationId,
              socket,
              userId,
              requestId,
              timestamp,
              action: pendingAction ?? undefined, // 透传给前端（可选）
              llmAction: pendingAction ?? undefined,
              emotion,
            });
            socket.data.activeTtsController = ttsController;
          }

          // rest 可能包含 reply 内容
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
          continue;
        }

        continue;
      }

      handleReplyStream(deltaContent);
    }
  } catch (error) {
    streamError = error;
  }

  // 流异常处理
  if (streamError && !isIgnorableStreamError(streamError)) {
    console.error("textChatFlow: LLM 流式响应处理失败", {
      clientId,
      conversationId,
      error: streamError,
    });
    socket.emit(
      "message",
      serializePayload({
        event: "chat-response-error",
        data: {
          clientId,
          conversationId,
          message:
            streamError instanceof Error ? streamError.message : "未知的 LLM 流式响应异常",
        },
      })
    );

    // ✅ 失败也要收尾 TTS，避免前端卡住
    flushTtsBuffer();
    ttsController?.closeText();
    await ttsController?.done().catch(() => {});
    return false;
  }

  if (streamError) {
    console.warn("textChatFlow: LLM 流式连接提前终止，尝试收尾处理", {
      clientId,
      conversationId,
      error: streamError,
    });
  }

  // 如果头部 JSON 最终还没解析到，尝试最后再提取一次
  if (!headJsonParsed && headJsonBuffer.trim()) {
    const { jsonText, rest } = extractFirstJson(headJsonBuffer);
    if (jsonText) {
      try {
        const parsed = JSON.parse(jsonText) as Record<string, unknown>;
        const candidate = parsed.damage_delta;
        if (typeof candidate === "number") {
          damageDelta = candidate;
        }
        pendingAction = (parsed.suggested_emotion as string) || pendingAction;
        headJsonParsed = true;

        // 启动 TTS（即使晚了也尽量启动）
        const emotion: TtsEmotion | null = isTtsEmotion(pendingAction) ? pendingAction : null;
        if (!ttsController && isLatestTtsFlow()) {
          ttsController = streamSentenceToTts({
            clientId,
            conversationId,
            socket,
            userId,
            requestId,
            timestamp,
            action: pendingAction ?? undefined,
            llmAction: pendingAction ?? undefined,
            emotion,
          });
          socket.data.activeTtsController = ttsController;
        }

        if (rest) handleReplyStream(rest);
      } catch (error) {
        console.error("textToSpeechChatFlow: 解析头部 JSON 失败(末尾兜底)", {
          clientId,
          conversationId,
          error,
          jsonText,
          rawBuffer: headJsonBuffer,
        });
      }
    }
  }

  // 流结束但没遇到分隔符：把剩余当 reply
  if (!replyEnded && replyBuffer) {
    handleReplyChunk(replyBuffer);
    replyBuffer = "";
  }

  // reply 结束时如果还没 close（比如没有 delimiter），这里兜底 close
  flushTtsBuffer();
  ttsController?.closeText();

  // 解析 tail JSON
  if (tailJsonBuffer.trim()) {
    const jsonTextRaw = tailJsonBuffer.trim();
    let jsonText = jsonTextRaw;
    const strayDelimiterIndex = jsonText.indexOf(STREAM_REPLY_DELIMITER);
    if (strayDelimiterIndex !== -1) {
      jsonText = jsonText.slice(0, strayDelimiterIndex).trim();
    }
    if (jsonText) {
      const { jsonText: extractedJson } = extractFirstJson(jsonText);
      if (extractedJson) {
        try {
          const parsed = JSON.parse(extractedJson.trim()) as Record<string, unknown>;
          if (damageDelta !== null && typeof parsed.damage_delta !== "number") {
            parsed.damage_delta = damageDelta;
          }
          socket.emit(
            "message",
            serializePayload({
              event: "chat-response-meta",
              data: { requestId, ...parsed },
            })
          );
        } catch (error) {
          console.error("textToSpeechChatFlow: 解析 LLM 结构化输出失败", {
            clientId,
            conversationId,
            error,
            extractedJson,
            jsonTextRaw,
          });
        }
      }
    }
  }

  // ✅ 等待 TTS 音频流结束（单连接）
  await ttsController?.done().catch(() => {});

  // 落库 assistant
  if (assistantContent) {
    const assistantTimestamp = Date.now();
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

    socket.data.clientConversations.push(
      { role: "user", content: normalizedContent, timestamp },
      { role: "assistant", content: assistantContent, timestamp: assistantTimestamp }
    );

    if (socket.data.clientConversations.length >= 10) {
      compressClientConversations({ socket, batchSize: 10 })
        .then((result) => {
          if (!result) return;
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
