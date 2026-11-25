-- AlterTable
ALTER TABLE "DiscoveryBrief" ADD COLUMN     "describedAs" TEXT,
ADD COLUMN     "synonymsJson" TEXT NOT NULL DEFAULT '{}';

