import { type Socket } from "socket.io";

interface speechChatFlowParams {
  clientId: string;
  conversationId: string;
  userId: string;
  socket: Socket;
  content: Float32Array;
  chunkId: string | undefined;
  type: string;
}

/** 语音结束后等待的间隔时间，单位毫秒，只有在此期间未收到新片段才算真正结束 */
const END_SETTLEMENT_WINDOW_MS = 200;

export const processSpeechToSpeechChatFlow = async (params: speechChatFlowParams) => {
  const { socket, content, chunkId, type } = params;

  /**
   * 语音结束命令需要等待一个短暂的“结算窗”：客户端可能在发送 end 标志后仍然上传残留数据，
   * 所以只有当 200ms 内都没有新内容到来时才真正通知第三方结束，避免过早关闭流式会话。
   */
  if (type === "end") {
    console.log("用户语音输入结束");
    const previousTimer = socket.data.asrEndTimer as ReturnType<typeof setTimeout> | undefined;
    if (previousTimer) {
      clearTimeout(previousTimer);
    }

    socket.data.asrEndTimer = setTimeout(() => {
      const payload = JSON.stringify({
        type: "end",
      });
      console.log("发送 ASR 结束命令：", payload);
      socket.data.asrSocket.send(payload);
      socket.data.asrEndTimer = undefined;
    }, END_SETTLEMENT_WINDOW_MS);

    return true;
  }

  /**
   * 收到新音频片段时一定要取消持续挂起的结算定时器，避免在新内容后仍旧触发结束命令。
   */
  const pendingTimer = socket.data.asrEndTimer as ReturnType<typeof setTimeout> | undefined;
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    socket.data.asrEndTimer = undefined;
  }

  const payload = JSON.stringify({
    type: "audio",
    data: content,
    sample_rate: 16000,
    chunk_id: chunkId,
  });
  socket.data.asrSocket.send(payload);

  return true;
};
