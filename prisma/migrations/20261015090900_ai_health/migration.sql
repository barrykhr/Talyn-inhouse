-- CreateTable
CREATE TABLE "AiHealth" (
    "provider" TEXT NOT NULL,
    "lastOkAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorKind" TEXT,
    "lastErrorText" TEXT,
    "failuresSinceOk" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiHealth_pkey" PRIMARY KEY ("provider")
);

