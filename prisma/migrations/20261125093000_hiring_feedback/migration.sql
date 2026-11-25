-- CreateTable
CREATE TABLE "HiringFeedback" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HiringFeedback_orgId_idx" ON "HiringFeedback"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "HiringFeedback_applicationId_userId_key" ON "HiringFeedback"("applicationId", "userId");

-- AddForeignKey
ALTER TABLE "HiringFeedback" ADD CONSTRAINT "HiringFeedback_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

