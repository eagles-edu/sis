ALTER TABLE "ExerciseSubmission"
  ADD COLUMN IF NOT EXISTS "sourceOriginLabel" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceOriginHost" TEXT;

ALTER TABLE "IncomingExerciseResult"
  ADD COLUMN IF NOT EXISTS "sourceOriginLabel" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceOriginHost" TEXT;

ALTER TABLE "StudentGradeRecord"
  ADD COLUMN IF NOT EXISTS "sourceOriginLabel" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceOriginHost" TEXT;
