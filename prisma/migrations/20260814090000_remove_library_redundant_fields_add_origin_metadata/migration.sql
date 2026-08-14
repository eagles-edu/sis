DROP INDEX IF EXISTS "library"."LibraryEntry_partOfSpeech_entryKind_phraseType_idx";

ALTER TABLE "library"."LibraryEntry"
  DROP COLUMN "entryKind",
  DROP COLUMN "posSubtype",
  ADD COLUMN "originPath" TEXT,
  ADD COLUMN "originReferences" JSONB;

CREATE INDEX "LibraryEntry_partOfSpeech_phraseType_idx"
  ON "library"."LibraryEntry"("partOfSpeech", "phraseType");
