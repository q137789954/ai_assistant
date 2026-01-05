
import { Socket } from "socket.io";
import { prisma } from "@/server/db/prisma";
import { getUserProfileUpdatePrompt } from "@/server/llm/prompt";

// 统一的默认用户画像结构，确保传给 LLM 的 JSON 结构稳定
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

// 将 YYYY-MM-DD 的日期键转换为当天起止时间，方便数据库按天拉取
const getDayRange = (dayKey: string) => {
  const [year, month, day] = dayKey.split("-").map((value) => Number(value));
  const startAt = new Date(year, month - 1, day, 0, 0, 0, 0);
  const endAt = new Date(year, month - 1, day + 1, 0, 0, 0, 0);
  return {
    startAt,
    endAt,
  };
};

// 仅做轻量结构校验，避免 LLM 返回非 JSON 或结构缺失导致落库异常
const isValidUserProfile = (value: unknown): value is typeof defaultUserProfile => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const preferences = record.preferences;
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) {
    return false;
  }
  const preferencesRecord = preferences as Record<string, unknown>;
  return (
    "nickname" in record &&
    "relation" in record &&
    Array.isArray(record.self_tags) &&
    Array.isArray(record.taboos) &&
    Array.isArray(preferencesRecord.likes) &&
    Array.isArray(preferencesRecord.dislikes)
  );
};

/**
 * 在 WebSocket 断开时，基于记录的日期拉取当天聊天记录与旧画像，
 * 调用 LLM 生成新的用户画像并覆盖落库。
 */
export const updateUserProfileOnDisconnect = async (socket: Socket) => {
  // 从 socket 中读取 userId，缺失时无需继续处理
  const userId = socket.data.userId as string | undefined;
  if (!userId) {
    console.error("updateUserProfileOnDisconnect: 缺少 userId，跳过更新");
    return;
  }

  // 读取本次连接记录过的日期集合（YYYY-MM-DD），相同日期只记录一次
  const rawDayKeys = socket.data.userProfileUpdateDays;
  const dayKeys =
    rawDayKeys instanceof Set
      ? Array.from(rawDayKeys)
      : Array.isArray(rawDayKeys)
        ? rawDayKeys
        : [];
  const uniqueDayKeys = Array.from(new Set(dayKeys)).sort();
  if (uniqueDayKeys.length === 0) {
    return;
  }

  // LLM 客户端缺失时无法生成画像
  if (!socket.data.llmClient) {
    console.error("updateUserProfileOnDisconnect: 缺少 llmClient，跳过更新");
    return;
  }

  try {
    // 拉取旧画像，若不存在则使用默认结构
    const existingProfileRecord = await prisma.userProfile.findUnique({
      where: { userId },
    });
    let currentProfile = existingProfileRecord?.profile ?? defaultUserProfile;
    let updated = false;

    for (const dayKey of uniqueDayKeys) {
      const { startAt, endAt } = getDayRange(dayKey);
      // 按天拉取聊天记录，确保同一天的对话完整输入 LLM
      const dayMessages = await prisma.conversationMessage.findMany({
        where: {
          userId,
          createdAt: {
            gte: startAt,
            lt: endAt,
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      });

      if (dayMessages.length === 0) {
        continue;
      }

      // 拼接为 session_log 纯文本，过滤空内容
      const sessionLog = dayMessages
        .map((message) => {
          const content =
            typeof message.content === "string" ? message.content.trim() : "";
          if (!content) {
            return null;
          }
          return `${message.role}: ${content}`;
        })
        .filter((line): line is string => Boolean(line))
        .join("\n");

      if (!sessionLog) {
        continue;
      }

      // 构建 LLM 提示词，传入旧画像与当天聊天记录
      const prompt = getUserProfileUpdatePrompt({
        user_profile_old: JSON.stringify(currentProfile),
        session_log: sessionLog,
      });

      let responseText = "";
      try {
        const response = await socket.data.llmClient.responses.create({
          model: "grok-4-fast-non-reasoning",
          input: [
            {
              role: "system",
              content: prompt,
            },
          ],
        });
        responseText =
          typeof response?.output_text === "string"
            ? response.output_text.trim()
            : "";
      } catch (error) {
        console.error("updateUserProfileOnDisconnect: LLM 画像生成失败", {
          dayKey,
          error,
        });
        continue;
      }

      if (!responseText) {
        console.error("updateUserProfileOnDisconnect: LLM 未返回有效 JSON", {
          dayKey,
        });
        continue;
      }

      // 尝试解析 JSON 并进行最小结构校验
      let parsedProfile: unknown = null;
      try {
        parsedProfile = JSON.parse(responseText);
      } catch (error) {
        console.error("updateUserProfileOnDisconnect: JSON 解析失败", {
          dayKey,
          error,
        });
        continue;
      }

      if (!isValidUserProfile(parsedProfile)) {
        console.error("updateUserProfileOnDisconnect: 画像结构不合法", {
          dayKey,
        });
        continue;
      }

      // 使用本次 LLM 结果作为新的画像继续迭代后续日期
      currentProfile = parsedProfile;
      updated = true;
    }

    // 有效更新才写入数据库，避免无意义覆盖
    if (updated) {
      await prisma.userProfile.upsert({
        where: { userId },
        create: {
          userId,
          profile: currentProfile,
        },
        update: {
          profile: currentProfile,
        },
      });
    }
  } catch (error) {
    console.error("updateUserProfileOnDisconnect: 处理更新失败", {
      error,
    });
  }
};
