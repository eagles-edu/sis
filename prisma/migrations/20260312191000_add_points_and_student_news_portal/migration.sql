-- Points management + student news portal models.

ALTER TABLE "ParentClassReport"
  ADD COLUMN IF NOT EXISTS "participationPointsAward" INTEGER,
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvedByUsername" TEXT;

CREATE INDEX IF NOT EXISTS "ParentClassReport_approvedAt_idx"
  ON "ParentClassReport"("approvedAt");

CREATE TABLE IF NOT EXISTS "StudentPointsAdjustment" (
  "id" TEXT NOT NULL,
  "studentRefId" TEXT NOT NULL,
  "pointsDelta" INTEGER NOT NULL,
  "reason" TEXT,
  "adjustedByUsername" TEXT,
  "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentPointsAdjustment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StudentPointsAdjustment_studentRefId_fkey" FOREIGN KEY ("studentRefId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "StudentPointsAdjustment_studentRefId_appliedAt_idx"
  ON "StudentPointsAdjustment"("studentRefId", "appliedAt");

CREATE TABLE IF NOT EXISTS "StudentNewsReport" (
  "id" TEXT NOT NULL,
  "studentRefId" TEXT NOT NULL,
  "reportDate" TIMESTAMP(3) NOT NULL,
  "sourceLink" TEXT NOT NULL,
  "articleTitle" TEXT NOT NULL,
  "byline" TEXT,
  "articleDateline" TEXT,
  "leadSynopsis" TEXT NOT NULL,
  "actionActor" TEXT NOT NULL,
  "actionAffected" TEXT NOT NULL,
  "actionWhere" TEXT NOT NULL,
  "actionWhat" TEXT NOT NULL,
  "actionWhy" TEXT NOT NULL,
  "biasAssessment" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentNewsReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StudentNewsReport_studentRefId_fkey" FOREIGN KEY ("studentRefId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "StudentNewsReport_studentRefId_reportDate_key"
  ON "StudentNewsReport"("studentRefId", "reportDate");

CREATE INDEX IF NOT EXISTS "StudentNewsReport_reportDate_submittedAt_idx"
  ON "StudentNewsReport"("reportDate", "submittedAt");
