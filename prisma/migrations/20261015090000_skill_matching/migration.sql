-- Idempotent: renamed from 20261009134803_skill_matching so it sorts after the migrations that create its tables.
-- Databases that already applied the old name see these statements as no-ops.
-- AlterTable
ALTER TABLE "AssessmentItem" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'criterion';

-- AlterTable
ALTER TABLE "Criterion" ADD COLUMN IF NOT EXISTS "aliases" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'criterion',
ADD COLUMN IF NOT EXISTS "mappedCriterionId" TEXT;

-- AlterTable
ALTER TABLE "Role" ADD COLUMN IF NOT EXISTS "rubricUpdatedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "rubricUpdatedBy" TEXT,
ADD COLUMN IF NOT EXISTS "skillPartialCredit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "skillThreshold" INTEGER,
ADD COLUMN IF NOT EXISTS "weightPreferred" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS "weightRequired" INTEGER NOT NULL DEFAULT 2;

