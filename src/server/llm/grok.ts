import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { randomUUID } from "crypto";

/**
 * Grok（xAI）服务端适配层
 * ------------------------------------------------------------
 * 目标：
 * 1) 封装 xAI 的 Chat Completions 调用（使用 OpenAI 兼容 SDK）
 * 2) 提供“上下文记忆”（对话历史）能力
 * 3) 供 Next.js API Route 直接调用
 *
 * 重要说明（上下文记忆的落地方式）：
 * - 这里使用“进程内内存 Map”实现，适合本地开发/单实例部署。
 * - 在 Serverless/多实例/水平扩展场景下，进程会被频繁重启/多份副本，
 *   这会导致对话上下文丢失或不一致。
 * - 生产建议：把对话历史存到 Redis/数据库（Prisma）等外部存储，再按 conversationId 取回。
 */

/**
 * 环境变量
 * - GROKKINGAI_API_KEY：xAI API Key（你当前项目已有这个变量名）
 */
const GROK_API_KEY = process.env.GROKKINGAI_API_KEY?.trim();

/**
 * xAI 的 OpenAI 兼容 API 地址
 * - 文档通常为：https://api.x.ai/v1
 */
const GROK_BASE_URL = "https://api.x.ai/v1";

/**
 * 默认模型（可在调用时覆盖）
 * - 你原文件示例使用 grok-4-1-fast-reasoning，这里沿用
 */
export const DEFAULT_GROK_MODEL = "grok-4-1-fast-reasoning";

/**
 * 默认系统提示词：可以按产品风格调整
 */
export const DEFAULT_SYSTEM_PROMPT =
  "你是一个中文为主的智能助手，回答要准确、简洁，并在需要时给出可执行的步骤。";

/**
 * 对话记忆相关的默认配置
 * - MAX_MESSAGES：单个对话最多保留多少条消息（user+assistant 总数）
 * - TTL_MS：对话多长时间未更新就过期（毫秒）
 * - MAX_CONVERSATIONS：最多保留多少个对话，避免内存无限增长
 */
const MAX_MESSAGES = 40;
const TTL_MS = 1000 * 60 * 60; // 1 小时
const MAX_CONVERSATIONS = 200;

/**
 * 服务端保存的对话结构
 */
type StoredConversation = {
  id: string;
  systemPrompt: string;
  /**
   * 这里存“历史对话”（不含 system）
   * - 每次请求会把 system + history + newUser 拼起来发给模型
   */
  messages: ChatCompletionMessageParam[];
  createdAt: number;
  updatedAt: number;
};

/**
 * 进程内对话缓存
 */
const conversationStore = new Map<string, StoredConversation>();

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
     * - 推理模型可能较慢，你原来示例给到 360000ms（6 分钟），这里保留
     */
    timeout: 360000,
  });
  return grokClient;
}

/**
 * 清理过期/超量的对话，避免内存无限增长
 * - 每次 get/写入前调用一次即可（O(n)，但 n 默认最多 200）
 */
function cleanupConversationStore(now = Date.now()) {
  // 1) 先清理过期
  for (const [id, conv] of conversationStore.entries()) {
    if (now - conv.updatedAt > TTL_MS) {
      conversationStore.delete(id);
    }
  }

  // 2) 再限制总数量（按 updatedAt 从旧到新删）
  if (conversationStore.size <= MAX_CONVERSATIONS) {
    return;
  }

  const entries = Array.from(conversationStore.entries()).sort(
    (a, b) => a[1].updatedAt - b[1].updatedAt,
  );
  const overflow = entries.length - MAX_CONVERSATIONS;
  for (let i = 0; i < overflow; i += 1) {
    conversationStore.delete(entries[i]![0]);
  }
}

/**
 * 获取或创建一个对话
 * - 如果未传 conversationId，则自动生成并创建新对话
 */
