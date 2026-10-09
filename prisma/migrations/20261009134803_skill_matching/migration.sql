-- AlterTable
ALTER TABLE "AssessmentItem" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'criterion';

-- AlterTable
ALTER TABLE "Criterion" ADD COLUMN     "aliases" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'criterion',
ADD COLUMN     "mappedCriterionId" TEXT;

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "rubricUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "rubricUpdatedBy" TEXT,
ADD COLUMN     "skillPartialCredit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "skillThreshold" INTEGER,
ADD COLUMN     "weightPreferred" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "weightRequired" INTEGER NOT NULL DEFAULT 2;

