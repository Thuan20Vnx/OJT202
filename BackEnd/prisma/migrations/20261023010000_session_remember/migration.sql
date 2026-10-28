-- Existing sessions were persistent; preserve them, store the choice for new ones.
ALTER TABLE "sessions" ADD COLUMN "remember" BOOLEAN NOT NULL DEFAULT true;
