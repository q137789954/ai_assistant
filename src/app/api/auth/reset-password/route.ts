import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import { prisma } from "@/server/db/prisma";

/**
 * 重置密码
 * - POST /api/auth/reset-password
 * - body: { email: string, password: string, code: string }
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const emailRaw = typeof body?.email === "string" ? body.email : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const email = emailRaw.trim().toLowerCase();

  if (!email || !email.includes("@") || !password) {
    return NextResponse.json(
      { ok: false, message: "邮箱或密码为空/格式不正确" },
      { status: 400 },
    );
  }

  if (password.length < 6) {
    return NextResponse.json(
      { ok: false, message: "密码长度不足（至少 6 位）" },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json({ ok: false, message: "账号不存在" }, { status: 404 });
  }

  // 校验验证码
  if (!code) {
    return NextResponse.json({ ok: false, message: "请输入邮箱验证码" }, { status: 400 });
  }

  const verify = await prisma.verificationToken.findUnique({
    where: { identifier_token: { identifier: email, token: code } },
  });

  if (!verify || verify.expires.getTime() < Date.now()) {
    return NextResponse.json(
      { ok: false, message: "验证码错误或已过期" },
      { status: 400 },
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.update({
    where: { email },
    data: { passwordHash },
  });

  // 重置成功后清理验证码
  await prisma.verificationToken.deleteMany({ where: { identifier: email } });

  return NextResponse.json({ ok: true, message: "密码已重置" });
}
