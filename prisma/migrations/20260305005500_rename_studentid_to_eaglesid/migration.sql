-- Rename Student.studentId column to Student.eaglesId and keep existing uniqueness/index semantics.
ALTER TABLE "Student" RENAME COLUMN "studentId" TO "eaglesId";

ALTER INDEX IF EXISTS "Student_studentId_key" RENAME TO "Student_eaglesId_key";
ALTER INDEX IF EXISTS "Student_studentId_idx" RENAME TO "Student_eaglesId_idx";
