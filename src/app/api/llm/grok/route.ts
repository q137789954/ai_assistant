import { withGlobalResponse } from "@/server/middleware/responseFormatter";
import {
  grokChat,
  grokChatStream,
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
 *     reset?: boolean,
 *     stream?: boolean
 *   }
 *
 * 返回（统一格式由 withGlobalResponse 包装）：
 * - data: { conversationId: string, reply: string }
 *
 * 流式返回（SSE）：
 * - 当 body.stream === true 时，返回 text/event-stream
 * - event: meta  -> data: {"conversationId": "..."}
 * - event: delta -> data: {"delta":"..."}
 * - event: done  -> data: {}
 * - event: error -> data: {"message":"..."}
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
  stream?: boolean;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | GrokChatRequestBody
    | null;

  // -----------------------------
  // 1) 公共入参解析（流式/非流式共用）
  // -----------------------------
  const conversationId =
    typeof body?.conversationId === "string"
      ? body.conversationId.trim()
      : undefined;

  const message = typeof body?.message === "string" ? body.message.trim() : "";

  const systemPrompt =
    typeof body?.systemPrompt === "string" ? body.systemPrompt : undefined;

  const model =
    typeof body?.model === "string" && body.model.trim()
      ? body.model.trim()
      : DEFAULT_GROK_MODEL;

  const temperature =
    typeof body?.temperature === "number" ? body.temperature : undefined;

  const reset = body?.reset === true;
  const stream = body?.stream === true;

  if (reset && conversationId) {
    // reset=true 且给了 conversationId：清空上下文
    await resetGrokConversation(conversationId);
  }

  if (!message) {
    // 给一个更明确的错误提示，便于前端 UI 显示
    // - 流式：用 SSE error 返回
    // - 非流式：走 withGlobalResponse 并返回 400
    if (stream) {
      const encoder = new TextEncoder();
      const errorStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `event: error\n` +
                `data: ${JSON.stringify({ message: "message 不能为空" })}\n\n`,
            ),
          );
          controller.close();
        },
      });
      return new Response(errorStream, {
        status: 400,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }
    return withGlobalResponse(
      () => {
        throw new Error("message 不能为空");
      },
      { errorStatus: 400 },
    );
  }

  // -----------------------------
  // 2) 流式模式：返回 SSE（不走 withGlobalResponse）
  // -----------------------------
  if (stream) {
    const encoder = new TextEncoder();

    const sseStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const sendEvent = (event: string, data: unknown) => {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`,
            ),
          );
        };

        try {
          // 先启动 Grok 流
          let emittedMeta = false;

          for await (const chunk of grokChatStream({
            conversationId,
            userMessage: message,
            systemPrompt: systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
            model,
            temperature,
            stream: true,
          })) {
            // 首包时先把 conversationId 告诉前端，方便前端后续续写上下文
            if (!emittedMeta) {
              sendEvent("meta", { conversationId: chunk.conversationId });
              emittedMeta = true;
            }
            // grokChatStream 会先 yield 一个空 delta，用于让上层尽早拿到 conversationId
            if (chunk.delta) {
              sendEvent("delta", { delta: chunk.delta });
            }
          }

          sendEvent("done", {});
          controller.close();
        } catch (error) {
          sendEvent("error", {
            message: error instanceof Error ? error.message : "服务端发生未知错误",
          });
          controller.close();
        }
      },
    });

    return new Response(sseStream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  // -----------------------------
  // 3) 非流式模式：统一 JSON 返回
  // -----------------------------
  return withGlobalResponse(async () => {
    // 调用 Grok（含上下文记忆）
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
