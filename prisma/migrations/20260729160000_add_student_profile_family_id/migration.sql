ALTER TABLE "StudentProfile" ADD COLUMN "familyId" TEXT;

UPDATE "StudentProfile"
SET "familyId" = "parentsId"
WHERE "familyId" IS NULL
  AND "parentsId" IS NOT NULL;

CREATE INDEX "StudentProfile_familyId_idx" ON "StudentProfile"("familyId");
