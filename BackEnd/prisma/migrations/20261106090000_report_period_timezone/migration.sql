-- Existing reports retain their historical interval and immutable metrics.
ALTER TABLE projects ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh';
ALTER TABLE ai_reports ADD COLUMN timezone TEXT;
ALTER TABLE ai_reports ADD COLUMN "periodConvention" TEXT NOT NULL DEFAULT 'legacy-inclusive';
