-- Idempotent: renamed from 20261009201901_profile_scoring so it sorts after the migrations that create its tables.
-- Databases that already applied the old name see these statements as no-ops.
-- AlterTable
ALTER TABLE "Application" ADD COLUMN IF NOT EXISTS "altRoute" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN IF NOT EXISTS "altRouteAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "altRouteBy" TEXT,
ADD COLUMN IF NOT EXISTS "altRouteNote" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "accommodationText" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "demographicAttestedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "demographicAttestedBy" TEXT,
ADD COLUMN IF NOT EXISTS "demographicMonitoring" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ScoringVersion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "bandsJson" TEXT NOT NULL,
    "weightRequired" INTEGER NOT NULL,
    "weightPreferred" INTEGER NOT NULL,
    "minCoverage" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "note" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "flaggedAt" TIMESTAMP(3),
    "flagReason" TEXT,
    "flagReviewedAt" TIMESTAMP(3),
    "flagReviewedBy" TEXT,
    "flagNote" TEXT,

    CONSTRAINT "ScoringVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProfileScore" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "scoringVersionId" TEXT NOT NULL,
    "score" INTEGER,
    "coverage" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "band" TEXT,
    "bandLabel" TEXT,
    "breakdownJson" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DemographicRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'self_reported',
    "collectedAt" TIMESTAMP(3),
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemographicRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ScoringVersion_orgId_idx" ON "ScoringVersion"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ScoringVersion_roleId_version_key" ON "ScoringVersion"("roleId", "version");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProfileScore_orgId_roleId_idx" ON "ProfileScore"("orgId", "roleId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProfileScore_applicationId_createdAt_idx" ON "ProfileScore"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProfileScore_scoringVersionId_idx" ON "ProfileScore"("scoringVersionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DemographicRecord_orgId_category_idx" ON "DemographicRecord"("orgId", "category");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DemographicRecord_candidateId_category_key" ON "DemographicRecord"("candidateId", "category");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ScoringVersion" ADD CONSTRAINT "ScoringVersion_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ProfileScore" ADD CONSTRAINT "ProfileScore_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ProfileScore" ADD CONSTRAINT "ProfileScore_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ProfileScore" ADD CONSTRAINT "ProfileScore_scoringVersionId_fkey" FOREIGN KEY ("scoringVersionId") REFERENCES "ScoringVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DemographicRecord" ADD CONSTRAINT "DemographicRecord_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

