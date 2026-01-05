import { Socket } from "socket.io";
import { randomUUID } from "crypto";
import { ConversationMessageRole } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { irritablePrompt } from "@/server/llm/prompt";
import { serializePayload } from "../../utils";
import { compressClientConversations } from '../clientConversationsProcessors';

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
  console.log(timestamp, 'timestamp');
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
    console.log('尝试把用户输入写入消息表');
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
  // 复用当前 socket 中的历史对话上下文以便生成连续的 Chat 结果
  const chatHistory = Array.isArray(socket.data.clientConversations)
    ? socket.data.clientConversations
    : [];

    const chatHistorySummary = socket.data.chatHistorySummary;
    if (chatHistorySummary) {
      // 如果存在历史摘要，则将其作为系统提示的一部分传入
      chatHistory.unshift({
        role: "system",
        content: `这是此前的对话摘要，请在新的摘要中延续其关键信息：${chatHistorySummary}`,
      });
    }

  const responseStream = await socket.data.llmClient.chat.completions.create({
    model: "grok-4-fast-non-reasoning",
    // model: "qwen-turbo",
    stream: true, // 开启流式返回以便后续使用 for-await 读取每个 chunk
    messages: [
      {
        role: "system",
        content: irritablePrompt.systemPrompt,
      },
      ...chatHistory,
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

      assistantContent += deltaContent;
      chunkIndex += 1;
      // 把当前 chunk 和上一轮未完成的片段拼接，提取出已经完整的句子
      const combinedText = pendingSentence + deltaContent;
      const { sanitized, action } = stripActionMarker(combinedText);
      if (action && !pendingAction) {
        pendingAction = action;
      }
      const { sentences, remainder } = extractCompletedSentences(sanitized);
      pendingSentence = remainder;
      sentences.forEach(enqueueSentence);
    }

    if (pendingSentence.trim()) {
      // 循环结束后如果还有残留片段，也需要转换为语音
      enqueueSentence(pendingSentence);
      pendingSentence = "";
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
      console.log('尝试把助手回复写入消息表');
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
      { role: "assistant", content: assistantContent, timestamp: assistantTimestamp }
    );
    if (socket.data.clientConversations.length >= 20) {
      compressClientConversations({
        socket
      })
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
        emotion_scale:5,
        emotion:'angry',
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
