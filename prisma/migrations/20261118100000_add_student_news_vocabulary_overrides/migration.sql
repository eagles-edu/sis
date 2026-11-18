CREATE TABLE "public"."StudentNewsVocabularyOverride" (
    "id" TEXT NOT NULL,
    "englishKey" TEXT NOT NULL,
    "english" TEXT NOT NULL,
    "syllabication" TEXT NOT NULL,
    "approvedByUsername" TEXT NOT NULL,
    "sourceRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentNewsVocabularyOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudentNewsVocabularyOverride_englishKey_key"
ON "public"."StudentNewsVocabularyOverride"("englishKey");

CREATE INDEX "StudentNewsVocabularyOverride_sourceRequestId_idx"
ON "public"."StudentNewsVocabularyOverride"("sourceRequestId");
