CREATE TABLE "weekly_capacities" (
  "workspace_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "week_start" DATE NOT NULL,
  "hours" DOUBLE PRECISION NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "weekly_capacities_pkey" PRIMARY KEY ("workspace_id", "user_id", "week_start"),
  CONSTRAINT "weekly_capacities_membership_fkey" FOREIGN KEY ("workspace_id", "user_id")
    REFERENCES "memberships" ("workspace_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "weekly_capacities_hours_check" CHECK ("hours" >= 0 AND "hours" <= 80),
  CONSTRAINT "weekly_capacities_monday_check" CHECK (EXTRACT(ISODOW FROM "week_start") = 1),
  CONSTRAINT "weekly_capacities_version_check" CHECK ("version" >= 1)
);
