import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { randomUUID } from "crypto";

import { authOptions } from "@/server/auth/authOptions";
import { withGlobalResponse } from "@/server/middleware/responseFormatter";

const resolveCreemBaseUrl = () => {
  return process.env.NODE_ENV === "production"
    ? "https://api.creem.io"
    : "https://test-api.creem.io";
};

/**
 * 创建 Creem Checkout，用于引导用户订阅。
 * - 仅允许已登录用户调用
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json(
      {
        success: false,
        code: 1,
        message: "未登录或会话已过期",
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 401 },
    );
  }

  const creemApiKey = process.env.CREEM_API_KEY;
  const creemProductId = process.env.CREEM_PRODUCT_ID;
  if (!creemApiKey || !creemProductId) {
    return NextResponse.json(
      {
        success: false,
        code: 1,
        message: "Creem 配置缺失，请检查环境变量",
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 500 },
    );
  }

  return withGlobalResponse(async () => {
    const baseUrl = resolveCreemBaseUrl();
    const successUrl = `${
      process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
    }/?subscribe=success`;
    const payload = {
      request_id: `checkout_${randomUUID()}`,
      product_id: creemProductId,
      success_url: successUrl,
      customer: session.user.email ? { email: session.user.email } : undefined,
      metadata: {
        userId: session.user.id,
      },
    };

    const response = await fetch(`${baseUrl}/v1/checkouts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": creemApiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Creem Checkout 创建失败: ${response.status} ${errorText}`.trim()
      );
    }

    const data = (await response.json().catch(() => null)) as {
      checkout_url?: string;
    } | null;

    if (!data?.checkout_url) {
      throw new Error("Creem Checkout 返回缺少 checkout_url");
    }

    return {
      checkoutUrl: data.checkout_url,
    };
  });
}
