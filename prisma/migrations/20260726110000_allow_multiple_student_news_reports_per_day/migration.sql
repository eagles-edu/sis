ALTER TABLE "StudentNewsReport"
  ADD COLUMN IF NOT EXISTS "reportSequence" INTEGER NOT NULL DEFAULT 1;

DROP INDEX IF EXISTS "StudentNewsReport_studentRefId_reportDate_key";

CREATE UNIQUE INDEX IF NOT EXISTS "StudentNewsReport_studentRefId_reportDate_reportSequence_key"
  ON "StudentNewsReport"("studentRefId", "reportDate", "reportSequence");
