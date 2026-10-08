-- CreateTable
CREATE TABLE "SearchStrategy" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "icpId" TEXT NOT NULL,
    "icpVersion" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "request" TEXT NOT NULL DEFAULT '',
    "filtersJson" TEXT NOT NULL,
    "booleanQuery" TEXT NOT NULL DEFAULT '',
    "mappingJson" TEXT NOT NULL DEFAULT '[]',
    "explanationsJson" TEXT NOT NULL DEFAULT '[]',
    "planJson" TEXT NOT NULL DEFAULT '{}',
    "generator" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchStrategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "query" TEXT NOT NULL DEFAULT '',
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "excludedCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedTotal" INTEGER,
    "error" TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourcedProfile" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "displayName" TEXT NOT NULL,
    "currentTitle" TEXT,
    "currentCompany" TEXT,
    "location" TEXT,
    "fieldsJson" TEXT NOT NULL DEFAULT '{}',
    "signalsJson" TEXT NOT NULL DEFAULT '[]',
    "matchedSignals" INTEGER NOT NULL DEFAULT 0,
    "totalSignals" INTEGER NOT NULL DEFAULT 0,
    "evidenceStatus" TEXT NOT NULL DEFAULT 'ok',
    "staleReason" TEXT,
    "duplicateCandidateId" TEXT,
    "duplicateReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "excludedBy" TEXT,
    "feedback" TEXT,
    "feedbackReason" TEXT,
    "savedApplicationId" TEXT,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourcedProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SearchStrategy_orgId_roleId_idx" ON "SearchStrategy"("orgId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "SearchStrategy_roleId_version_key" ON "SearchStrategy"("roleId", "version");

-- CreateIndex
CREATE INDEX "SearchRun_orgId_roleId_idx" ON "SearchRun"("orgId", "roleId");

-- CreateIndex
CREATE INDEX "SourcedProfile_orgId_roleId_status_idx" ON "SourcedProfile"("orgId", "roleId", "status");

-- CreateIndex
CREATE INDEX "SourcedProfile_runId_idx" ON "SourcedProfile"("runId");

-- AddForeignKey
ALTER TABLE "SearchRun" ADD CONSTRAINT "SearchRun_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "SearchStrategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcedProfile" ADD CONSTRAINT "SourcedProfile_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

