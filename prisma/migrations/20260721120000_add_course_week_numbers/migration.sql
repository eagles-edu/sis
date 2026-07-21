ALTER TABLE "AssignmentTemplate" ADD COLUMN "weekNumber" INTEGER;
ALTER TABLE "ExerciseSubmission" ADD COLUMN "weekNumber" INTEGER;
ALTER TABLE "IncomingExerciseResult" ADD COLUMN "weekNumber" INTEGER;
ALTER TABLE "StudentAttendance" ADD COLUMN "weekNumber" INTEGER;
ALTER TABLE "StudentGradeRecord" ADD COLUMN "weekNumber" INTEGER;
ALTER TABLE "ParentClassReport" ADD COLUMN "weekNumber" INTEGER;
ALTER TABLE "StudentNewsReport" ADD COLUMN "weekNumber" INTEGER;

CREATE INDEX "AssignmentTemplate_weekNumber_idx" ON "AssignmentTemplate"("weekNumber");
CREATE INDEX "ExerciseSubmission_weekNumber_idx" ON "ExerciseSubmission"("weekNumber");
CREATE INDEX "IncomingExerciseResult_weekNumber_idx" ON "IncomingExerciseResult"("weekNumber");
CREATE INDEX "StudentAttendance_weekNumber_idx" ON "StudentAttendance"("weekNumber");
CREATE INDEX "StudentGradeRecord_weekNumber_idx" ON "StudentGradeRecord"("weekNumber");
CREATE INDEX "ParentClassReport_weekNumber_idx" ON "ParentClassReport"("weekNumber");
CREATE INDEX "StudentNewsReport_weekNumber_idx" ON "StudentNewsReport"("weekNumber");
