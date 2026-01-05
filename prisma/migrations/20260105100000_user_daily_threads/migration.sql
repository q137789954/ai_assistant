-- =========================
-- User Daily Threads
-- =========================

-- CreateTable
CREATE TABLE "user_daily_threads" (
    "id" BIGSERIAL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "text" VARCHAR(120) NOT NULL,
    "score" SMALLINT NOT NULL CHECK ("score" BETWEEN 0 AND 100),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "uq_user_day_text" UNIQUE ("user_id", "day", "text")
);

-- 索引：用户维度按日期/评分倒序查询
CREATE INDEX "idx_user_day" ON "user_daily_threads" ("user_id", "day" DESC);
CREATE INDEX "idx_user_day_score" ON "user_daily_threads" ("user_id", "day" DESC, "score" DESC);

-- 外键：关联到 user 表
ALTER TABLE "user_daily_threads"
ADD CONSTRAINT "user_daily_threads_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
