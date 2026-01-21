import type { Socket } from "socket.io";
import WebSocket from "ws";
import { serializePayload } from "@/server/client-ws/utils";

/**
 * 默认 ASR 服务地址，可通过环境变量覆盖，方便不同部署环境切换。
 */
const ASR_WS_ENDPOINT = process.env.ASR_WS_ENDPOINT?.trim() || "ws://13.192.162.164:6000/ws";

/**
 * 在某个 socket 连接中初始化与 ASR 服务的 WebSocket 连接，后续通过该连接进行语音片段传输或结果转发。
 */
export const initializeAsrConnection = (socket: Socket) => {
  const asrSocket = new WebSocket(ASR_WS_ENDPOINT, {
    perMessageDeflate: false,
  });
  socket.data.asrSocket = asrSocket;

  asrSocket.on("open", () => {
    console.log("ASR WebSocket 连接已建立，准备接收语音片段");
  });

  asrSocket.on("message", (buf:Buffer) => {

    try {
      const str = buf.toString('utf8');   // 变成 JSON 字符串
      const data = JSON.parse(str);
      const { text, type } = data || {};
      switch (type) {
        case 'final':
          socket.emit(
              "message",
              serializePayload({
                event: "asr:result",
                data: text,
              })
            );
          break;
      
        default:
          break;
      }

    } catch (error) {
      console.log(error)
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

  // 已进入关闭流程或已关闭时不再重复调用 close
  if (
    asrSocket.readyState === WebSocket.CLOSING ||
    asrSocket.readyState === WebSocket.CLOSED
  ) {
    socket.data.asrSocket = undefined;
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
