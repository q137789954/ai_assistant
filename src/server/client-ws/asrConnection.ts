import { Buffer } from "node:buffer";
import type { Socket } from "socket.io";
import WebSocket, { type RawData } from "ws";
import { serializePayload } from "./utils";

/**
 * 默认 ASR 服务地址，可通过环境变量覆盖，方便不同部署环境切换。
 */
const ASR_WS_ENDPOINT = process.env.ASR_WS_ENDPOINT?.trim() || "ws://192.168.3.88:8000/ws/asr";

/**
 * 在某个 socket 连接中初始化与 ASR 服务的 WebSocket 连接，后续通过该连接进行语音片段传输或结果转发。
 */
export const initializeAsrConnection = (socket: Socket) => {
  const asrSocket = new WebSocket(ASR_WS_ENDPOINT);
  socket.data.asrSocket = asrSocket;

  asrSocket.on("open", () => {
    socket.emit(
      "message",
      serializePayload({
        event: "asr:connected",
        data: {
          endpoint: ASR_WS_ENDPOINT,
          ts: new Date().toISOString(),
        },
      }),
    );
  });

  asrSocket.on("message", (rawData: RawData) => {
    const payload =
      typeof rawData === "string"
        ? rawData
        : Array.isArray(rawData)
        ? Buffer.concat(rawData).toString("utf-8")
        : Buffer.from(rawData).toString("utf-8");

    socket.emit(
      "message",
      serializePayload({
        event: "asr:message",
        data: {
          clientId: socket.data.userId ?? socket.id,
          payload,
          ts: new Date().toISOString(),
        },
      }),
    );
  });

  asrSocket.on("close", (code, reason) => {
    socket.emit(
      "message",
      serializePayload({
        event: "asr:closed",
        data: {
          clientId: socket.data.userId ?? socket.id,
          code,
          reason: reason?.toString() ?? "unknown",
          ts: new Date().toISOString(),
        },
      }),
    );
  });

  asrSocket.on("error", (error) => {
    socket.emit(
      "message",
      serializePayload({
        event: "asr:error",
        data: {
          clientId: socket.data.userId ?? socket.id,
          message: error?.message ?? "unknown",
          ts: new Date().toISOString(),
        },
      }),
    );
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

  socket.data.asrSocket = undefined;

  if (asrSocket.readyState === WebSocket.OPEN || asrSocket.readyState === WebSocket.CONNECTING) {
    asrSocket.close();
  }
};
