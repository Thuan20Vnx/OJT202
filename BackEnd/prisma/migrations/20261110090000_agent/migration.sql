-- CreateEnum
CREATE TYPE "RepoProvider" AS ENUM ('github', 'gitlab');

-- CreateEnum
CREATE TYPE "AgentRunKind" AS ENUM ('review', 'security', 'suggest');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('running', 'done', 'failed');

-- AlterEnum
ALTER TYPE "TaskSource" ADD VALUE 'ai_agent';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'agent';

-- AlterEnum
ALTER TYPE "AiFeature" ADD VALUE 'suggest';

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "agent_daily" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "agent_daily_time" VARCHAR(5) NOT NULL DEFAULT '08:00';

-- CreateTable
CREATE TABLE "repo_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "provider" "RepoProvider" NOT NULL,
    "base_url" VARCHAR(300) NOT NULL,
    "repo_path" VARCHAR(300) NOT NULL,
    "default_branch" VARCHAR(200) NOT NULL DEFAULT 'main',
    "token_enc" TEXT,
    "created_by_id" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repo_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID,
    "kind" "AgentRunKind" NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'done',
    "title" VARCHAR(300) NOT NULL,
    "target" VARCHAR(200),
    "summary" TEXT NOT NULL DEFAULT '',
    "focus" JSONB NOT NULL DEFAULT '[]',
    "items" JSONB NOT NULL DEFAULT '[]',
    "source" VARCHAR(20) NOT NULL DEFAULT 'server',
    "agent_name" VARCHAR(80),
    "model" TEXT,
    "error" TEXT,
    "claim_key" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "token_hash" TEXT NOT NULL,
    "prefix" VARCHAR(16) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "repo_connections_project_id_key" ON "repo_connections"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_runs_claim_key_key" ON "agent_runs"("claim_key");

-- CreateIndex
CREATE INDEX "agent_runs_project_id_createdAt_idx" ON "agent_runs"("project_id", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "agent_tokens_token_hash_key" ON "agent_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "agent_tokens_user_id_idx" ON "agent_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "repo_connections" ADD CONSTRAINT "repo_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repo_connections" ADD CONSTRAINT "repo_connections_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repo_connections" ADD CONSTRAINT "repo_connections_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

