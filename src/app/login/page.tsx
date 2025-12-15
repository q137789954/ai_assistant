"use client";

import { useEffect, useMemo, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * 登录页
 * - 支持 Google OAuth
 * - 支持账号密码（Credentials）
 */
export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = useMemo(
    () => searchParams.get("callbackUrl") || "/",
    [searchParams],
  );
  const authError = useMemo(() => searchParams.get("error"), [searchParams]);

  const { status } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 已登录则直接跳回首页（避免重复登录）
  useEffect(() => {
    if (status === "authenticated") router.replace(callbackUrl);
  }, [callbackUrl, router, status]);

  async function handleCredentialsLogin(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await signIn("credentials", {
        email,
        password,
        callbackUrl,
        redirect: false,
      });

      if (!res?.ok) {
        setError("邮箱或密码错误");
        return;
      }
      router.replace(res.url ?? callbackUrl);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-10">
      <h1 className="text-2xl font-semibold text-slate-900">登录</h1>
      <p className="mt-2 text-sm text-slate-600">
        使用 Google 或账号密码登录。
      </p>

      {authError && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <p className="font-medium">登录错误：{authError}</p>
          <p className="mt-1 text-xs text-amber-700">
            常见原因：Google OAuth 回调地址未在 Google Console 配置、或
            `NEXTAUTH_URL` 与当前访问域名不一致。
          </p>
        </div>
      )}

      <button
        type="button"
        className="mt-6 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
        onClick={() => signIn("google", { callbackUrl })}
      >
        使用 Google 登录
      </button>

      <div className="my-6 flex items-center gap-3 text-xs text-slate-400">
        <div className="h-px flex-1 bg-slate-200" />
        或
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <form onSubmit={handleCredentialsLogin} className="space-y-4">
        <label className="block">
          <span className="text-sm text-slate-700">邮箱</span>
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />
        </label>

        <label className="block">
          <span className="text-sm text-slate-700">密码</span>
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <button
          className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          type="submit"
          disabled={submitting}
        >
          {submitting ? "登录中..." : "登录"}
        </button>
      </form>

      <p className="mt-6 text-sm text-slate-600">
        还没有账号？{" "}
        <a className="font-medium text-slate-900 underline" href="/register">
          去注册
        </a>
      </p>
    </main>
  );
}
