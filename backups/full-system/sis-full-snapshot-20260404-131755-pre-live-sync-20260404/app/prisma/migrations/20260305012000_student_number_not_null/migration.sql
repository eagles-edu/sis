-- Backfill missing studentNumber values, then enforce NOT NULL.
WITH starting_point AS (
  SELECT GREATEST(100, COALESCE(MAX("studentNumber"), 99) + 1) AS next_number
  FROM "Student"
),
missing_rows AS (
  SELECT
    s."id",
    sp.next_number + ROW_NUMBER() OVER (ORDER BY s."createdAt", s."id") - 1 AS assigned_number
  FROM "Student" s
  CROSS JOIN starting_point sp
  WHERE s."studentNumber" IS NULL
)
UPDATE "Student" s
SET "studentNumber" = m.assigned_number
FROM missing_rows m
WHERE s."id" = m."id";

ALTER TABLE "Student"
  ALTER COLUMN "studentNumber" SET NOT NULL;
