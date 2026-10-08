-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "atsExternalId" TEXT;

-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "atsExternalId" TEXT,
ADD COLUMN     "atsSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "atsLinkedAt" TIMESTAMP(3),
ADD COLUMN     "atsLinkedBy" TEXT;

-- AlterTable
ALTER TABLE "OutreachMessage" ADD COLUMN     "deliveredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "atsExternalId" TEXT;

-- CreateTable
CREATE TABLE "AtsSyncRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "connector" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "conflicts" INTEGER NOT NULL DEFAULT 0,
    "errorsJson" TEXT NOT NULL DEFAULT '[]',
    "triggeredBy" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AtsSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtsConflict" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "talynValue" TEXT NOT NULL,
    "atsValue" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedByName" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AtsConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtsStageMap" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "talynStage" TEXT NOT NULL,
    "atsStage" TEXT,

    CONSTRAINT "AtsStageMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtsOutbox" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "talynStage" TEXT NOT NULL,
    "atsStage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "AtsOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AtsSyncRun_orgId_startedAt_idx" ON "AtsSyncRun"("orgId", "startedAt");

-- CreateIndex
CREATE INDEX "AtsConflict_orgId_status_idx" ON "AtsConflict"("orgId", "status");

-- CreateIndex
CREATE INDEX "AtsConflict_candidateId_idx" ON "AtsConflict"("candidateId");

-- CreateIndex
CREATE INDEX "AtsStageMap_orgId_idx" ON "AtsStageMap"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "AtsStageMap_roleId_talynStage_key" ON "AtsStageMap"("roleId", "talynStage");

-- CreateIndex
CREATE INDEX "AtsOutbox_orgId_status_idx" ON "AtsOutbox"("orgId", "status");

-- CreateIndex
CREATE INDEX "AtsOutbox_status_nextAttemptAt_idx" ON "AtsOutbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "OutreachMessage_providerMessageId_idx" ON "OutreachMessage"("providerMessageId");

-- AddForeignKey
ALTER TABLE "AtsSyncRun" ADD CONSTRAINT "AtsSyncRun_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtsConflict" ADD CONSTRAINT "AtsConflict_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtsStageMap" ADD CONSTRAINT "AtsStageMap_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtsOutbox" ADD CONSTRAINT "AtsOutbox_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

