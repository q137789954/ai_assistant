import React, { useEffect, useState, useContext, useCallback } from "react";
import { Textarea } from "@/app/components/ui";
import { useWebSocketContext } from "@/app/providers/WebSocketProviders";
import { useTtsAudioPlayerContext } from "@/app/providers/TtsAudioPlayerProvider";
import { VoiceInputToggle } from "@/app/components/features";
import { GlobalsContext } from "@/app/providers/GlobalsProviders";

const AvatarCommandInput = ({
  updatePenguinCounter,
  disabled = false,
}: {
  updatePenguinCounter: (items: string[]) => void;
  disabled?: boolean;
}) => {
  const [input, setInput] = useState("");
  const { emitEvent, subscribe } = useWebSocketContext();
  const { stopTtsPlayback } = useTtsAudioPlayerContext();

  const globals = useContext(GlobalsContext);
  const { dispatch } = globals ?? {};

  // 通过音频与动画控制钩子提前抢占现有播放资源，防止新指令与旧音频冲突

  const handleSubmit = useCallback((overrideText?: string) => {
    if (disabled) {
      return;
    }
    console.log(new Date(), '发送文本')
    // 如果传入了 ASR 文本则优先使用，否则回退到输入框内容
    const rawText =
      typeof overrideText === "string" ? overrideText : input;
    const trimmed = rawText.trim();
    if (!trimmed) {
      return;
    }
    const timestampWatermark = Date.now();
    if (dispatch) {
      dispatch({
        type: "SET_TIMESTAMP_WATERMARK",
        payload: timestampWatermark,
      });
    }
    // 发送新指令前重置语音播放与视频帧
    stopTtsPlayback();

    // 构建消息元数据，包含唯一 ID 及格式要求
    const messageMeta = {
      requestId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      sampleRate: 16000,
      content: trimmed,
      timestamp: timestampWatermark,
      outputFormat: "speech",
      inputFormat: "text",
    };
    const sent = emitEvent("chat:input", messageMeta);
    if (!sent) {
      console.warn("消息发送失败，请检查 WebSocket 连接状态");
    }
    setInput("");
    updatePenguinCounter([])
  }, [disabled, dispatch, emitEvent, input, stopTtsPlayback, updatePenguinCounter]);

  useEffect(() => {
    // 订阅 WebSocket 消息，当聊天抽屉打开时接收助手回应
    const unsubscribe = subscribe((event) => {
      if (typeof event.data !== "string") {
        return;
      }

      let parsed: { event?: string; data?: unknown } | null =
        null;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }

      if (!parsed?.event) {
        return;
      }

      const payloadData = parsed.data ?? {};

      // 打印错误日志，方便排查接口异常
      if (parsed.event === "chat-response-error") {
        console.error("助手响应错误：", payloadData.message);
      }

      // 收到 ASR 最终结果后，直接触发发送逻辑（内容来自 ASR 而不是输入框）
      if (parsed.event === "asr:result") {
        const asrText =
          typeof payloadData === "string"
            ? payloadData
            : String(payloadData ?? "");
        handleSubmit(asrText);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [handleSubmit, subscribe]);

  const handleTextareaKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    // 按下 Enter 且未按住 Shift 时提交，避免默认换行行为
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="w-full flex gap-1 items-center">
      <Textarea
        className="h-11! rounded-full! border-none! resize-none! bg-black/5 backdrop-blur-lg! shadow-none!"
        placeholder="请输入指令"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleTextareaKeyDown}
        disabled={disabled}
      />
      <VoiceInputToggle disabled={disabled} />
      <div
        className={`flex items-center justify-center h-10! w-10! rounded-full! p-0! shrink-0 bg-[rgb(204,255,0)] text-black text-sm ${
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
        }`}
        onClick={handleSubmit}
        aria-disabled={disabled}
      >
        ➤
      </div>
    </div>
  );
};

export default AvatarCommandInput;
