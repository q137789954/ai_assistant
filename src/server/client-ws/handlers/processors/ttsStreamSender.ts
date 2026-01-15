import { randomUUID } from "crypto";
import { Socket } from "socket.io";
import { serializePayload } from "../../utils";

/**
 * 调用 Openspeech 的 TTS 接口并把流式音频 chunk 转成 base64 推送给客户端。
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
  console.log(llmAction, 'llmAction')
  console.log(action, 'action')
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
