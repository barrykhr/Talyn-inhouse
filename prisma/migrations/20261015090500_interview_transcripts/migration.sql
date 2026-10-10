-- CreateTable
CREATE TABLE "InterviewRecording" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kitId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "durationMs" INTEGER,
    "consentMethod" TEXT NOT NULL,
    "consentNote" TEXT,
    "consentByName" TEXT NOT NULL,
    "consentById" TEXT,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "analysisModel" TEXT,
    "analyzedAt" TIMESTAMP(3),
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewRecording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptSegment" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "speaker" TEXT NOT NULL,
    "speakerRole" TEXT NOT NULL DEFAULT 'unknown',
    "text" TEXT NOT NULL,
    "originalText" TEXT NOT NULL,
    "editedByName" TEXT,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "TranscriptSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationInsight" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "competencyId" TEXT,
    "competencyName" TEXT,
    "criterionId" TEXT,
    "coverage" TEXT,
    "text" TEXT NOT NULL,
    "quote" TEXT,
    "segmentIdsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'suggested',
    "editedText" TEXT,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "usedInScorecardBy" TEXT,
    "usedInScorecardAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterviewRecording_orgId_kitId_idx" ON "InterviewRecording"("orgId", "kitId");

-- CreateIndex
CREATE INDEX "TranscriptSegment_recordingId_idx_idx" ON "TranscriptSegment"("recordingId", "idx");

-- CreateIndex
CREATE INDEX "ConversationInsight_recordingId_kind_idx" ON "ConversationInsight"("recordingId", "kind");

-- AddForeignKey
ALTER TABLE "InterviewRecording" ADD CONSTRAINT "InterviewRecording_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "InterviewStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "InterviewRecording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationInsight" ADD CONSTRAINT "ConversationInsight_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "InterviewRecording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

