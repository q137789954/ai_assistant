import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";

import { authOptions } from "@/server/auth/authOptions";
import { prisma } from "@/server/db/prisma";
import { withGlobalResponse } from "@/server/middleware/responseFormatter";

const resolveCreemBaseUrl = () => {
  return process.env.NODE_ENV === "production"
    ? "https://api.creem.io"
    : "https://test-api.creem.io";
};

/**
 * 取消用户当前订阅（通过 Creem API 发起）。
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
  if (!creemApiKey) {
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
    // 从数据库中取最近的订阅记录，避免误取消历史订阅。
    const subscription = await prisma.subscription.findFirst({
      where: {
        userId: session.user.id,
        status: { notIn: ["canceled", "expired"] },
      },
      orderBy: { updatedAt: "desc" },
    });

    if (!subscription) {
      throw new Error("未找到可取消的订阅记录");
    }

    const baseUrl = resolveCreemBaseUrl();
    const response = await fetch(
      `${baseUrl}/v1/subscriptions/${subscription.subscriptionId}/cancel`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": creemApiKey,
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Creem 取消订阅失败: ${response.status} ${errorText}`.trim(),
      );
    }

    return { ok: true };
  });
}
