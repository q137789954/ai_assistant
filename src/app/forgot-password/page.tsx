"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 忘记密码页
 * - 发送重置验证码到邮箱
 * - 校验验证码后重置密码
 */
export default function ForgotPasswordPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 倒计时处理，避免重复发送验证码
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
      const res = await fetch("/api/auth/reset-password/send-code", {
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
          "验证码已发送，请查收邮箱（5 分钟内有效）",
      );
      setCountdown(60);
    } finally {
      setSendingCode(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (!email || !code || !password || !confirmPassword) {
      setError("请完整填写邮箱、验证码与新密码");
      return;
    }

    if (password.length < 6) {
      setError("新密码长度不足（至少 6 位）");
      return;
    }

    if (password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, code }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: true; message?: string }
        | { ok: false; message?: string }
        | null;

      if (!res.ok) {
        setError(
          (data && "message" in data && data.message) || "重置失败，请稍后重试",
        );
        return;
      }

      setNotice(
        (data && "message" in data && data.message) ||
          "密码已重置，正在前往登录页",
      );
      setTimeout(() => router.replace("/login"), 600);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh w-full flex-col items-center justify-center">
      <div className="w-full max-w-md px-6 py-10">
        <h1 className="text-5xl font-black! text-primary italic text-center">
          ROAST.AI
        </h1>
        <p className="mt-2 text-sm text-white/80 font-bold">
          Reset your password with email verification.
        </p>

        <form onSubmit={handleReset} className="mt-6 space-y-4">
          <label className="block">
            <input
              className="mt-1 w-full rounded-sm border-strong bg-surface-2 p-3 text-sm text-slate-900 outline-none focus:border-slate-400"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              required
            />
          </label>

          <label className="block">
            <div className="mt-1 flex gap-3">
              <input
                className="w-full rounded-sm border-strong bg-surface-2 p-3 text-sm text-slate-900 outline-none focus:border-slate-400"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="输入邮箱收到的 6 位验证码"
                required
              />
              <button
                type="button"
                onClick={handleSendCode}
                // 发送验证码按钮，倒计时期间禁用以避免重复请求
                className="w-30! shrink-0 whitespace-nowrap rounded-sm border-strong bg-surface-2 px-3 py-2 text-sm font-semibold text-secondary hover:bg-surface-3 disabled:opacity-60 cursor-pointer"
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

          <label className="block">
            <input
              className="mt-1 w-full rounded-sm border-strong bg-surface-2 p-3 text-sm text-slate-900 outline-none focus:border-slate-400"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="新密码（至少 6 位）"
              required
              minLength={6}
            />
          </label>

          <label className="block">
            <input
              className="mt-1 w-full rounded-sm border-strong bg-surface-2 p-3 text-sm text-slate-900 outline-none focus:border-slate-400"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="确认新密码"
              required
              minLength={6}
            />
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

          <div className="w-full flex justify-center">
            <button
              className="w-50 mx-auto rounded-full bg-primary px-4 py-3 text-sm! font-black! text-black! italic text-center hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
              type="submit"
              disabled={
                submitting ||
                !email.trim() ||
                !code.trim() ||
                !password.trim() ||
                !confirmPassword.trim()
              }
            >
              RESET PASSWORD {submitting ? "..." : ""}
            </button>
          </div>
        </form>

        <div className="flex justify-center mt-5">
          <a
            className="text-sm text-center font-medium text-secondary underline trans-base hover:text-primary"
            href="/login"
          >
            Back to <span>Login</span>
          </a>
        </div>
      </div>
    </main>
  );
}
