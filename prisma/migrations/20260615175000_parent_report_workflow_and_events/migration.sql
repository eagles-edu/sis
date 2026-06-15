ALTER TABLE "ParentClassReport"
ADD COLUMN "workflowState" TEXT NOT NULL DEFAULT 'draft_pr',
ADD COLUMN "submittedAt" TIMESTAMP(3),
ADD COLUMN "submittedByUsername" TEXT,
ADD COLUMN "adminReviewStartedAt" TIMESTAMP(3),
ADD COLUMN "adminReviewStartedByUsername" TEXT,
ADD COLUMN "rcDraftedAt" TIMESTAMP(3),
ADD COLUMN "rcDraftedByUsername" TEXT,
ADD COLUMN "publishedAt" TIMESTAMP(3),
ADD COLUMN "notificationQueuedAt" TIMESTAMP(3),
ADD COLUMN "notificationSentAt" TIMESTAMP(3),
ADD COLUMN "finalArtifactVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "finalArtifactPayload" JSONB,
ADD COLUMN "finalArtifactFrozenAt" TIMESTAMP(3);

CREATE INDEX "ParentClassReport_workflowState_schoolYear_quarter_generatedAt_idx"
ON "ParentClassReport"("workflowState", "schoolYear", "quarter", "generatedAt");

CREATE TABLE "ParentClassReportEvent" (
  "id" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "artifactVersion" INTEGER,
  "eventType" TEXT NOT NULL,
  "eventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorType" TEXT,
  "actorId" TEXT,
  "recipientEmail" TEXT,
  "channel" TEXT,
  "userAgent" TEXT,
  "ipHash" TEXT,
  "metadataJson" JSONB,

  CONSTRAINT "ParentClassReportEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ParentClassReportEvent_reportId_eventAt_idx"
ON "ParentClassReportEvent"("reportId", "eventAt");

CREATE INDEX "ParentClassReportEvent_eventType_eventAt_idx"
ON "ParentClassReportEvent"("eventType", "eventAt");

CREATE INDEX "ParentClassReportEvent_recipientEmail_eventAt_idx"
ON "ParentClassReportEvent"("recipientEmail", "eventAt");
