CREATE TABLE "AssignmentTemplate" (
  "id" TEXT NOT NULL,
  "assignmentTitle" TEXT NOT NULL,
  "exerciseTitle" TEXT,
  "assignedAt" TEXT,
  "dueAt" TEXT,
  "level" TEXT,
  "eaglesId" TEXT,
  "message" TEXT,
  "itemsJson" JSONB,
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "completedAt" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AssignmentTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssignmentTemplate_level_dueAt_idx"
  ON "AssignmentTemplate"("level", "dueAt");

CREATE INDEX "AssignmentTemplate_assignedAt_dueAt_idx"
  ON "AssignmentTemplate"("assignedAt", "dueAt");

CREATE INDEX "AssignmentTemplate_updatedAt_idx"
  ON "AssignmentTemplate"("updatedAt");
