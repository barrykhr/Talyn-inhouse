-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "interestChannel" TEXT,
ADD COLUMN     "interestSource" TEXT;

-- CreateTable
CREATE TABLE "AssessmentCorrection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'criterion',
    "criterionName" TEXT NOT NULL,
    "engineResult" TEXT NOT NULL,
    "fromResult" TEXT,
    "toResult" TEXT,
    "fromNote" TEXT,
    "note" TEXT,
    "restoredFromId" TEXT,
    "byId" TEXT,
    "byName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuplicateReview" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "candidateAId" TEXT NOT NULL,
    "candidateBId" TEXT NOT NULL,
    "reasonsJson" TEXT NOT NULL DEFAULT '[]',
    "confidence" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "note" TEXT,
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DuplicateReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssessmentCorrection_orgId_createdAt_idx" ON "AssessmentCorrection"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "AssessmentCorrection_itemId_createdAt_idx" ON "AssessmentCorrection"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "DuplicateReview_orgId_status_idx" ON "DuplicateReview"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DuplicateReview_orgId_candidateAId_candidateBId_key" ON "DuplicateReview"("orgId", "candidateAId", "candidateBId");

-- AddForeignKey
ALTER TABLE "AssessmentCorrection" ADD CONSTRAINT "AssessmentCorrection_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "AssessmentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateReview" ADD CONSTRAINT "DuplicateReview_candidateAId_fkey" FOREIGN KEY ("candidateAId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateReview" ADD CONSTRAINT "DuplicateReview_candidateBId_fkey" FOREIGN KEY ("candidateBId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

