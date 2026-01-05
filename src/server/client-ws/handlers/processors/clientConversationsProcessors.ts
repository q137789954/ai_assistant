import { Socket } from "socket.io";
import { prisma } from "@/server/db/prisma";
import { getThreadCompressorPrompt } from "@/server/llm/prompt";

/**
 * 压缩 socket.data.clientConversations 中最早的对话消息。
 * 当累计消息条数超过阈值（默认 100）时，按消息时间拆分出涉及的日期，
 * 分日拉取数据库中的当天聊天记录，调用 LLM 生成主线 threads 并落库，
 * 成功后移除 socket.data.clientConversations 中已使用的消息，避免上下文膨胀。
 */
export const compressClientConversations = async ({
  socket,
  batchSize = 100,
  model = "grok-4-fast-non-reasoning",
}: {
  socket: Socket;
  batchSize?: number;
  model?: string;
}): Promise<string | null> => {
  // 利用 socket 上的状态位避免重复触发压缩
  if (socket.data.clientConversationsCompressing) {
    return null;
  }
  socket.data.clientConversationsCompressing = true;
  // 默认画像结构，确保传给 LLM 的用户画像是稳定的 JSON 结构
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

  // 将 timestamp 统一解析为毫秒时间戳，便于后续按日期归档
  const normalizeTimestamp = (timestamp: unknown): number | null => {
    if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
      return timestamp;
    }
    if (typeof timestamp === "string") {
      const parsed = Number.isFinite(Number(timestamp))
        ? Number(timestamp)
        : Date.parse(timestamp);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  // 生成本地日期键（YYYY-MM-DD），用于分组与去重
  const getDayKey = (timestamp: number): string => {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  // 将日期键转为当天的起止时间，用于数据库查询
  const getDayRange = (dayKey: string) => {
    const [year, month, day] = dayKey.split("-").map((value) => Number(value));
    const startAt = new Date(year, month - 1, day, 0, 0, 0, 0);
    const endAt = new Date(year, month - 1, day + 1, 0, 0, 0, 0);
    return {
      dayDate: startAt,
      startAt,
      endAt,
    };
  };

  try {
    // 安全兜底，确保 clientConversations 始终是数组，避免后续处理触发异常
    const conversations = Array.isArray(socket.data.clientConversations)
      ? socket.data.clientConversations
      : [];
    if (!socket.data.llmClient) {
      console.error(
        "compressClientConversations: 缺少 llmClient，无法生成 threads",
        {
          conversationLength: conversations.length,
        }
      );
      return null;
    }

    // 未超过阈值时无需压缩，直接返回
    if (conversations.length <= batchSize) {
      return null;
    }

    const userId = socket.data.userId as string | undefined;
    if (!userId) {
      console.error("compressClientConversations: 缺少 userId，无法写入线程", {
        conversationLength: conversations.length,
      });
      return null;
    }

    // 只处理最早一批消息，避免误删最新上下文
    const messagesToCompress = conversations.slice(0, batchSize);
    // 基于消息中的时间戳提取当天日期，避免跨天混合生成主线
    const dayKeySet = new Set<string>();
    messagesToCompress.forEach((message) => {
      const normalized = normalizeTimestamp(message?.timestamp);
      if (normalized === null) {
        return;
      }
      dayKeySet.add(getDayKey(normalized));
    });

    const dayKeys = Array.from(dayKeySet).sort();
    if (dayKeys.length === 0) {
      console.error("compressClientConversations: 无法从消息中解析日期", {
        conversationLength: conversations.length,
      });
      return null;
    }

    // 拉取用户画像，用于减少主线与画像重复
    const userProfileRecord = await prisma.userProfile.findUnique({
      where: { userId },
    });
    // 统一序列化为 JSON 字符串，避免 LLM 解析结构时出错
    const userProfileText = JSON.stringify(
      userProfileRecord?.profile ?? defaultUserProfile
    );

    let lastResponseText: string | null = null;
    // 记录已成功生成并落库的日期，便于后续安全清理缓存消息
    const processedDayKeys = new Set<string>();

    for (const dayKey of dayKeys) {
      const { dayDate, startAt, endAt } = getDayRange(dayKey);
      // 按天拉取完整聊天记录，确保 LLM 看到的是当天全量上下文
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

      // 把当天对话整理为纯文本 log，供线程压缩器使用
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

      // 生成线程压缩提示词，输入画像与当天日志
      const prompt = getThreadCompressorPrompt({
        user_profile: userProfileText,
        session_log: sessionLog,
      });

      let responseText = "";
      try {
        // 通过 LLM 生成线程 JSON
        const response = await socket.data.llmClient.responses.create({
          model,
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
        console.error("compressClientConversations: LLM 线程生成失败", {
          dayKey,
          error,
        });
        continue;
      }

      if (!responseText) {
        console.error("compressClientConversations: LLM 未返回有效 JSON", {
          dayKey,
        });
        continue;
      }

      lastResponseText = responseText;

      // 解析 LLM 返回的 JSON，容错处理无效结构
      let parsedResult: unknown = null;
      try {
        parsedResult = JSON.parse(responseText);
      } catch (error) {
        console.error("compressClientConversations: 线程 JSON 解析失败", {
          dayKey,
          error,
        });
        continue;
      }

      const threads = Array.isArray((parsedResult as { threads?: unknown }).threads)
        ? (parsedResult as { threads: Array<{ text?: unknown; score?: unknown }> })
            .threads
        : [];
      // 过滤空文本与非法评分，统一裁剪到数据库字段允许范围
      const normalizedThreads = threads
        .map((thread) => {
          const text =
            typeof thread.text === "string" ? thread.text.trim() : "";
          if (!text) {
            return null;
          }
          const rawScore =
            typeof thread.score === "number"
              ? thread.score
              : Number(thread.score);
          const score = Number.isFinite(rawScore)
            ? Math.max(0, Math.min(100, Math.round(rawScore)))
            : 0;
          return {
            text: text.slice(0, 120),
            score,
          };
        })
        .filter(
          (
            thread
          ): thread is {
            text: string;
            score: number;
          } => Boolean(thread)
        );

      if (normalizedThreads.length === 0) {
        continue;
      }

      try {
        // 批量写入当日线程，使用 skipDuplicates 避免重复插入
        await prisma.userDailyThread.createMany({
          data: normalizedThreads.map((thread) => ({
            userId,
            day: dayDate,
            text: thread.text,
            score: thread.score,
          })),
          skipDuplicates: true,
        });
        processedDayKeys.add(dayKey);
      } catch (error) {
        console.error("compressClientConversations: 线程落库失败", {
          dayKey,
          error,
        });
      }
    }

    if (processedDayKeys.size > 0) {
      // 仅移除已成功生成并落库的日期对应消息，保留未处理的数据供后续重试
      const remainingMessages = conversations.filter((message) => {
        const normalized = normalizeTimestamp(message?.timestamp);
        if (normalized === null) {
          return true;
        }
        return !processedDayKeys.has(getDayKey(normalized));
      });
      socket.data.clientConversations = remainingMessages;
    }

    return lastResponseText;
  } catch (error) {
    console.error("compressClientConversations: 处理线程压缩失败", {
      error,
    });
    return null;
  } finally {
    socket.data.clientConversationsCompressing = false;
  }
};
