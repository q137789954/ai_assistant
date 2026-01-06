import { Prisma } from "@prisma/client";
import { Socket } from "socket.io";
import { prisma } from "@/server/db/prisma";

/**
 * 在连接成功时加载用户最新一条未胜利的吐槽对战回合，
 * 若不存在则初始化一条 startedAt 为空的记录并保存到 socket.data。
 */
export const loadRoastBattleRoundOnConnect = async (socket: Socket) => {
  const userId = socket.data.userId as string | undefined;
  if (!userId) {
    console.error("loadRoastBattleRoundOnConnect: 缺少 userId，无法加载对战回合");
    return;
  }

  try {
    // 查询该用户尚未胜利的回合记录，按创建时间倒序取最新一条
    const existingRound = await prisma.roastBattleRound.findFirst({
      where: {
        userId,
        isWin: false,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    console.log(existingRound, 'existingRound')
    if (existingRound) {
      // 命中未完成回合时直接复用，确保本次连接可继续该回合
      socket.data.roastBattleRound = existingRound;
      socket.data.roastBattleEnabled = true;
      return;
    }

    // 未命中则初始化一条回合记录，startedAt 依业务要求保持为空
    const newRound = await prisma.roastBattleRound.create({
      data: {
        userId,
        score: 0,
        isWin: false,
        startedAt: null,
      },
    });

    console.log(newRound, 'newRound')

    socket.data.roastBattleRound = newRound;
    socket.data.roastBattleEnabled = true;
  } catch (error) {
    // 并发连接可能触发唯一约束冲突，命中时回退为再次查询
    const isUniqueConflict =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    if (isUniqueConflict) {
      const fallbackRound = await prisma.roastBattleRound.findFirst({
        where: {
          userId,
          isWin: false,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
      if (fallbackRound) {
        socket.data.roastBattleRound = fallbackRound;
        socket.data.roastBattleEnabled = true;
        return;
      }
    }

    console.error("loadRoastBattleRoundOnConnect: 初始化回合失败", {
      userId,
      error,
    });
  }
};
