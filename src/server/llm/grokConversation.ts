import type {
  ChatCompletion,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import { randomUUID } from "crypto";

import {
  DEFAULT_GROK_MODEL,
  grokCreateChatCompletion,
  grokCreateChatCompletionStream,
} from "@/server/llm/grok";

/**
 * Grok“会话层”（轻量持久化 + 上下文拼装）
 * ------------------------------------------------------------
 * 职责边界：
 * - 负责：conversationId 管理、（仅进程内）持久化、systemPrompt 策略、上下文裁剪与拼装
 * - 不负责：Grok SDK 的初始化与调用（由 `src/server/llm/grok.ts` 负责）
 *
 * 重要说明（按你的需求“暂时只需要本次会话上下文”）：
 * - 这里不会再从数据库查询“以前会话”的历史消息；
 * - 上下文记忆仅保存在服务端进程内存中（Map），仅覆盖“本次服务运行期/本次会话”；
 * - 若部署在 Serverless/多实例环境，进程内存不保证跨实例一致；需要真正持久化时再切回 DB 即可。
 */

/**
 * 默认系统提示词：可按产品风格调整
 * - 放在会话层而不是 grok.ts，避免 grok.ts 携带业务策略
 */
export const DEFAULT_SYSTEM_PROMPT =
  "你是一个中文为主的智能助手，回答要准确、简洁，并在需要时给出可执行的步骤。";

/**
 * 对话记忆相关的默认配置
 * - MAX_MESSAGES：单个对话最多取多少条历史消息（user+assistant 总数，不含本轮 user）
 */
const MAX_MESSAGES = 40;

/**
 * 单个进程内的“会话记忆”存储结构
 * - 角色枚举沿用 Prisma schema 的定义（SYSTEM/USER/ASSISTANT/TOOL）
 * - 这样 `getGrokConversationSnapshot` 返回值能尽量保持与 DB 版本一致，减少上层改动
 */
type ConversationMessageRole = "SYSTEM" | "USER" | "ASSISTANT" | "TOOL";

type StoredConversationMessage = {
  role: ConversationMessageRole;
  content: string;
  createdAt: Date;
};

type StoredConversation = {
  id: string;
  systemPrompt: string;
  messages: StoredConversationMessage[];
  model: string | null;
  temperature: number | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * 进程内会话缓存（LRU-ish）
 * - Map 的插入顺序可用于实现简单的“最近最少使用”淘汰策略
 * - 每次访问会通过 delete+set 刷新到队尾
 */
const conversationStore = new Map<string, StoredConversation>();

/**
 * 为避免开发时反复调用导致内存无限增长，这里加一个最大会话数限制
 * - 超过后会淘汰最老的会话（Map 首个 key）
 * - 这是“临时仅本次会话”的方案，生产可根据实际情况调整或改为 DB
 */
const MAX_CONVERSATIONS = 200;

function normalizeIncomingConversationId(conversationId?: string) {
  const incomingId =
    typeof conversationId === "string" ? conversationId.trim() : "";
  return incomingId && isUuidLike(incomingId) ? incomingId : randomUUID();
}

function touchConversation(conv: StoredConversation) {
  // 通过刷新插入顺序实现简单 LRU
  conversationStore.delete(conv.id);
  conversationStore.set(conv.id, conv);

  while (conversationStore.size > MAX_CONVERSATIONS) {
    const oldestKey = conversationStore.keys().next().value as string | undefined;
    if (!oldestKey) break;
    conversationStore.delete(oldestKey);
  }
}

function toChatRole(role: ConversationMessageRole): ChatCompletionMessageParam["role"] {
  if (role === "SYSTEM") return "system";
  if (role === "USER") return "user";
  if (role === "ASSISTANT") return "assistant";
  return "tool";
}

function clampHistoryMessages(messages: StoredConversationMessage[]) {
  // 只保留最近 MAX_MESSAGES 条（不含 system）
  if (messages.length <= MAX_MESSAGES) return messages;
  return messages.slice(messages.length - MAX_MESSAGES);
}

/**
 * 简单校验 conversationId 是否“像一个 UUID”
 * - 数据库存储用 TEXT，不强制 UUID 类型
 * - 这里做弱校验，避免把奇怪的字符串当作主键导致潜在滥用（例如超长字符串）
 */
function isUuidLike(value: string) {
  // 允许大小写；仅判断 8-4-4-4-12 的基本形态
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/**
 * 获取或创建一个对话（进程内）
 * - 如果未传 conversationId 或不符合 UUID 形态，则自动生成新 UUID
 * - 不再从数据库读取历史消息，只使用进程内缓存的“本次会话上下文”
 */
async function getOrCreateConversation(params: {
  conversationId?: string;
  systemPrompt?: string;
  model?: string;
  temperature?: number;
}): Promise<{
  id: string;
  systemPrompt: string;
  messages: ChatCompletionMessageParam[];
}> {
  // 1) 规范化 conversationId
  const id = normalizeIncomingConversationId(params.conversationId);

  // 2) systemPrompt 策略（与 DB 版保持一致：默认提示词 + “空历史时允许更新”）
  const nextSystemPrompt =
    typeof params.systemPrompt === "string" && params.systemPrompt.trim()
      ? params.systemPrompt.trim()
      : DEFAULT_SYSTEM_PROMPT;

  const existed = conversationStore.get(id);
  const now = new Date();

  let conv: StoredConversation;
  if (!existed) {
    conv = {
      id,
      systemPrompt: nextSystemPrompt,
      messages: [],
      model: params.model?.trim() || null,
      temperature: typeof params.temperature === "number" ? params.temperature : null,
      createdAt: now,
      updatedAt: now,
    };
  } else {
    // 旧会话：仅在“还没有任何消息”时允许更新 systemPrompt，避免中途风格突变
    const allowUpdateSystemPrompt =
      existed.messages.length === 0 &&
      typeof params.systemPrompt === "string" &&
      params.systemPrompt.trim();
    conv = {
      ...existed,
      systemPrompt: allowUpdateSystemPrompt ? nextSystemPrompt : existed.systemPrompt,
      model: params.model?.trim() || existed.model,
      temperature:
        typeof params.temperature === "number" ? params.temperature : existed.temperature,
      updatedAt: now,
    };
  }

  // 3) 裁剪历史消息（只用进程内缓存）
  conv.messages = clampHistoryMessages(conv.messages);
  touchConversation(conv);

  const history: ChatCompletionMessageParam[] = conv.messages.map((msg) => ({
    role: toChatRole(msg.role),
    content: msg.content,
  })) as ChatCompletionMessageParam[];

  return {
    id,
    systemPrompt: conv.systemPrompt,
    messages: history,
  };
}

/**
 * 公开：清空某个对话（用于“重置上下文”）
 * - 删除消息，但保留会话本身（便于前端继续沿用 conversationId）
 */
export async function resetGrokConversation(conversationId: string) {
  const id = conversationId.trim();
  if (!id) {
    return;
  }

  const existed = conversationStore.get(id);
  if (!existed) {
    // 与旧实现保持兼容：reset 一个不存在的 id 也应“静默成功”
    return;
  }

  const now = new Date();
  const next: StoredConversation = {
    ...existed,
    messages: [],
    model: null,
    temperature: null,
    updatedAt: now,
  };
  touchConversation(next);
}

/**
 * 公开：仅用于调试/观测（不要在生产把完整上下文返回给前端）
 */
export async function getGrokConversationSnapshot(conversationId: string) {
  const id = conversationId.trim();
  if (!id) return null;

  const conv = conversationStore.get(id);
  if (!conv) return null;

  return {
    id: conv.id,
    systemPrompt: conv.systemPrompt,
    // 返回结构尽量贴近 DB 版（role + content + createdAt）
    messages: conv.messages.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
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
 * 与 Grok 对话（带 DB 持久化的上下文记忆）
 * - 会把对话历史 + 本轮用户输入 一起发给模型
 * - 会把模型回复写回数据库
 */
export async function grokChat(input: GrokChatInput): Promise<GrokChatResult> {
  const userMessage = input.userMessage?.trim() ?? "";
  if (!userMessage) {
    throw new Error("userMessage 不能为空");
  }

  const conv = await getOrCreateConversation({
    conversationId: input.conversationId,
    systemPrompt: input.systemPrompt,
    model: input.model,
    temperature: input.temperature,
  });

  // 构造本轮要发给模型的 messages：system + history + 本轮 user
  const requestMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: conv.systemPrompt },
    ...conv.messages,
    { role: "user", content: userMessage },
  ];

  const raw = await grokCreateChatCompletion({
    model: input.model?.trim() || DEFAULT_GROK_MODEL,
    messages: requestMessages,
    temperature: input.temperature,
  });

  const reply = raw.choices[0]?.message?.content ?? "";

  /**
   * 只有在成功拿到回复后，才写入“进程内上下文”（避免失败污染上下文）
   * - 这里不会写数据库，仅用于“本次会话”的上下文续写
   */
  const existed = conversationStore.get(conv.id);
  if (existed) {
    const now = new Date();
    const nextMessages = clampHistoryMessages([
      ...existed.messages,
      { role: "USER", content: userMessage, createdAt: now },
      { role: "ASSISTANT", content: reply, createdAt: now },
    ]);
    const next: StoredConversation = {
      ...existed,
      messages: nextMessages,
      model: input.model?.trim() || null,
      temperature: typeof input.temperature === "number" ? input.temperature : null,
      updatedAt: now,
    };
    touchConversation(next);
  }

  return { conversationId: conv.id, reply, raw };
}

export type GrokChatStreamInput = GrokChatInput & {
  /**
   * 流式输出时是否启用
   * - 该字段主要用于上层 API 更直观；实际在本函数中默认就是 stream=true
   */
  stream?: true;
};

/**
 * 与 Grok 对话（流式输出 + DB 持久化上下文）
 * ------------------------------------------------------------
 * 使用方式：
 * - for await (const delta of grokChatStream(...)) { ... }
 *
 * 上下文写入策略：
 * - 为避免“失败污染对话”，这里在完整流结束后才把 user/assistant 写回数据库。
 */
export async function* grokChatStream(
  input: GrokChatStreamInput,
): AsyncGenerator<{
  conversationId: string;
  delta: string;
}> {
  const userMessage = input.userMessage?.trim() ?? "";
  if (!userMessage) {
    throw new Error("userMessage 不能为空");
  }

  const conv = await getOrCreateConversation({
    conversationId: input.conversationId,
    systemPrompt: input.systemPrompt,
    model: input.model,
    temperature: input.temperature,
  });

  /**
   * 先产出一次“空 delta”，用于上层尽早拿到 conversationId（例如 SSE meta 事件）
   * - 上层收到后可忽略 delta===""，仅使用 conversationId
   */
  yield { conversationId: conv.id, delta: "" };

  // 构造本轮要发给模型的 messages：system + history + 本轮 user
  const requestMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: conv.systemPrompt },
    ...conv.messages,
    { role: "user", content: userMessage },
  ];

  const stream = await grokCreateChatCompletionStream({
    model: input.model?.trim() || DEFAULT_GROK_MODEL,
    messages: requestMessages,
    temperature: input.temperature,
  });

  let fullReply = "";

  try {
    for await (const chunk of stream) {
      const delta = (chunk as ChatCompletionChunk).choices[0]?.delta?.content ?? "";
      if (!delta) {
        continue;
      }
      fullReply += delta;
      yield { conversationId: conv.id, delta };
    }

    // 流式结束后，再落入“进程内上下文”，避免中途失败污染对话
    const existed = conversationStore.get(conv.id);
    if (existed) {
      const now = new Date();
      const nextMessages = clampHistoryMessages([
        ...existed.messages,
        { role: "USER", content: userMessage, createdAt: now },
        { role: "ASSISTANT", content: fullReply, createdAt: now },
      ]);
      const next: StoredConversation = {
        ...existed,
        messages: nextMessages,
        model: input.model?.trim() || null,
        temperature: typeof input.temperature === "number" ? input.temperature : null,
        updatedAt: now,
      };
      touchConversation(next);
    }
  } catch (error) {
    // 不写入历史，直接抛出，让上层决定如何处理
    throw error;
  }
}
