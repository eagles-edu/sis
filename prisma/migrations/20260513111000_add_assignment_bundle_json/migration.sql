ALTER TABLE "AssignmentTemplate"
  ADD COLUMN IF NOT EXISTS "assignmentBundleJson" JSONB;

ALTER TABLE "StudentGradeRecord"
  ADD COLUMN IF NOT EXISTS "assignmentBundleJson" JSONB;
