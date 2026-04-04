-- Native exercise submission cutover:
-- 1) Rename submitted ID columns to submittedEaglesId
-- 2) Remove legacy answersJson payload storage

ALTER TABLE "ExerciseSubmission"
  RENAME COLUMN "submittedStudentId" TO "submittedEaglesId";

DROP INDEX IF EXISTS "ExerciseSubmission_submittedStudentId_completedAt_idx";
CREATE INDEX IF NOT EXISTS "ExerciseSubmission_submittedEaglesId_completedAt_idx"
  ON "ExerciseSubmission"("submittedEaglesId", "completedAt");

ALTER TABLE "ExerciseSubmission"
  DROP COLUMN IF EXISTS "answersJson";

ALTER TABLE "IncomingExerciseResult"
  RENAME COLUMN "submittedStudentId" TO "submittedEaglesId";

DROP INDEX IF EXISTS "IncomingExerciseResult_submittedStudentId_createdAt_idx";
CREATE INDEX IF NOT EXISTS "IncomingExerciseResult_submittedEaglesId_createdAt_idx"
  ON "IncomingExerciseResult"("submittedEaglesId", "createdAt");

ALTER TABLE "IncomingExerciseResult"
  DROP COLUMN IF EXISTS "answersJson";
