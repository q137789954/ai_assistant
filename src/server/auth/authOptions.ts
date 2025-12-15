import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import bcrypt from "bcryptjs";

import { prisma } from "@/server/db/prisma";

/**
 * next-auth 配置（v4）
 * - 使用 PrismaAdapter 把用户/会话/第三方账号信息写入 PostgreSQL
 * - 同时支持：
 *   1) Google OAuth 登录
 *   2) 账号密码（注册后使用 Credentials Provider 登录）
 */
export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),

  /**
   * 显式配置 secret（从 .env 读取）
   * - 开发环境可不设置，但生产环境强烈建议设置
   * - 变量名使用 NEXTAUTH_SECRET（与官方习惯一致）
   */
  secret: process.env.NEXTAUTH_SECRET,

  session: {
    /**
     * 使用数据库会话（Session 表）
     * - 当配置了 Adapter 时，next-auth 默认使用数据库策略
     */
    strategy: "database",
  },

  pages: {
    // 自定义登录页（默认是 next-auth 自带页面）
    signIn: "/login",
  },

  providers: [
    /**
     * Google OAuth
     * - 变量名按你的要求使用 `.env` 中的 GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET
     */
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),

    /**
     * 账号密码登录
     * - 需要先走“注册”接口写入用户与 passwordHash
     */
    CredentialsProvider({
      name: "账号密码",
      credentials: {
        email: {
          label: "邮箱",
          type: "email",
          placeholder: "you@example.com",
        },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials) {
        const email =
          typeof credentials?.email === "string"
            ? credentials.email.trim().toLowerCase()
            : "";
        const password =
          typeof credentials?.password === "string" ? credentials.password : "";

        if (!email || !password) return null;

        // 仅允许已注册（存在 passwordHash）的用户用账号密码登录
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user?.passwordHash) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        // next-auth 需要返回最小用户信息；id 必须存在
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  ],

  callbacks: {
    /**
     * 把数据库里的 user.id 注入到 session.user.id，方便前端使用
     */
    async session({ session, user }) {
      if (session.user) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (session.user as any).id = user.id;
      }
      return session;
    },
  },
};

