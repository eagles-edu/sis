ALTER TABLE "library"."LibraryContribution"
  ADD COLUMN "dueAt" TIMESTAMP(3),
  ADD COLUMN "canonicalizedAt" TIMESTAMP(3);

CREATE TABLE "library"."LibraryContributionRevision" (
  "id" TEXT NOT NULL,
  "contributionId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "snapshotJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LibraryContributionRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LibraryContributionRevision_contributionId_createdAt_idx"
  ON "library"."LibraryContributionRevision"("contributionId", "createdAt");

ALTER TABLE "library"."LibraryContributionRevision"
  ADD CONSTRAINT "LibraryContributionRevision_contributionId_fkey"
  FOREIGN KEY ("contributionId") REFERENCES "library"."LibraryContribution"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "library"."LibraryLegacySourceArchive" (
  "id" TEXT NOT NULL,
  "runKey" TEXT NOT NULL,
  "sourceKind" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "normalizedKey" TEXT NOT NULL,
  "partOfSpeech" TEXT NOT NULL,
  "payloadJson" JSONB NOT NULL,
  "entrySnapshotJson" JSONB,
  "entryRevisionsJson" JSONB,
  "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LibraryLegacySourceArchive_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LibraryLegacySourceArchive_runKey_sourceKind_sourceId_key"
  ON "library"."LibraryLegacySourceArchive"("runKey", "sourceKind", "sourceId");

CREATE INDEX "LibraryLegacySourceArchive_runKey_normalizedKey_partOfSpeech_idx"
  ON "library"."LibraryLegacySourceArchive"("runKey", "normalizedKey", "partOfSpeech");

CREATE INDEX "LibraryLegacySourceArchive_normalizedKey_partOfSpeech_idx"
  ON "library"."LibraryLegacySourceArchive"("normalizedKey", "partOfSpeech");
