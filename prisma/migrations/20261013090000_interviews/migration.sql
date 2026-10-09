-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "invitedByName" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewKit" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "generator" TEXT NOT NULL DEFAULT 'recruiter',
    "criteriaVersion" INTEGER,
    "ownerId" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "hiringManagerId" TEXT,
    "sharedAt" TIMESTAMP(3),
    "sharedByName" TEXT,
    "decision" TEXT,
    "decisionRationale" TEXT,
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewKit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewCompetency" (
    "id" TEXT NOT NULL,
    "kitId" TEXT NOT NULL,
    "criterionId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "importance" TEXT NOT NULL DEFAULT 'essential',
    "position" INTEGER NOT NULL DEFAULT 0,
    "anchorsJson" TEXT NOT NULL DEFAULT '{}',
    "origin" TEXT NOT NULL DEFAULT 'criteria',
    "anchorsOrigin" TEXT NOT NULL DEFAULT 'template',

    CONSTRAINT "InterviewCompetency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewQuestion" (
    "id" TEXT NOT NULL,
    "competencyId" TEXT NOT NULL,
    "kitId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "followUps" TEXT NOT NULL DEFAULT '',
    "guidance" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "origin" TEXT NOT NULL,
    "edited" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "InterviewQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewStage" (
    "id" TEXT NOT NULL,
    "kitId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "competencyIdsJson" TEXT NOT NULL DEFAULT '[]',
    "scheduledAt" TIMESTAMP(3),
    "durationMins" INTEGER,
    "locationNote" TEXT,

    CONSTRAINT "InterviewStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewAssignment" (
    "id" TEXT NOT NULL,
    "kitId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "interviewerId" TEXT NOT NULL,
    "interviewerName" TEXT NOT NULL,
    "assignedByName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "entriesJson" TEXT NOT NULL DEFAULT '[]',
    "questionNotesJson" TEXT NOT NULL DEFAULT '{}',
    "notes" TEXT NOT NULL DEFAULT '',
    "savedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebriefComment" (
    "id" TEXT NOT NULL,
    "kitId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'comment',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DebriefComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invite_tokenHash_key" ON "Invite"("tokenHash");

-- CreateIndex
CREATE INDEX "Invite_orgId_idx" ON "Invite"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewKit_applicationId_key" ON "InterviewKit"("applicationId");

-- CreateIndex
CREATE INDEX "InterviewKit_orgId_roleId_idx" ON "InterviewKit"("orgId", "roleId");

-- CreateIndex
CREATE INDEX "InterviewCompetency_kitId_idx" ON "InterviewCompetency"("kitId");

-- CreateIndex
CREATE INDEX "InterviewQuestion_kitId_idx" ON "InterviewQuestion"("kitId");

-- CreateIndex
CREATE INDEX "InterviewStage_kitId_idx" ON "InterviewStage"("kitId");

-- CreateIndex
CREATE INDEX "InterviewAssignment_interviewerId_status_idx" ON "InterviewAssignment"("interviewerId", "status");

-- CreateIndex
CREATE INDEX "InterviewAssignment_kitId_idx" ON "InterviewAssignment"("kitId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewAssignment_stageId_interviewerId_key" ON "InterviewAssignment"("stageId", "interviewerId");

-- CreateIndex
CREATE INDEX "DebriefComment_kitId_idx" ON "DebriefComment"("kitId");

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewKit" ADD CONSTRAINT "InterviewKit_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewCompetency" ADD CONSTRAINT "InterviewCompetency_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "InterviewKit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewQuestion" ADD CONSTRAINT "InterviewQuestion_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "InterviewCompetency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewStage" ADD CONSTRAINT "InterviewStage_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "InterviewKit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewAssignment" ADD CONSTRAINT "InterviewAssignment_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "InterviewStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebriefComment" ADD CONSTRAINT "DebriefComment_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "InterviewKit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

