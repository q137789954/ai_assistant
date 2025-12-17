"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import useWebSocket from "@/app/hooks/useWebSocket";
import type {
  WebSocketProviderContextValue,
  WebSocketProviderProps,
  WebSocketMessageListener,
} from "./types";
import { GlobalsContext } from "@/app/providers/GlobalsProviders";

/**
 * 简单的类型守卫，确保后续处理 message 的时候可以安全读取 conversationId 字段。
 */
const isConversationIdPayload = (
  value: unknown,
): value is { type: "chat:conversationId"; conversationId: string } =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  (value as { type?: unknown }).type === "chat:conversationId" &&
  typeof (value as { conversationId?: unknown }).conversationId === "string";

export const WebSocketContext = createContext<WebSocketProviderContextValue | undefined>(
  undefined,
);

/**
 * 提供一个集中式 WebSocket Provider 组件，封装连接状态与事件分发。
 */
const WebSocketProviders = ({
  children,
  url,
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
    emitEvent,
  } = useWebSocket(url, {
    autoConnect,
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

  const globals = useContext(GlobalsContext);
  const globalDispatch = globals?.dispatch;
  // 监听来自服务端的 conversationId 推送，用于更新全局的聊天上下文
  useEffect(() => {
    if (!globalDispatch) {
      return;
    }

    const unsubscribe = subscribe((event) => {
      if (typeof event.data !== "string") {
        return;
      }

      try {
        const parsed = JSON.parse(event.data);
        if (isConversationIdPayload(parsed)) {
          globalDispatch({
            type: "SET_CONVERSATION_ID",
            payload: parsed.conversationId,
          });
        }
      } catch {
        // 无法解析的 payload 忽略，避免影响其他逻辑
      }
    });

    return unsubscribe;
  }, [globalDispatch, subscribe]);

  const value: WebSocketProviderContextValue = useMemo(
    () => ({
      status,
      lastMessage,
      lastError,
      isSupported,
      connect,
      disconnect,
      sendMessage,
      emitEvent,
      subscribe,
    }),
    [status, lastMessage, lastError, isSupported, connect, disconnect, sendMessage, emitEvent, subscribe],
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
