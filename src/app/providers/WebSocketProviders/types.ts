import type { ReactNode } from "react";
import type { WebSocketStatus } from "@/app/hooks/useWebSocket";

/**
 * 通知组件接收到消息的回调类型。
 */
export type WebSocketMessageListener = (event: MessageEvent) => void;

/**
 * Provider 对外暴露的上下文值，用于读取连接状态和基础操作。
 */
export type WebSocketProviderContextValue = {
  status: WebSocketStatus;
  lastMessage: MessageEvent | null;
  lastError: Event | null;
  isSupported: boolean;
  connect: () => void;
  disconnect: () => void;
  sendMessage: (payload: string | ArrayBuffer | ArrayBufferView) => boolean;
  subscribe: (listener: WebSocketMessageListener) => () => void;
};

/**
 * Provider 的 props 配置，可以自定义连接的 URL、协议及事件回调。
 */
export type WebSocketProviderProps = {
  children: ReactNode;
  url: string;
  protocols?: string | string[];
  autoConnect?: boolean;
  onOpen?: (event: Event) => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (event: Event) => void;
  onMessage?: (event: MessageEvent) => void;
};
