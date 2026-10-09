-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "decisionReason" TEXT,
ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'applied',
ADD COLUMN     "originDetail" TEXT,
ADD COLUMN     "sourcedProfileId" TEXT;

-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "isSample" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SearchStrategy" ALTER COLUMN "icpId" DROP NOT NULL,
ALTER COLUMN "icpVersion" DROP NOT NULL;


-- Backfill: applications created by saving a sourcing result are "discovered".
UPDATE "Application" a SET "origin" = 'discovered', "sourcedProfileId" = sp."id", "originDetail" = 'Saved from sourcing results'
FROM "SourcedProfile" sp WHERE sp."savedApplicationId" = a."id";
UPDATE "Application" a SET "origin" = 'discovered', "originDetail" = COALESCE(a."originDetail", 'Saved from sourcing results')
FROM "Candidate" c WHERE c."id" = a."candidateId" AND c."source" LIKE 'sourced:%';
