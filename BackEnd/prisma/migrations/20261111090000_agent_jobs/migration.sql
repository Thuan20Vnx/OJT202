-- CreateEnum
CREATE TYPE "AgentJobKind" AS ENUM ('plan', 'qa', 'meeting');

-- CreateEnum
CREATE TYPE "AgentJobStatus" AS ENUM ('queued', 'running', 'done', 'failed', 'cancelled');

-- AlterTable
ALTER TABLE "agent_tokens" ADD COLUMN     "runner_agents" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "runner_seen_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "agent_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "AgentJobKind" NOT NULL,
    "agent" VARCHAR(20) NOT NULL,
    "status" "AgentJobStatus" NOT NULL DEFAULT 'queued',
    "input" JSONB NOT NULL,
    "result_type" VARCHAR(20),
    "result_id" UUID,
    "error" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "agent_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_jobs_user_id_status_idx" ON "agent_jobs"("user_id", "status");

-- AddForeignKey
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

