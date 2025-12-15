import { type DefaultSession } from "next-auth";
import "next-auth";

/**
 * next-auth 类型增强
 * - 让 session.user.id 在 TypeScript 中可用
 */
declare module "next-auth" {
  interface Session {
    user: {
      /** 数据库中的用户 ID（Prisma User.id） */
      id: string;
    } & DefaultSession["user"];
  }
}
