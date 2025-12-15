/**
 * OpenAI 大语言模型基础调用封装（不依赖 SDK，基于 fetch 调用 OpenAI HTTP API）。
 *
 * 设计目标：
 * - 作为 `src/server/llm` 下的“基础能力”，让上层业务只关心 messages / 文本结果
 * - 同时提供最常见的两种模式：非流式（一次性返回）与流式（SSE 增量返回）
 * - 统一错误结构，方便在 API Route / Socket.IO 等场景中做日志与重试
 *
 * 说明：
 * - 默认调用 `POST /v1/chat/completions`（兼容性最好、上手最直接）
 * - 需要在服务端环境设置 `OPENAI_API_KEY`
 * - 如使用代理/自建网关，可设置 `OPENAI_BASE_URL`（例如 https://api.openai.com）
 */

export type OpenAIChatRole = "system" | "user" | "assistant" | "tool";

export type OpenAIChatMessage = {
  role: OpenAIChatRole;
  content: string;
  name?: string;
};

export type OpenAIUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export type OpenAIChatCompletionResponse = {
  id?: string;
  model?: string;
  usage?: OpenAIUsage;
  choices?: Array<{
    index?: number;
    message?: { role?: OpenAIChatRole; content?: string };
    delta?: { role?: OpenAIChatRole; content?: string };
    finish_reason?: string | null;
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
};

export type OpenAIChatCompletionOptions = {
  /**
   * OpenAI 模型名，例如：gpt-4o-mini / gpt-4.1-mini 等。
   */
  model?: string;
  /**
   * 生成温度：越高越发散，越低越确定。
   */
  temperature?: number;
  /**
   * 最大输出 token 数。
   */
  maxTokens?: number;
  /**
   * 采样 top_p。
   */
  topP?: number;
  /**
   * OpenAI 侧 user 字段（可选，用于风控/追踪）。
   */
  user?: string;
  /**
   * 超时（毫秒），到时会主动 abort。
   */
  timeoutMs?: number;
  /**
   * 外部传入的 abort signal（可用于上层取消）。
   */
  signal?: AbortSignal;
  /**
   * 覆盖 baseURL（默认从环境变量读取）。
   */
  baseURL?: string;
  /**
   * 覆盖 apiKey（默认从环境变量读取）。
   */
  apiKey?: string;
};

/**
 * 统一 OpenAI 错误：把 HTTP 状态码、OpenAI error 字段与响应体拼起来，方便排查。
 */
export class OpenAIAPIError extends Error {
  public readonly status: number;
  public readonly type?: string;
  public readonly code?: string;
  public readonly requestId?: string;
  public readonly raw?: unknown;

  constructor(params: {
    message: string;
    status: number;
    type?: string;
    code?: string;
    requestId?: string;
    raw?: unknown;
  }) {
    super(params.message);
    this.name = "OpenAIAPIError";
    this.status = params.status;
    this.type = params.type;
    this.code = params.code;
    this.requestId = params.requestId;
    this.raw = params.raw;
  }
}

const DEFAULT_BASE_URL = "https://api.openai.com";
const DEFAULT_MODEL = "gpt-4o-mini";

/**
 * 读取并校验 OpenAI 基础配置。
 */
export const getOpenAIConfig = (overrides?: {
  baseURL?: string;
  apiKey?: string;
}) => {
  const baseURL = (overrides?.baseURL ?? process.env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const apiKey = overrides?.apiKey ?? process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "未配置 OPENAI_API_KEY：请在服务端环境变量中设置 OPENAI_API_KEY（或在调用时通过 options.apiKey 传入）。",
    );
  }

  return { baseURL, apiKey };
};

/**
 * 用于为 fetch 创建一个可控超时 + 可叠加上层 signal 的 AbortSignal。
 */
