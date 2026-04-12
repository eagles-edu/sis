-- AlterTable
ALTER TABLE "Student"
  ADD COLUMN "studentNumber" INTEGER;

-- AlterTable
ALTER TABLE "StudentProfile"
  ADD COLUMN "memberSince" TEXT,
  ADD COLUMN "exercisePoints" INTEGER,
  ADD COLUMN "parentsId" TEXT,
  ADD COLUMN "newAddress" TEXT,
  ADD COLUMN "currentSchoolGrade" TEXT,
  ADD COLUMN "postCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Student_studentNumber_key" ON "Student"("studentNumber");
