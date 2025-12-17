import { Server, type Socket } from "socket.io";
import { clearVoiceBucket } from "./audio";
import { normalizeIncomingPayload, serializePayload } from "./utils";

/**
 * 构建通用的客户端元信息，便于在广播事件中复用。
 */
export const createClientMetadata = (clientId: string, clients: Map<string, Socket>) => ({
  clientId,
  activeClients: clients.size,
  timestamp: new Date().toISOString(),
});

/**
 * 仅向新连接的客户端发送欢迎消息，避免干扰已有连接的会话。
 */
export const sendJoinNotifications = (clientId: string, clients: Map<string, Socket>) => {
  const metadata = createClientMetadata(clientId, clients);
  const welcomePayload = serializePayload({
    event: "welcome",
    data: metadata,
  });

  const socket = clients.get(clientId);
  if (socket) {
    socket.emit("message", welcomePayload);
  }
};

/**
 * 清理连接并广播离线事件，确保状态与语音缓冲区同步清理。
 */
export const cleanupClient = (clientId: string, clients: Map<string, Socket>, io: Server) => {
  if (!clients.has(clientId)) {
    return;
  }

  clients.delete(clientId);
  clearVoiceBucket(clientId);

  const metadata = createClientMetadata(clientId, clients);
  const payload = serializePayload({
    event: "client-left",
    data: metadata,
  });

  io.emit("message", payload);
};

/**
 * 将客户端的每条 message 转化为统一结构后广播，便于前端展示。
 * @param userId 已登录的 userId，可用于后端审计或多租户区分
 */
export const handleClientMessage = (
  clientId: string,
  conversationId: string,
  userId: string,
  io: Server,
  rawData: unknown,
) => {
  const normalized = normalizeIncomingPayload(rawData);
  let parsed: unknown = normalized;

  try {
    parsed = JSON.parse(normalized);
  } catch {
    // 解析失败时保持原始字符串
  }

  const payload = serializePayload({
    event: "client-message",
    data: {
      clientId,
      userId,
      conversationId,
      raw: normalized,
      parsed,
      timestamp: new Date().toISOString(),
    },
  });

  io.emit("message", payload);
};
