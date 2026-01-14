import { NextResponse } from "next/server";
import crypto from "crypto";

import { prisma } from "@/server/db/prisma";
import { withGlobalResponse } from "@/server/middleware/responseFormatter";

type CreemWebhookPayload = {
  eventType?: string;
  object?: Record<string, unknown>;
};

// 从多个候选值中取第一个有效字符串
const pickString = (...candidates: Array<unknown>) => {
  const found = candidates.find(
    (candidate) => typeof candidate === "string" && candidate.trim() !== ""
  );
  return typeof found === "string" ? found : "";
};

// 解析金额（仅当为有限整数时返回，避免浮点精度问题）
const extractAmount = (...candidates: Array<unknown>) => {
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isInteger(candidate)) {
      return candidate;
    }
    if (typeof candidate === "string") {
      const parsed = Number(candidate);
      if (Number.isInteger(parsed)) {
        return parsed;
      }
    }
  }
  return null;
};

// 将未知类型解析为 Date，失败则返回 null
const toDate = (value: unknown) => {
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
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
  return toDate(endDate);
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

    // 从 payload 中提取订单/订阅相关字段
    const object = payload.object ?? {};
    const subscriptionObject = object.subscription as Record<string, unknown> | undefined;
    const orderObject = object.order as Record<string, unknown> | undefined;
    const productObject = object.product as Record<string, unknown> | undefined;
    const customerObject = object.customer as Record<string, unknown> | undefined;
    const orderId = pickString(
      orderObject?.id,
      object.order_id,
      object.orderId
    );
    const checkoutId = pickString(
      object.id,
      object.checkout_id,
      object.checkoutId
    );
    const customerId = pickString(
      customerObject?.id,
      object.customer_id,
      object.customerId
    );
    const subscriptionId = pickString(
      subscriptionObject?.id,
      subscriptionObject?.subscription_id,
      subscriptionObject?.subscriptionId,
      object.subscription_id,
      object.subscriptionId
    );
    const productId = pickString(
      subscriptionObject?.product,
      subscriptionObject?.product_id,
      subscriptionObject?.productId,
      orderObject?.product,
      productObject?.id,
      object.product_id,
      object.productId
    );
    const requestId = pickString(
      object.request_id,
      object.requestId
    );
    const currency = pickString(
      orderObject?.currency,
      productObject?.currency,
      object.currency,
      object.currency_code,
      object.currencyCode
    );
    const amount = extractAmount(
      orderObject?.amount,
      orderObject?.amount_due,
      orderObject?.amount_paid,
      productObject?.price,
      object.amount,
      object.total_amount,
      object.totalAmount,
      object.unit_amount,
      object.unitAmount
    );
    const subscriptionStatus = pickString(
      subscriptionObject?.status,
      orderObject?.status,
      object.status
    );
    const currentPeriodStart = toDate(
      subscriptionObject?.current_period_start_date ??
        object.current_period_start_date
    );
    const currentPeriodEnd = toDate(
      subscriptionObject?.current_period_end_date ??
        object.current_period_end_date
    );
    const paidAt = toDate(
      orderObject?.paid_at ??
        orderObject?.paidAt ??
        object.paid_at ??
        object.paidAt
    );
    const refundedAt = toDate(
      orderObject?.refunded_at ??
        orderObject?.refundedAt ??
        object.refunded_at ??
        object.refundedAt
    );

    // 先记录 webhook 事件，便于审计与排查（若有 eventId 则做幂等）
    const eventId = pickString(
      (payload as Record<string, unknown>).id,
      (payload as Record<string, unknown>).eventId
    );
    if (eventId) {
      await prisma.webhookEvent.upsert({
        where: { eventId },
        update: {
          eventType: eventType || "unknown",
          signature,
          payload: payload as unknown as Record<string, unknown>,
          processedAt: new Date(),
        },
        create: {
          provider: "creem",
          eventType: eventType || "unknown",
          eventId,
          signature,
          payload: payload as unknown as Record<string, unknown>,
          processedAt: new Date(),
        },
      });
    } else {
      await prisma.webhookEvent.create({
        data: {
          provider: "creem",
          eventType: eventType || "unknown",
          signature,
          payload: payload as unknown as Record<string, unknown>,
          processedAt: new Date(),
        },
      });
    }

    // 写入/更新 Customer、Subscription、Order 三类数据
    await prisma.$transaction(async (tx) => {
      if (customerId) {
        await tx.customer.upsert({
          where: { customerId },
          update: {
            userId,
            email: pickString(
              customerObject?.email,
              object.customer_email,
              object.email
            ),
            rawPayload:
              (customerObject as Record<string, unknown>) ??
              (object as unknown as Record<string, unknown>),
          },
          create: {
            userId,
            customerId,
            email: pickString(
              customerObject?.email,
              object.customer_email,
              object.email
            ),
            rawPayload:
              (customerObject as Record<string, unknown>) ??
              (object as unknown as Record<string, unknown>),
          },
        });
      }

      if (subscriptionId) {
        await tx.subscription.upsert({
          where: { subscriptionId },
          update: {
            userId,
            status: subscriptionStatus || "unknown",
            productId: productId || null,
            currentPeriodStartAt: currentPeriodStart,
            currentPeriodEndAt: currentPeriodEnd ?? subscriptionEnd,
            metadata: subscriptionObject ?? object,
          },
          create: {
            userId,
            subscriptionId,
            status: subscriptionStatus || "unknown",
            productId: productId || null,
            currentPeriodStartAt: currentPeriodStart,
            currentPeriodEndAt: currentPeriodEnd ?? subscriptionEnd,
            metadata: subscriptionObject ?? object,
          },
        });
      }

      if (orderId) {
        await tx.order.upsert({
          where: { orderId },
          update: {
            userId,
            checkoutId: checkoutId || null,
            subscriptionId: subscriptionId || null,
            requestId: requestId || null,
            productId: productId || null,
            amount: amount ?? null,
            currency: currency || null,
            status: subscriptionStatus || eventType || null,
            paidAt,
            refundedAt,
            rawPayload:
              (orderObject as Record<string, unknown>) ??
              (object as unknown as Record<string, unknown>),
          },
          create: {
            userId,
            orderId,
            checkoutId: checkoutId || null,
            subscriptionId: subscriptionId || null,
            requestId: requestId || null,
            productId: productId || null,
            amount: amount ?? null,
            currency: currency || null,
            status: subscriptionStatus || eventType || null,
            paidAt,
            refundedAt,
            rawPayload:
              (orderObject as Record<string, unknown>) ??
              (object as unknown as Record<string, unknown>),
          },
        });
      }
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
