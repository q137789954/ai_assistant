-- =========================
-- Roast Battle Rounds
-- =========================

-- CreateTable
CREATE TABLE "roast_battle_rounds" (
    "id" BIGSERIAL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "score" SMALLINT NOT NULL,
    "is_win" BOOLEAN NOT NULL,
    "roast_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "won_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "roast_battle_rounds_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "roast_battle_rounds_won_at_check"
      CHECK (
        ("is_win" = TRUE AND "won_at" IS NOT NULL)
        OR ("is_win" = FALSE AND "won_at" IS NULL)
      )
);

-- Indexes
CREATE INDEX "idx_roast_battle_rounds_user_time"
  ON "roast_battle_rounds" ("user_id", "started_at" DESC);

CREATE INDEX "idx_roast_battle_rounds_user_win"
  ON "roast_battle_rounds" ("user_id", "is_win");

-- 保证同一用户最多只有一条未胜利记录
CREATE UNIQUE INDEX "uq_roast_battle_rounds_user_unfinished"
  ON "roast_battle_rounds" ("user_id") WHERE "is_win" = FALSE;
