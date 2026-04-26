-- Normalize blank eaglesId values to NULL first.
UPDATE "Student"
SET "eaglesId" = NULL
WHERE "eaglesId" IS NOT NULL
  AND BTRIM("eaglesId") = '';

-- Backfill missing eaglesId values from studentNumber.
-- If the generated SIS-###### id is already taken, append the row id to keep it unique.
WITH candidates AS (
  SELECT
    s."id",
    'SIS-' || LPAD(s."studentNumber"::text, 6, '0') AS base_eagles_id
  FROM "Student" s
  WHERE s."eaglesId" IS NULL
),
resolved AS (
  SELECT
    c."id",
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM "Student" s2
        WHERE s2."id" <> c."id"
          AND s2."eaglesId" = c.base_eagles_id
      )
      THEN c.base_eagles_id || '-' || c."id"
      ELSE c.base_eagles_id
    END AS assigned_eagles_id
  FROM candidates c
)
UPDATE "Student" s
SET "eaglesId" = r.assigned_eagles_id
FROM resolved r
WHERE s."id" = r."id";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Student" WHERE "eaglesId" IS NULL OR BTRIM("eaglesId") = '') THEN
    RAISE EXCEPTION 'Cannot enforce NOT NULL on Student.eaglesId while missing values remain';
  END IF;
END $$;

ALTER TABLE "Student"
  ALTER COLUMN "eaglesId" SET NOT NULL;
