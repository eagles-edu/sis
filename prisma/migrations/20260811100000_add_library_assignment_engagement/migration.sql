CREATE TABLE "library"."LibraryAssignmentEngagement" (
  "id" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  "trackingToken" TEXT NOT NULL,
  "queueId" TEXT,
  "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "openedAt" TIMESTAMP(3),
  "clickedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "metadataJson" JSONB,
  CONSTRAINT "LibraryAssignmentEngagement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LibraryAssignmentEngagement_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "library"."LibraryAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LibraryAssignmentEngagement_trackingToken_key" ON "library"."LibraryAssignmentEngagement"("trackingToken");
CREATE UNIQUE INDEX "LibraryAssignmentEngagement_assignmentId_recipientEmail_key" ON "library"."LibraryAssignmentEngagement"("assignmentId", "recipientEmail");
CREATE INDEX "LibraryAssignmentEngagement_queuedAt_idx" ON "library"."LibraryAssignmentEngagement"("queuedAt");
CREATE INDEX "LibraryAssignmentEngagement_openedAt_clickedAt_idx" ON "library"."LibraryAssignmentEngagement"("openedAt", "clickedAt");
