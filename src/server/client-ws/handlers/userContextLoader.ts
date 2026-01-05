import { Socket } from "socket.io";
import { prisma } from "@/server/db/prisma";

// 统一的默认用户画像结构，确保任何场景下都能向下游提供稳定 JSON 结构
const defaultUserProfile = {
  nickname: null,
  relation: null,
  self_tags: [],
  taboos: [],
  preferences: {
    likes: [],
    dislikes: [],
  },
};

// 计算包含今天在内的最近 7 天时间范围，用于 userDailyThread 的按天查询
const getRecentDayRange = (now: Date = new Date()) => {
  const endAt = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
    0
  );
  const startAt = new Date(endAt);
  startAt.setDate(startAt.getDate() - 7);
  return {
    startAt,
    endAt,
  };
};

/**
 * 在 WebSocket 建立连接时加载用户画像与 userDailyThread 数据，
 * 并保存到 socket.data 供本次连接后续流程使用。
 */
export const loadUserContextOnConnect = async (socket: Socket) => {
  const userId = socket.data.userId as string | undefined;
  if (!userId) {
    console.error("loadUserContextOnConnect: 缺少 userId，无法加载用户上下文");
    return;
  }

  const { startAt, endAt } = getRecentDayRange();

  try {
    // 并行拉取用户画像、最近 7 天 threads 与更早的高分 threads，减少连接阶段的等待时间
    const [userProfileRecord, recentThreads, historyTopThreads] = await Promise.all([
      prisma.userProfile.findUnique({
        where: { userId },
      }),
      prisma.userDailyThread.findMany({
        where: {
          userId,
          day: {
            gte: startAt,
            lt: endAt,
          },
        },
        orderBy: [
          {
            day: "desc",
          },
          {
            score: "desc",
          },
        ],
      }),
      prisma.userDailyThread.findMany({
        where: {
          userId,
          day: {
            lt: startAt,
          },
        },
        orderBy: [
          {
            score: "desc",
          },
          {
            day: "desc",
          },
        ],
        take: 20,
      }),
    ]);

    socket.data.userProfile = userProfileRecord?.profile ?? defaultUserProfile;
    socket.data.userDailyThreadsRecent = recentThreads;
    socket.data.userDailyThreadsTop = historyTopThreads;
  } catch (error) {
    console.error("loadUserContextOnConnect: 加载用户上下文失败", {
      userId,
      error,
    });
  }
};

/**
 * 当 userDailyThread 被更新后刷新最近 7 天数据，保证本次连接上下文保持最新。
 */
export const refreshRecentUserDailyThreads = async (socket: Socket) => {
  const userId = socket.data.userId as string | undefined;
  if (!userId) {
    console.error("refreshRecentUserDailyThreads: 缺少 userId，无法刷新数据");
    return;
  }

  const { startAt, endAt } = getRecentDayRange();

  try {
    console.log("refreshRecentUserDailyThreads: 开始刷新最近 threads");
    const recentThreads = await prisma.userDailyThread.findMany({
      where: {
        userId,
        day: {
          gte: startAt,
          lt: endAt,
        },
      },
      orderBy: [
        {
          day: "desc",
        },
        {
          score: "desc",
        },
      ],
    });

    console.log("refreshRecentUserDailyThreads: 刷新最近 threads 成功", recentThreads);

    socket.data.userDailyThreadsRecent = recentThreads;
  } catch (error) {
    console.error("refreshRecentUserDailyThreads: 刷新最近 threads 失败", {
      userId,
      error,
    });
  }
};
