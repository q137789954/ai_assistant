const TTS_END_PUNCTUATIONS = /[。！？!?]/;
// LLM 可能在回复中携带动作字段，需要识别并拆分。
const ACTION_MARKER = /【动作：([^】]+)】/;

/**
 * 试图从文本中提取动作标记，若存在则同时移除该片段并返回去除后的内容与动作名称。
 */
export const stripActionMarker = (text: string) => {
  const match = ACTION_MARKER.exec(text);
  if (!match) {
    return {
      sanitized: text,
      action: null,
    };
  }
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);
  return {
    sanitized: `${before}${after}`,
    action: match[1].trim(),
  };
};

/**
 * 从积累的文本中提取以句末标点结束的完整句子，返回句子列表及剩余未封装的尾部。
 */
export const extractCompletedSentences = (text: string) => {
  const sentences: string[] = [];
  let cursor = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (TTS_END_PUNCTUATIONS.test(text[index])) {
      // 遇到句尾标点就把从 cursor 到当前的片段作为一个完整句子
      const candidate = text.slice(cursor, index + 1).trim();
      if (candidate) {
        sentences.push(candidate);
      }
      cursor = index + 1;
    }
  }
  const remainder = text.slice(cursor);
  // 将最后剩余的未封装段落返回，用于下一次 chunk 拼接
  return {
    sentences,
    remainder,
  };
};
