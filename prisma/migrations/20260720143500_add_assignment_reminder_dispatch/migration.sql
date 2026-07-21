CREATE TABLE "AssignmentReminderDispatch" (
  "id" TEXT NOT NULL,
  "dispatchKey" TEXT NOT NULL,
  "assignmentTemplateId" TEXT NOT NULL,
  "studentRefId" TEXT NOT NULL,
  "reminderKind" TEXT NOT NULL,
  "localDate" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "queueId" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssignmentReminderDispatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssignmentReminderDispatch_dispatchKey_key"
  ON "AssignmentReminderDispatch"("dispatchKey");
CREATE INDEX "AssignmentReminderDispatch_assignmentTemplateId_localDate_reminderKind_idx"
  ON "AssignmentReminderDispatch"("assignmentTemplateId", "localDate", "reminderKind");
CREATE INDEX "AssignmentReminderDispatch_studentRefId_localDate_reminderKind_idx"
  ON "AssignmentReminderDispatch"("studentRefId", "localDate", "reminderKind");
CREATE INDEX "AssignmentReminderDispatch_status_updatedAt_idx"
  ON "AssignmentReminderDispatch"("status", "updatedAt");
