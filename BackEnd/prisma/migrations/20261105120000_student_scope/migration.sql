-- Vai trò chuyên môn (một người giữ nhiều vai trò) và giảng viên hướng dẫn.
ALTER TABLE "memberships" ADD COLUMN "specialties" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "memberships" ADD COLUMN "isMentor" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "invites" ADD COLUMN "mentor" BOOLEAN NOT NULL DEFAULT false;

-- Danh mục nhãn theo dự án; nhãn đã dùng trước đây được giữ lại làm lựa chọn.
CREATE TABLE "project_labels" (
    "project" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_labels_pkey" PRIMARY KEY ("project","name")
);
ALTER TABLE "project_labels" ADD CONSTRAINT "project_labels_project_fkey" FOREIGN KEY ("project") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
INSERT INTO "project_labels" ("project", "name")
SELECT DISTINCT "project_id", left(label, 40) FROM "tasks", unnest("labels") AS label
WHERE "deleted_at" IS NULL AND trim(label) <> ''
ON CONFLICT DO NOTHING;

-- Nhiều Sprint cho một dự án. projects.sprint vẫn giữ bản sao của Sprint đang chạy để tương thích.
CREATE TABLE "sprints" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "goal" VARCHAR(300) NOT NULL DEFAULT '',
    "start" TIMESTAMP(3),
    "end" TIMESTAMP(3),
    "status" VARCHAR(20) NOT NULL DEFAULT 'planned',
    "closedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sprints_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sprints_project_name_key" ON "sprints"("project", "name");
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_project_fkey" FOREIGN KEY ("project") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
INSERT INTO "sprints" ("project", "name", "goal", "start", "end", "status")
SELECT "id", left("sprint"->>'name', 60), left(coalesce("sprint"->>'goal', ''), 300),
       (nullif("sprint"->>'start', ''))::timestamptz, (nullif("sprint"->>'end', ''))::timestamptz, 'active'
FROM "projects" WHERE coalesce("sprint"->>'name', '') <> '';
INSERT INTO "sprints" ("project", "name")
SELECT DISTINCT "project_id", left("sprint", 60) FROM "tasks"
WHERE "deleted_at" IS NULL AND "sprint" <> ''
ON CONFLICT DO NOTHING;

-- Issue cấp dự án: có thể không gắn task (ví dụ thành viên bị ốm).
ALTER TABLE "task_issues" ADD COLUMN "project" UUID;
UPDATE "task_issues" i SET "project" = t."project_id" FROM "tasks" t WHERE t."id" = i."task";
ALTER TABLE "task_issues" ALTER COLUMN "project" SET NOT NULL;
ALTER TABLE "task_issues" ALTER COLUMN "task" DROP NOT NULL;
ALTER TABLE "task_issues" ADD COLUMN "type" VARCHAR(20) NOT NULL DEFAULT 'technical';
ALTER TABLE "task_issues" ADD COLUMN "affectedUser" UUID;
ALTER TABLE "task_issues" ADD COLUMN "startDate" DATE;
ALTER TABLE "task_issues" ADD COLUMN "endDate" DATE;
ALTER TABLE "task_issues" ADD CONSTRAINT "task_issues_project_fkey" FOREIGN KEY ("project") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_issues" ADD CONSTRAINT "task_issues_affectedUser_fkey" FOREIGN KEY ("affectedUser") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "task_issues_project_status_idx" ON "task_issues"("project", "status");

-- Bộ đếm chống spam và khóa tạm sau nhiều lần nhập sai mật khẩu.
CREATE TABLE "rate_counters" (
    "key" VARCHAR(120) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "rate_counters_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "rate_counters_windowStart_idx" ON "rate_counters"("windowStart");
