ALTER TABLE tasks ALTER COLUMN "workType" SET DEFAULT 'unclassified';
ALTER TABLE tasks DROP CONSTRAINT "tasks_work_type";
ALTER TABLE tasks ADD CONSTRAINT "tasks_work_type" CHECK ("workType" IN ('unclassified','development','testing','database','design','documentation','devops','research'));
-- The initial field had no UI; existing default values were not user classifications.
UPDATE tasks SET "workType" = 'unclassified' WHERE "workType" = 'development';
