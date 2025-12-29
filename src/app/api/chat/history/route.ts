import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import type { Prisma } from "@prisma/client";

import { authOptions } from "@/server/auth/authOptions";
import { prisma } from "@/server/db/prisma";
import { withGlobalResponse } from "@/server/middleware/responseFormatter";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parseLimit(raw: string | null) {
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/**
 * 获取登录用户的聊天记录（倒序分页：最新 -> 更旧）
 *
 * Query:
 * - limit: number (default 20, max 100)
 * - cursor: string | undefined （上一页返回的 nextCursor；为空则从最新开始）
 *
 * Response:
 * - pagination.nextCursor: 下一页继续请求要带的 cursor（本页最后一条/最旧那条的 id）
 */
export async function GET(request: NextRequest) {
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
    const { searchParams } = new URL(request.url);

    // ✅ 新参数：limit + cursor
    // （如果你想彻底不兼容旧参数，这两行就只用 limit/cursor，不用 fallback）
    const limit = parseLimit(searchParams.get("limit") ?? searchParams.get("pageSize"));
    const cursor = searchParams.get("cursor") ?? searchParams.get("lastMessageId") ?? undefined;

    const baseArgs: Prisma.ConversationMessageFindManyArgs = {
      where: { userId: session.user.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        conversationId: true,
        role: true,
        content: true,
        isVoice: true,
        voiceDurationMs: true,
        createdAt: true,
      },
    };

    const args: Prisma.ConversationMessageFindManyArgs = { ...baseArgs };

    if (cursor) {
      args.cursor = { id: cursor };
      args.skip = 1;
    }

    let rows;
    try {
      rows = await prisma.conversationMessage.findMany(args);
    } catch (err) {
      // cursor 非法 / 不存在 / 不属于该用户过滤范围时，回退到第一页
      rows = await prisma.conversationMessage.findMany(baseArgs);
    }

    const hasMore = rows.length > limit;
    const messages = hasMore ? rows.slice(0, limit) : rows;

    const nextCursor = messages.length > 0 ? messages[messages.length - 1]!.id : null;

    return {
      messages: messages.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        role: m.role,
        content: m.content,
        isVoice: m.isVoice,
        voiceDurationMs: m.voiceDurationMs,
        createdAt: m.createdAt.toISOString(),
      })),
      pagination: {
        hasMore,
        nextCursor,
        limit,
      },
    };
  });
}
