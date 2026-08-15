DO $$
DECLARE
  duplicate_rows TEXT;
BEGIN
  SELECT string_agg(
    format('%s/%s (%s rows)', "normalizedKey", "partOfSpeech", row_count),
    ', ' ORDER BY "normalizedKey", "partOfSpeech"
  )
  INTO duplicate_rows
  FROM (
    SELECT "normalizedKey", "partOfSpeech", COUNT(*) AS row_count
    FROM "library"."LibraryEntry"
    GROUP BY "normalizedKey", "partOfSpeech"
    HAVING COUNT(*) > 1
  ) AS duplicates;

  IF duplicate_rows IS NOT NULL THEN
    RAISE EXCEPTION 'LibraryEntry canonical duplicates remain after legacy cutover: %', duplicate_rows;
  END IF;
END $$;

CREATE UNIQUE INDEX "LibraryEntry_normalizedKey_partOfSpeech_key"
  ON "library"."LibraryEntry"("normalizedKey", "partOfSpeech");
