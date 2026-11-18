CREATE TABLE "public"."StudentNewsVocabularyHelpRequest" (
    "id" TEXT NOT NULL,
    "submissionKey" TEXT NOT NULL,
    "studentRefId" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "syllabication" TEXT NOT NULL,
    "checkMessage" TEXT NOT NULL,
    "additionalDetails" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUsername" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentNewsVocabularyHelpRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudentNewsVocabularyHelpRequest_submissionKey_key"
ON "public"."StudentNewsVocabularyHelpRequest"("submissionKey");

CREATE INDEX "StudentNewsVocabularyHelpRequest_status_createdAt_idx"
ON "public"."StudentNewsVocabularyHelpRequest"("status", "createdAt");

CREATE INDEX "StudentNewsVocabularyHelpRequest_studentRefId_createdAt_idx"
ON "public"."StudentNewsVocabularyHelpRequest"("studentRefId", "createdAt");

ALTER TABLE "public"."StudentNewsVocabularyHelpRequest"
ADD CONSTRAINT "StudentNewsVocabularyHelpRequest_studentRefId_fkey"
FOREIGN KEY ("studentRefId") REFERENCES "public"."Student"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
