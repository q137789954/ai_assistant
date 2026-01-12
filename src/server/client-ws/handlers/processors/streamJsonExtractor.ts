/**
 * 从缓冲区中提取首个完整 JSON 对象，并返回 JSON 文本与剩余内容。
 * - 通过花括号/方括号深度与字符串状态机识别 JSON 边界，避免被字符串中的括号干扰。
 * - 若未形成完整 JSON，则返回 null 并保留原缓冲区。
 */
export const extractFirstJson = (buffer: string) => {
  const startIndex = buffer.indexOf("{");
  if (startIndex === -1) {
    return { jsonText: null as string | null, rest: buffer };
  }

  let braceDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < buffer.length; index += 1) {
    const char = buffer[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth -= 1;
      if (braceDepth === 0 && bracketDepth === 0) {
        const jsonText = buffer.slice(startIndex, index + 1);
        const rest = buffer.slice(index + 1);
        return { jsonText, rest };
      }
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth -= 1;
    }
  }

  return { jsonText: null as string | null, rest: buffer };
};
