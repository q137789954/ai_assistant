import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";

/**
 * Grok（xAI）“纯交互层”
 * ------------------------------------------------------------
 * 职责边界：
 * - 只负责：初始化 Grok 客户端、调用 Chat Completions（非流式/流式）
 * - 不负责：会话上下文管理、数据库读写、鉴权、消息拼装、截断策略等业务逻辑
 *
 * 业务层（会话持久化/上下文拼装）请看：
 * - `src/server/llm/grokConversation.ts`
 */

/**
 * 环境变量
 * - GROKKINGAI_API_KEY：xAI API Key
 */
const GROK_API_KEY = process.env.GROKKINGAI_API_KEY?.trim();

/**
 * xAI 的 OpenAI 兼容 API 地址
 * - 文档通常为：https://api.x.ai/v1
 */
const GROK_BASE_URL = "https://api.x.ai/v1";

/**
 * 默认模型（业务层可覆盖）
 */
export const DEFAULT_GROK_MODEL = "grok-4-1-fast-reasoning";

/**
 * 单例 Grok Client（OpenAI SDK 兼容）
 * - 避免每次请求重复初始化
 */
let grokClient: OpenAI | null = null;

function getGrokClient() {
  if (grokClient) {
    return grokClient;
  }
  if (!GROK_API_KEY) {
    throw new Error(
      "缺少 GROKKINGAI_API_KEY：请在 .env 中配置 xAI 的 API Key",
    );
  }

  grokClient = new OpenAI({
    apiKey: GROK_API_KEY,
    baseURL: GROK_BASE_URL,
    /**
     * 请求超时时间（毫秒）
     * - 推理模型可能较慢，这里给一个更保守的超时时间
     */
    timeout: 360000,
  });
  return grokClient;
}

/**
 * Grok Chat Completions（非流式）
 * - 输入 messages 必须由调用方（业务层）自行拼装（如 system + history + user）
 */
export async function grokCreateChatCompletion(input: {
  messages: ChatCompletionMessageParam[];
  model?: string;
  temperature?: number;
}): Promise<ChatCompletion> {
  const client = getGrokClient();
  return client.chat.completions.create({
    model: input.model?.trim() || DEFAULT_GROK_MODEL,
    messages: input.messages,
    temperature: input.temperature,
  });
}

/**
 * Grok Chat Completions（流式）
 * - 返回值是一个可 async-iterate 的流（每个 chunk 是 ChatCompletionChunk）
 */
export async function grokCreateChatCompletionStream(input: {
  messages: ChatCompletionMessageParam[];
  model?: string;
  temperature?: number;
}): Promise<AsyncIterable<ChatCompletionChunk>> {
  const client = getGrokClient();
  return (await client.chat.completions.create({
    model: input.model?.trim() || DEFAULT_GROK_MODEL,
    messages: input.messages,
    temperature: input.temperature,
    stream: true,
  })) as AsyncIterable<ChatCompletionChunk>;
}

