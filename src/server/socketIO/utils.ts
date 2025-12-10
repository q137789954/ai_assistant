import { Buffer } from "node:buffer";

/**
 * serializePayload 用于确保所有发往客户端的事件结构一致，即使数据对象发生变化也能生成有效字符串。
 */
export const serializePayload = (payload: Record<string, unknown>) => JSON.stringify(payload);

/**
 * normalizeIncomingPayload 用于统一解析任意类型的输入并终化为字符串，方便后续的日志记录与 JSON 解析。
 */
export const normalizeIncomingPayload = (incoming: unknown) => {
  if (typeof incoming === "string") {
    return incoming;
  }

  if (incoming instanceof ArrayBuffer) {
    return Buffer.from(incoming).toString("utf-8");
  }

  if (
    typeof incoming === "object" &&
    incoming !== null &&
    "buffer" in incoming &&
    "byteLength" in incoming &&
    (incoming as ArrayBufferView).byteLength
  ) {
    const view = incoming as ArrayBufferView;
    return Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString("utf-8");
  }

  try {
    return JSON.stringify(incoming);
  } catch {
    return String(incoming);
  }
};
