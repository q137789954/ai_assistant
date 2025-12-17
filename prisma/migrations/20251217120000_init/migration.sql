-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_token" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- =========================
-- Conversation / Messages
-- =========================

-- CreateEnum
CREATE TYPE "ConversationMessageRole" AS ENUM ('SYSTEM', 'USER', 'ASSISTANT', 'TOOL');

-- CreateTable (UPDATED)
CREATE TABLE "conversation_message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,

    -- role：用于区分用户/机器人（业务上建议只写 USER / ASSISTANT）
    "role" "ConversationMessageRole" NOT NULL,

    -- 语音消息允许为空；文本消息必须有内容
    "content" TEXT,

    -- 是否语音
    "isVoice" BOOLEAN NOT NULL DEFAULT FALSE,

    -- 语音时长（毫秒），仅语音消息需要
    "voiceDurationMs" INTEGER,

    -- 归属用户 ID
    "userId" TEXT NOT NULL,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_message_pkey" PRIMARY KEY ("id"),

    -- 规则：
    -- 1) isVoice=false -> 必须有 content(非空串)，且 voiceDurationMs 必须为空
    -- 2) isVoice=true  -> content 可空，但 voiceDurationMs 必须存在且 > 0
    CONSTRAINT "conversation_message_payload_check"
      CHECK (
        (
          "isVoice" = FALSE
          AND "content" IS NOT NULL
          AND length(trim("content")) > 0
          AND "voiceDurationMs" IS NULL
        )
        OR
        (
          "isVoice" = TRUE
          AND "voiceDurationMs" IS NOT NULL
          AND "voiceDurationMs" > 0
        )
      )
);

-- =========================
-- Indexes
-- =========================

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "account_user_id_idx" ON "account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "account_provider_provider_account_id_key" ON "account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "session_session_token_key" ON "session"("sessionToken");

-- CreateIndex
CREATE INDEX "session_user_id_idx" ON "session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "verification_token_token_key" ON "verification_token"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_token_identifier_token_key" ON "verification_token"("identifier", "token");

-- Message indexes
CREATE INDEX "conversation_message_conversation_id_idx" ON "conversation_message"("conversationId");
CREATE INDEX "conversation_message_conversation_id_created_at_idx"
  ON "conversation_message"("conversationId", "createdAt");
CREATE INDEX "conversation_message_user_id_idx" ON "conversation_message"("userId");

-- =========================
-- Foreign Keys
-- =========================

-- AddForeignKey
ALTER TABLE "account"
ADD CONSTRAINT "account_user_id_fkey"
FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session"
ADD CONSTRAINT "session_user_id_fkey"
FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_message"
ADD CONSTRAINT "conversation_message_user_id_fkey"
FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
