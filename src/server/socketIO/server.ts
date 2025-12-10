import http from "node:http";
import { randomUUID } from "node:crypto";
import { Server, type Socket } from "socket.io";
import { queueVoiceSegment } from "./audio";
import { cleanupClient, handleClientMessage, sendJoinNotifications } from "./clientLifecycle";

/**
 * 支持环境变量覆盖端口与 CORS，确保在不同部署中一致。
 */
const PORT = Number(process.env.SOCKET_SERVER_PORT) || 4000;
const CORS_ORIGIN = process.env.SOCKET_SERVER_CORS_ORIGIN || "*";

/**
 * HTTP 服务器仅用于 Socket.IO 的握手，所有 WebSocket 请求都由 socket.io 收到。
 */
const httpServer = http.createServer();

/**
 * 基于 WebSocket 的 socket.io 实例，禁用轮询以减少延迟。
 */
export const io = new Server(httpServer, {
  cors: {
    origin: CORS_ORIGIN,
  },
  transports: ["websocket"],
});

/**
 * 当前活跃客户端映射，方便广播和统计。
 */
const clients = new Map<string, Socket>();

/**
 * 每当新的连接建立则注册各类事件。
 */
io.on("connection", (socket) => {
  const clientId = randomUUID();
  clients.set(clientId, socket);

  console.debug("socketIOServer: 新客户端连接", {
    clientId,
    activeClients: clients.size,
  });

  sendJoinNotifications(clientId, clients);

  socket.on("message", (payload) => {
    handleClientMessage(clientId, io, payload);
  });

  socket.on("voice-chunk", (meta, audio) => {
    queueVoiceSegment(clientId, socket, meta, audio);
  });

  socket.on("disconnect", (reason) => {
    console.debug("socketIOServer: 客户端断开连接", { clientId, reason });
    cleanupClient(clientId, clients, io);
  });

  socket.on("error", (error) => {
    console.error("socketIOServer: 连接错误", { clientId, error });
    cleanupClient(clientId, clients, io);
  });
});

/**
 * 启动 HTTP 服务并监听端口。
 */
export const startSocketServer = () => {
  httpServer.listen(PORT, () => {
    console.info(`socketIOServer: 正在监听端口 ${PORT}，允许的 CORS 源为 ${CORS_ORIGIN}`);
  });
};

/**
 * 优雅关闭 socket.io 与 HTTP 服务。
 */
const shutdown = () => {
  console.info("socketIOServer: 收到退出信号，正在关闭服务...");
  io.close();
  httpServer.close(() => {
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
