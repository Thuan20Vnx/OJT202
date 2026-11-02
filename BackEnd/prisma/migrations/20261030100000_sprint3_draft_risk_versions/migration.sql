-- Legacy dismissals have no verified source/reason and must not hide live risks.
ALTER TABLE "ai_drafts" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "projects" ADD COLUMN "riskRulesVersion" INTEGER NOT NULL DEFAULT 1;
-- Preserve unknown snapshot time on legacy reports instead of inventing it.
ALTER TABLE "ai_reports" ADD COLUMN "generatedAt" TIMESTAMP(3);
ALTER TABLE "risk_resolutions"
  ADD COLUMN "source_version" VARCHAR(64),
  ADD COLUMN "reason" VARCHAR(1000),
  ADD COLUMN "snapshot" JSONB;
ALTER TABLE "ai_drafts" ADD CONSTRAINT "ai_drafts_version_positive" CHECK ("version" > 0);
