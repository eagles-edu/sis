ALTER TABLE "public"."StudentGradeRecord"
  ADD COLUMN "correctCount" INTEGER,
  ADD COLUMN "totalQuestions" INTEGER,
  ADD COLUMN "sourceEmail" TEXT;
