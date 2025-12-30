import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";

import { authOptions } from "@/server/auth/authOptions";
import { prisma } from "@/server/db/prisma";
import { withGlobalResponse } from "@/server/middleware/responseFormatter";

/**
 * 更新当前登录用户的展示名
 * - PATCH /api/user/name
 * - Body: { name: string }
 * - 必须先通过 next-auth 保持会话，未登录直接返回 401
 */
export async function PATCH(request: NextRequest) {
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

  // 解析并校验用户传入的名称，统一做 trim，确保不会写入空字符串或超长内容
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json(
      {
        success: false,
        code: 1,
        message: "用户名不能为空",
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 400 },
    );
  }
  if (name.length > 32) {
    return NextResponse.json(
      {
        success: false,
        code: 1,
        message: "用户名长度不能超过 32 个字符",
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 400 },
    );
  }

  return withGlobalResponse(async () => {
    // 只更新当前登录用户的 name 字段，避免越权
    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: { name },
      select: { id: true, name: true, email: true, image: true },
    });

    // 返回最新的用户基本信息，便于前端同步展示
    return { user };
  });
}
