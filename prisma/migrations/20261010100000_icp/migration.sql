-- CreateTable
CREATE TABLE "Icp" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "generator" TEXT NOT NULL,
    "criteriaVersion" INTEGER NOT NULL,
    "clarificationsJson" TEXT NOT NULL DEFAULT '[]',
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Icp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IcpItem" (
    "id" TEXT NOT NULL,
    "icpId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "rationale" TEXT,
    "sourceQuote" TEXT,
    "sourcePage" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "IcpItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Icp_orgId_roleId_idx" ON "Icp"("orgId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "Icp_roleId_version_key" ON "Icp"("roleId", "version");

-- CreateIndex
CREATE INDEX "IcpItem_icpId_idx" ON "IcpItem"("icpId");

-- AddForeignKey
ALTER TABLE "Icp" ADD CONSTRAINT "Icp_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IcpItem" ADD CONSTRAINT "IcpItem_icpId_fkey" FOREIGN KEY ("icpId") REFERENCES "Icp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

