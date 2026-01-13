import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";

import { authOptions } from "@/server/auth/authOptions";
import { prisma } from "@/server/db/prisma";
import { withGlobalResponse } from "@/server/middleware/responseFormatter";

/**
 * 获取当前用户订阅状态与免费额度使用情况。
 */
export async function GET() {
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

  return withGlobalResponse(async () => {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        isSubscribed: true,
        subscriptionExpiresAt: true,
        ttsUsageCount: true,
      },
    });

    if (!user) {
      throw new Error("用户不存在");
    }

    return {
      isSubscribed: user.isSubscribed,
      subscriptionExpiresAt: user.subscriptionExpiresAt,
      ttsUsageCount: user.ttsUsageCount,
      freeLimit: 20,
    };
  });
}
