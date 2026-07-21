ALTER TABLE "AssignmentReminderDispatch"
  ADD COLUMN "audience" TEXT NOT NULL DEFAULT 'combined';

CREATE TABLE "AssignmentReminderEngagement" (
  "id" TEXT NOT NULL,
  "dispatchId" TEXT NOT NULL,
  "audience" TEXT NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  "trackingToken" TEXT NOT NULL,
  "actionUrl" TEXT,
  "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "openedAt" TIMESTAMP(3),
  "clickedAt" TIMESTAMP(3),
  "actionCompletedAt" TIMESTAMP(3),
  "metadataJson" JSONB,
  CONSTRAINT "AssignmentReminderEngagement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AssignmentReminderEngagement_dispatchId_fkey"
    FOREIGN KEY ("dispatchId") REFERENCES "AssignmentReminderDispatch"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AssignmentReminderEngagement_trackingToken_key"
  ON "AssignmentReminderEngagement"("trackingToken");
CREATE UNIQUE INDEX "AssignmentReminderEngagement_dispatchId_audience_recipientEmail_key"
  ON "AssignmentReminderEngagement"("dispatchId", "audience", "recipientEmail");
CREATE INDEX "AssignmentReminderEngagement_audience_queuedAt_idx"
  ON "AssignmentReminderEngagement"("audience", "queuedAt");
CREATE INDEX "AssignmentReminderEngagement_openedAt_clickedAt_idx"
  ON "AssignmentReminderEngagement"("openedAt", "clickedAt");
CREATE INDEX "AssignmentReminderEngagement_actionCompletedAt_idx"
  ON "AssignmentReminderEngagement"("actionCompletedAt");
