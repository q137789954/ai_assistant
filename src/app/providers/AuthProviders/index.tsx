"use client";

import { SessionProvider } from "next-auth/react";

/**
 * next-auth SessionProvider
 * - 负责在客户端维持会话状态
 * - useSession()/signIn()/signOut() 等 hook 依赖该 Provider
 */
export default function AuthProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SessionProvider>{children}</SessionProvider>;
}

