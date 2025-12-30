import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import bcrypt from "bcryptjs";

import { authOptions } from "@/server/auth/authOptions";
import { prisma } from "@/server/db/prisma";
import { withGlobalResponse } from "@/server/middleware/responseFormatter";

/**
 * 修改当前登录用户的密码
 * - PATCH /api/user/password
 * - Body: { oldPassword: string, newPassword: string }
 * - 需要登录态，校验旧密码后更新 passwordHash
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

  // 解析用户输入，确保字段为字符串
  const body = await request.json().catch(() => null);
  const oldPassword =
    typeof body?.oldPassword === "string" ? body.oldPassword : "";
  const newPassword =
    typeof body?.newPassword === "string" ? body.newPassword : "";

  if (!oldPassword || !newPassword) {
    return NextResponse.json(
      {
        success: false,
        code: 1,
        message: "请输入原密码与新密码",
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 400 },
    );
  }

  if (newPassword.length < 6) {
    return NextResponse.json(
      {
        success: false,
        code: 1,
        message: "新密码长度不足（至少 6 位）",
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 400 },
    );
  }

  if (oldPassword === newPassword) {
    return NextResponse.json(
      {
        success: false,
        code: 1,
        message: "新密码不能与旧密码相同",
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 400 },
    );
  }

  // 查询当前用户并校验旧密码哈希
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, passwordHash: true },
  });

  if (!user) {
    return NextResponse.json(
      {
        success: false,
        code: 1,
        message: "用户不存在",
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 404 },
    );
  }

  if (!user.passwordHash) {
    return NextResponse.json(
      {
        success: false,
        code: 1,
        message: "当前账号未设置密码，请先通过邮箱重置密码",
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 400 },
    );
  }

  const matchOld = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!matchOld) {
    return NextResponse.json(
      {
        success: false,
        code: 1,
        message: "原密码不正确",
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 400 },
    );
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);

  return withGlobalResponse(async () => {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });
    return { message: "密码已更新，请使用新密码重新登录" };
  });
}