const createAbortSignal = (timeoutMs?: number, external?: AbortSignal) => {
  if (!timeoutMs && !external) {
    return undefined;
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  if (typeof timeoutMs === "number" && timeoutMs > 0) {
    timeout = setTimeout(abort, timeoutMs);
  }

  if (external) {
    if (external.aborted) {
      abort();
    } else {
      external.addEventListener("abort", abort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (external) {
        external.removeEventListener("abort", abort);
      }
    },
  };
};

/**
 * 把 OpenAI 返回的错误尽可能解析出来（包括 request-id / json error / text body）。
 */
const buildOpenAIError = async (response: Response) => {
  const requestId = response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? undefined;

  let rawText: string | null = null;
  let rawJson: unknown = undefined;

  try {
    rawText = await response.text();
    try {
      rawJson = rawText ? (JSON.parse(rawText) as unknown) : undefined;
    } catch {
      rawJson = undefined;
    }
  } catch {
    rawText = null;
  }

  const asResponse = rawJson as OpenAIChatCompletionResponse | undefined;
  const message =
    asResponse?.error?.message ??
    (rawText ? `OpenAI API 请求失败（HTTP ${response.status}）：${rawText}` : `OpenAI API 请求失败（HTTP ${response.status}）`);

  return new OpenAIAPIError({
    message,
    status: response.status,
    type: asResponse?.error?.type,
    code: asResponse?.error?.code,
    requestId,
    raw: rawJson ?? rawText,
  });
};

/**
 * 非流式：一次性拿到完整回复文本。
 */
export const openAIChatCompletion = async (
  messages: OpenAIChatMessage[],
  options: OpenAIChatCompletionOptions = {},
) => {
  const { baseURL, apiKey } = getOpenAIConfig({ baseURL: options.baseURL, apiKey: options.apiKey });
  const model = options.model ?? DEFAULT_MODEL;

  const abort = createAbortSignal(options.timeoutMs, options.signal);
  try {
    const response = await fetch(`${baseURL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        top_p: options.topP,
        user: options.user,
        stream: false,
      }),
      signal: abort?.signal,
    });

    if (!response.ok) {
      throw await buildOpenAIError(response);
    }

    const json = (await response.json()) as OpenAIChatCompletionResponse;
    const text = json.choices?.[0]?.message?.content ?? "";

    return {
      text,
      usage: json.usage,
      raw: json,
    };
  } finally {
    abort?.cleanup();
  }
};

/**
 * 流式：以 AsyncGenerator 的形式持续产出增量文本，便于上层转发给 SSE / WebSocket。
 *
 * 用法示例：
 * for await (const chunk of openAIChatCompletionStream(messages)) {
 *   process.stdout.write(chunk.deltaText);
 * }
 */
export async function* openAIChatCompletionStream(
  messages: OpenAIChatMessage[],
  options: OpenAIChatCompletionOptions = {},
): AsyncGenerator<
  { deltaText: string; rawEvent?: unknown },
  { fullText: string; raw?: OpenAIChatCompletionResponse },
  void
> {
  const { baseURL, apiKey } = getOpenAIConfig({ baseURL: options.baseURL, apiKey: options.apiKey });
  const model = options.model ?? DEFAULT_MODEL;

  const abort = createAbortSignal(options.timeoutMs, options.signal);
  try {
    const response = await fetch(`${baseURL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        top_p: options.topP,
        user: options.user,
        stream: true,
      }),
      signal: abort?.signal,
    });

    if (!response.ok) {
      throw await buildOpenAIError(response);
    }
    if (!response.body) {
      throw new OpenAIAPIError({
        message: "OpenAI 流式响应缺少 body（ReadableStream 不存在）",
        status: 500,
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");

    let buffer = "";
    let fullText = "";
    let lastRaw: OpenAIChatCompletionResponse | undefined = undefined;

    const flushLines = (isFinal: boolean) => {
      // SSE 的基本格式是按行输出，真正的事件以空行分隔；但我们只需处理 data 行即可。
      // 这里用“逐行解析”的方式，简单可靠（即使没有严格的空行分隔，也能处理）。
      const lines = buffer.split(/\r?\n/);
      buffer = isFinal ? "" : lines.pop() ?? "";

      const deltas: Array<{ deltaText: string; rawEvent?: unknown }> = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
          continue;
        }

        const payload = trimmed.replace(/^data:\s*/, "");
        if (!payload) {
          continue;
        }
        if (payload === "[DONE]") {
          // 流式结束标记。
          return { done: true as const, deltas };
        }

        let eventJson: unknown;
        try {
          eventJson = JSON.parse(payload) as unknown;
        } catch {
          // 某些代理可能会夹杂非 JSON 输出；这里选择忽略，避免中断整个流。
          continue;
        }

        const event = eventJson as OpenAIChatCompletionResponse;
        lastRaw = event;
        const delta = event.choices?.[0]?.delta?.content ?? "";
        if (delta) {
          fullText += delta;
          deltas.push({ deltaText: delta, rawEvent: eventJson });
        }
      }

      return { done: false as const, deltas };
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        const r = flushLines(true);
        for (const delta of r.deltas) {
          yield delta;
        }
        if (r.done) {
          break;
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const r = flushLines(false);
      for (const delta of r.deltas) {
        yield delta;
      }
      if (r.done) {
        break;
      }
    }

    return { fullText, raw: lastRaw };
  } finally {
    abort?.cleanup();
  }
}
