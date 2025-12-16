import type {
  ChatCompletion,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import { randomUUID } from "crypto";

import { prisma } from "@/server/db/prisma";
import {
  DEFAULT_GROK_MODEL,
  grokCreateChatCompletion,
  grokCreateChatCompletionStream,
} from "@/server/llm/grok";

/**
 * Grok“会话层”（持久化 + 上下文拼装）
 * ------------------------------------------------------------
 * 职责边界：
 * - 负责：conversationId 管理、数据库持久化、历史消息读取、systemPrompt 策略、上下文裁剪
 * - 不负责：Grok SDK 的初始化与调用（由 `src/server/llm/grok.ts` 负责）
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
 * 获取或创建一个对话（DB）
 * - 如果未传 conversationId 或不符合 UUID 形态，则自动生成新 UUID
 * - 从数据库读取最近 MAX_MESSAGES 条历史消息
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
  /**
   * 1) 规范化 conversationId
   * - 为空：生成新 UUID
   * - 非 UUID 形态：忽略，生成新 UUID（避免 DB 主键被滥用）
   */
  const incomingId =
    typeof params.conversationId === "string" ? params.conversationId.trim() : "";
  const id = incomingId && isUuidLike(incomingId) ? incomingId : randomUUID();

  /**
   * 2) 读取/创建会话
   * - 如果会话不存在则创建
   * - 如果会话存在且“还没有任何消息”，允许更新 systemPrompt（避免中途风格突变）
   */
  const existed = await prisma.conversation.findUnique({
    where: { id },
    select: { id: true, systemPrompt: true },
  });

  const nextSystemPrompt =
    typeof params.systemPrompt === "string" && params.systemPrompt.trim()
      ? params.systemPrompt.trim()
      : DEFAULT_SYSTEM_PROMPT;

  if (!existed) {
    await prisma.conversation.create({
      data: {
        id,
        systemPrompt: nextSystemPrompt,
        model: params.model?.trim() || null,
        temperature:
          typeof params.temperature === "number" ? params.temperature : null,
      },
    });
  } else if (
    typeof params.systemPrompt === "string" &&
    params.systemPrompt.trim()
  ) {
    const count = await prisma.conversationMessage.count({
      where: { conversationId: id },
    });
    if (count === 0 && existed.systemPrompt !== nextSystemPrompt) {
      await prisma.conversation.update({
        where: { id },
        data: { systemPrompt: nextSystemPrompt },
      });
    }
  }

  /**
   * 3) 读取最近的历史消息（只取必要字段）
   * - take+desc 后需要反转，保证返回从旧到新
   */
  const rows = await prisma.conversationMessage.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "desc" },
    take: MAX_MESSAGES,
    select: { role: true, content: true },
  });

  const history = rows
    .slice()
    .reverse()
    .map((row) => {
      // 将 DB 枚举映射到 OpenAI SDK 角色字符串
      const role =
        row.role === "USER"
          ? "user"
          : row.role === "ASSISTANT"
          ? "assistant"
          : row.role === "SYSTEM"
          ? "system"
          : "tool";
      return { role, content: row.content } as ChatCompletionMessageParam;
    });

  return {
    id,
    systemPrompt: existed?.systemPrompt ?? nextSystemPrompt,
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

  await prisma.conversationMessage.deleteMany({ where: { conversationId: id } });

  // 触发 updatedAt 更新，便于按时间排序/观测
  await prisma.conversation
    .update({
      where: { id },
      data: { model: null, temperature: null },
    })
    .catch(() => {
      // 会话不存在时无需报错（与旧实现保持兼容：delete 一个不存在的 id 也应“静默成功”）
    });
}

/**
 * 公开：仅用于调试/观测（不要在生产把完整上下文返回给前端）
 */
export async function getGrokConversationSnapshot(conversationId: string) {
  const id = conversationId.trim();
  if (!id) return null;

  const conv = await prisma.conversation.findUnique({
    where: { id },
    select: { id: true, systemPrompt: true, createdAt: true, updatedAt: true },
  });
  if (!conv) return null;

  const messages = await prisma.conversationMessage.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true, createdAt: true },
  });

  return {
    id: conv.id,
    systemPrompt: conv.systemPrompt,
    messages,
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
   * 只有在成功拿到回复后，才写入数据库（避免失败污染上下文）
   * - user/assistant 两条消息同一事务写入
   * - 同时更新会话的 model/temperature，并触发 updatedAt
   */
  await prisma.$transaction([
    prisma.conversationMessage.create({
      data: {
        conversationId: conv.id,
        role: "USER",
        content: userMessage,
      },
    }),
    prisma.conversationMessage.create({
      data: {
        conversationId: conv.id,
        role: "ASSISTANT",
        content: reply,
      },
    }),
    prisma.conversation.update({
      where: { id: conv.id },
      data: {
        model: input.model?.trim() || null,
        temperature:
          typeof input.temperature === "number" ? input.temperature : null,
      },
    }),
  ]);

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

    await prisma.$transaction([
      prisma.conversationMessage.create({
        data: {
          conversationId: conv.id,
          role: "USER",
          content: userMessage,
        },
      }),
      prisma.conversationMessage.create({
        data: {
          conversationId: conv.id,
          role: "ASSISTANT",
          content: fullReply,
        },
      }),
      prisma.conversation.update({
        where: { id: conv.id },
        data: {
          model: input.model?.trim() || null,
          temperature:
            typeof input.temperature === "number" ? input.temperature : null,
        },
      }),
    ]);
  } catch (error) {
    // 不写入历史，直接抛出，让上层决定如何处理
    throw error;
  }
}

