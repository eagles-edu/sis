ALTER TABLE "StudentNewsReport"
  ADD COLUMN "submissionState" TEXT NOT NULL DEFAULT 'submitted',
  ADD COLUMN "draftCheckedAt" TIMESTAMP(3),
  ADD COLUMN "mmrPassedAt" TIMESTAMP(3),
  ADD COLUMN "dateSatisfiedAt" TIMESTAMP(3),
  ADD COLUMN "reportDateLockedAt" TIMESTAMP(3),
  ADD COLUMN "firstSubmittedAt" TIMESTAMP(3),
  ADD COLUMN "lastSubmittedAt" TIMESTAMP(3),
  ADD COLUMN "editableUntil" TIMESTAMP(3);

CREATE INDEX "StudentNewsReport_submissionState_reportDate_submittedAt_idx"
ON "StudentNewsReport"("submissionState", "reportDate", "submittedAt");
