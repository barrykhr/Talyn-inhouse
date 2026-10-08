-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "criteriaVersion" INTEGER,
ADD COLUMN     "engineVersion" TEXT,
ADD COLUMN     "finalRecommendation" TEXT,
ADD COLUMN     "parserVersion" TEXT,
ADD COLUMN     "recommendation" TEXT,
ADD COLUMN     "recommendationJson" TEXT,
ADD COLUMN     "recommendationNote" TEXT,
ADD COLUMN     "recommendationReviewedAt" TIMESTAMP(3),
ADD COLUMN     "recommendationReviewedBy" TEXT,
ADD COLUMN     "recommendationStatus" TEXT,
ADD COLUMN     "scoreJson" TEXT;

-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "extractionStatus" TEXT,
ADD COLUMN     "fieldOriginsJson" TEXT NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Criterion" ADD COLUMN     "sourcePage" INTEGER,
ADD COLUMN     "sourceSection" TEXT;

-- AlterTable
ALTER TABLE "Resume" ADD COLUMN     "parserVersion" TEXT NOT NULL DEFAULT 'text-v1';

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "criteriaVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "extractionStatus" TEXT;

-- CreateTable
CREATE TABLE "JobDescription" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "pagesJson" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobDescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobDescriptionFile" (
    "id" TEXT NOT NULL,
    "jdId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "JobDescriptionFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractedField" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "roleId" TEXT,
    "candidateId" TEXT,
    "documentId" TEXT,
    "field" TEXT NOT NULL,
    "valueJson" TEXT NOT NULL,
    "editedValueJson" TEXT,
    "sourceQuote" TEXT,
    "sourcePage" INTEGER,
    "sourceSection" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "extractor" TEXT NOT NULL,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractedField_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobDescription_orgId_roleId_idx" ON "JobDescription"("orgId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "JobDescriptionFile_jdId_key" ON "JobDescriptionFile"("jdId");

-- CreateIndex
CREATE INDEX "ExtractedField_orgId_roleId_idx" ON "ExtractedField"("orgId", "roleId");

-- CreateIndex
CREATE INDEX "ExtractedField_orgId_candidateId_idx" ON "ExtractedField"("orgId", "candidateId");

-- AddForeignKey
ALTER TABLE "JobDescription" ADD CONSTRAINT "JobDescription_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDescriptionFile" ADD CONSTRAINT "JobDescriptionFile_jdId_fkey" FOREIGN KEY ("jdId") REFERENCES "JobDescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedField" ADD CONSTRAINT "ExtractedField_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedField" ADD CONSTRAINT "ExtractedField_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

