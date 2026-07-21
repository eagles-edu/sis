ALTER TABLE "StudentProfile"
  ADD COLUMN "maIsHomeworkProctor" TEXT,
  ADD COLUMN "baIsHomeworkProctor" TEXT;

UPDATE "StudentProfile"
SET
  "maIsHomeworkProctor" = COALESCE(NULLIF("normalizedFormPayload"->>'maIsHomeworkProctor', ''), NULLIF("rawFormPayload"->>'maIsHomeworkProctor', '')),
  "baIsHomeworkProctor" = COALESCE(NULLIF("normalizedFormPayload"->>'baIsHomeworkProctor', ''), NULLIF("rawFormPayload"->>'baIsHomeworkProctor', ''))
WHERE "normalizedFormPayload" IS NOT NULL OR "rawFormPayload" IS NOT NULL;
