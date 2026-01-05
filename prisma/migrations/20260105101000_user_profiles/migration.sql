-- =========================
-- User Profiles
-- =========================

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" BIGSERIAL PRIMARY KEY,
    "user_id" TEXT NOT NULL UNIQUE,
    "profile" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "user_profiles_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
