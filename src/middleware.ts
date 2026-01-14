import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { authGuardConfig, isProtectedPath } from "@/config/auth";

/**
 * 全局登录守卫
 * - 仅对命中的受保护页面生效
 * - 未登录时跳转到登录页，并携带 callbackUrl 方便回跳
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  if (token) {
    return NextResponse.next();
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = authGuardConfig.loginPath;
  loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);

  return NextResponse.redirect(loginUrl);
}

/**
 * 中间件匹配范围
 * - 排除 API 与静态资源，避免无意义的鉴权开销
 */
export const config = {
  matcher: ["/((?!api|_next|favicon.ico|robots.txt|sitemap.xml).*)"],
};
