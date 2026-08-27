ALTER TABLE "library"."LibraryEntry"
  ADD COLUMN "dictionaryProvider" TEXT,
  ADD COLUMN "dictionarySourceUrl" TEXT,
  ADD COLUMN "dictionaryMetadata" JSONB;

CREATE TABLE "library"."LibraryMediaAsset" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "dialect" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "storagePath" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "byteLength" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "actorRole" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LibraryMediaAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LibraryMediaAsset_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "library"."LibraryEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LibraryMediaAsset_entryId_provider_dialect_key"
  ON "library"."LibraryMediaAsset"("entryId", "provider", "dialect");
CREATE INDEX "LibraryMediaAsset_provider_dialect_createdAt_idx"
  ON "library"."LibraryMediaAsset"("provider", "dialect", "createdAt");
CREATE INDEX "LibraryMediaAsset_sha256_idx"
  ON "library"."LibraryMediaAsset"("sha256");
