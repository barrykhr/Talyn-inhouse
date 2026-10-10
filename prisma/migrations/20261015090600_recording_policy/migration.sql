-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "recordingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recordingEnabledAt" TIMESTAMP(3),
ADD COLUMN     "recordingEnabledBy" TEXT,
ADD COLUMN     "recordingPolicy" TEXT NOT NULL DEFAULT '';

