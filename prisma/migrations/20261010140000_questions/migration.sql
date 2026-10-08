-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "criterionId" TEXT,
    "criterionName" TEXT NOT NULL,
    "applicationId" TEXT,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "rationale" TEXT NOT NULL DEFAULT '',
    "evidenceJson" TEXT NOT NULL DEFAULT '{}',
    "origin" TEXT NOT NULL,
    "generator" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Question_orgId_roleId_idx" ON "Question"("orgId", "roleId");

-- CreateIndex
CREATE INDEX "Question_applicationId_idx" ON "Question"("applicationId");

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

