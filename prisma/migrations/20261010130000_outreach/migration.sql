-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "contactOptOut" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "optOutAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OutreachTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachSequence" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "stopReason" TEXT,
    "activatedByName" TEXT,
    "activatedAt" TIMESTAMP(3),
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachMessage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "delayDays" INTEGER NOT NULL DEFAULT 0,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "draftSubject" TEXT NOT NULL,
    "draftBody" TEXT NOT NULL,
    "personalizationJson" TEXT NOT NULL DEFAULT '[]',
    "generator" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "sentVia" TEXT,
    "providerMessageId" TEXT,
    "toEmail" TEXT,
    "senderName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "messageId" TEXT,
    "type" TEXT NOT NULL,
    "providerConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "actorName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutreachTemplate_orgId_idx" ON "OutreachTemplate"("orgId");

-- CreateIndex
CREATE INDEX "OutreachSequence_orgId_status_idx" ON "OutreachSequence"("orgId", "status");

-- CreateIndex
CREATE INDEX "OutreachSequence_applicationId_idx" ON "OutreachSequence"("applicationId");

-- CreateIndex
CREATE INDEX "OutreachMessage_orgId_status_idx" ON "OutreachMessage"("orgId", "status");

-- CreateIndex
CREATE INDEX "OutreachMessage_sequenceId_idx" ON "OutreachMessage"("sequenceId");

-- CreateIndex
CREATE INDEX "OutreachEvent_sequenceId_idx" ON "OutreachEvent"("sequenceId");

-- AddForeignKey
ALTER TABLE "SearchStrategy" ADD CONSTRAINT "SearchStrategy_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachSequence" ADD CONSTRAINT "OutreachSequence_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachMessage" ADD CONSTRAINT "OutreachMessage_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "OutreachSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachEvent" ADD CONSTRAINT "OutreachEvent_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "OutreachSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

