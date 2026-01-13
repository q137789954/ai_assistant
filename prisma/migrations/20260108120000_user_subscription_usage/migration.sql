-- AlterTable
ALTER TABLE "user"
ADD COLUMN "isSubscribed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "subscriptionExpiresAt" TIMESTAMP(3),
ADD COLUMN "ttsUsageCount" INTEGER NOT NULL DEFAULT 0;
