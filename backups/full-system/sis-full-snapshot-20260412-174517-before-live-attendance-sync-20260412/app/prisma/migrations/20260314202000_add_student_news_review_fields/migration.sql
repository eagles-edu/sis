-- DB-native review workflow fields for student news reports.

ALTER TABLE "StudentNewsReport"
  ADD COLUMN IF NOT EXISTS "reviewStatus" TEXT NOT NULL DEFAULT 'submitted',
  ADD COLUMN IF NOT EXISTS "reviewNote" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewedByUsername" TEXT;

CREATE INDEX IF NOT EXISTS "StudentNewsReport_reviewStatus_reportDate_submittedAt_idx"
  ON "StudentNewsReport"("reviewStatus", "reportDate", "submittedAt");

CREATE INDEX IF NOT EXISTS "StudentNewsReport_reviewedAt_idx"
  ON "StudentNewsReport"("reviewedAt");
