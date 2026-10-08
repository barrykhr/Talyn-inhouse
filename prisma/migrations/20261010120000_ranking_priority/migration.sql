-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "priorityAt" TIMESTAMP(3),
ADD COLUMN     "priorityByName" TEXT,
ADD COLUMN     "priorityNote" TEXT;

