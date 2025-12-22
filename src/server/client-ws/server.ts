import http, { type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { Server, type Socket } from "socket.io";
import { getToken } from "next-auth/jwt";
import { queueVoiceSegment } from "./audio";
import { cleanupClient, handleClientMessage, sendJoinNotifications } from "./clientLifecycle";
import { handleChatInput } from "./handlers/chatInput";
import { ChatInputPayload } from "./types";
import OpenAI from "openai";
import { closeAsrConnection, initializeAsrConnection } from "./asrConnection";

/**
 * 支持环境变量覆盖端口与 CORS，确保在不同部署中一致。
 */
const PORT = Number(process.env.SOCKET_SERVER_PORT) || 4000;
const CORS_ORIGIN = process.env.SOCKET_SERVER_CORS_ORIGIN || "*";
/**
 * 只有在指定了明确的跨域源时才允许凭证，避免使用 `*` 时违反浏览器策略。
 */
const ALLOW_CREDENTIALS = CORS_ORIGIN !== "*";
const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "";

/**
 * 从握手请求携带的 cookie 字符串中提取键值对，供 next-auth JWT 验证时使用。
 * 这样即使原始请求没有自动解析 cookie，也能通过 headers 明确提供给 getToken。
 */
const parseCookieHeader = (cookieHeader?: string): Partial<Record<string, string>> => {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) {
    return cookies;
  }

  for (const entry of cookieHeader.split(";")) {
    const [rawName, ...rest] = entry.split("=");
    const name = rawName?.trim();
    if (!name) {
      continue;
    }

    cookies[name] = rest.join("=").trim();
  }

  return cookies;
};

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
    credentials: ALLOW_CREDENTIALS,
  },
  transports: ["websocket"],
});

/**
 * 在握手阶段使用 next-auth 的 JWT 校验，未登录直接拒绝连接。
 */
io.use(async (socket, next) => {
  if (!NEXTAUTH_SECRET) {
    next(new Error("socketIOServer: 缺失 NEXTAUTH_SECRET"));
    return;
  }

  try {
    const handshakeReq = socket.request as IncomingMessage & {
      cookies: Partial<Record<string, string>>;
    };
    // next-auth 需要 req 带有 cookies，在握手阶段补齐以满足类型校验
    handshakeReq.cookies = {
      ...(handshakeReq.cookies ?? {}),
      ...parseCookieHeader(socket.request.headers.cookie),
    };
    const token = await getToken({
      req: handshakeReq,
      secret: NEXTAUTH_SECRET,
      secureCookie: process.env.NODE_ENV === "production",
    });

    const userId = token?.sub;
    if (!userId) {
      throw new Error("socketIOServer: 未登录");
    }

    socket.data.userId = userId;
    next();
  } catch (error) {
    next(new Error("socketIOServer: 未授权"));
  }
});

/**
 * 当前活跃客户端映射，方便广播和统计。
 */
const clients = new Map<string, Socket>();

/**
 * 每个连接对应的对话 ID，便于追踪本次 WebSocket 会话以及后续的消息上下文。
 */
const clientConversations = new Map<string, string>();

/**
 * 每当新的连接建立则注册各类事件。
 */
io.on("connection", (socket) => {
  const clientId = randomUUID();
  const conversationId = randomUUID();
  const userId = socket.data.userId as string;
  clients.set(clientId, socket);
  clientConversations.set(clientId, conversationId);
  sendJoinNotifications(clientId, clients);
  // 每个客户端连接时主动创建对应的 ASR WebSocket，后续语音片段将通过该通道转发
  const asrSocket = initializeAsrConnection(socket);

  const llmClient = new OpenAI({
    apiKey: process.env.GROKKINGAI_API_KEY?.trim(),
    baseURL: "https://api.x.ai/v1",
    timeout: 360000, // Override default timeout with longer timeout for reasoning models
  });

  socket.data.llmClient = llmClient;

  socket.on("message", (payload) => {
    handleClientMessage(clientId, conversationId, userId, io, payload);
  });

  socket.on("chat:input", (payload: ChatInputPayload) => {
    handleChatInput(clientId, conversationId, userId, socket, payload, io, asrSocket);
  });
  
  socket.on("disconnect", (reason) => {
    closeAsrConnection(socket);
    clientConversations.delete(clientId);
    cleanupClient(clientId, clients, io);
  });

  socket.on("error", (error) => {
    closeAsrConnection(socket);
    clientConversations.delete(clientId);
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
