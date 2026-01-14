/**
 * 登录守卫配置与匹配规则
 * - 通过可配置的路由规则集中管理强制登录页面
 * - 支持精确匹配与前缀匹配（以 "/*" 结尾的规则视为前缀）
 */
export const authGuardConfig = {
  loginPath: "/login",
  protectedRoutes: ["/", "/demo"],
};

type AuthRoutePattern = string;

/**
 * 判断当前路径是否命中配置的保护规则
 * - "/foo" 表示精确匹配
 * - "/foo/*" 表示前缀匹配（含 "/foo" 与 "/foo/..."）
 */
export function isProtectedPath(pathname: string): boolean {
  return authGuardConfig.protectedRoutes.some((pattern) =>
    matchRoutePattern(pathname, pattern)
  );
}

function matchRoutePattern(pathname: string, pattern: AuthRoutePattern): boolean {
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  }
  return pathname === pattern;
}
