-- Track field-level news validation outcomes for revision guidance rendering.
ALTER TABLE "StudentNewsReport"
  ADD COLUMN IF NOT EXISTS "validationIssuesJson" JSONB;
