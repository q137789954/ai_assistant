/**
 * 这个模块在 Edge 运行时中维护全局的 WebSocket 客户端集合，负责消息编解码以及广播逻辑。
 * 所有连接在这里统一管理，方便在多个客户端之间共享状态或广播事件。
 */
const clients = new Map<string, EdgeWebSocket>();

const textDecoder = new TextDecoder("utf-8");

type WebSocketPayload = {
  event: string;
  data?: Record<string, unknown>;
};

/**
 * 生成一个兼容 Edge/Node 的客户端 ID，主要用于日志与广播事件标识。
 */
const createClientId = () => {
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
};

/**
 * 将通用的负载序列化为字符串，以便直接调用 WebSocket.send。
 */
const serializePayload = (payload: WebSocketPayload) => JSON.stringify(payload);

/**
 * 确保在 WebSocket 处于 OPEN 状态时发送数据，不可用时会静默丢弃或清理连接。
 */
const safeSend = (socket: EdgeWebSocket, payload: WebSocketPayload) => {
  if (socket.readyState !== WebSocket.OPEN) {
    return false;
  }

  try {
    socket.send(serializePayload(payload));
    return true;
  } catch (error) {
    console.error("WebSocket 发送失败，连接将被移除：", error);
    return false;
  }
};

/**
 * 广播事件到所有客户端，可通过 excludeId 排除发送者。
 */
const broadcast = (payload: WebSocketPayload, excludeId?: string) => {
  const payloadStr = serializePayload(payload);
  for (const [clientId, socket] of clients) {
    if (excludeId && clientId === excludeId) {
      continue;
    }
    if (socket.readyState !== WebSocket.OPEN) {
      clients.delete(clientId);
      continue;
    }
    try {
      socket.send(payloadStr);
    } catch (error) {
      console.warn("广播期间发生异常，正在移除失败的连接：", clientId, error);
      clients.delete(clientId);
    }
  }
};

/**
 * 彻底移除指定客户端，并向剩余的客户端广播离线事件。
 */
const cleanupClient = (clientId: string) => {
  if (!clients.has(clientId)) {
    return;
  }

  clients.delete(clientId);
  broadcast({
    event: "client-left",
    data: {
      clientId,
      activeClients: clients.size,
      timestamp: new Date().toISOString(),
    },
  });
};

/**
 * 将 incomingPayload 统一解码为字符串，优先支持 string/ArrayBuffer/TypedArray。
 */
const normalizeIncomingPayload = (incoming: unknown) => {
  if (typeof incoming === "string") {
    return incoming;
  }

  if (incoming instanceof ArrayBuffer) {
    return textDecoder.decode(incoming);
  }

  if (ArrayBuffer.isView(incoming)) {
    return textDecoder.decode(incoming);
  }

  return String(incoming);
};

/**
 * 处理客户端发送的原始数据，并转发一个统一的 "client-message" 事件。
 */
const handleClientMessage = (clientId: string, rawValue: unknown) => {
  const rawText = normalizeIncomingPayload(rawValue);
  let parsedPayload: unknown = rawText;

  try {
    parsedPayload = JSON.parse(rawText);
  } catch {
    // 忽略解析失败情况，保持原始字符串即可
  }

  broadcast({
    event: "client-message",
    data: {
      clientId,
      raw: rawText,
      parsed: parsedPayload,
      timestamp: new Date().toISOString(),
    },
  });
};

/**
 * 对外暴露的入口，用于在 Edge API 路由中处理每个 WebSocket 连接。
 */
export const handleWebSocketConnection = (socket: EdgeWebSocket) => {
  const clientId = createClientId();
  clients.set(clientId, socket);

  socket.addEventListener("message", (event) => {
    handleClientMessage(clientId, event.data);
  });

  const dispose = () => cleanupClient(clientId);

  socket.addEventListener("close", () => dispose());
  socket.addEventListener("error", () => dispose());

  socket.accept();

  safeSend(socket, {
    event: "welcome",
    data: {
      clientId,
      activeClients: clients.size,
      timestamp: new Date().toISOString(),
    },
  });

  broadcast({
    event: "client-joined",
    data: {
      clientId,
      activeClients: clients.size,
      timestamp: new Date().toISOString(),
    },
  }, clientId);
};
