-- CreateTable
CREATE TABLE "InboxState" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "until" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InboxState_orgId_userId_idx" ON "InboxState"("orgId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "InboxState_userId_orgId_itemKey_key" ON "InboxState"("userId", "orgId", "itemKey");

