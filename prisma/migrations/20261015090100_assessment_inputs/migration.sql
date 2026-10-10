-- Idempotent: renamed from 20261009134955_assessment_inputs so it sorts after the migrations that create its tables.
-- Databases that already applied the old name see these statements as no-ops.
-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN IF NOT EXISTS "profileHash" TEXT,
ADD COLUMN IF NOT EXISTS "sourceProfileId" TEXT;

