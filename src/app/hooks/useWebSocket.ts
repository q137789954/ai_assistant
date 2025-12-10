"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

export type WebSocketStatus =
  | "idle"
  | "connecting"
  | "open"
  | "closing"
  | "closed"
  | "error";

export type UseWebSocketOptions = {
  autoConnect?: boolean;
  onOpen?: (event: Event) => void;
  onMessage?: (event: MessageEvent) => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (event: Event) => void;
};

const isClientSide = typeof window !== "undefined";

/**
 * 将任意 payload 转为 MessageEvent 实例，使得上层逻辑依然可以通过 event.data 读取文本。
 */
const buildMessageEvent = (payload: unknown) => {
  const data =
    typeof payload === "string"
      ? payload
      : typeof payload === "object"
      ? JSON.stringify(payload)
      : String(payload);
  return new MessageEvent("message", {
    data,
  });
};

const useWebSocket = (url: string | null, options: UseWebSocketOptions = {}) => {
  const { autoConnect = true, onOpen, onMessage, onClose, onError } = options;

  const socketRef = useRef<Socket | null>(null);
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
   * 使用 socket.io-client 创建连接并绑定所有生命周期回调。
   */
  const internalConnect = useCallback(() => {
    if (!isClientSide || !url) {
      return;
    }

    if (socketRef.current) {
      return;
    }

    const socket = io(url, {
      autoConnect: false,
      transports: ["websocket"],
    });

    socket.on("connect", () => {
      setStatus("open");
      setLastError(null);
      listenersRef.current.onOpen?.(new Event("open"));
    });

    socket.on("message", (payload) => {
      const event = buildMessageEvent(payload);
      setLastMessage(event);
      listenersRef.current.onMessage?.(event);
    });

    socket.on("disconnect", (reason) => {
      const closeEvent = new CloseEvent("close", {
        reason,
        wasClean: reason !== "transport close",
        code: 1000,
      });
      setStatus("closed");
      listenersRef.current.onClose?.(closeEvent);
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    });

    socket.on("error", () => {
      const errorEvent = new Event("error");
      setStatus("error");
      setLastError(errorEvent);
      listenersRef.current.onError?.(errorEvent);
    });

    socket.on("connect_error", () => {
      const errorEvent = new Event("error");
      setStatus("error");
      setLastError(errorEvent);
      listenersRef.current.onError?.(errorEvent);
    });

    socketRef.current = socket;
    socket.connect();
  }, [url]);

  /**
   * 主动断开当前连接并清理引用。
   */
  const internalDisconnect = useCallback(() => {
    if (!socketRef.current) {
      return;
    }

    socketRef.current.disconnect();
    socketRef.current = null;
  }, []);

  /**
   * 向外暴露的 connect，可在 UI 中触发并首先设置状态。
   */
  const connect = useCallback(() => {
    setStatus("connecting");
    internalConnect();
  }, [internalConnect]);

  /**
   * 向外暴露的 disconnect，用于主动释放 socket。
   */
  const disconnect = useCallback(() => {
    setStatus("closing");
    internalDisconnect();
  }, [internalDisconnect]);

  /**
   * autoConnect 逻辑：在具备 URL 时自动建立连接，卸载时 clean-up。
   */
  useEffect(() => {
    if (!autoConnect || !url) {
      return;
    }

    internalConnect();

    return () => {
      internalDisconnect();
    };
  }, [autoConnect, url, internalConnect, internalDisconnect]);

  /**
   * 通过 socket.io 发送 `message` 事件，返回是否成功。
   */
  const sendMessage = useCallback(
    (payload: string | ArrayBuffer | ArrayBufferView) => {
      if (!socketRef.current || !socketRef.current.connected) {
        return false;
      }

      socketRef.current.emit("message", payload);
      return true;
    },
    [],
  );

  const value = useMemo(
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

  return value;
};

export default useWebSocket;
