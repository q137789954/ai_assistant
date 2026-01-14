"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { Tooltip } from "antd";
import { Crown } from "lucide-react";

type SubscriptionSnapshot = {
  // 当前账户是否已订阅
  isSubscribed: boolean;
  // 订阅到期时间（ISO 字符串或 null）
  subscriptionExpiresAt: string | null;
  // 已使用的 TTS 次数（用于计算剩余额度）
  ttsUsageCount: number;
  // 免费额度上限（由接口返回，便于前端展示）
  freeLimit: number;
};

// Tabbar 订阅状态徽标：仅展示一个小图标，悬浮展示详情
const SubscriptionStatusBadge = () => {
  // 会话状态用于判断是否允许拉取订阅信息
  const { status: sessionStatus } = useSession();
  // 订阅状态拉取中的 loading
  const [loading, setLoading] = useState(false);
  // 拉取或结账异常信息
  const [error, setError] = useState<string | null>(null);
  // 服务端订阅快照
  const [subscription, setSubscription] = useState<SubscriptionSnapshot | null>(
    null
  );

  // 拉取订阅状态：统一封装以便首次进入与刷新时复用
  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/subscription/status");
      const payload = (await response.json().catch(() => null)) as {
        success?: boolean;
        data?: SubscriptionSnapshot;
        message?: string;
      } | null;
      if (!response.ok || !payload?.success || !payload.data) {
        throw new Error(payload?.message || "订阅状态查询失败");
      }
      setSubscription(payload.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "订阅状态查询失败");
    } finally {
      setLoading(false);
    }
  }, []);

  // 会话就绪后再拉取订阅快照，未登录时清空显示状态
  useEffect(() => {
    if (sessionStatus === "authenticated") {
      void fetchStatus();
      return;
    }
    if (sessionStatus === "unauthenticated") {
      setSubscription(null);
      setLoading(false);
      setError(null);
    }
  }, [fetchStatus, sessionStatus]);

  // 计算剩余免费额度，避免出现负数
  const remainingCount = useMemo(() => {
    if (!subscription) return 0;
    return Math.max(subscription.freeLimit - subscription.ttsUsageCount, 0);
  }, [subscription]);

  // 订阅到期时间格式化（非订阅用户返回占位）
  const formattedExpire = useMemo(() => {
    if (!subscription?.subscriptionExpiresAt) return "暂无";
    const date = new Date(subscription.subscriptionExpiresAt);
    if (Number.isNaN(date.getTime())) return "暂无";
    return date.toLocaleDateString("zh-CN");
  }, [subscription?.subscriptionExpiresAt]);

  // 将状态映射为 tooltip 文案与图标色彩，避免渲染逻辑分散
  const statusMeta = useMemo(() => {
    if (sessionStatus === "loading") {
      return {
        tooltip: "订阅状态加载中",
        iconClassName: "text-slate-400",
        clickable: false,
      };
    }
    if (sessionStatus === "unauthenticated") {
      return {
        tooltip: "未登录，登录后查看订阅信息",
        iconClassName: "text-slate-500",
        clickable: false,
      };
    }
    if (loading) {
      return {
        tooltip: "正在同步订阅状态",
        iconClassName: "text-amber-300",
        clickable: false,
      };
    }
    if (error) {
      return {
        tooltip: `订阅状态异常：${error}`,
        iconClassName: "text-rose-400",
        clickable: false,
      };
    }
    if (subscription?.isSubscribed) {
      return {
        tooltip: `已订阅，到期时间 ${formattedExpire}`,
        iconClassName: "text-lime-300",
        clickable: false,
      };
    }
    return {
      tooltip: `未订阅，剩余免费 ${remainingCount}/${subscription?.freeLimit ?? 0} 次，点击去订阅`,
      iconClassName: "text-slate-400",
      clickable: true,
    };
  }, [error, formattedExpire, loading, remainingCount, sessionStatus, subscription]);

  // 订阅结账：点击后跳转到支付页面
  const handleCheckout = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/subscription/checkout", {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as {
        success?: boolean;
        data?: { checkoutUrl?: string };
        message?: string;
      } | null;
      if (!response.ok || !payload?.success || !payload.data?.checkoutUrl) {
        throw new Error(payload?.message || "创建订阅会话失败");
      }
      window.location.href = payload.data.checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "订阅发起失败");
    }
  }, []);

  return (
    <Tooltip title={statusMeta.tooltip}>
      <span>
        <button
          type="button"
          aria-label="订阅状态"
          disabled={!statusMeta.clickable}
          onClick={statusMeta.clickable ? handleCheckout : undefined}
          className={[
            "flex h-9 w-9 items-center justify-center rounded-full border transition",
            statusMeta.clickable
              ? "cursor-pointer border-white/20 bg-black/30 hover:border-lime-300 hover:text-lime-200"
              : "cursor-default border-white/10 bg-black/20",
            statusMeta.iconClassName,
          ].join(" ")}
        >
          <Crown size={18} />
        </button>
      </span>
    </Tooltip>
  );
};

export default SubscriptionStatusBadge;
