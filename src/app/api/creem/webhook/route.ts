import { NextResponse } from "next/server";
import crypto from "crypto";

import { prisma } from "@/server/db/prisma";
import { withGlobalResponse } from "@/server/middleware/responseFormatter";

type CreemWebhookPayload = {
  eventType?: string;
  object?: Record<string, unknown>;
};

// 从 payload 中提取 userId，兼容 metadata 与 subscription.metadata 两种位置
const extractUserId = (payload: CreemWebhookPayload) => {
  const object = payload.object ?? {};
  const metadata = (object.metadata as Record<string, unknown>) ?? {};
  const subscription = object.subscription as Record<string, unknown> | undefined;
  const subscriptionMetadata =
    (subscription?.metadata as Record<string, unknown>) ?? {};

  const candidate =
    metadata.userId ??
    metadata.user_id ??
    subscriptionMetadata.userId ??
    subscriptionMetadata.user_id;

  return typeof candidate === "string" ? candidate : "";
};

// 提取订阅到期时间（优先 subscription.current_period_end_date）
const extractSubscriptionEndDate = (payload: CreemWebhookPayload) => {
  const object = payload.object ?? {};
  const subscription = object.subscription as Record<string, unknown> | undefined;
  const endDate =
    subscription?.current_period_end_date ?? object.current_period_end_date;
  if (typeof endDate === "string") {
    const parsed = new Date(endDate);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof endDate === "number") {
    const parsed = new Date(endDate);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

/**
 * 接收 Creem Webhook 事件，同步订阅状态。
 */
export async function POST(request: Request) {
  console.log("[creem webhook] 请求到达");
  const signature = request.headers.get("creem-signature");
  const webhookSecret = process.env.CREEM_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    console.warn("[creem webhook] 缺少签名或密钥", {
      hasSignature: Boolean(signature),
      hasSecret: Boolean(webhookSecret),
    });
    return NextResponse.json(
      {
        success: false,
        code: 1,
        message: "Webhook 校验信息缺失",
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 400 },
    );
  }

  const rawBody = await request.text();
  console.log("[creem webhook] 原始请求体长度", rawBody.length);
  const computedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");

  if (computedSignature !== signature) {
    console.warn("[creem webhook] 签名校验失败", {
      signature,
      computedSignature,
    });
    return NextResponse.json(
      {
        success: false,
        code: 1,
        message: "Webhook 签名校验失败",
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 400 },
    );
  }

  return withGlobalResponse(async () => {
    console.log("[creem webhook] 签名校验通过");
    const payload = JSON.parse(rawBody) as CreemWebhookPayload;
    console.log("[creem webhook] 事件类型", payload.eventType);
    const userId = extractUserId(payload);

    if (!userId) {
      console.warn("[creem webhook] 未找到 userId", payload.object);
      throw new Error("Webhook 缺少 userId 元信息");
    }

    const eventType = payload.eventType ?? "";
    const subscriptionEnd = extractSubscriptionEndDate(payload);
    console.log("[creem webhook] userId 与到期时间", {
      userId,
      subscriptionEnd,
    });

    if (
      eventType === "checkout.completed" ||
      eventType === "subscription.active" ||
      eventType === "subscription.paid"
    ) {
      console.log("[creem webhook] 订阅激活事件，写入订阅状态");
      await prisma.user.update({
        where: { id: userId },
        data: {
          isSubscribed: true,
          subscriptionExpiresAt: subscriptionEnd,
        },
      });
    }

    if (
      eventType === "subscription.canceled" ||
      eventType === "subscription.expired" ||
      eventType === "subscription.paused"
    ) {
      console.log("[creem webhook] 订阅终止事件，写入订阅状态");
      await prisma.user.update({
        where: { id: userId },
        data: {
          isSubscribed: false,
          subscriptionExpiresAt: subscriptionEnd,
        },
      });
    }

    console.log("[creem webhook] 处理完成");
    return { ok: true };
  });
}

/**
 * 健康检查用 GET，便于平台验证或本地自测。
 */
export async function GET() {
  return NextResponse.json(
    {
      success: true,
      code: 0,
      data: { ok: true },
      meta: { timestamp: new Date().toISOString() },
    },
    { status: 200 },
  );
}
