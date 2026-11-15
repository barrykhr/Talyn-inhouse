-- AlterTable
ALTER TABLE "DiscoveryBrief" ADD COLUMN     "aiRankTop" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "minRequiredSkills" INTEGER;

-- AlterTable
ALTER TABLE "SourcedProfile" ADD COLUMN     "aiFitJson" TEXT,
ADD COLUMN     "aiRank" INTEGER,
ADD COLUMN     "relevanceJson" TEXT NOT NULL DEFAULT '{}',
ADD COLUMN     "relevanceScore" INTEGER NOT NULL DEFAULT 0;

