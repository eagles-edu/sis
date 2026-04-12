CREATE TABLE "IncomingExerciseResult" (
  "id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "submittedStudentId" TEXT NOT NULL,
  "submittedEmail" TEXT,
  "pageTitle" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL,
  "totalQuestions" INTEGER NOT NULL,
  "correctCount" INTEGER NOT NULL,
  "pendingCount" INTEGER NOT NULL,
  "incorrectCount" INTEGER NOT NULL,
  "scorePercent" DOUBLE PRECISION NOT NULL,
  "answersJson" JSONB NOT NULL,
  "recipientsJson" JSONB,
  "payloadJson" JSONB,
  "notes" TEXT,
  "reviewedByUsername" TEXT,
  "matchedStudentRefId" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "IncomingExerciseResult_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IncomingExerciseResult_status_createdAt_idx"
  ON "IncomingExerciseResult"("status", "createdAt");

CREATE INDEX "IncomingExerciseResult_submittedStudentId_createdAt_idx"
  ON "IncomingExerciseResult"("submittedStudentId", "createdAt");

CREATE INDEX "IncomingExerciseResult_submittedEmail_createdAt_idx"
  ON "IncomingExerciseResult"("submittedEmail", "createdAt");

CREATE INDEX "IncomingExerciseResult_matchedStudentRefId_createdAt_idx"
  ON "IncomingExerciseResult"("matchedStudentRefId", "createdAt");

ALTER TABLE "IncomingExerciseResult"
  ADD CONSTRAINT "IncomingExerciseResult_matchedStudentRefId_fkey"
  FOREIGN KEY ("matchedStudentRefId") REFERENCES "Student"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
