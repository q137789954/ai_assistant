import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import { prisma } from "@/server/db/prisma";

/**
 * 注册接口（账号密码）
 * - POST /api/auth/register
 * - body: { email: string, password: string, name?: string, code: string }
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  const emailRaw = typeof body?.email === "string" ? body.email : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const name = typeof body?.name === "string" ? body.name.trim() : undefined;
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  // 统一处理邮箱：去空格 + 小写
  const email = emailRaw.trim().toLowerCase();

  if (!email || !password) {
    return NextResponse.json(
      { ok: false, message: "邮箱和密码不能为空" },
      { status: 400 },
    );
  }

  // 简单校验（可按需要增强）
  if (!email.includes("@") || password.length < 6) {
    return NextResponse.json(
      { ok: false, message: "邮箱格式不正确或密码长度不足（至少 6 位）" },
      { status: 400 },
    );
  }

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    return NextResponse.json(
      { ok: false, message: "该邮箱已注册" },
      { status: 409 },
    );
  }

  // 校验邮箱验证码
  if (!code) {
    return NextResponse.json(
      { ok: false, message: "请输入邮箱验证码" },
      { status: 400 },
    );
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

  // 使用 bcrypt 生成密码哈希，避免明文入库
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      email,
      name: name || email.split("@")[0],
      passwordHash,
    },
    select: { id: true, email: true, name: true },
  });

  // 注册成功后，清理验证码
  await prisma.verificationToken.deleteMany({ where: { identifier: email } });

  return NextResponse.json({ ok: true, user }, { status: 201 });
}
