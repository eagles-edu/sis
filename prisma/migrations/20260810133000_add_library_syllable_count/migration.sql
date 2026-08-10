ALTER TABLE "library"."LibraryEntry" ADD COLUMN "syllableCount" INTEGER NOT NULL DEFAULT 0;
UPDATE "library"."LibraryEntry"
SET "syllableCount" = GREATEST(1, array_length(regexp_split_to_array("syllabication", '-'), 1))
WHERE "syllabication" <> '';
CREATE INDEX "LibraryEntry_syllableCount_english_idx" ON "library"."LibraryEntry"("syllableCount", "english");
