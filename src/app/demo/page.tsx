"use client";

import { useCallback, useState } from "react";

type DemoResponse<T = unknown> = {
  success: boolean;
  code: number;
  data?: T;
  message?: string;
};

export default function DemoPage() {
  const [result, setResult] = useState<DemoResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const callDemoApi = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/demo");
      const payload = (await response.json()) as DemoResponse;
      if (!response.ok) {
        throw new Error(payload.message ?? "接口返回失败");
      }
      setResult(payload);
    } catch (err) {
      setResult(null);
      setError(
        err instanceof Error ? err.message : "调用示例接口时发生未知错误",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-zinc-50 px-6 py-12 dark:bg-black">
      <div className="w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-8 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="mb-4 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
          Demo API 页面
        </h1>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          点击下方按钮将访问 <code>/api/demo</code>，并展示统一格式的返回。
        </p>
        <button
          className="mb-4 inline-flex items-center justify-center rounded-full bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          type="button"
          onClick={callDemoApi}
          disabled={loading}
        >
          {loading ? "请求中..." : "调 Demo 接口"}
        </button>
        {error && (
          <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-700 dark:bg-red-900/20 dark:text-red-200">
            {error}
          </p>
        )}
        {result && (
          <pre className="overflow-auto rounded-xl border border-zinc-100 bg-zinc-50 p-4 text-xs text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-white">
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
