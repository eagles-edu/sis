-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "studentId" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExerciseSubmission" (
    "id" TEXT NOT NULL,
    "studentRefId" TEXT NOT NULL,
    "exerciseRefId" TEXT NOT NULL,
    "submittedStudentId" TEXT NOT NULL,
    "submittedEmail" TEXT,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "totalQuestions" INTEGER NOT NULL,
    "correctCount" INTEGER NOT NULL,
    "pendingCount" INTEGER NOT NULL,
    "incorrectCount" INTEGER NOT NULL,
    "scorePercent" DOUBLE PRECISION NOT NULL,
    "answersJson" JSONB NOT NULL,
    "recipientsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExerciseSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Student_externalKey_key" ON "Student"("externalKey");

-- CreateIndex
CREATE INDEX "Student_studentId_idx" ON "Student"("studentId");

-- CreateIndex
CREATE INDEX "Student_email_idx" ON "Student"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Exercise_slug_key" ON "Exercise"("slug");

-- CreateIndex
CREATE INDEX "ExerciseSubmission_studentRefId_completedAt_idx" ON "ExerciseSubmission"("studentRefId", "completedAt");

-- CreateIndex
CREATE INDEX "ExerciseSubmission_exerciseRefId_completedAt_idx" ON "ExerciseSubmission"("exerciseRefId", "completedAt");

-- CreateIndex
CREATE INDEX "ExerciseSubmission_submittedStudentId_completedAt_idx" ON "ExerciseSubmission"("submittedStudentId", "completedAt");

-- AddForeignKey
ALTER TABLE "ExerciseSubmission" ADD CONSTRAINT "ExerciseSubmission_studentRefId_fkey" FOREIGN KEY ("studentRefId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseSubmission" ADD CONSTRAINT "ExerciseSubmission_exerciseRefId_fkey" FOREIGN KEY ("exerciseRefId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
