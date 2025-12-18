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

  /**
   * 允许 next-auth 信任当前请求的 Host 信息
   * - 在一些新版本 Next/代理环境下，未开启可能会导致构建回调 URL/issuer 时失败，进而出现 OAuthSignin
   */
  trustHost: true,

  /**
   * 开发环境开启调试日志，便于排查 OAuthSignin 等问题
   * - 你可以在 `pnpm dev` 的终端里看到 next-auth 的详细报错
   */
  debug: process.env.NODE_ENV === "development",

  /**
   * 自定义 logger：把 next-auth 内部错误输出到控制台
   * - 当遇到 /login?error=OAuthSignin 时，这里通常会给出更具体的原因（例如 clientId 缺失、回调地址不匹配等）
   */
  logger: {
    error(code, metadata) {
      // eslint-disable-next-line no-console
      console.error("[next-auth][error]", code, metadata);
    },
    warn(code) {
      // eslint-disable-next-line no-console
      console.warn("[next-auth][warn]", code);
    },
    // debug(code, metadata) {
    //   // eslint-disable-next-line no-console
    //   console.debug("[next-auth][debug]", code, metadata);
    // },
  },

  session: {
    /**
     * 使用 JWT 策略让服务端可直接解码 payload 而不用再去数据库查 session。
     */
    strategy: "jwt",
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
      /**
       * 适当放宽请求超时时间
       * - 你当前的报错是：outgoing request timed out after 3500ms
       * - 这通常发生在本机/服务器访问 Google 的 OAuth/OpenID 端点不稳定或被阻断时
       * - 提高 timeout 只能缓解“网络慢”的情况；如果网络被墙/无法访问，需要配置代理或 VPN
       */
      httpOptions: {
        timeout: 15000,
      },
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
     * 认证后把初始用户 ID 放在 JWT 里，后续再由 session 回调复用；
     */
    async jwt({ token, user }) {
      if (user?.id) {
        token.id = user.id;
      }
      return token;
    },
    /**
     * session 需要从 token 里恢复 user.id，而不是依赖数据库 user 参数（JWT 策略不会重复提供）。
     */
    async session({ session, token }) {
      if (session.user) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (session.user as any).id = token.sub ?? token.id;
      }
      return session;
    },
  },
};
