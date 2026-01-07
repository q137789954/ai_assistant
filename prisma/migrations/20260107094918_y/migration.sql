-- DropForeignKey
ALTER TABLE "user_daily_threads" DROP CONSTRAINT "user_daily_threads_user_id_fkey";

-- AlterTable
ALTER TABLE "account" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "session" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "user" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "verification_token" ADD CONSTRAINT "verification_token_pkey" PRIMARY KEY ("identifier", "token");

-- DropIndex
DROP INDEX "verification_token_identifier_token_key";

-- RenameForeignKey
ALTER TABLE "account" RENAME CONSTRAINT "account_user_id_fkey" TO "account_userId_fkey";

-- RenameForeignKey
ALTER TABLE "conversation_message" RENAME CONSTRAINT "conversation_message_user_id_fkey" TO "conversation_message_userId_fkey";

-- RenameForeignKey
ALTER TABLE "session" RENAME CONSTRAINT "session_user_id_fkey" TO "session_userId_fkey";
