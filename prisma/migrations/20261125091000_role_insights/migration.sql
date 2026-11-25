-- CreateTable
CREATE TABLE "RoleInsight" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "checksJson" TEXT NOT NULL DEFAULT '[]',
    "growthJson" TEXT,
    "model" TEXT NOT NULL,
    "jdFileName" TEXT,
    "generatedByName" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoleInsight_roleId_key" ON "RoleInsight"("roleId");

-- CreateIndex
CREATE INDEX "RoleInsight_orgId_idx" ON "RoleInsight"("orgId");

-- AddForeignKey
ALTER TABLE "RoleInsight" ADD CONSTRAINT "RoleInsight_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

