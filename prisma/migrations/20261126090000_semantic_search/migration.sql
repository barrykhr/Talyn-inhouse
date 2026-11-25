-- AlterTable
ALTER TABLE "SourcedProfile" ADD COLUMN     "profileText" TEXT;

-- CreateTable
CREATE TABLE "Embedding" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "vector" DOUBLE PRECISION[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Embedding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Embedding_orgId_kind_idx" ON "Embedding"("orgId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Embedding_kind_refId_key" ON "Embedding"("kind", "refId");

