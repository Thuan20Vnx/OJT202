-- Older snapshots remain readable but cannot be certified current.
ALTER TABLE "ai_reports" ADD COLUMN "sourceRevision" VARCHAR(64);
