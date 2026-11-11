-- Legacy calls keep unknown timestamps/usage; do not invent timing or billable tokens.
ALTER TABLE "ai_calls"
  ADD COLUMN "queuedAt" TIMESTAMP(3),
  ADD COLUMN "finishedAt" TIMESTAMP(3),
  ADD COLUMN "provider" TEXT,
  ADD COLUMN "attempts" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "usageComplete" BOOLEAN NOT NULL DEFAULT false;
