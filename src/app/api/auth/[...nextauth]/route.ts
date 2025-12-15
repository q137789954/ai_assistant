import NextAuth from "next-auth";

import { authOptions } from "@/server/auth/authOptions";

/**
 * next-auth 的标准路由入口（App Router）
 * - GET：获取 session、providers、csrf 等
 * - POST：登录/登出/回调等动作
 */
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
