// 统一的 UUID 生成工具，优先使用安全随机数，必要时做兼容降级
export const createUUID = () => {
  // 优先使用浏览器原生的 randomUUID，最符合规范且性能最好
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // 退化到 getRandomValues：手动拼装 RFC4122 v4 格式，保证结构正确
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    // 设置版本号与变体位，确保生成的 UUID 符合 v4 标准
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
      12,
      16
    )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // 最低保底：在无安全随机数的环境下，使用时间戳+随机数避免业务中断
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};
