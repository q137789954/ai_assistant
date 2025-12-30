"use client";

import { useEffect, useMemo, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * 注册页
 * - 调用 /api/auth/register 创建用户（写入 passwordHash）
 * - 注册成功后自动用 Credentials 登录
 */
export default function RegisterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = useMemo(
    () => searchParams.get("callbackUrl") || "/",
    [searchParams],
  );

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  async function handleSendCode() {
    setError(null);
    setNotice(null);
    if (!email || !email.includes("@")) {
      setError("请先填写正确的邮箱");
      return;
    }
    if (countdown > 0 || sendingCode) return;

    setSendingCode(true);
    try {
      const res = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: true; message?: string }
        | { ok: false; message?: string }
        | null;

      if (!res.ok) {
        setError(
          (data && "message" in data && data.message) || "验证码发送失败，请重试",
        );
        return;
      }

      setNotice(
        (data && "message" in data && data.message) ||
          "验证码已发送，请查收邮箱（有效期 5 分钟）",
      );
      setCountdown(60);
    } finally {
      setSendingCode(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, password, code }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; message?: string }
        | null;

      if (!res.ok) {
        setError(
          (data && "message" in data && data.message) || "注册失败，请重试",
        );
        return;
      }

      // 注册成功后，自动使用账号密码登录
      const login = await signIn("credentials", {
        email,
        password,
        callbackUrl,
        redirect: false,
      });

      if (!login?.ok) {
        router.replace(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
        return;
      }

      router.replace(login.url ?? callbackUrl);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-10">
      <h1 className="text-2xl font-semibold text-slate-900">注册</h1>
      <p className="mt-2 text-sm text-slate-900">创建一个账号用于登录。</p>

      <form onSubmit={handleRegister} className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm text-slate-700">昵称（可选）</span>
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="你的名字"
            autoComplete="nickname"
          />
        </label>

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
          <span className="text-sm text-slate-700">密码（至少 6 位）</span>
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
        />
      </label>

      <label className="block">
        <span className="text-sm text-slate-700">邮箱验证码</span>
        <div className="mt-1 flex gap-2">
          <input
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="输入邮箱收到的 6 位验证码"
            required
          />
          <button
            type="button"
            onClick={handleSendCode}
            className="whitespace-nowrap rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-60"
            disabled={sendingCode || countdown > 0}
          >
            {countdown > 0
              ? `重新发送(${countdown}s)`
              : sendingCode
                ? "发送中..."
                : "发送验证码"}
          </button>
        </div>
      </label>

      {notice && (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {notice}
        </p>
      )}

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
          {submitting ? "注册中..." : "注册并登录"}
        </button>
      </form>

      <p className="mt-6 text-sm text-slate-600">
        已有账号？{" "}
        <a className="font-medium text-slate-900 underline" href="/login">
          去登录
        </a>
      </p>
    </main>
  );
}
