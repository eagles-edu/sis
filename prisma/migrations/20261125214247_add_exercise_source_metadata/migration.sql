ALTER TABLE "ExerciseSubmission"
  ADD COLUMN "sourceTitle" TEXT,
  ADD COLUMN "startedAt" TIMESTAMP(3);

ALTER TABLE "IncomingExerciseResult"
  ADD COLUMN "sourceTitle" TEXT,
  ADD COLUMN "startedAt" TIMESTAMP(3);

ALTER TABLE "StudentGradeRecord"
  ADD COLUMN "startedAt" TIMESTAMP(3);
