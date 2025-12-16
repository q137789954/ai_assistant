import { withGlobalResponse } from "@/server/middleware/responseFormatter";
import {
  grokChat,
  resetGrokConversation,
  DEFAULT_GROK_MODEL,
  DEFAULT_SYSTEM_PROMPT,
} from "@/server/llm/grok";

/**
 * Grok 聊天接口（给前端调用）
 * - POST /api/llm/grok
 * - body:
 *   {
 *     conversationId?: string,
 *     message: string,
 *     systemPrompt?: string,
 *     model?: string,
 *     temperature?: number,
 *     reset?: boolean
 *   }
 *
 * 返回（统一格式由 withGlobalResponse 包装）：
 * - data: { conversationId: string, reply: string }
 */

// 强制使用 Node.js Runtime：依赖 crypto/randomUUID + OpenAI SDK Node 实现
export const runtime = "nodejs";
// 动态接口：避免被 Next 缓存
export const dynamic = "force-dynamic";

type GrokChatRequestBody = {
  conversationId?: string;
  message?: string;
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  reset?: boolean;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | GrokChatRequestBody
    | null;

  return withGlobalResponse(async () => {
    // 1) 解析/校验入参
    const conversationId =
      typeof body?.conversationId === "string"
        ? body.conversationId.trim()
        : undefined;

    const message =
      typeof body?.message === "string" ? body.message.trim() : "";

    const systemPrompt =
      typeof body?.systemPrompt === "string"
        ? body.systemPrompt
        : undefined;

    const model =
      typeof body?.model === "string" && body.model.trim()
        ? body.model.trim()
        : DEFAULT_GROK_MODEL;

    const temperature =
      typeof body?.temperature === "number" ? body.temperature : undefined;

    const reset = body?.reset === true;

    if (reset && conversationId) {
      // reset=true 且给了 conversationId：清空上下文
      resetGrokConversation(conversationId);
    }

    if (!message) {
      // 给一个更明确的错误提示，便于前端 UI 显示
      throw new Error("message 不能为空");
    }

    // 2) 调用 Grok（含上下文记忆）
    const result = await grokChat({
      conversationId,
      userMessage: message,
      systemPrompt: systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      model,
      temperature,
    });

    return {
      conversationId: result.conversationId,
      reply: result.reply,
    };
  });
}

