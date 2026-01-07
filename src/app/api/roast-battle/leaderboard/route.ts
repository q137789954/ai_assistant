import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";

import { authOptions } from "@/server/auth/authOptions";
import { prisma } from "@/server/db/prisma";
import { withGlobalResponse } from "@/server/middleware/responseFormatter";

/**
 * 获取吐槽对战排行榜（前 100）与当前用户排名
 * - GET /api/roast-battle/leaderboard
 * - 返回：排行榜列表 + 当前用户胜场与排名
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
    // 查询前 100 名胜场统计，并补充用户展示名
    const topStats = await prisma.userRoastBattleStat.findMany({
      orderBy: {
        winCount: "desc",
      },
      take: 100,
      include: {
        user: {
          select: {
            name: true,
          },
        },
      },
    });

    // 查询当前用户的胜场统计
    const myStat = await prisma.userRoastBattleStat.findUnique({
      where: {
        userId: session.user.id,
      },
      select: {
        winCount: true,
      },
    });

    // 若用户有胜场记录，则计算排名（胜场更高的人数 + 1）
    const myRank = myStat
      ? await prisma.userRoastBattleStat.count({
          where: {
            winCount: {
              gt: myStat.winCount,
            },
          },
        }) + 1
      : null;

    return {
      entries: topStats.map((stat) => ({
        userId: stat.userId,
        name: stat.user?.name ?? null,
        winCount: stat.winCount,
      })),
      my: {
        userId: session.user.id,
        name: session.user.name ?? null,
        winCount: myStat?.winCount ?? 0,
        rank: myRank,
      },
    };
  });
}
