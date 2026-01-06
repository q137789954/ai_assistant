import { Socket } from "socket.io";
import { randomUUID } from "crypto";
import { ConversationMessageRole } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { getToSpeechPrompt } from "@/server/llm/prompt";
import { serializePayload } from "../../utils";
import { compressClientConversations } from "../clientConversationsProcessors";
import { refreshRecentUserDailyThreads } from "../userContextLoader";
import {
  updateRoastBattleRound,
} from "../roastBattleRoundLoader";

interface textToSpeechChatFlowParams {
  clientId: string;
  conversationId: string;
  userId: string;
  socket: Socket;
  content: unknown;
  requestId: string;
  timestamp: number;
}

const TTS_END_PUNCTUATIONS = /[。！？!?]/;
// 以上常量用于控制 Openspeech TTS 的各项参数，优先读取可调节的环境变量并保留合理默认值
// LLM 可能会在回复中保留一个动作字段，后续需要识别并拆分出该部分。
const ACTION_MARKER = /【动作：([^】]+)】/;
const STREAM_REPLY_DELIMITER = "<<<END_REPLY>>>";

/**
 * 试图从文本中提取动作标记，若存在则同时移除该片段并返回去除后的内容与动作名称。
 */
const stripActionMarker = (text: string) => {
  const match = ACTION_MARKER.exec(text);
  if (!match) {
    return {
      sanitized: text,
      action: null,
    };
  }
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);
  return {
    sanitized: `${before}${after}`,
    action: match[1].trim(),
  };
};

/**
 * 从缓冲区中提取首个完整 JSON 对象，并返回 JSON 文本与剩余内容。
 * - 通过花括号/方括号深度与字符串状态机识别 JSON 边界，避免被字符串中的括号干扰。
 * - 若未形成完整 JSON，则返回 null 并保留原缓冲区。
 */
