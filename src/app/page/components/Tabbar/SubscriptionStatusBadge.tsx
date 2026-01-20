"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { Tooltip } from "antd";
import { Crown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/Dialog";
import { Button } from "@/app/components/ui/button";
import Image from "next/image";

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

type SubscriptionAction = "none" | "checkout" | "cancel";

// Tabbar 订阅状态徽标：仅展示一个小图标，悬浮展示详情
const SubscriptionStatusBadge = () => {
  // 会话状态用于判断是否允许拉取订阅信息
  const { status: sessionStatus } = useSession();
  // 订阅状态拉取中的 loading
  const [loading, setLoading] = useState(false);
  // 订阅操作（结账/取消）中的 loading
  const [actionLoading, setActionLoading] = useState(false);
  // 取消订阅二次确认弹窗
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
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
        action: "none" as SubscriptionAction,
      };
    }
    if (sessionStatus === "unauthenticated") {
      return {
        tooltip: "未登录，登录后查看订阅信息",
        iconClassName: "text-slate-500",
        clickable: false,
        action: "none" as SubscriptionAction,
      };
    }
    if (loading) {
      return {
        tooltip: "正在同步订阅状态",
        iconClassName: "text-amber-300",
        clickable: false,
        action: "none" as SubscriptionAction,
      };
    }
    if (actionLoading) {
      return {
        tooltip: "正在处理订阅操作，请稍候",
        iconClassName: "text-amber-300",
        clickable: false,
        action: "none" as SubscriptionAction,
      };
    }
    if (error) {
      return {
        tooltip: `订阅状态异常：${error}`,
        iconClassName: "text-rose-400",
        clickable: false,
        action: "none" as SubscriptionAction,
      };
    }
    if (subscription?.isSubscribed) {
      return {
        tooltip: `已订阅，到期时间 ${formattedExpire}，点击取消订阅`,
        iconClassName: "text-lime-300",
        clickable: true,
        action: "cancel" as SubscriptionAction,
      };
    }
    return {
      tooltip: `未订阅，剩余免费 ${remainingCount}/${subscription?.freeLimit ?? 0} 次，点击去订阅`,
      iconClassName: "text-slate-400",
      clickable: true,
      action: "checkout" as SubscriptionAction,
    };
  }, [
    actionLoading,
    error,
    formattedExpire,
    loading,
    remainingCount,
    sessionStatus,
    subscription,
  ]);

  // 订阅结账：点击后跳转到支付页面
  const handleCheckout = useCallback(async () => {
    setError(null);
    setActionLoading(true);
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
    } finally {
      setActionLoading(false);
    }
  }, []);

  // 打开取消订阅确认弹窗
  const handleOpenCancelDialog = useCallback(() => {
    setCancelDialogOpen(true);
  }, []);

  // 关闭取消订阅确认弹窗，避免操作中被误关
  const handleCloseCancelDialog = useCallback(() => {
    if (actionLoading) return;
    setCancelDialogOpen(false);
  }, [actionLoading]);

  // 取消订阅：请求服务端通知 Creem 终止订阅
  const handleCancelSubscription = useCallback(async () => {
    if (!subscription?.isSubscribed) return;
    setError(null);
    setActionLoading(true);
    try {
      const response = await fetch("/api/subscription/cancel", {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as {
        success?: boolean;
        message?: string;
      } | null;
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.message || "取消订阅失败");
      }
      setCancelDialogOpen(false);
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "取消订阅失败");
    } finally {
      setActionLoading(false);
    }
  }, [fetchStatus, subscription?.isSubscribed]);

  const handleAction = useCallback(() => {
    if (statusMeta.action === "checkout") {
      void handleCheckout();
      return;
    }
    if (statusMeta.action === "cancel") {
      // 已订阅用户点击图标时弹出二次确认弹窗
      handleOpenCancelDialog();
    }
  }, [handleCheckout, handleOpenCancelDialog, statusMeta.action]);

  console.log(statusMeta.clickable, 'statusMeta.clickable')

  return (
    <>
      <Tooltip title={statusMeta.tooltip}>
        <span>
          <button
            type="button"
            aria-label="订阅状态"
            disabled={!statusMeta.clickable || actionLoading}
            onClick={statusMeta.clickable ? handleAction : undefined}
            className={[
              "flex h-9 w-9 items-center justify-center rounded-full border transition",
              statusMeta.clickable
                ? "cursor-pointer border-white/20 bg-black/30 text-[#828479] hover:border-lime-300! hover:text-lime-200!"
                : "cursor-default border-white/10 bg-black/20",
              statusMeta.iconClassName,
            ].join(" ")}
          >
            {/* 使用 Next/Image 渲染本地图标，必要时跳过优化以避免优化器异常导致图标不显示 */}
            {
              subscription?.isSubscribed ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><path fill="#cf0" d="M2.005 19h20v2h-20zm0-14l5 3l5-6l5 6l5-3v12h-20z" stroke-width="0.5" stroke="currentColor"/></svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  className="transition-colors"
                >
                  <path
                    fill="currentColor"
                    d="M2.005 19h20v2h-20zm0-14l5 3.5l5-6.5l5 6.5l5-3.5v12h-20zm2 3.841V15h16V8.841l-3.42 2.394l-4.58-5.955l-4.58 5.955z"
                    stroke="currentColor"
                    strokeWidth="0.5"
                  />
                </svg>
              )
            }
          </button>
        </span>
      </Tooltip>
      {/* 使用统一 Dialog 组件呈现取消订阅的二次确认 */}
      <Dialog
        open={cancelDialogOpen}
        onOpenChange={handleCloseCancelDialog}
        maskClosable={!actionLoading}
        closable={false}
        footer={null}
        className="bg-white/20! border-[rgba(0,0,0,.1)]! backdrop-blur-3xl!"
      >
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-app">确认取消订阅</DialogTitle>
            <DialogDescription className="text-sm text-app">
              取消后将于当前周期结束时生效，期间仍可继续使用订阅权益。
            </DialogDescription>
          </DialogHeader>
          {/* 若取消失败，在弹窗内给出错误提示便于用户再次确认 */}
          {error ? (
            <div className="mt-4 text-sm text-red-600">取消订阅失败</div>
          ) : null}
          <DialogFooter className="mt-6">
            <Button
              appearance="outlined"
              tone="default"
              onClick={handleCloseCancelDialog}
              disabled={actionLoading}
            >
              暂不取消
            </Button>
            <Button
              tone="danger"
              
              onClick={handleCancelSubscription}
              loading={actionLoading}
            >
              确认取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default SubscriptionStatusBadge;
