-- AlterTable
ALTER TABLE "CallAnalysis" ADD COLUMN     "integrityJson" TEXT NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Criterion" ADD COLUMN     "mustHave" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "InterviewScheduling" ADD COLUMN     "bookingExpiresAt" TIMESTAMP(3),
ADD COLUMN     "bookingTokenHash" TEXT,
ADD COLUMN     "proposedById" TEXT;

-- AlterTable
ALTER TABLE "Resume" ADD COLUMN     "simhash" TEXT;

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "keepLooking" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "InterestCheck" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sentVia" TEXT NOT NULL,
    "sentByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "response" TEXT,

    CONSTRAINT "InterestCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalibrationRound" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suggestionsJson" TEXT,
    "suggestedAt" TIMESTAMP(3),

    CONSTRAINT "CalibrationRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalibrationItem" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "headline" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CalibrationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalibrationVote" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalibrationVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InterestCheck_tokenHash_key" ON "InterestCheck"("tokenHash");

-- CreateIndex
CREATE INDEX "InterestCheck_orgId_applicationId_idx" ON "InterestCheck"("orgId", "applicationId");

-- CreateIndex
CREATE INDEX "CalibrationRound_orgId_roleId_idx" ON "CalibrationRound"("orgId", "roleId");

-- CreateIndex
CREATE INDEX "CalibrationItem_roundId_idx" ON "CalibrationItem"("roundId");

-- CreateIndex
CREATE UNIQUE INDEX "CalibrationVote_itemId_userId_key" ON "CalibrationVote"("itemId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewScheduling_bookingTokenHash_key" ON "InterviewScheduling"("bookingTokenHash");

-- AddForeignKey
ALTER TABLE "InterestCheck" ADD CONSTRAINT "InterestCheck_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalibrationRound" ADD CONSTRAINT "CalibrationRound_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalibrationItem" ADD CONSTRAINT "CalibrationItem_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "CalibrationRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalibrationVote" ADD CONSTRAINT "CalibrationVote_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CalibrationItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

