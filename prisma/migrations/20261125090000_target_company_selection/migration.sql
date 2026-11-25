-- AlterTable
ALTER TABLE "TargetCompanySet" ADD COLUMN     "selectedAt" TIMESTAMP(3),
ADD COLUMN     "selectedByName" TEXT,
ADD COLUMN     "selectedJson" TEXT NOT NULL DEFAULT '[]';
