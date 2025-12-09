export {};

/**
 * 声明全局类型，以便 Edge 运行时下的 `WebSocketPair` 与 WebSocket 升级响应在编译时可用。
 */
declare global {
  /**
   * Edge 运行时的 WebSocket 对象，暴露了 `accept` 用于完成协议升级。
   */
  interface EdgeWebSocket extends WebSocket {
    accept: () => void;
  }

  /**
   * `WebSocketPair` 是 Edge Runtime 提供的 API，通过构造函数返回一对互联的 WebSocket 实例。
   */
  const WebSocketPair: {
    new (): [EdgeWebSocket, EdgeWebSocket];
  };

  /**
   * 扩展 `ResponseInit`，允许 `new Response` 返回值携带 `webSocket` 属性用于协议升级。
   */
  interface ResponseInit {
    webSocket?: EdgeWebSocket;
  }
}
