-- dueDate remains the planned finish used by reminders/calendar/AI.
-- Do not infer when legacy tasks started; completedAt is existing evidence of finish.
ALTER TABLE "tasks"
  ADD COLUMN "plannedStartDate" TIMESTAMP(3),
  ADD COLUMN "actualStartDate" TIMESTAMP(3),
  ADD COLUMN "actualEndDate" TIMESTAMP(3);

UPDATE "tasks" SET "actualEndDate" = "completedAt"
WHERE "status" = 'done' AND "completedAt" IS NOT NULL;

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_planned_dates_order"
  CHECK ("plannedStartDate" IS NULL OR "dueDate" IS NULL OR "dueDate" >= "plannedStartDate");
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_actual_dates_order"
  CHECK ("actualStartDate" IS NULL OR "actualEndDate" IS NULL OR "actualEndDate" >= "actualStartDate");
