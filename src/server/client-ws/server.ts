import http, { type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { Server, type Socket } from "socket.io";
import { getToken } from "next-auth/jwt";
import { cleanupClient, handleClientMessage, sendJoinNotifications } from "./clientLifecycle";
import { handleChatInput } from "./handlers/chatInput";
import { ChatInputPayload } from "./types";
import OpenAI from "openai";
import { closeAsrConnection, initializeAsrConnection } from "./asrConnection";
import { updateUserProfileOnDisconnect } from "./handlers/userProfileUpdater";
import { compressClientConversations } from "./handlers/clientConversationsProcessors";
import { loadUserContextOnConnect } from "./handlers/userContextLoader";
import {
  emitRoastBattleRoundSnapshot,
  loadRoastBattleRoundOnConnect,
} from "./handlers/roastBattleRoundLoader";

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
 * 生成本地日期键（YYYY-MM-DD），用于记录需要更新画像的日期。
 */
const getDayKey = (timestamp: number): string => {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/**
 * 记录 chat:input 发生的日期，同一天只记录一次。
 */
const recordUserProfileUpdateDay = (socket: Socket, timestamp: number) => {
  const safeTimestamp = Number.isFinite(timestamp) ? timestamp : Date.now();
  const dayKey = getDayKey(safeTimestamp);
  if (!Array.isArray(socket.data.userProfileUpdateDays)) {
    socket.data.userProfileUpdateDays = [];
  }
  if (!socket.data.userProfileUpdateDays.includes(dayKey)) {
    socket.data.userProfileUpdateDays.push(dayKey);
  }
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
 * 每当新的连接建立则注册各类事件。
 */
io.on("connection", async (socket) => {
  const clientId = randomUUID();
  const conversationId = randomUUID();
  // 把本次会话的 conversationId 暂存到 socket.data，方便 ASR 连接等后续处理读取
  socket.data.conversationId = conversationId;
  const userId = socket.data.userId as string;
  clients.set(clientId, socket);
  sendJoinNotifications(clientId, clients);
  // 每个客户端连接时主动创建对应的 ASR WebSocket，后续语音片段将通过该通道转发
  initializeAsrConnection(socket);

  /**
 * 每个连接对应的对话 ID，存储消息上下文。
 */
  socket.data.clientConversations = [];
  // 记录本次连接期间出现过的日期，断开时用于更新用户画像
  socket.data.userProfileUpdateDays = [];
  // 默认关闭吐槽对战功能，等待加载回合数据后根据情况开启
  socket.data.roastBattleEnabled = false;
  // 建立连接后加载用户画像与 userDailyThreads，供本次 WebSocket 流程复用
  await loadUserContextOnConnect(socket);
  // 建立连接后准备吐槽对战回合数据，保证本次连接始终有可用回合上下文
  await loadRoastBattleRoundOnConnect(socket);

  const llmClient = new OpenAI({
    apiKey: process.env.GROKKINGAI_API_KEY?.trim(),
    baseURL: "https://api.x.ai/v1",
    // apiKey:"sk-b907c100bb864db1871df86fb1b224e7",
    // baseURL:"https://dashscope.aliyuncs.com/compatible-mode/v1",
    timeout: 360000, // Override default timeout with longer timeout for reasoning models
  });

  socket.data.llmClient = llmClient;

  socket.on("message", (payload) => {
    handleClientMessage(clientId, conversationId, userId, io, payload);
  });

  socket.on("chat:input", (payload: ChatInputPayload) => {
    // 每次收到输入时记录日期，同一天只保留一份
    recordUserProfileUpdateDay(socket, payload.timestamp);
    handleChatInput(clientId, conversationId, userId, socket, payload);
  });

  // 客户端请求当前吐槽对战回合时，返回最新快照
  socket.on("roast-battle-rounds:load", () => {
    console.log("接收到了 roast-battle-rounds:load 事件");
    emitRoastBattleRoundSnapshot(socket);
  });
  
  socket.on("disconnect", async (reason) => {
    await updateUserProfileOnDisconnect(socket);
    // 断开时若对话上下文足够，尝试压缩并更新 userDailyThread
    if (Array.isArray(socket.data.clientConversations) && socket.data.clientConversations.length >= 2) {
      await compressClientConversations({ socket,batchSize: 2 });
    }
    closeAsrConnection(socket);
    cleanupClient(clientId, clients, io);
  });

  socket.on("error", (error) => {
    closeAsrConnection(socket);
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
