-- CreateTable
CREATE TABLE "CompanyEvents" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "companyKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "eventsJson" TEXT NOT NULL DEFAULT '[]',
    "webSearch" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyEvents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyEvents_orgId_companyKey_key" ON "CompanyEvents"("orgId", "companyKey");