function getOrCreateConversation(params: {
  conversationId?: string;
  systemPrompt?: string;
}): StoredConversation {
  cleanupConversationStore();

  const id = params.conversationId?.trim() || randomUUID();
  const existed = conversationStore.get(id);
  if (existed) {
    // 如果调用方“明确传了 systemPrompt”，且对话还没开始，可以更新系统提示词
    if (
      typeof params.systemPrompt === "string" &&
      existed.messages.length === 0
    ) {
      existed.systemPrompt =
        params.systemPrompt.trim() || DEFAULT_SYSTEM_PROMPT;
      existed.updatedAt = Date.now();
    }
    return existed;
  }

  const systemPrompt =
    typeof params.systemPrompt === "string" && params.systemPrompt.trim()
      ? params.systemPrompt.trim()
      : DEFAULT_SYSTEM_PROMPT;

  const created: StoredConversation = {
    id,
    systemPrompt,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  conversationStore.set(id, created);
  return created;
}

/**
 * 公开：清空某个对话（用于“重置上下文”）
 */
export function resetGrokConversation(conversationId: string) {
  const id = conversationId.trim();
  if (!id) {
    return;
  }
  conversationStore.delete(id);
}

/**
 * 公开：仅用于调试/观测（不要在生产把完整上下文返回给前端）
 */
export function getGrokConversationSnapshot(conversationId: string) {
  const id = conversationId.trim();
  const conv = conversationStore.get(id);
  if (!conv) {
    return null;
  }
  return {
    id: conv.id,
    systemPrompt: conv.systemPrompt,
    messages: conv.messages,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
  };
}

export type GrokChatInput = {
  /**
   * 对话 ID：用于“上下文记忆”
   * - 不传则自动创建新对话并返回新的 conversationId
   */
  conversationId?: string;
  /**
   * 用户输入（必填）
   */
  userMessage: string;
  /**
   * 系统提示词（可选）
   * - 新对话时会写入对话
   * - 旧对话只有在 messages 为空时才允许更新（避免中途风格突变）
   */
  systemPrompt?: string;
  /**
   * 模型名（可选）
   */
  model?: string;
  /**
   * 采样温度（可选）
   * - 不同模型/网关是否支持可能不同；不确定时可不传
   */
  temperature?: number;
};

export type GrokChatResult = {
  conversationId: string;
  reply: string;
  /**
   * 原始响应，便于你以后取 usage / finish_reason 等信息
   * - 注意：生产环境通常不建议把 raw 直接返回给前端
   */
  raw: ChatCompletion;
};

/**
 * 与 Grok 对话（带上下文记忆）
 * - 会把对话历史 + 本轮用户输入 一起发给模型
 * - 会把模型回复写回对话历史中
 */
export async function grokChat(input: GrokChatInput): Promise<GrokChatResult> {
  const userMessage = input.userMessage?.trim() ?? "";
  if (!userMessage) {
    throw new Error("userMessage 不能为空");
  }

  const conv = getOrCreateConversation({
    conversationId: input.conversationId,
    systemPrompt: input.systemPrompt,
  });

  // 构造本轮要发给模型的 messages：system + history + 本轮 user
  const requestMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: conv.systemPrompt },
    ...conv.messages,
    { role: "user", content: userMessage },
  ];

  const client = getGrokClient();
  const raw = await client.chat.completions.create({
    model: input.model?.trim() || DEFAULT_GROK_MODEL,
    messages: requestMessages,
    temperature: input.temperature,
  });

  const reply = raw.choices[0]?.message?.content ?? "";

  // 只有在成功拿到回复后，才写入“对话记忆”（避免失败污染上下文）
  conv.messages.push({ role: "user", content: userMessage });
  conv.messages.push({ role: "assistant", content: reply });

  // 控制单个对话的最大消息数量：只保留最近 MAX_MESSAGES 条（从尾部保留）
  if (conv.messages.length > MAX_MESSAGES) {
    conv.messages = conv.messages.slice(conv.messages.length - MAX_MESSAGES);
  }
  conv.updatedAt = Date.now();

  return { conversationId: conv.id, reply, raw };
}
