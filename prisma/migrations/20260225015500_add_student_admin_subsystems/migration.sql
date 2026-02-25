-- CreateEnum
CREATE TYPE "SchoolQuarter" AS ENUM ('q1', 'q2', 'q3', 'q4');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('present', 'absent', 'late', 'excused');

-- AlterTable
CREATE UNIQUE INDEX "Student_studentId_key" ON "Student"("studentId");

-- CreateTable
CREATE TABLE "StudentAttendance" (
    "id" TEXT NOT NULL,
    "studentRefId" TEXT NOT NULL,
    "className" TEXT NOT NULL,
    "level" TEXT,
    "schoolYear" TEXT NOT NULL,
    "quarter" "SchoolQuarter" NOT NULL,
    "attendanceDate" TIMESTAMP(3) NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'present',
    "comments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentGradeRecord" (
    "id" TEXT NOT NULL,
    "studentRefId" TEXT NOT NULL,
    "className" TEXT NOT NULL,
    "level" TEXT,
    "schoolYear" TEXT NOT NULL,
    "quarter" "SchoolQuarter" NOT NULL,
    "assignmentName" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "score" DOUBLE PRECISION,
    "maxScore" DOUBLE PRECISION,
    "homeworkCompleted" BOOLEAN,
    "homeworkOnTime" BOOLEAN,
    "behaviorScore" INTEGER,
    "participationScore" INTEGER,
    "inClassScore" INTEGER,
    "comments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentGradeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParentClassReport" (
    "id" TEXT NOT NULL,
    "studentRefId" TEXT NOT NULL,
    "className" TEXT NOT NULL,
    "level" TEXT,
    "schoolYear" TEXT NOT NULL,
    "quarter" "SchoolQuarter" NOT NULL,
    "homeworkCompletionRate" DOUBLE PRECISION,
    "homeworkOnTimeRate" DOUBLE PRECISION,
    "behaviorScore" DOUBLE PRECISION,
    "participationScore" DOUBLE PRECISION,
    "inClassScore" DOUBLE PRECISION,
    "comments" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParentClassReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudentAttendance_studentRefId_className_attendanceDate_key" ON "StudentAttendance"("studentRefId", "className", "attendanceDate");

-- CreateIndex
CREATE INDEX "StudentAttendance_studentRefId_attendanceDate_idx" ON "StudentAttendance"("studentRefId", "attendanceDate");

-- CreateIndex
CREATE INDEX "StudentAttendance_level_schoolYear_quarter_attendanceDate_idx" ON "StudentAttendance"("level", "schoolYear", "quarter", "attendanceDate");

-- CreateIndex
CREATE INDEX "StudentGradeRecord_studentRefId_schoolYear_quarter_idx" ON "StudentGradeRecord"("studentRefId", "schoolYear", "quarter");

-- CreateIndex
CREATE INDEX "StudentGradeRecord_className_schoolYear_quarter_idx" ON "StudentGradeRecord"("className", "schoolYear", "quarter");

-- CreateIndex
CREATE INDEX "StudentGradeRecord_dueAt_idx" ON "StudentGradeRecord"("dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "ParentClassReport_studentRefId_className_schoolYear_quarter_key" ON "ParentClassReport"("studentRefId", "className", "schoolYear", "quarter");

-- CreateIndex
CREATE INDEX "ParentClassReport_level_schoolYear_quarter_idx" ON "ParentClassReport"("level", "schoolYear", "quarter");

-- AddForeignKey
ALTER TABLE "StudentAttendance" ADD CONSTRAINT "StudentAttendance_studentRefId_fkey" FOREIGN KEY ("studentRefId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentGradeRecord" ADD CONSTRAINT "StudentGradeRecord_studentRefId_fkey" FOREIGN KEY ("studentRefId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentClassReport" ADD CONSTRAINT "ParentClassReport_studentRefId_fkey" FOREIGN KEY ("studentRefId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
