"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type SubscribeState = "success" | "processing" | "failed" | "unknown";

type SubscriptionSnapshot = {
  isSubscribed: boolean;
  subscriptionExpiresAt: string | null;
};

// 统一解析订阅回调状态，避免页面分支散乱
const resolveSubscribeState = (raw: string | null): SubscribeState => {
  if (!raw) return "unknown";
  if (raw === "success") return "success";
  if (raw === "processing" || raw === "pending") return "processing";
  if (raw === "failed" || raw === "cancel" || raw === "canceled") return "failed";
  return "unknown";
};

// 订阅状态页：展示支付结果 + 同步状态
export default function SubscribeResultPage() {
  const searchParams = useSearchParams();
  const subscribeRaw = searchParams.get("subscribe");
  const subscribeState = useMemo(
    () => resolveSubscribeState(subscribeRaw),
    [subscribeRaw]
  );

  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionSnapshot | null>(
    null
  );

  // 拉取服务端订阅状态，确保展示与 webhook 同步后的结果一致
  const fetchStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const response = await fetch("/api/subscription/status");
      if (!response.ok) {
        throw new Error("订阅状态查询失败");
      }
      const payload = (await response.json()) as {
        success?: boolean;
        data?: SubscriptionSnapshot;
      };
      if (!payload?.data) {
        throw new Error("订阅状态响应异常");
      }
      setSubscription(payload.data);
    } catch (error) {
      setStatusError(
        error instanceof Error ? error.message : "订阅状态拉取失败"
      );
    } finally {
      setStatusLoading(false);
    }
  }, []);

  // 成功或处理中时主动刷新一次，避免用户误以为未生效
  useEffect(() => {
    if (subscribeState === "success" || subscribeState === "processing") {
      void fetchStatus();
    } else {
      setStatusLoading(false);
    }
  }, [fetchStatus, subscribeState]);

  const statusTitle = useMemo(() => {
    if (subscribeState === "success") return "支付完成";
    if (subscribeState === "processing") return "正在同步";
    if (subscribeState === "failed") return "支付未完成";
    return "订阅状态未知";
  }, [subscribeState]);

  const statusDesc = useMemo(() => {
    if (subscribeState === "success") {
      return "我们正在确认订阅状态，请稍候刷新或继续体验。";
    }
    if (subscribeState === "processing") {
      return "支付已提交，系统正在等待 Creem 回调同步。";
    }
    if (subscribeState === "failed") {
      return "没有检测到成功付款，可返回重新发起订阅。";
    }
    return "暂未识别回调状态，可返回首页继续操作。";
  }, [subscribeState]);

  const statusTone = useMemo(() => {
    if (subscribeState === "success") return "border-lime-300 text-lime-200";
    if (subscribeState === "processing") return "border-amber-300 text-amber-200";
    if (subscribeState === "failed") return "border-rose-400 text-rose-200";
    return "border-slate-500 text-slate-200";
  }, [subscribeState]);

  const formattedExpire = useMemo(() => {
    if (!subscription?.subscriptionExpiresAt) return "暂无";
    const date = new Date(subscription.subscriptionExpiresAt);
    if (Number.isNaN(date.getTime())) return "暂无";
    return date.toLocaleString("zh-CN");
  }, [subscription?.subscriptionExpiresAt]);

  return (
    <main
      className="relative h-dvh w-full overflow-x-hidden overflow-y-auto px-6 py-10 [-webkit-overflow-scrolling:touch]"
      style={{
        fontFamily:
          '"Futura","Avenir Next","Gill Sans","Trebuchet MS",sans-serif',
      }}
    >
      {/* 仅限制横向溢出，保留纵向滚动以避免长内容被裁切 */}
      {/* 背景：分层渐变 + 光斑，制造更强的订阅仪式感 */}
      <div className="absolute inset-0 -z-10">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 20% 20%, rgba(204,255,0,0.18), transparent 45%), radial-gradient(circle at 80% 10%, rgba(255,0,85,0.16), transparent 40%), radial-gradient(circle at 50% 80%, rgba(80,200,255,0.12), transparent 50%), linear-gradient(160deg, #0a0a0a 10%, #0f0f12 60%, #101114 100%)",
          }}
        />
        <div className="absolute left-10 top-16 h-40 w-40 rounded-full bg-lime-400/20 blur-3xl" />
        <div className="absolute right-12 top-24 h-52 w-52 rounded-full bg-rose-500/20 blur-3xl" />
        <div className="absolute bottom-10 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-sky-300/10 blur-3xl" />
      </div>

      <section className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        {/* 页面标题区域 */}
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.4em] text-white/50">
            Subscription Relay
          </p>
          <h1 className="text-4xl font-black uppercase text-white sm:text-5xl">
            {statusTitle}
          </h1>
          <p className="max-w-2xl text-base text-white/70">{statusDesc}</p>
        </header>

        {/* 状态卡片 */}
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[0_0_40px_rgba(0,0,0,0.45)] backdrop-blur">
          <div className={`border-l-4 pl-4 ${statusTone}`}>
            <p className="text-sm uppercase tracking-[0.3em] text-white/60">
              Current Status
            </p>
            <div className="mt-2 flex items-center gap-3">
              {subscribeState === "processing" && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-amber-200/70 border-t-transparent" />
              )}
              <p className="text-lg font-semibold text-white">{statusTitle}</p>
            </div>
            <p className="mt-2 text-sm text-white/70">
              系统以 webhook 同步结果为准。
            </p>
          </div>

          {/* 同步进度展示 */}
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              {
                title: "支付确认",
                desc: "Creem 已完成收款校验",
                active: subscribeState !== "failed",
              },
              {
                title: "回调同步",
                desc: "Webhook 正在写入订阅状态",
                active: subscribeState === "success" || subscribeState === "processing",
              },
              {
                title: "账户激活",
                desc: "权限将在数据写入后生效",
                active: subscription?.isSubscribed ?? false,
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-white/10 bg-black/30 p-4"
              >
                <div
                  className={[
                    "h-2 w-full rounded-full",
                    item.active ? "bg-lime-300/80" : "bg-white/10",
                  ].join(" ")}
                />
                <p className="mt-3 text-sm font-semibold text-white">
                  {item.title}
                </p>
                <p className="mt-1 text-xs text-white/60">{item.desc}</p>
              </div>
            ))}
          </div>

          {/* 服务端订阅状态 */}
          <div className="mt-6 rounded-2xl border border-white/10 bg-black/40 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-white/50">
              Server Snapshot
            </p>
            <div className="mt-3 grid gap-3 text-sm text-white/80 sm:grid-cols-2">
              <div>
                <p className="text-white/50">订阅状态</p>
                <p className="mt-1 text-base font-semibold text-white">
                  {statusLoading
                    ? "同步中..."
                    : subscription?.isSubscribed
                      ? "已生效"
                      : "未生效"}
                </p>
              </div>
              <div>
                <p className="text-white/50">到期时间</p>
                <p className="mt-1 text-base font-semibold text-white">
                  {statusLoading ? "同步中..." : formattedExpire}
                </p>
              </div>
            </div>
            {statusError && (
              <p className="mt-3 text-xs text-rose-300">{statusError}</p>
            )}
          </div>
        </div>

        {/* 回调参数展示：仅作为信息提示 */}

        {/* 行动按钮 */}
        <div className="flex flex-wrap gap-4">
          <button
            type="button"
            className="rounded-full border border-white/20 bg-white/10 px-6 py-3 text-sm font-semibold text-white transition hover:border-white/40 hover:bg-white/20"
            onClick={fetchStatus}
          >
            重新同步状态
          </button>
          <Link
            href="/"
            className="rounded-full bg-lime-300 px-6 py-3 text-sm font-bold text-black transition hover:bg-lime-200"
          >
            返回首页
          </Link>
        </div>
      </section>
    </main>
  );
}
