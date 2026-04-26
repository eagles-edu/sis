ALTER TABLE "ExerciseSubmission"
  ADD COLUMN IF NOT EXISTS "sourceSystem" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceAttemptId" TEXT;

ALTER TABLE "IncomingExerciseResult"
  ADD COLUMN IF NOT EXISTS "sourceSystem" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceAttemptId" TEXT;

ALTER TABLE "StudentGradeRecord"
  ADD COLUMN IF NOT EXISTS "sourceSystem" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceAttemptId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ExerciseSubmission_sourceSystem_sourceAttemptId_key"
  ON "ExerciseSubmission"("sourceSystem", "sourceAttemptId");

CREATE UNIQUE INDEX IF NOT EXISTS "IncomingExerciseResult_sourceSystem_sourceAttemptId_key"
  ON "IncomingExerciseResult"("sourceSystem", "sourceAttemptId");

CREATE UNIQUE INDEX IF NOT EXISTS "StudentGradeRecord_sourceSystem_sourceAttemptId_key"
  ON "StudentGradeRecord"("sourceSystem", "sourceAttemptId");
