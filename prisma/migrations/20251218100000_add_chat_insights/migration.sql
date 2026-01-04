-- 为用户表新增 chat_insights 字段，用于存放聊天洞察的 JSON 数据
ALTER TABLE "user"
ADD COLUMN "chat_insights" JSONB;
