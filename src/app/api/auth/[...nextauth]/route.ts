import NextAuth from "next-auth";

import { authOptions } from "@/server/auth/authOptions";

/**
 * next-auth 在 App Router 下建议：
 * - 强制使用 Node.js Runtime（避免被错误地运行在 Edge 环境导致 OAuth/加密/回调异常）
 * - 强制动态渲染（避免被缓存影响登录流程）
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * next-auth 的标准路由入口（App Router）
 * - GET：获取 session、providers、csrf 等
 * - POST：登录/登出/回调等动作
 */
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
