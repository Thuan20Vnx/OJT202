-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "legacySpentHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "progressPct" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "workType" VARCHAR(30) NOT NULL DEFAULT 'development';

-- CreateTable
CREATE TABLE "task_contributors" (
    "task" UUID NOT NULL,
    "user" UUID NOT NULL,
    "responsibility" VARCHAR(300) NOT NULL DEFAULT '',
    "plannedHours" DOUBLE PRECISION NOT NULL,
    "remainingHours" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "task_contributors_pkey" PRIMARY KEY ("task","user")
);

-- CreateTable
CREATE TABLE "task_daily_updates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task" UUID NOT NULL,
    "user" UUID NOT NULL,
    "workDate" DATE NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "completed" VARCHAR(2000) NOT NULL,
    "nextStep" VARCHAR(2000) NOT NULL DEFAULT '',
    "blockers" VARCHAR(2000) NOT NULL DEFAULT '',
    "progressPct" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_daily_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_issues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task" UUID NOT NULL,
    "reporter" UUID NOT NULL,
    "owner" UUID,
    "title" VARCHAR(200) NOT NULL,
    "severity" VARCHAR(20) NOT NULL,
    "cause" VARCHAR(2000) NOT NULL,
    "action" VARCHAR(2000) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "resolution" VARCHAR(2000) NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_meetings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project" UUID NOT NULL,
    "creator" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "agenda" VARCHAR(4000) NOT NULL DEFAULT '',
    "location" VARCHAR(500) NOT NULL DEFAULT '',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'scheduled',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_participants" (
    "meeting" UUID NOT NULL,
    "user" UUID NOT NULL,

    CONSTRAINT "meeting_participants_pkey" PRIMARY KEY ("meeting","user")
);

-- CreateIndex
CREATE INDEX "task_contributors_user_idx" ON "task_contributors"("user");

-- CreateIndex
CREATE INDEX "task_daily_updates_user_workDate_idx" ON "task_daily_updates"("user", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "task_daily_updates_task_user_workDate_key" ON "task_daily_updates"("task", "user", "workDate");

-- CreateIndex
CREATE INDEX "task_issues_task_status_idx" ON "task_issues"("task", "status");

-- CreateIndex
CREATE INDEX "project_meetings_project_startAt_idx" ON "project_meetings"("project", "startAt");

-- CreateIndex
CREATE INDEX "meeting_participants_user_idx" ON "meeting_participants"("user");

-- AddForeignKey
ALTER TABLE "task_contributors" ADD CONSTRAINT "task_contributors_task_fkey" FOREIGN KEY ("task") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_contributors" ADD CONSTRAINT "task_contributors_user_fkey" FOREIGN KEY ("user") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_daily_updates" ADD CONSTRAINT "task_daily_updates_task_fkey" FOREIGN KEY ("task") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_daily_updates" ADD CONSTRAINT "task_daily_updates_user_fkey" FOREIGN KEY ("user") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_issues" ADD CONSTRAINT "task_issues_task_fkey" FOREIGN KEY ("task") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_issues" ADD CONSTRAINT "task_issues_reporter_fkey" FOREIGN KEY ("reporter") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_issues" ADD CONSTRAINT "task_issues_owner_fkey" FOREIGN KEY ("owner") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_meetings" ADD CONSTRAINT "project_meetings_project_fkey" FOREIGN KEY ("project") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_meetings" ADD CONSTRAINT "project_meetings_creator_fkey" FOREIGN KEY ("creator") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meeting_fkey" FOREIGN KEY ("meeting") REFERENCES "project_meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_user_fkey" FOREIGN KEY ("user") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "tasks" SET "legacySpentHours" = "spentHours", "progressPct" = CASE WHEN status = 'done' THEN 100 ELSE 0 END;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_progress_range" CHECK ("progressPct" BETWEEN 0 AND 100), ADD CONSTRAINT "tasks_work_type" CHECK ("workType" IN ('development','testing','database','design','documentation','devops','research'));
ALTER TABLE "task_contributors" ADD CONSTRAINT "contributor_hours_range" CHECK ("plannedHours" > 0 AND "plannedHours" <= 1000 AND "remainingHours" >= 0 AND "remainingHours" <= 1000);
ALTER TABLE "task_daily_updates" ADD CONSTRAINT "daily_update_hours_range" CHECK ("hours" >= 0 AND "hours" <= 24), ADD CONSTRAINT "daily_update_progress_range" CHECK ("progressPct" BETWEEN 0 AND 100);
ALTER TABLE "task_issues" ADD CONSTRAINT "issue_severity" CHECK (severity IN ('low','medium','high','critical')), ADD CONSTRAINT "issue_status" CHECK (status IN ('open','resolved'));
ALTER TABLE "project_meetings" ADD CONSTRAINT "meeting_dates_order" CHECK ("endAt" > "startAt"), ADD CONSTRAINT "meeting_status" CHECK (status IN ('scheduled','cancelled'));
