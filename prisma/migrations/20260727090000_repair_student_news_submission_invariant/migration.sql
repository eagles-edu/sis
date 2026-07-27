ALTER TABLE "StudentNewsReport"
  ALTER COLUMN "submittedAt" DROP DEFAULT,
  ALTER COLUMN "submittedAt" DROP NOT NULL;

-- Records created after the explicit student Check/Submit state was introduced
-- must have a real firstSubmittedAt marker before they can be submitted.
UPDATE "StudentNewsReport"
SET
  "submissionState" = CASE
    WHEN "firstSubmittedAt" IS NOT NULL THEN 'submitted'
    WHEN "mmrPassedAt" IS NOT NULL
      OR "dateSatisfiedAt" IS NOT NULL
      OR "reportDateLockedAt" IS NOT NULL THEN 'ready'
    ELSE 'draft'
  END,
  "submittedAt" = CASE WHEN "firstSubmittedAt" IS NOT NULL THEN "submittedAt" ELSE NULL END,
  "lastSubmittedAt" = CASE WHEN "firstSubmittedAt" IS NOT NULL THEN "lastSubmittedAt" ELSE NULL END
WHERE "createdAt" >= TIMESTAMP '2026-06-28 00:00:00';
