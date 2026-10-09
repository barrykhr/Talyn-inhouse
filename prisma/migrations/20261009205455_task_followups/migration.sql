-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "agentApprovedBy" TEXT,
ADD COLUMN     "agentChannel" TEXT,
ADD COLUMN     "agentDraft" TEXT,
ADD COLUMN     "agentDraftedBy" TEXT,
ADD COLUMN     "agentError" TEXT,
ADD COLUMN     "agentProviderId" TEXT,
ADD COLUMN     "agentReplyAt" TIMESTAMP(3),
ADD COLUMN     "agentReplyVia" TEXT,
ADD COLUMN     "agentSentAt" TIMESTAMP(3),
ADD COLUMN     "agentSentVia" TEXT,
ADD COLUMN     "agentStatus" TEXT,
ADD COLUMN     "agentSubject" TEXT,
ADD COLUMN     "agentTo" TEXT;

-- CreateIndex
CREATE INDEX "Task_agentProviderId_idx" ON "Task"("agentProviderId");

