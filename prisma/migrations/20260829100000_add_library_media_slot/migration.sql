ALTER TABLE "library"."LibraryMediaAsset" ADD COLUMN "slot" TEXT NOT NULL DEFAULT 'headword';

DROP INDEX IF EXISTS "library"."LibraryMediaAsset_entryId_provider_dialect_key";

CREATE UNIQUE INDEX "LibraryMediaAsset_entryId_provider_dialect_slot_key"
ON "library"."LibraryMediaAsset"("entryId", "provider", "dialect", "slot");
