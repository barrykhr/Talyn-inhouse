-- Idempotent: renamed from 20261009205455_task_followups so it sorts after the migrations that create its tables.
-- Databases that already applied the old name see these statements as no-ops.
-- AlterTable
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "agentApprovedBy" TEXT,
ADD COLUMN IF NOT EXISTS "agentChannel" TEXT,
ADD COLUMN IF NOT EXISTS "agentDraft" TEXT,
ADD COLUMN IF NOT EXISTS "agentDraftedBy" TEXT,
ADD COLUMN IF NOT EXISTS "agentError" TEXT,
ADD COLUMN IF NOT EXISTS "agentProviderId" TEXT,
ADD COLUMN IF NOT EXISTS "agentReplyAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "agentReplyVia" TEXT,
ADD COLUMN IF NOT EXISTS "agentSentAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "agentSentVia" TEXT,
ADD COLUMN IF NOT EXISTS "agentStatus" TEXT,
ADD COLUMN IF NOT EXISTS "agentSubject" TEXT,
ADD COLUMN IF NOT EXISTS "agentTo" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Task_agentProviderId_idx" ON "Task"("agentProviderId");

