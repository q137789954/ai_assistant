"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/Dialog";
import { Button } from "@/app/components/ui/button";

type SubscriptionRequiredDialogProps = {
  open: boolean;
  limit: number;
  used: number;
  remaining: number;
  onSubscribed: () => void;
};

export default function SubscriptionRequiredDialog({
  open,
  limit,
  used,
  remaining,
  onSubscribed,
}: SubscriptionRequiredDialogProps) {
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const handleCheckout = async () => {
    setError("");
    setLoading(true);
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
      setLoading(false);
    }
  };

  const handleCheckStatus = async () => {
    setError("");
    setChecking(true);
    try {
      const response = await fetch("/api/subscription/status");
      const payload = (await response.json().catch(() => null)) as {
        success?: boolean;
        data?: { isSubscribed?: boolean };
        message?: string;
      } | null;
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.message || "订阅状态查询失败");
      }
      if (payload.data?.isSubscribed) {
        onSubscribed();
        return;
      }
      setError("订阅尚未生效，请稍后再试");
    } catch (err) {
      setError(err instanceof Error ? err.message : "订阅状态查询失败");
    } finally {
      setChecking(false);
    }
  };

  return (
    <Dialog open={open} closable={false} maskClosable={false} footer={null}>
      <DialogContent className="rounded-2xl bg-white/95 p-6 shadow-xl">
        <DialogHeader>
          <DialogTitle>免费额度已用完</DialogTitle>
          <DialogDescription className="text-sm text-slate-600">
            当前已使用 {used}/{limit} 次免费语音对话额度。
            订阅后即可继续使用语音对话服务。
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
          <div>剩余额度：{remaining}</div>
          <div>解锁权益：不限次数语音对话 + 优先处理</div>
        </div>
        {error ? (
          <div className="mt-3 text-sm text-red-600">{error}</div>
        ) : null}
        <DialogFooter className="mt-6">
          <Button
            appearance="outlined"
            tone="default"
            onClick={handleCheckStatus}
            loading={checking}
          >
            我已完成订阅
          </Button>
          <Button onClick={handleCheckout} loading={loading}>
            立即订阅
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
