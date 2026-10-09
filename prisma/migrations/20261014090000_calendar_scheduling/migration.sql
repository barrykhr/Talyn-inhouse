-- CreateTable
CREATE TABLE "CalendarConnection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "googleEmail" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT '',
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastError" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewScheduling" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "kitId" TEXT NOT NULL,
    "interviewerIdsJson" TEXT NOT NULL DEFAULT '[]',
    "durationMins" INTEGER NOT NULL DEFAULT 60,
    "dateFrom" TEXT NOT NULL,
    "dateTo" TEXT NOT NULL,
    "workStart" TEXT NOT NULL DEFAULT '09:00',
    "workEnd" TEXT NOT NULL DEFAULT '17:00',
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "candidateEmail" TEXT,
    "candidatePhone" TEXT,
    "candidateWindowsJson" TEXT NOT NULL DEFAULT '[]',
    "manualWindowsJson" TEXT NOT NULL DEFAULT '{}',
    "meetingMethod" TEXT NOT NULL DEFAULT 'meet',
    "locationNote" TEXT,
    "proposedSlotsJson" TEXT NOT NULL DEFAULT '[]',
    "proposedVia" TEXT,
    "proposedAt" TIMESTAMP(3),
    "updatedByName" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewScheduling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kitId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "organizerUserId" TEXT NOT NULL,
    "organizerEmail" TEXT,
    "calendarId" TEXT NOT NULL DEFAULT 'primary',
    "googleEventId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "timeZone" TEXT NOT NULL,
    "attendeesJson" TEXT NOT NULL DEFAULT '[]',
    "meetUrl" TEXT,
    "meetStatus" TEXT,
    "htmlLink" TEXT,
    "meetingMethod" TEXT NOT NULL DEFAULT 'meet',
    "locationNote" TEXT,
    "lastError" TEXT,
    "createdByName" TEXT NOT NULL,
    "updatedByName" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarConnection_orgId_idx" ON "CalendarConnection"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_userId_orgId_key" ON "CalendarConnection"("userId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewScheduling_stageId_key" ON "InterviewScheduling"("stageId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewEvent_requestKey_key" ON "InterviewEvent"("requestKey");

-- CreateIndex
CREATE INDEX "InterviewEvent_orgId_idx" ON "InterviewEvent"("orgId");

-- CreateIndex
CREATE INDEX "InterviewEvent_stageId_status_idx" ON "InterviewEvent"("stageId", "status");

-- AddForeignKey
ALTER TABLE "InterviewScheduling" ADD CONSTRAINT "InterviewScheduling_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "InterviewStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewEvent" ADD CONSTRAINT "InterviewEvent_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "InterviewStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

