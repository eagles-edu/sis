ALTER TABLE "library"."LibraryEntry"
  ADD COLUMN "physicalQuality" TEXT,
  ADD COLUMN "grammaticalNumber" TEXT,
  ADD COLUMN "primaryClassification" TEXT,
  ADD COLUMN "materialUsage" TEXT,
  ADD COLUMN "properNounVariantShift" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "dualCountabilityUsage" TEXT;

CREATE INDEX "LibraryEntry_countability_physicalQuality_primaryClassification_idx"
  ON "library"."LibraryEntry"("countability", "physicalQuality", "primaryClassification");

CREATE TABLE "library"."LibraryReferenceCatalogEntry" (
  "id" TEXT NOT NULL,
  "catalogKey" TEXT NOT NULL,
  "naturalKey" TEXT NOT NULL,
  "term" TEXT NOT NULL,
  "partOfSpeech" TEXT,
  "subtype" TEXT,
  "dataJson" JSONB NOT NULL,
  "sourceLabel" TEXT,
  "sourceUrl" TEXT,
  "editorialStatus" TEXT NOT NULL DEFAULT 'seeded',
  "createdByName" TEXT NOT NULL,
  "lastEditedByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LibraryReferenceCatalogEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "library"."LibraryReferenceCatalogRevision" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "snapshotJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LibraryReferenceCatalogRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LibraryReferenceCatalogEntry_catalogKey_naturalKey_key"
  ON "library"."LibraryReferenceCatalogEntry"("catalogKey", "naturalKey");
CREATE INDEX "LibraryReferenceCatalogEntry_catalogKey_term_idx"
  ON "library"."LibraryReferenceCatalogEntry"("catalogKey", "term");
CREATE INDEX "LibraryReferenceCatalogEntry_catalogKey_partOfSpeech_subtype_idx"
  ON "library"."LibraryReferenceCatalogEntry"("catalogKey", "partOfSpeech", "subtype");
CREATE INDEX "LibraryReferenceCatalogRevision_entryId_createdAt_idx"
  ON "library"."LibraryReferenceCatalogRevision"("entryId", "createdAt");
CREATE INDEX "LibraryReferenceCatalogRevision_actorName_createdAt_idx"
  ON "library"."LibraryReferenceCatalogRevision"("actorName", "createdAt");

ALTER TABLE "library"."LibraryReferenceCatalogRevision"
  ADD CONSTRAINT "LibraryReferenceCatalogRevision_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "library"."LibraryReferenceCatalogEntry"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "library"."LibraryEntry"
SET
  "primaryClassification" = CASE WHEN "nounType" IN ('common', 'proper', 'collective', 'compound', 'possessive') THEN "nounType" ELSE NULL END,
  "physicalQuality" = CASE WHEN "nounType" IN ('concrete', 'abstract', 'material') THEN "nounType" ELSE NULL END,
  "grammaticalNumber" = CASE WHEN "nounNumber" = 'singular and plural' THEN 'singular_and_plural' WHEN "nounNumber" IN ('singular', 'plural') THEN "nounNumber" ELSE NULL END,
  "countability" = CASE WHEN "countability" = 'both s & p' THEN 'countable_and_uncountable' ELSE "countability" END
WHERE "partOfSpeech" = 'noun';
