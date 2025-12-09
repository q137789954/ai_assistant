"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef } from "react";
import useWebSocket from "@/app/hooks/useWebSocket";
import type {
  WebSocketProviderContextValue,
  WebSocketProviderProps,
  WebSocketMessageListener,
} from "./types";

export const WebSocketContext = createContext<WebSocketProviderContextValue | undefined>(
  undefined,
);

/**
 * 提供一个集中式 WebSocket Provider 组件，封装连接状态与事件分发。
 */
const WebSocketProviders = ({
  children,
  url,
  protocols,
  autoConnect = true,
  onOpen,
  onClose,
  onError,
  onMessage,
}: WebSocketProviderProps) => {
  // 将所有订阅监听器保存到 ref 中，避免在 rerender 时重建集合
  const messageListenersRef = useRef<Set<WebSocketMessageListener>>(new Set());

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      // 将事件逐个分发给订阅者，保持先注册先执行的通道
      messageListenersRef.current.forEach((listener) => listener(event));
      // 如外部传入 onMessage 回调，同步触发以便做额外处理
      onMessage?.(event);
    },
    [onMessage],
  );

  const {
    status,
    lastMessage,
    lastError,
    isSupported,
    connect,
    disconnect,
    sendMessage,
  } = useWebSocket(url, {
    autoConnect,
    protocols,
    onOpen,
    onMessage: handleMessage,
    onClose,
    onError,
  });

  const subscribe = useCallback((listener: WebSocketMessageListener) => {
    messageListenersRef.current.add(listener);
    return () => {
      messageListenersRef.current.delete(listener);
    };
  }, []);

  const value: WebSocketProviderContextValue = useMemo(
    () => ({
      status,
      lastMessage,
      lastError,
      isSupported,
      connect,
      disconnect,
      sendMessage,
      subscribe,
    }),
    [status, lastMessage, lastError, isSupported, connect, disconnect, sendMessage, subscribe],
  );

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>;
};

/**
 * 使用该 Hook 获取 Provider 中的上下文值，需在 Provider 组件内使用。
 */
export const useWebSocketContext = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error("useWebSocketContext 必须在 WebSocketProviders 内部调用");
  }
  return context;
};

export default WebSocketProviders;
