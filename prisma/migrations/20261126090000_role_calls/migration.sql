-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "notetakerName" TEXT,
ADD COLUMN     "notetakerTokenAt" TIMESTAMP(3),
ADD COLUMN     "notetakerTokenBy" TEXT,
ADD COLUMN     "notetakerTokenHash" TEXT;

-- CreateTable
CREATE TABLE "RoleCall" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "roleId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "source" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "candidateId" TEXT,
    "applicationId" TEXT,
    "interviewerName" TEXT,
    "interviewerRole" TEXT NOT NULL DEFAULT 'hiring_manager',
    "speakersJson" TEXT NOT NULL DEFAULT '[]',
    "participantsJson" TEXT NOT NULL DEFAULT '[]',
    "consentMethod" TEXT NOT NULL,
    "consentByName" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "error" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallSegment" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "speaker" TEXT NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "CallSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallAnalysis" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "criteriaVersion" INTEGER NOT NULL,
    "candidateJson" TEXT NOT NULL DEFAULT '[]',
    "questionsJson" TEXT NOT NULL DEFAULT '[]',
    "coverageJson" TEXT NOT NULL DEFAULT '[]',
    "expectationsJson" TEXT NOT NULL DEFAULT '[]',
    "behaviouralJson" TEXT NOT NULL DEFAULT '[]',
    "suggestionsJson" TEXT NOT NULL DEFAULT '[]',
    "questionAlignment" INTEGER,
    "essentialCoverage" INTEGER,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BehaviouralSet" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "companySize" TEXT NOT NULL,
    "scenariosJson" TEXT NOT NULL DEFAULT '[]',
    "questionsJson" TEXT NOT NULL DEFAULT '[]',
    "model" TEXT NOT NULL,
    "generatedByName" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BehaviouralSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoleCall_orgId_roleId_idx" ON "RoleCall"("orgId", "roleId");

-- CreateIndex
CREATE INDEX "RoleCall_orgId_status_idx" ON "RoleCall"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RoleCall_orgId_externalId_key" ON "RoleCall"("orgId", "externalId");

-- CreateIndex
CREATE INDEX "CallSegment_callId_idx_idx" ON "CallSegment"("callId", "idx");

-- CreateIndex
CREATE UNIQUE INDEX "CallAnalysis_callId_key" ON "CallAnalysis"("callId");

-- CreateIndex
CREATE INDEX "CallAnalysis_orgId_roleId_idx" ON "CallAnalysis"("orgId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "BehaviouralSet_roleId_key" ON "BehaviouralSet"("roleId");

-- CreateIndex
CREATE INDEX "BehaviouralSet_orgId_idx" ON "BehaviouralSet"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_notetakerTokenHash_key" ON "Organization"("notetakerTokenHash");

-- AddForeignKey
ALTER TABLE "RoleCall" ADD CONSTRAINT "RoleCall_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSegment" ADD CONSTRAINT "CallSegment_callId_fkey" FOREIGN KEY ("callId") REFERENCES "RoleCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallAnalysis" ADD CONSTRAINT "CallAnalysis_callId_fkey" FOREIGN KEY ("callId") REFERENCES "RoleCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BehaviouralSet" ADD CONSTRAINT "BehaviouralSet_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

