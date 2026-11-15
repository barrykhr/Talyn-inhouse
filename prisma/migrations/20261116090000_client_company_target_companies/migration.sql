-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "clientCompanyName" TEXT,
ADD COLUMN     "clientCompanyNotes" TEXT,
ADD COLUMN     "clientCompanyWebsite" TEXT;

-- CreateTable
CREATE TABLE "TargetCompanySet" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "clientProfileJson" TEXT NOT NULL,
    "companiesJson" TEXT NOT NULL DEFAULT '[]',
    "droppedJson" TEXT NOT NULL DEFAULT '[]',
    "model" TEXT NOT NULL,
    "webSearch" BOOLEAN NOT NULL DEFAULT false,
    "generatedByName" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TargetCompanySet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TargetCompanySet_roleId_key" ON "TargetCompanySet"("roleId");

-- CreateIndex
CREATE INDEX "TargetCompanySet_orgId_idx" ON "TargetCompanySet"("orgId");

-- AddForeignKey
ALTER TABLE "TargetCompanySet" ADD CONSTRAINT "TargetCompanySet_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

