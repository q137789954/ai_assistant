"use client";

import { FormEvent, useCallback, useMemo, useRef, useState } from "react";

/**
 * Grok 接口测试页面
 * - 访问路径：/grok-test
 * - 作用：手动测试服务端 `/api/llm/grok` 的对话、上下文记忆、重置能力
 *
 * 注意：
 * - 该页面是“开发调试用途”，生产环境可按需移除或加鉴权保护
 */

type GlobalResponse<T> = {
  success: boolean;
  code: number;
  data?: T;
  message?: string;
  meta?: { timestamp: string };
};

type GrokApiData = {
  conversationId: string;
  reply: string;
};

type MessageRole = "user" | "assistant";
type ChatMessage = {
  id: string;
  role: MessageRole;
  content: string;
};

function safeRandomId() {
  // 浏览器侧优先用 crypto.randomUUID；极端情况下退化为时间戳
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Date.now());
}

export default function GrokTestPage() {
  // 当前对话 ID：用于“上下文记忆”
  const [conversationId, setConversationId] = useState<string>("");
  // 系统提示词：新对话时生效；旧对话也会随请求传入（服务端会做限制）
  const [systemPrompt, setSystemPrompt] = useState<string>(
    "你是一个中文为主的智能助手，回答要准确、简洁，并在需要时给出可执行的步骤。",
  );
  // 模型/温度：便于调试
  const [model, setModel] = useState<string>("grok-4-1-fast-non-reasoning");
  const [temperature, setTemperature] = useState<string>(""); // 用字符串，避免输入过程的 NaN

  // 聊天记录（前端展示用）
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: safeRandomId(),
      role: "assistant",
      content:
        "这里是 Grok 测试页面。你可以发送消息，验证上下文记忆（conversationId）和重置功能。",
    },
  ]);

  // 输入框草稿
  const [draft, setDraft] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  // 用于把滚动条始终滚到最底部
  const viewportRef = useRef<HTMLDivElement>(null);

  const canSend = useMemo(() => {
    return !loading && draft.trim().length > 0;
  }, [draft, loading]);

  const scrollToBottom = useCallback(() => {
    // setTimeout 让 DOM 更新完后再滚动
    setTimeout(() => {
      const el = viewportRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }, 0);
  }, []);

  const callGrokApi = useCallback(
    async (params: { message: string; reset?: boolean }) => {
      // 1) 组织请求体
      const body: Record<string, unknown> = {
        message: params.message,
        // conversationId：如果为空则不传，让服务端创建新会话
        ...(conversationId ? { conversationId } : {}),
        systemPrompt,
        model,
      };

      // temperature：只有当用户输入了数字时才传
      if (temperature.trim()) {
        const parsed = Number(temperature);
        if (!Number.isNaN(parsed)) {
          body.temperature = parsed;
        }
      }

      // reset：用于测试“重置上下文”
      if (params.reset === true) {
        body.reset = true;
      }

      // 2) 发起请求
      const response = await fetch("/api/llm/grok", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload = (await response.json().catch(() => null)) as
        | GlobalResponse<GrokApiData>
        | null;

      // 3) 统一错误处理：兼容 withGlobalResponse 的 message
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.message ?? "调用 Grok 接口失败");
      }

      if (!payload.data?.conversationId) {
        throw new Error("接口返回缺少 conversationId");
      }

      return payload.data;
    },
    [conversationId, model, systemPrompt, temperature],
  );

  const handleSend = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const text = draft.trim();
      if (!text || loading) return;

      setError("");
      setLoading(true);

      // 1) 先把用户消息追加到 UI，提供即时反馈
      const userMessage: ChatMessage = {
        id: safeRandomId(),
        role: "user",
        content: text,
      };
      setMessages((prev) => [...prev, userMessage]);
      setDraft("");
      scrollToBottom();

      try {
        // 2) 调用后端 Grok 接口
        const data = await callGrokApi({ message: text });

        // 3) 保存/更新 conversationId（用于后续“上下文记忆”）
        setConversationId(data.conversationId);

        // 4) 将助手回复追加到 UI
        const assistantMessage: ChatMessage = {
          id: safeRandomId(),
          role: "assistant",
          content: data.reply || "(空回复)",
        };
        setMessages((prev) => [...prev, assistantMessage]);
        scrollToBottom();
      } catch (err) {
        setError(err instanceof Error ? err.message : "发生未知错误");
      } finally {
        setLoading(false);
      }
    },
    [callGrokApi, draft, loading, scrollToBottom],
  );

  const handleResetConversation = useCallback(async () => {
    // reset 行为：服务端支持 reset + conversationId
    if (!conversationId) {
      // 没有会话时，直接清空 UI 也算“重置”
      setMessages((prev) => prev.slice(0, 1));
      setError("");
      return;
    }

    setError("");
    setLoading(true);
    try {
      // 发送一条“空消息”不合理，所以这里用一个固定的指令型消息，同时带 reset=true
      // - 这样可以测试：服务端先清空会话，再根据该消息生成回复（并建立新的上下文）
      const data = await callGrokApi({
        message: "请确认你已清空之前的对话上下文，并从头开始。",
        reset: true,
      });

      // reset 后会话 ID 可能保持不变（取决于服务端实现），这里以返回为准
      setConversationId(data.conversationId);

      // 清空 UI 历史，只保留开场提示 + 本次系统确认
      setMessages([
        {
          id: safeRandomId(),
          role: "assistant",
          content:
            "已请求重置上下文。接下来发送的消息将从新的上下文开始（取决于服务端存储策略）。",
        },
        {
          id: safeRandomId(),
          role: "assistant",
          content: data.reply || "(空回复)",
        },
      ]);
      scrollToBottom();
    } catch (err) {
      setError(err instanceof Error ? err.message : "发生未知错误");
    } finally {
      setLoading(false);
    }
  }, [callGrokApi, conversationId, scrollToBottom]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-zinc-900">
          Grok 接口测试页面
        </h1>
        <p className="text-sm text-zinc-600">
          测试接口：<code className="rounded bg-zinc-100 px-1">/api/llm/grok</code>
          ，通过 <code className="rounded bg-zinc-100 px-1">conversationId</code>{" "}
          验证上下文记忆。
        </p>
      </header>

      <section className="grid grid-cols-1 gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-zinc-800">
            conversationId（为空则新建会话）
          </label>
          <input
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-sky-400 focus:outline-none"
            value={conversationId}
            onChange={(e) => setConversationId(e.target.value)}
            placeholder="（自动生成）"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                // 手动清空会话 ID：下一次发送会触发服务端创建新会话
                setConversationId("");
                setError("");
              }}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
              disabled={loading}
            >
              清空会话 ID
            </button>
            <button
              type="button"
              onClick={handleResetConversation}
              className="rounded-xl bg-rose-600 px-3 py-2 text-sm text-white hover:bg-rose-500 disabled:opacity-60"
              disabled={loading}
            >
              {loading ? "处理中..." : "重置上下文"}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-zinc-800">model</label>
              <input
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-sky-400 focus:outline-none"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="grok-4-1-fast-reasoning"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-zinc-800">
                temperature（可选）
              </label>
              <input
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-sky-400 focus:outline-none"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                placeholder="例如：0.7"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-zinc-800">
              systemPrompt（系统提示词）
            </label>
            <textarea
              className="min-h-[88px] w-full resize-y rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-sky-400 focus:outline-none"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="输入系统提示词（决定助手风格）"
            />
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      <section className="flex flex-1 flex-col rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <div
          ref={viewportRef}
          className="flex flex-1 flex-col gap-3 overflow-y-auto p-5"
        >
          {messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-[46rem] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                m.role === "assistant"
                  ? "bg-zinc-100 text-zinc-900"
                  : "ml-auto bg-sky-100 text-sky-900"
              }`}
            >
              {m.content}
            </div>
          ))}
        </div>

        <form
          onSubmit={handleSend}
          className="flex flex-col gap-3 border-t border-zinc-200 p-5"
        >
          <textarea
            className="min-h-[70px] w-full resize-y rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-sky-400 focus:outline-none"
            placeholder="输入消息，回车提交（或点击发送）..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-zinc-500">
              当前会话：{" "}
              <code className="rounded bg-zinc-100 px-1">
                {conversationId || "（未建立）"}
              </code>
            </div>
            <button
              type="submit"
              className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-60"
              disabled={!canSend}
            >
              {loading ? "发送中..." : "发送"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

