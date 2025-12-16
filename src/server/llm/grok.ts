import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import { randomUUID } from "crypto";

import { prisma } from "@/server/db/prisma";

/**
 * Grok（xAI）服务端适配层
 * ------------------------------------------------------------
 * 目标：
 * 1) 封装 xAI 的 Chat Completions 调用（使用 OpenAI 兼容 SDK）
 * 2) 提供“上下文记忆”（对话历史）能力
 * 3) 供 Next.js API Route 直接调用
 *
 * 重要说明（上下文记忆的落地方式）：
 * - 这里使用“数据库（Prisma/PostgreSQL）”进行持久化存储，避免进程重启丢上下文。
 * - conversationId 作为会话唯一标识：前端每次带上即可续写上下文。
 * - 为避免单次请求上下文过长，这里默认只取最近 MAX_MESSAGES 条消息。
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
 */
const MAX_MESSAGES = 40;

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
 * 获取或创建一个对话
 * - 如果未传 conversationId，则自动生成并创建新对话
 * - 会从数据库读取最近 MAX_MESSAGES 条历史消息
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
        temperature: typeof params.temperature === "number" ? params.temperature : null,
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

  // 3) 读取最近的历史消息（只取必要字段）
  const rows = await prisma.conversationMessage.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "desc" },
    take: MAX_MESSAGES,
    select: { role: true, content: true },
  });

  // Prisma take+desc 需要反转，保证从旧到新
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
 */
export async function resetGrokConversation(conversationId: string) {
  const id = conversationId.trim();
  if (!id) {
    return;
  }
  // 删除消息，但保留会话本身（便于前端继续沿用 conversationId）
  await prisma.conversationMessage.deleteMany({ where: { conversationId: id } });
  // 触发 updatedAt 更新，便于按时间排序/观测
  await prisma.conversation.update({
    where: { id },
    data: { model: null, temperature: null },
  }).catch(() => {
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

  const client = getGrokClient();
  const raw = await client.chat.completions.create({
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
        temperature: typeof input.temperature === "number" ? input.temperature : null,
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
 * 与 Grok 对话（流式输出 + 上下文记忆）
 * ------------------------------------------------------------
 * 使用方式：
 * - for await (const delta of grokChatStream(...)) { ... }
 *
 * 上下文写入策略：
 * - 为避免“失败污染对话”，这里在完整流结束后才把 user/assistant 写回历史。
 * - 如果你更希望在开始时就写入 user（例如用于并发占位），可改为先写入 user，再在异常时回滚。
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

  const client = getGrokClient();

  // OpenAI SDK 的 stream 模式会返回一个可 async-iterate 的流
  const stream = (await client.chat.completions.create({
    model: input.model?.trim() || DEFAULT_GROK_MODEL,
    messages: requestMessages,
    temperature: input.temperature,
    stream: true,
  })) as AsyncIterable<ChatCompletionChunk>;

  let fullReply = "";

  try {
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (!delta) {
        continue;
      }
      fullReply += delta;
      yield { conversationId: conv.id, delta };
    }

    // 流结束后写入“对话记忆”
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
