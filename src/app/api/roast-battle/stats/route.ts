import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";

import { authOptions } from "@/server/auth/authOptions";
import { prisma } from "@/server/db/prisma";
import { withGlobalResponse } from "@/server/middleware/responseFormatter";

/**
 * 获取当前登录用户的吐槽对战统计
 * - GET /api/roast-battle/stats
 * - 返回：总获胜次数、获胜回合中最小的 roast_count
 */
export async function GET(_request: NextRequest) {
  // 统一从 session 中取登录态，避免前端伪造 userId
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
    // 并行查询：统计胜利总次数 + 统计胜利回合最小 roast_count
    const [winCount, minRoastAgg] = await Promise.all([
      prisma.roastBattleRound.count({
        where: {
          userId: session.user.id,
          isWin: true,
        },
      }),
      prisma.roastBattleRound.aggregate({
        where: {
          userId: session.user.id,
          isWin: true,
        },
        _min: {
          roastCount: true,
        },
      }),
    ]);

    // 没有胜利记录时，最小 roast_count 为空，便于前端区分 0 与无数据
    const minRoastCount = winCount > 0 ? minRoastAgg._min.roastCount ?? null : null;

    return {
      winCount,
      minRoastCount,
    };
  });
}
