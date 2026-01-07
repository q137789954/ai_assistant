-- =========================
-- 用户吐槽对战统计
-- =========================

-- 创建表
CREATE TABLE "user_roast_battle_stats" (
    "user_id" TEXT PRIMARY KEY,
    "win_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "user_roast_battle_stats_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 索引
CREATE INDEX "idx_user_roast_battle_stats_win_count"
  ON "user_roast_battle_stats" ("win_count" DESC);
