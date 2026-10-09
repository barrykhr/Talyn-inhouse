-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "interest" TEXT NOT NULL DEFAULT 'not_expressed',
ADD COLUMN     "interestAt" TIMESTAMP(3),
ADD COLUMN     "interestByName" TEXT,
ADD COLUMN     "interestNote" TEXT;

-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "whatsappPermission" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "whatsappPermissionAt" TIMESTAMP(3),
ADD COLUMN     "whatsappPermissionBy" TEXT,
ADD COLUMN     "whatsappPermissionNote" TEXT;

-- AlterTable
ALTER TABLE "OutreachMessage" ADD COLUMN     "toPhone" TEXT;

-- AlterTable
ALTER TABLE "OutreachSequence" ADD COLUMN     "channel" TEXT NOT NULL DEFAULT 'email';

-- AlterTable
ALTER TABLE "SearchRun" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sourcesJson" TEXT NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "SourcedProfile" ADD COLUMN     "sourcesJson" TEXT NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "DiscoveryBrief" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "roleName" TEXT NOT NULL,
    "altTitlesJson" TEXT NOT NULL DEFAULT '[]',
    "skillsRequiredJson" TEXT NOT NULL DEFAULT '[]',
    "skillsPreferredJson" TEXT NOT NULL DEFAULT '[]',
    "exclusionsJson" TEXT NOT NULL DEFAULT '[]',
    "minYears" INTEGER,
    "maxYears" INTEGER,
    "location" TEXT,
    "workArrangement" TEXT,
    "provenanceJson" TEXT NOT NULL DEFAULT '{}',
    "booleanQuery" TEXT NOT NULL DEFAULT '',
    "booleanEdited" BOOLEAN NOT NULL DEFAULT false,
    "booleanFieldsKey" TEXT,
    "extractor" TEXT,
    "jdId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedByName" TEXT,
    "updatedByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryBrief_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryBrief_roleId_key" ON "DiscoveryBrief"("roleId");

-- CreateIndex
CREATE INDEX "DiscoveryBrief_orgId_idx" ON "DiscoveryBrief"("orgId");

-- AddForeignKey
ALTER TABLE "DiscoveryBrief" ADD CONSTRAINT "DiscoveryBrief_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Earlier sample-data searches are demo runs.
UPDATE "SearchRun" SET "isDemo" = true WHERE "source" = 'sample';
