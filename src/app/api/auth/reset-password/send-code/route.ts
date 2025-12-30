import { NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";

/**
 * 发送重置密码验证码
 * - POST /api/auth/reset-password/send-code
 * - body: { email: string }
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const emailRaw = typeof body?.email === "string" ? body.email : "";
  const email = emailRaw.trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return NextResponse.json({ ok: false, message: "请输入正确的邮箱地址" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json({ ok: false, message: "账号不存在，请检查邮箱" }, { status: 404 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;

  if (!apiKey || !from) {
    return NextResponse.json(
      { ok: false, message: "邮件服务未配置，请联系管理员" },
      { status: 500 },
    );
  }

  // 生成 6 位数字验证码
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = new Date(Date.now() + 5 * 60 * 1000);

  // 清理旧验证码，确保同一邮箱只有一条有效记录
  await prisma.verificationToken.deleteMany({ where: { identifier: email } });
  await prisma.verificationToken.create({
    data: {
      identifier: email,
      token: code,
      expires,
    },
  });

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: email,
      subject: "重置密码验证码",
      text: `你的重置密码验证码为 ${code}，5 分钟内有效。如果非本人操作，请忽略此邮件。`,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return NextResponse.json(
      { ok: false, message: text || "验证码发送失败，请稍后重试" },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, message: "验证码已发送，请查收邮箱" });
}
