import { Buffer } from "node:buffer";
import { Socket } from "socket.io";
import { randomUUID } from "crypto";
import { ConversationMessageRole } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { irritablePrompt } from "@/server/llm/prompt";
import { serializePayload } from "../../utils";

interface textToSpeechChatFlowParams {
  clientId: string;
  conversationId: string;
  userId: string;
  socket: Socket;
  content: unknown;
}

/**
 * 将环境变量的字符串值解析成数字，若解析失败则退回默认值，避免 NaN 垫高后续逻辑。
 */
const parseNumberWithFallback = (
  value: string | undefined,
  fallback: number
) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const TTS_API_URL =
  process.env.OPENSPEECH_TTS_URL ??
  "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
const TTS_API_KEY = process.env.OPENSPEECH_API_KEY ?? "";
const TTS_VOICE = process.env.OPENSPEECH_TTS_VOICE ?? "alloy";
const TTS_AUDIO_FORMAT = process.env.OPENSPEECH_TTS_FORMAT ?? "wav";
const TTS_SAMPLE_RATE = parseNumberWithFallback(
  process.env.OPENSPEECH_TTS_SAMPLE_RATE,
  24000
);
const TTS_SPEED = parseNumberWithFallback(process.env.OPENSPEECH_TTS_SPEED, 1);
const TTS_PITCH = parseNumberWithFallback(process.env.OPENSPEECH_TTS_PITCH, 1);
const TTS_VOLUME = parseNumberWithFallback(
  process.env.OPENSPEECH_TTS_VOLUME,
  1
);
const TTS_END_PUNCTUATIONS = /[。！？!?]/;

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
}: textToSpeechChatFlowParams): Promise<boolean> => {
    console.log("textToSpeechChatFlow: 开始处理文本到语音的聊天流程", {
        clientId,
        conversationId,
        userId,
        content,
    });
  // 只有字符串才能写入文本列，先做类型校验以防异常
  if (typeof content !== "string") {
    console.error("textChatFlow: 收到的文本内容非法，要求字符串", {
      clientId,
      conversationId,
      content,
    });
    return false;
  }
  const startTime = Date.now();
  console.log("textToSpeechChatFlow: 准备写库并处理流式响应（Grok + TTS）", {
    clientId,
    conversationId,
  });
  // 读取 Grok 流式响应，累计文本并在每次收到 chunk 后尝试分句。
  try {
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
    console.log("textToSpeechChatFlow: 用户输入落库完成", {
      clientId,
      conversationId,
    });
  } catch (error) {
    console.error("textToSpeechChatFlow: 存储用户输入失败", {
      clientId,
      conversationId,
      error,
    });
  }

  console.log("textToSpeechChatFlow: 已发起 Grok 流式生成请求");
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
  let pendingSentence = "";
  let ttsPipeline: Promise<void> = Promise.resolve();

  // 通过 Promise 链把所有需要转换的句子串行化，避免 TTS 请求并发导致顺序错乱。
  const enqueueSentence = (sentence: string) => {
    const normalized = sentence.trim();
    if (!normalized) {
      return;
    }

    console.log("textToSpeechChatFlow: 准备发送句子到 TTS 队列", {
      clientId,
      conversationId,
      sentence: normalized,
    });

    ttsPipeline = ttsPipeline
      .then(() =>
        streamSentenceToTts({
          sentence: normalized,
          clientId,
          conversationId,
          socket,
          userId,
        })
      )
      .catch((error) => {
        console.error("textToSpeechChatFlow: TTS 服务处理失败", {
          clientId,
          conversationId,
          sentence: normalized,
          error,
        });
        const errorPayload = serializePayload({
          event: "tts-error",
          data: {
            clientId,
            conversationId,
            sentence: normalized,
            message: error instanceof Error ? error.message : "未知的 TTS 异常",
          },
        });
        socket.emit("message", errorPayload);
      });
  };

  try {
    for await (const chunk of responseStream) {
      const delta = chunk.choices?.[0]?.delta;
      const deltaContent =
        typeof delta?.content === "string" ? delta.content : "";
      if (!deltaContent) {
        continue;
      }

      console.log("textToSpeechChatFlow: 收到 Grok chunk", {
        clientId,
        conversationId,
        deltaContent,
      });

      if (!firstChunkLogged) {
        console.log(
          "textToSpeechChatFlow: 收到第一个 chunk，耗时 (ms)",
          Date.now() - startTime
        );
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

      const { sentences, remainder } = extractCompletedSentences(
        pendingSentence + deltaContent
      );
      pendingSentence = remainder;
      sentences.forEach(enqueueSentence);
    }

    if (pendingSentence.trim()) {
      console.log("textToSpeechChatFlow: 处理剩余未闭合句子", {
        clientId,
        conversationId,
        pendingSentence,
      });
      enqueueSentence(pendingSentence);
      pendingSentence = "";
    }

    await ttsPipeline;
    console.log("textToSpeechChatFlow: 所有句子 TTS 处理完毕", {
      clientId,
      conversationId,
    });
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
      console.error("textToSpeechChatFlow: 存储助手回复时出错", {
        clientId,
        conversationId,
        error,
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
      const candidate = text.slice(cursor, index + 1).trim();
      if (candidate) {
        sentences.push(candidate);
      }
      cursor = index + 1;
    }
  }
  const remainder = text.slice(cursor);
  console.log("textToSpeechChatFlow: 分句结果", {
    sentences,
    remainder,
  });
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
}) {
  const { sentence, clientId, conversationId, socket, userId } = params;
  const sentenceId = randomUUID();

  // 构建 TTS 请求体，携带可配置的参数以控制音色与采样率。
  const requestBody = {
    user:{
        id: userId,
    },
    req_params:{
        speaker: sentence,
        audio_params: {
        format: "mp3",
        sample_rate: 24000,
        },
    },
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Api-App-Id": "1383573066",
    "X-Api-Access-Key": "4QSc8Vtv1e9kZEUhE2gQeHAhFUHZjhsk",
    "X-Api-Resource-Id": "seed-tts-1.0",
  };

  console.log("textToSpeechChatFlow: 发起 Openspeech TTS 请求", {
    clientId,
    conversationId,
    sentenceId,
    sentence,
  });
  const response = await fetch(TTS_API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw new Error(`TTS 请求失败：${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error("TTS 响应缺少 body");
  }

  // 首先通知客户端 TTS 流即将开始，方便前端初始化解码缓冲区。
  socket.emit(
    "message",
    serializePayload({
      event: "tts-audio-start",
      data: {
        clientId,
        conversationId,
        sentenceId,
        sentence,
        sampleRate: TTS_SAMPLE_RATE,
        format: TTS_AUDIO_FORMAT,
        voice: TTS_VOICE,
        timestamp: new Date().toISOString(),
      },
    })
  );

  const reader = response.body.getReader();
  let chunkIndex = 0;

  // 逐个读取流式数据，并立即发送 base64 chunk 给客户端。
  try {
    while (true) {
      const { value, done } = await reader.read();
      console.log("textToSpeechChatFlow: 读取 TTS 流式 chunk", {
        clientId,
        conversationId,
        sentenceId,
        length: value?.length ?? 0,
        done,
        value
      });
      if (done) {
        break;
      }
      if (!value || !value.length) {
        continue;
      }

      socket.emit(
        "message",
        serializePayload({
          event: "tts-audio-chunk",
          data: {
            clientId,
            conversationId,
            sentenceId,
            chunkIndex,
            base64: Buffer.from(value).toString("base64"),
            sampleRate: TTS_SAMPLE_RATE,
            format: TTS_AUDIO_FORMAT,
            voice: TTS_VOICE,
            timestamp: new Date().toISOString(),
          },
        })
      );
      chunkIndex += 1;
      console.log("textToSpeechChatFlow: TTS chunk 推送", {
        clientId,
        conversationId,
        sentenceId,
        chunkIndex,
      });
    }

    // 发送读取完毕信号，方便客户端做播放收尾或切换下一个句子。
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
        },
      })
    );
    console.log("textToSpeechChatFlow: TTS 句子完成", {
      clientId,
      conversationId,
      sentenceId,
      chunkCount: chunkIndex,
    });
  } finally {
    reader.releaseLock();
  }
}
