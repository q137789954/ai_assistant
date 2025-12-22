import type { Socket } from "socket.io";
import WebSocket from "ws";
import { processTextToSpeechChatFlow } from "./handlers/processors/textToSpeechChatFlow.js";

/**
 * 默认 ASR 服务地址，可通过环境变量覆盖，方便不同部署环境切换。
 */
const ASR_WS_ENDPOINT = process.env.ASR_WS_ENDPOINT?.trim() || "ws://192.168.3.88:8000/ws/asr";
const HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * 在某个 socket 连接中初始化与 ASR 服务的 WebSocket 连接，后续通过该连接进行语音片段传输或结果转发。
 */
export const initializeAsrConnection = (socket: Socket) => {
  const asrSocket = new WebSocket(ASR_WS_ENDPOINT);
  socket.data.asrSocket = asrSocket;

  const heartbeat = setInterval(() => {
    if (asrSocket.readyState === WebSocket.OPEN) {
      asrSocket.send(JSON.stringify({ type: "ping" }));
    }
  }, HEARTBEAT_INTERVAL_MS);
  socket.data.asrHeartbeat = heartbeat;

  asrSocket.on("open", () => {
    console.log("ASR WebSocket 连接已建立，准备接收语音片段");
  });

  asrSocket.on("message", (rawData) => {

    let parsedPayload: unknown = rawData;
    try {
      parsedPayload = JSON.parse(rawData);
    } catch {
      parsedPayload = rawData;
    }

    console.log("收到 ASR 服务返回的消息：", parsedPayload);
    const { type, is_final } = parsedPayload || {};
    if( type === "result") {
      if(is_final === true) {
        console.log(socket.data, 'socket.data---asrConnection')
        processTextToSpeechChatFlow({
          clientId: socket.id,
          conversationId: socket.data.conversationId,
          userId: socket.data.userId,
          socket,
          content: parsedPayload.text,
        });
      }
      return;
    }
  });

  asrSocket.on("close", (code, reason) => {
    console.log("ASR WebSocket 连接已关闭", code, reason);
  });

  asrSocket.on("error", (error) => {
    console.error("ASR WebSocket 连接发生错误", error);
  });

  return asrSocket;
};

/**
 * 安全地关闭已经绑定在 socket 上的 ASR 连接，并移除引用，避免重复发送或内存泄漏。
 */
export const closeAsrConnection = (socket: Socket) => {
  const asrSocket = socket.data.asrSocket as WebSocket | undefined;
  if (!asrSocket) {
    return;
  }

  const heartbeat = socket.data.asrHeartbeat as ReturnType<typeof setInterval> | undefined;
  if (heartbeat) {
    clearInterval(heartbeat);
    socket.data.asrHeartbeat = undefined;
  }

  socket.data.asrSocket = undefined;

  if (asrSocket.readyState === WebSocket.OPEN || asrSocket.readyState === WebSocket.CONNECTING) {
    asrSocket.close();
  }
};
