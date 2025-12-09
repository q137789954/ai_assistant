"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type WebSocketStatus =
  | "idle"
  | "connecting"
  | "open"
  | "closing"
  | "closed"
  | "error";

export type UseWebSocketOptions = {
  autoConnect?: boolean;
  protocols?: string | string[];
  onOpen?: (event: Event) => void;
  onMessage?: (event: MessageEvent) => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (event: Event) => void;
};

const isClientSide = typeof window !== "undefined" && "WebSocket" in window;

const useWebSocket = (url: string | null, options: UseWebSocketOptions = {}) => {
  const {
    autoConnect = true,
    protocols,
    onOpen,
    onMessage,
    onClose,
    onError,
  } = options;

  const socketRef = useRef<WebSocket | null>(null);

  const listenersRef = useRef({
    onOpen,
    onMessage,
    onClose,
    onError,
  });

  const [status, setStatus] = useState<WebSocketStatus>("idle");
  const [lastMessage, setLastMessage] = useState<MessageEvent | null>(null);
  const [lastError, setLastError] = useState<Event | null>(null);

  useEffect(() => {
    listenersRef.current = {
      onOpen,
      onMessage,
      onClose,
      onError,
    };
  }, [onOpen, onMessage, onClose, onError]);

  /**
   * 只负责真正创建 WebSocket + 绑定事件，不直接 setState，
   * 这样可以安全地在 useEffect 里调用。
   */
  const internalConnect = useCallback(() => {
    if (!isClientSide) return;
    if (!url) return;

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      return;
    }

    const socket = protocols
      ? new WebSocket(url, protocols)
      : new WebSocket(url);

    socket.addEventListener("open", (event) => {
      setStatus("open");
      setLastError(null);
      listenersRef.current.onOpen?.(event);
    });

    socket.addEventListener("message", (event) => {
      setLastMessage(event);
      listenersRef.current.onMessage?.(event);
    });

    socket.addEventListener("close", (event) => {
      setStatus("closed");
      listenersRef.current.onClose?.(event);
      // 确保只清掉当前这条 socket
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    });

    socket.addEventListener("error", (event) => {
      setStatus("error");
      setLastError(event);
      listenersRef.current.onError?.(event);
    });

    socketRef.current = socket;
  }, [url, protocols]);

  /**
   * 只负责真正调用 close，不直接 setState。
   */
  const internalDisconnect = useCallback(() => {
    if (!socketRef.current) return;

    if (socketRef.current.readyState === WebSocket.CLOSED) {
      // 已经是 closed，事件也触发过了，这里只清理引用即可
      socketRef.current = null;
      return;
    }

    socketRef.current.close();
    // status 在 close 事件回调里更新为 'closed'
  }, []);

  /**
   * 暴露给组件用的 connect：可以设置为 "connecting"，然后走真正的连接逻辑。
   * 注意：这个函数不会被 effect 调用，所以不会触发刚才那个 lint 规则。
   */
  const connect = useCallback(() => {
    setStatus("connecting");
    internalConnect();
  }, [internalConnect]);

  /**
   * 暴露给组件用的 disconnect：设置为 "closing"，然后走真正的断开逻辑。
   */
  const disconnect = useCallback(() => {
    setStatus("closing");
    internalDisconnect();
  }, [internalDisconnect]);

  /**
   * autoConnect 逻辑：在 effect 里只调用 “不改 state 的内部版本”，
   * 状态变化全部交给事件回调和外部动作来完成。
   */
  useEffect(() => {
    if (!autoConnect || !url) {
      return;
    }

    internalConnect();

    return () => {
      internalDisconnect();
    };
  }, [url, autoConnect, protocols, internalConnect, internalDisconnect]);

  const sendMessage = useCallback(
    (payload: string | ArrayBuffer | ArrayBufferView) => {
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        return false;
      }
      socketRef.current.send(payload);
      return true;
    },
    [],
  );

  const memoized = useMemo(
    () => ({
      status,
      lastMessage,
      lastError,
      isSupported: isClientSide,
      connect,
      disconnect,
      sendMessage,
    }),
    [status, lastMessage, lastError, connect, disconnect, sendMessage],
  );

  return memoized;
};

export default useWebSocket;
