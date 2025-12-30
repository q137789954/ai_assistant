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
  const [agree, setAgree] = useState(false);

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
    setError(null);
    setNotice(null);
    // 未勾选协议时不允许提交
    if (!agree) {
      setError("请先勾选同意条款与隐私政策");
      return;
    }
    setSubmitting(true);
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

  // 布局与登录页保持一致，统一品牌视觉
  return (
    <main className="flex min-h-dvh w-full flex-col items-center justify-center">
      <div className="w-full max-w-md px-6 py-10">
        <h1 className="text-5xl font-black! text-primary italic text-center">
          ROAST.AI
        </h1>
        <p className="mt-2 text-sm text-white/80 font-bold">
          Create an account to enter the arena.
        </p>

        <form onSubmit={handleRegister} className="mt-6 space-y-4">
          <label className="block">
            <input
              className="mt-1 w-full rounded-sm border-strong bg-surface-2 p-3 text-sm text-slate-900 outline-none focus:border-slate-400"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your nickname (optional)"
              autoComplete="nickname"
            />
          </label>

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
            <input
              className="mt-1 w-full rounded-sm border-strong bg-surface-2 p-3 text-sm text-slate-900 outline-none focus:border-slate-400"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              placeholder="Password (at least 6 characters)"
            />
          </label>

          <label className="block">
            <div className="mt-1 flex gap-3">
              <input
                className="w-full rounded-sm border-strong bg-surface-2 p-3 text-sm text-slate-900 outline-none focus:border-slate-400"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Enter 6-digit code"
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
                  ? `Resend (${countdown}s)`
                  : sendingCode
                    ? "Sending..."
                    : "Get code"}
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

          <label className="flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
              className="h-4 w-4 rounded-sm border-strong bg-surface-2 text-primary focus:ring-2 focus:ring-primary"
            />
            <span>
              I agree to{" "}
              <a
                className="font-semibold text-secondary underline hover:text-primary"
                href="/terms"
                target="_blank"
                rel="noreferrer"
              >
                Terms
              </a>{" "}
              &{" "}
              <a
                className="font-semibold text-secondary underline hover:text-primary"
                href="/privacy"
                target="_blank"
                rel="noreferrer"
              >
                Privacy
              </a>
            </span>
          </label>

          <div className="w-full flex justify-center">
            <button
              className="w-50 mx-auto rounded-full bg-primary px-4 py-3 text-sm! font-black! text-black! italic text-center hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
              type="submit"
              disabled={
                submitting ||
                !agree ||
                !email.trim() ||
                !password.trim() ||
                !code.trim()
              }
            >
              ENTER THE ARENA {submitting ? "..." : ""}
            </button>
          </div>
        </form>

        <div className="flex justify-center mt-5">
          <a
            className="text-sm text-center font-medium text-secondary underline trans-base hover:text-primary"
            href="/login"
          >
            Already have an account? <span>Log in</span>
          </a>
        </div>
      </div>
    </main>
  );
}
