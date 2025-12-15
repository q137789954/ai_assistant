import { PrismaClient } from "@prisma/client";

/**
 * PrismaClient 单例
 * - Next.js 开发环境会热更新（HMR），如果每次都 new PrismaClient 会造成连接数暴涨
 * - 这里把实例挂在 globalThis 上，确保开发环境复用同一个连接
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // 需要排查 SQL/连接问题时可以开启日志：
    // log: ["query", "info", "warn", "error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

