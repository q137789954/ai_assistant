import { randomUUID } from "crypto";
import { Socket } from "socket.io";
import { serializePayload } from "../../utils";


export type TtsEmotion = "sad" | "happy" | "angry";


/**
 * 调用 OpenAI 的 gpt-4o-mini-tts 接口并把流式音频 chunk 转成 base64 推送给客户端。
 */
export async function streamSentenceToTts(params: {
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
    action,
    llmAction,
    requestId,
    timestamp,
  } = params;
  const sentenceId = randomUUID();
  console.log(sentence, 'sentence')

  // OpenAI TTS 需要使用 API Key 鉴权，避免未配置时导致难以定位的问题
  const apiKey ='sk-2tF2rqxA6OHRB25Qca5sdRWaZCJ6EQTei2qbtfQBEFEIC5e9';
  if (!apiKey) {
    throw new Error("TTS 请求失败：缺少 OPENAI_API_KEY");
  }

  const actionField = llmAction ?? action;
  console.log(llmAction, 'llmAction')
  console.log(action, 'action')

  // 允许通过环境变量覆盖 OpenAI 端点，便于在代理或私有网关场景复用
  const baseUrl = "https://oricreate.org";
  const ttsUrl = `${baseUrl.replace(/\/$/, "")}/v1/audio/speech`;
  const voice = 'onyx';

  // 构建 TTS 请求体，指定 gpt-4o-mini-tts 与 PCM 输出，确保前端可直接解码
  const requestBody = {
    model: "tts-1",
    input: sentence,
    // 语气的描述
    // instructions:"Speak in a cheerful and positive tone.",
    voice,
    response_format: "pcm",
    // 期望输出为 24k PCM，用于提升音质（需确保前端播放链路支持 24k）
    sample_rate: 24000,
  };

  const response = await fetch(ttsUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

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
    format: "pcm",
    timestamp: new Date().toISOString(),
    requestId,
    echoTimestamp: timestamp,
  };
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

  // 直接通知前端当前句子内容，避免依赖服务端回传的 sentence 字段
  socket.emit(
    "message",
    serializePayload({
      event: "tts-audio-sentence",
      data: {
        clientId,
        conversationId,
        sentenceId,
        sentence,
        timestamp: new Date().toISOString(),
      },
    })
  );

  // 获取流式响应 reader 以便逐个读取二进制音频数据
  const reader = response.body.getReader();
  let chunkIndex = 0;
  let completionSignaled = false;
  // PCM 16-bit 解码需要偶数字节对齐，缓存可能出现的单字节尾巴
  let pendingByte: Uint8Array | null = null;

  // 用于确保只推一次 tts-audio-complete 事件
  const signalCompletion = () => {
    if (completionSignaled) {
      return;
    }
    completionSignaled = true;
    console.log('发送了 tts-audio-complete', requestId)
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

  try {
    // 循环读取每个 chunk，当 done 时跳出并发送完成事件
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (!value || !value.length) {
        continue;
      }
      // 合并上一轮残留的单字节，确保当前块按 16-bit 采样边界对齐
      let alignedChunk = value;
      if (pendingByte) {
        const merged = new Uint8Array(pendingByte.length + value.length);
        merged.set(pendingByte, 0);
        merged.set(value, pendingByte.length);
        alignedChunk = merged;
        pendingByte = null;
      }

      // 如果仍为奇数字节，保留最后 1 字节，下一轮拼接再发送
      if (alignedChunk.length % 2 === 1) {
        pendingByte = alignedChunk.slice(alignedChunk.length - 1);
        alignedChunk = alignedChunk.slice(0, alignedChunk.length - 1);
      }

      if (!alignedChunk.length) {
        continue;
      }

      // 将二进制音频数据转成 base64，透传给前端解码
      const base64 = Buffer.from(alignedChunk).toString("base64");
      socket.emit(
        "message",
        serializePayload({
          event: "tts-audio-chunk",
          data: {
            clientId,
            conversationId,
            sentenceId,
            chunkIndex,
            base64,
            timestamp: new Date().toISOString(),
            requestId,
            echoTimestamp: timestamp,
          },
        })
      );
      chunkIndex += 1;
    }

    if (pendingByte) {
      // 流结束仍有单字节残留，丢弃以避免前端解码错位
      console.warn("ttsStreamSender: 丢弃未对齐的 PCM 尾字节", {
        clientId,
        conversationId,
        sentenceId,
        byte: pendingByte[0],
      });
      pendingByte = null;
    }

    // 最终确保发送完成事件通知客户端
    signalCompletion();
  } finally {
    // 无论成功与否都要释放 reader 锁，避免泄露资源
    reader.releaseLock();
  }
}
