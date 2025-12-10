import { handleWebSocketConnection } from "@/server/webSocketService";

/**
 * 该路由负责处理 WebSocket 升级请求，运行时指定为 edge 以调用 WebSocketPair。
 */
export const runtime = "edge";

export async function GET(request: Request) {
  console.debug("api/ws: 进入 WebSocket 升级入口", {
    method: request.method,
    url: request.url,
    headers: {
      upgrade: request.headers.get("upgrade"),
      connection: request.headers.get("connection"),
    },
  });

  const upgradeHeader = request.headers.get("upgrade");

  if (upgradeHeader?.toLowerCase() !== "websocket") {
    console.warn("api/ws: 非 WebSocket 请求拦截", {
      requestedUpgrade: upgradeHeader,
      url: request.url,
    });
    return new Response("需要通过 WebSocket 协议升级请求", { status: 426 });
  }

  // 创建 WebSocketPair 并将其中一个端交给自定义处理器
  const pair = new WebSocketPair();
  handleWebSocketConnection(pair[1]);

  return new Response(null, {
    status: 101,
    webSocket: pair[0],
  });
}