const extractFirstJson = (buffer: string) => {
  const startIndex = buffer.indexOf("{");
  if (startIndex === -1) {
    return { jsonText: null as string | null, rest: buffer };
  }

  let braceDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < buffer.length; index += 1) {
    const char = buffer[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth -= 1;
      if (braceDepth === 0 && bracketDepth === 0) {
        const jsonText = buffer.slice(startIndex, index + 1);
        const rest = buffer.slice(index + 1);
        return { jsonText, rest };
      }
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth -= 1;
    }
  }

  return { jsonText: null as string | null, rest: buffer };
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
  // 验证成功后立即将用户输入写入数据库，便于会话记录与问题追踪
  // 读取 Grok 流式响应，累计文本并在每次收到 chunk 后尝试分句。
  try {
    // 尝试把用户输入写入消息表，便于后续会话追踪
    await prisma.conversationMessage.create({
      data: {
        id: randomUUID(),
        conversationId,
        role: ConversationMessageRole.USER,
        content,
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
  const userProfile = JSON.stringify(socket.data.userProfile ?? {});
  const systemPrompt = getToSpeechPrompt({
    running_summary: runningSummary,
    recent_messages: recentMessages,
    user_profile: userProfile,
  });

  const responseStream = await socket.data.llmClient.chat.completions.create({
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
        content,
      },
    ],
  });

  // 下面的状态变量用于积累助手的回答、维护 chunk 序号以及串行化 TTS 调用
  let assistantContent = "";
  let chunkIndex = 0;
  let firstChunkLogged = false;
  let pendingSentence = "";
  let ttsPipeline: Promise<void> = Promise.resolve();
  let pendingAction: string | null = null;
  let actionHandledByTts = false;
  // reply/json 是流式混合输出，需要拆分后分别处理
  let replyEnded = false;
  // replyBuffer 用于缓存未完全确认的文本，避免分隔符被拆段误判
  let replyBuffer = "";
  // 先输出的 JSON（只包含 damage_delta）需要缓冲拼接并提前解析
  let headJsonBuffer = "";
  let headJsonParsed = false;
  let damageDelta: number | null = null;
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

  try {
    // 遍历的流式响应，逐步构建助手回复并推送 chunk
    for await (const chunk of responseStream) {
      const delta = chunk.choices?.[0]?.delta;
      const deltaContent =
        typeof delta?.content === "string" ? delta.content : "";
      if (!deltaContent) {
        continue;
      }

      if (!firstChunkLogged) {
        firstChunkLogged = true;
      }

      chunkIndex += 1;
      console.log(headJsonParsed, 'headJsonParsed')
      if (!headJsonParsed) {
        // 先解析头部 JSON（仅包含 damage_delta），解析成功后才进入 reply 阶段
        headJsonBuffer += deltaContent;
        const { jsonText, rest } = extractFirstJson(headJsonBuffer);
        if (!jsonText) {
          continue;
        }
        try {
          const parsed = JSON.parse(jsonText) as Record<string, unknown>;
          const candidate = parsed.damage_delta || 0;
          if (typeof candidate === "number") {
            damageDelta = candidate;
            socket.data.roastBattleRound.score += candidate;
            socket.data.roastBattleRound!.roastCount += 1;
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
        console.log("Current roast battle score:", socket.data.roastBattleRound.score);
        try {
          if (socket.data.roastBattleRound!.score >= 100) {
            // 分数达到 100 则关闭对战功能，等待下一回合加载
            socket.data.roastBattleEnabled = false;
            // 达到胜利分数线，标记回合为胜利
            socket.data.roastBattleRound!.isWin = true;
            // 记录胜利时间
            socket.data.roastBattleRound!.wonAt = new Date();
            await updateRoastBattleRound( socket.data.roastBattleRound);
            // 向客户端发送胜利通知
            const victoryPayload = serializePayload({
              event: "roast-battle-victory",
              data: {
                clientId,
                conversationId,
                message: "恭喜你在吐槽对战中取得胜利！",
              },
            });
            socket.emit("message", victoryPayload);
            return true;
          }
        } catch (error) {
          console.error("textToSpeechChatFlow: 更新对战回合失败", error);
        }

        // 头部 JSON 解析完成后，剩余内容可能包含 reply 或分隔符
        if (rest) {
          handleReplyStream(rest);
        }
        continue;
      }

      handleReplyStream(deltaContent);
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
        message:
          error instanceof Error ? error.message : "未知的 Grok 流式响应异常",
      },
    });
    socket.emit("message", errorPayload);
    return false;
  }

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
      { role: "user", content, timestamp },
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
function extractCompletedSentences(text: string) {
  const sentences: string[] = [];
  let cursor = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (TTS_END_PUNCTUATIONS.test(text[index])) {
      // 遇到句尾标点就把从 cursor 到当前的片段作为一个完整句子
      const candidate = text.slice(cursor, index + 1).trim();
      if (candidate) {
        sentences.push(candidate);
      }
      cursor = index + 1;
    }
  }
  const remainder = text.slice(cursor);
  // 将最后剩余的未封装段落返回，用于下一次 chunk 拼接
  return {
    sentences,
    remainder,
  };
}

/**
 * 调用 Openspeech 的 TTS 接口并把流式音频 chunk 转成 base64 推送给客户端。
 */
async function streamSentenceToTts(params: {
  sentence: string;
  clientId: string;
  conversationId: string;
  socket: Socket;
  userId: string;
  action?: string;
  llmAction?: string;
  requestId: string;
  timestamp: number;
}) {
  const {
    sentence,
    clientId,
    conversationId,
    socket,
    userId,
    action,
    llmAction,
    requestId,
    timestamp,
  } = params;
  const sentenceId = randomUUID();

  // Openspeech 接口要求的认证头与资源 ID，避免硬编码的时机可通过环境变量替换
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Api-App-Id": "1383573066",
    "X-Api-Access-Key": "4QSc8Vtv1e9kZEUhE2gQeHAhFUHZjhsk",
    "X-Api-Resource-Id": "seed-tts-2.0",
    Connection: "keep-alive",
  };

  // 构建 TTS 请求体，携带可配置的参数以控制音色与采样率，并绑定当前用户识别信息
  const requestBody = {
    user: {
      id: userId,
    },
    req_params: {
      speaker: "zh_female_vv_uranus_bigtts", // 语音角色，可根据需求调整
      text: sentence,
      audio_params: {
        format: "pcm",
        sample_rate: 16000,
        // 情绪
        emotion_scale: 5,
        emotion: "angry",
        // 语速
        // speech_rate:50
      },
    },
  };

  const response = await fetch(
    "https://openspeech.bytedance.com/api/v3/tts/unidirectional",
    {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    }
  );

  // 确认 HTTP 级别返回成功，防止后续解析空数据
  if (!response.ok) {
    throw new Error(`TTS 请求失败：${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error("TTS 响应缺少 body");
  }

  // 首先通知客户端 TTS 流即将开始，方便前端初始化解码缓冲区与播放流水线，同时把动作信息补传
  const startData: Record<string, unknown> = {
    clientId,
    conversationId,
    sentenceId,
    sentence,
    timestamp: new Date().toISOString(),
    requestId,
    echoTimestamp: timestamp,
  };
  const actionField = llmAction ?? action;
  if (actionField) {
    // 在 TTS 音频开始事件中同步传递 LLM 本次回复的动作字段，避免客户端异步等待
    startData.action = actionField;
  }
  socket.emit(
    "message",
    serializePayload({
      event: "tts-audio-start",
      data: startData,
    })
  );

  // 获取流式响应 reader 以便逐个处理数据行，然后解码转换为字符串
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let chunkIndex = 0;
  let pendingText = "";
  let completionSignaled = false;

  // 用于确保只推一次 tts-audio-complete 事件
  const signalCompletion = () => {
    if (completionSignaled) {
      return;
    }
    completionSignaled = true;
    socket.emit(
      "message",
      serializePayload({
        event: "tts-audio-complete",
        data: {
          clientId,
          conversationId,
          sentenceId,
          sentence,
          chunkCount: chunkIndex,
          timestamp: new Date().toISOString(),
          requestId,
          echoTimestamp: timestamp,
        },
      })
    );
  };

  // 处理每一行响应文本，解析 JSON 后根据字段分别推送 chunk、sentence 以及完成事件
  const handlePayloadText = (payloadText: string) => {
    const trimmedPayload = payloadText.trim();
    if (!trimmedPayload) {
      return;
    }
    if (trimmedPayload === "[DONE]") {
      signalCompletion();
      return;
    }

    let parsed: {
      code?: number;
      message?: string;
      data?: string;
      sentence?: string;
    } | null = null;
    try {
      parsed = JSON.parse(trimmedPayload);
    } catch (error) {
      console.warn("textToSpeechChatFlow: 无法解析 TTS chunk", {
        clientId,
        conversationId,
        sentenceId,
        line: trimmedPayload,
        error,
      });
      return;
    }

    if (!parsed) {
      return;
    }
    // 如果 TTS 本身反馈非 0 错误码，则记录并跳过
    if (typeof parsed.code === "number" && parsed.code !== 0) {
      // console.warn("textToSpeechChatFlow: TTS 服务返回错误", {
      //   clientId,
      //   conversationId,
      //   sentenceId,
      //   code: parsed.code,
      //   message: parsed.message,
      // });
      return;
    }

    // 有音频数据就按 chunk 顺序广播给前端，保持播放流水线
    if (typeof parsed.data === "string" && parsed.data) {
      socket.emit(
        "message",
        serializePayload({
          event: "tts-audio-chunk",
          data: {
            clientId,
            conversationId,
            sentenceId,
            chunkIndex,
            base64: parsed.data,
            timestamp: new Date().toISOString(),
            requestId,
            echoTimestamp: timestamp,
          },
        })
      );
      chunkIndex += 1;
    }

    // 如果服务补充了一句完整话语，则通知前端句子内容
    if (typeof parsed.sentence === "string" && parsed.sentence) {
      socket.emit(
        "message",
        serializePayload({
          event: "tts-audio-sentence",
          data: {
            clientId,
            conversationId,
            sentenceId,
            sentence: parsed.sentence,
            timestamp: new Date().toISOString(),
          },
        })
      );
    }
  };

  try {
    // 循环读取每个 chunk，当 done 时跳出
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (!value || !value.length) {
        continue;
      }

      pendingText += decoder.decode(value, { stream: true });
      let newlineIndex = pendingText.indexOf("\n");
      // 遇到换行说明接收到一整行 SSE 数据，逐行处理
      while (newlineIndex !== -1) {
        const rawLine = pendingText.slice(0, newlineIndex);
        pendingText = pendingText.slice(newlineIndex + 1);
        const trimmed = rawLine.trim();
        if (trimmed.startsWith("data:")) {
          handlePayloadText(trimmed.slice(5));
        } else {
          handlePayloadText(trimmed);
        }
        newlineIndex = pendingText.indexOf("\n");
      }
    }

    if (pendingText.trim()) {
      // 处理最后残留的一行数据，防止因没有换行而遗漏
      handlePayloadText(pendingText);
    }
    // 最终确保发送完成事件通知客户端
    signalCompletion();
  } finally {
    // 无论成功与否都要释放 reader 锁，避免泄露资源
    reader.releaseLock();
  }
}
