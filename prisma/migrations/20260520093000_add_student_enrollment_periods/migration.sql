DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StudentEnrollmentStatus') THEN
    CREATE TYPE "StudentEnrollmentStatus" AS ENUM ('active', 'unenrolled');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StudentUnenrollmentReason') THEN
    CREATE TYPE "StudentUnenrollmentReason" AS ENUM (
      'moved_residence',
      'changed_esl_center',
      'financial',
      'with_prejudice',
      'distance_traffic',
      'stopped_learning_esl',
      'changed_languages',
      'pre_high_school_exam_tutoring',
      'pre_college_exam_tutoring',
      'unknown'
    );
  END IF;
END $$;

CREATE TABLE "StudentEnrollmentPeriod" (
  "id" TEXT NOT NULL,
  "studentRefId" TEXT NOT NULL,
  "schoolYear" TEXT NOT NULL,
  "level" TEXT,
  "status" "StudentEnrollmentStatus" NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  "unenrollmentReason" "StudentUnenrollmentReason",
  "comment" TEXT,
  "promotedFromPeriodId" TEXT,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentEnrollmentPeriod_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "StudentAttendance"
  ADD COLUMN "enrollmentPeriodId" TEXT;

ALTER TABLE "StudentGradeRecord"
  ADD COLUMN "enrollmentPeriodId" TEXT;

ALTER TABLE "ParentClassReport"
  ADD COLUMN "enrollmentPeriodId" TEXT;

ALTER TABLE "StudentNewsReport"
  ADD COLUMN "enrollmentPeriodId" TEXT;

DROP INDEX IF EXISTS "ParentClassReport_studentRefId_className_schoolYear_quarter_key";

CREATE UNIQUE INDEX "ParentClassReport_studentRefId_className_schoolYear_quarter_enrollmentPeriodId_key"
  ON "ParentClassReport"("studentRefId", "className", "schoolYear", "quarter", "enrollmentPeriodId");

CREATE INDEX "StudentEnrollmentPeriod_studentRefId_schoolYear_idx"
  ON "StudentEnrollmentPeriod"("studentRefId", "schoolYear");

CREATE INDEX "StudentEnrollmentPeriod_status_schoolYear_level_idx"
  ON "StudentEnrollmentPeriod"("status", "schoolYear", "level");

CREATE INDEX "StudentEnrollmentPeriod_promotedFromPeriodId_idx"
  ON "StudentEnrollmentPeriod"("promotedFromPeriodId");

CREATE UNIQUE INDEX "StudentEnrollmentPeriod_one_active_per_student_school_year_idx"
  ON "StudentEnrollmentPeriod"("studentRefId", "schoolYear")
  WHERE "status" = 'active' AND "endedAt" IS NULL;

CREATE INDEX "StudentAttendance_enrollmentPeriodId_idx"
  ON "StudentAttendance"("enrollmentPeriodId");

CREATE INDEX "StudentGradeRecord_enrollmentPeriodId_idx"
  ON "StudentGradeRecord"("enrollmentPeriodId");

CREATE INDEX "ParentClassReport_enrollmentPeriodId_idx"
  ON "ParentClassReport"("enrollmentPeriodId");

CREATE INDEX "StudentNewsReport_enrollmentPeriodId_idx"
  ON "StudentNewsReport"("enrollmentPeriodId");

ALTER TABLE "StudentEnrollmentPeriod"
  ADD CONSTRAINT "StudentEnrollmentPeriod_studentRefId_fkey"
  FOREIGN KEY ("studentRefId") REFERENCES "Student"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StudentEnrollmentPeriod"
  ADD CONSTRAINT "StudentEnrollmentPeriod_promotedFromPeriodId_fkey"
  FOREIGN KEY ("promotedFromPeriodId") REFERENCES "StudentEnrollmentPeriod"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StudentAttendance"
  ADD CONSTRAINT "StudentAttendance_enrollmentPeriodId_fkey"
  FOREIGN KEY ("enrollmentPeriodId") REFERENCES "StudentEnrollmentPeriod"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StudentGradeRecord"
  ADD CONSTRAINT "StudentGradeRecord_enrollmentPeriodId_fkey"
  FOREIGN KEY ("enrollmentPeriodId") REFERENCES "StudentEnrollmentPeriod"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ParentClassReport"
  ADD CONSTRAINT "ParentClassReport_enrollmentPeriodId_fkey"
  FOREIGN KEY ("enrollmentPeriodId") REFERENCES "StudentEnrollmentPeriod"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StudentNewsReport"
  ADD CONSTRAINT "StudentNewsReport_enrollmentPeriodId_fkey"
  FOREIGN KEY ("enrollmentPeriodId") REFERENCES "StudentEnrollmentPeriod"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
