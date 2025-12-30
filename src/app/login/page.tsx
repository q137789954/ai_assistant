"use client";

import { useEffect, useMemo, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Chromium } from "lucide-react";

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
    [searchParams]
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
    <main className="flex min-h-dvh w-full flex-col justify-center items-center">
      <div className="px-6 py-10 w-full max-w-md">
        <h1 className="text-5xl font-black! text-primary italic text-center">
          ROAST.AI
        </h1>
        <p className="mt-2 text-sm text-white/80 font-bold">
          Use Google or log in with your account and password.
        </p>

        {authError && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <p className="font-medium">登录错误：{authError}</p>
          </div>
        )}

        <button
          type="button"
          className={[
            "mt-6 w-full inline-flex items-center justify-center gap-3",
            "rounded-sm px-4 py-3 text-sm font-semibold",
            "bg-[#1A73E8] text-white shadow-sm",
            "hover:bg-[#1669D3] active:bg-[#135CBC]",
            "focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/40",
            "transition-colors cursor-pointer",
          ].join(" ")}
          onClick={() => signIn("google", { callbackUrl })}
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-white">
            {/* Google 'G' (multi-color) */}
            <svg width="14" height="14" viewBox="0 0 48 48" aria-hidden="true">
              <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.35 1.52 8.2 2.8l6-5.78C34.67 3.21 29.74 1 24 1 14.61 1 6.51 6.38 2.56 14.22l7.06 5.48C11.38 13.63 17.2 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.5 24.5c0-1.64-.15-3.21-.43-4.73H24v9.05h12.7c-.55 2.98-2.2 5.5-4.7 7.18l7.2 5.59C43.8 37.28 46.5 31.4 46.5 24.5z"
              />
              <path
                fill="#FBBC05"
                d="M9.62 28.3a14.9 14.9 0 0 1-.78-4.8c0-1.67.29-3.28.78-4.8l-7.06-5.48A23.94 23.94 0 0 0 0 23.5c0 3.87.93 7.53 2.56 10.78l7.06-5.48z"
              />
              <path
                fill="#34A853"
                d="M24 46c5.74 0 10.57-1.9 14.1-5.19l-7.2-5.59c-2 1.34-4.56 2.14-6.9 2.14-6.8 0-12.62-4.13-14.38-10.2l-7.06 5.48C6.51 40.62 14.61 46 24 46z"
              />
            </svg>
          </span>
          使用 Google 登录
        </button>

        <div className="my-6 flex items-center gap-3 text-xs text-slate-400">
          <div className="h-px flex-1 bg-slate-200" />
          或
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        <form onSubmit={handleCredentialsLogin} className="space-y-4">
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
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="Password"
            />
          </label>
          <div className="flex justify-end">
            <a
              className="text-sm text-center font-medium text-secondary underline trans-base hover:text-primary"
              href="/forgot-password"
            >
              Forgot Password?
            </a>
          </div>

          {error && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="w-full flex justify-center">
            <button
              className="w-50 mx-auto rounded-full bg-primary px-4 py-3 text-sm! font-black! text-black! italic text-center hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
              type="submit"
              disabled={submitting}
            >
              ENTER THE ARENA {submitting ? "..." : ""}
            </button>
          </div>
        </form>

        <div className="flex justify-center mt-5">
          <a
            className="text-sm text-center font-medium text-secondary underline trans-base hover:text-primary"
            href="/register"
          >
            No account? <span>Register</span>
          </a>
        </div>
      </div>
    </main>
  );
}
