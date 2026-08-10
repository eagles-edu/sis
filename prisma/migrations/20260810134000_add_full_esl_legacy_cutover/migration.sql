ALTER TABLE "public"."StudentNewWord" ADD COLUMN "eslJson" JSONB;
ALTER TABLE "public"."StudentNewWord" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "public"."StudentNewWord" ADD COLUMN "archivedLibraryEntryId" TEXT;
CREATE INDEX "StudentNewWord_studentRefId_archivedAt_idx" ON "public"."StudentNewWord"("studentRefId", "archivedAt");

-- Duplicate cases are replaced by an immutable preflight report and source provenance.
DROP TABLE IF EXISTS "library"."LibraryDuplicateCase";

CREATE TABLE "library"."LibraryMigrationPreflight" (
  "id" TEXT NOT NULL,
  "runKey" TEXT NOT NULL,
  "normalizedKey" TEXT NOT NULL,
  "partOfSpeech" TEXT NOT NULL,
  "sourceRowsJson" JSONB NOT NULL,
  "conflictsJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LibraryMigrationPreflight_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LibraryMigrationPreflight_runKey_normalizedKey_partOfSpeech_key" ON "library"."LibraryMigrationPreflight"("runKey", "normalizedKey", "partOfSpeech");
CREATE INDEX "LibraryMigrationPreflight_runKey_idx" ON "library"."LibraryMigrationPreflight"("runKey", "createdAt");
