CREATE SCHEMA IF NOT EXISTS "library";

CREATE TABLE "library"."LibraryEntry" (
  "id" TEXT NOT NULL,
  "normalizedKey" TEXT NOT NULL,
  "english" TEXT NOT NULL,
  "americanEnglish" TEXT,
  "britishEnglish" TEXT,
  "partOfSpeech" TEXT NOT NULL,
  "entryKind" TEXT NOT NULL DEFAULT 'word',
  "phraseType" TEXT,
  "posSubtype" TEXT,
  "vietnamese" TEXT NOT NULL,
  "syllabication" TEXT NOT NULL,
  "definition" TEXT NOT NULL,
  "countability" TEXT,
  "verbRegularity" TEXT,
  "verbTransitivity" TEXT,
  "verbInfinitive" TEXT,
  "verbV1" TEXT,
  "verbV2" TEXT,
  "verbV3" TEXT,
  "verbV4" TEXT,
  "verbV5" TEXT,
  "displayVerbForm" TEXT,
  "edAdjective" BOOLEAN NOT NULL DEFAULT false,
  "ingAdjective" BOOLEAN NOT NULL DEFAULT false,
  "awlFamilyHeadword" TEXT,
  "awlQualifyingMember" TEXT,
  "awlMemberForm" TEXT,
  "awlSublist" INTEGER,
  "reviewStatus" TEXT NOT NULL DEFAULT 'approved',
  "createdByName" TEXT NOT NULL,
  "lastEditedByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LibraryEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "library"."LibraryEntryRevision" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "actorRole" TEXT NOT NULL,
  "snapshotJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LibraryEntryRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "library"."LibraryContribution" (
  "id" TEXT NOT NULL,
  "entryId" TEXT,
  "studentRefId" TEXT,
  "contributorName" TEXT NOT NULL,
  "sourceKind" TEXT NOT NULL,
  "sourceId" TEXT,
  "payloadJson" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending_review',
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewedByName" TEXT,
  CONSTRAINT "LibraryContribution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "library"."LibraryAssignment" (
  "id" TEXT NOT NULL,
  "entryId" TEXT,
  "studentRefId" TEXT NOT NULL,
  "taskType" TEXT NOT NULL,
  "instructions" TEXT,
  "dueAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'assigned',
  "assignedByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "LibraryAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "library"."LibraryDuplicateCase" (
  "id" TEXT NOT NULL,
  "normalizedKey" TEXT NOT NULL,
  "partOfSpeech" TEXT NOT NULL,
  "entryIdsJson" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "resolutionJson" JSONB,
  "createdByName" TEXT NOT NULL,
  "resolvedByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "LibraryDuplicateCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "library"."LibraryAwlFamily" (
  "id" TEXT NOT NULL,
  "familyHeadword" TEXT NOT NULL,
  "qualifyingMember" TEXT NOT NULL,
  "sublist" INTEGER NOT NULL,
  "americanHeadword" TEXT,
  "britishHeadword" TEXT,
  "membersJson" JSONB NOT NULL,
  "sourceVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LibraryAwlFamily_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LibraryEntry_normalizedKey_partOfSpeech_idx" ON "library"."LibraryEntry"("normalizedKey", "partOfSpeech");
CREATE INDEX "LibraryEntry_english_idx" ON "library"."LibraryEntry"("english");
CREATE INDEX "LibraryEntry_partOfSpeech_entryKind_phraseType_idx" ON "library"."LibraryEntry"("partOfSpeech", "entryKind", "phraseType");
CREATE INDEX "LibraryEntry_awlSublist_awlFamilyHeadword_idx" ON "library"."LibraryEntry"("awlSublist", "awlFamilyHeadword");
CREATE INDEX "LibraryEntry_createdAt_idx" ON "library"."LibraryEntry"("createdAt");
CREATE INDEX "LibraryEntry_updatedAt_idx" ON "library"."LibraryEntry"("updatedAt");
CREATE INDEX "LibraryEntryRevision_entryId_createdAt_idx" ON "library"."LibraryEntryRevision"("entryId", "createdAt");
CREATE INDEX "LibraryEntryRevision_actorName_createdAt_idx" ON "library"."LibraryEntryRevision"("actorName", "createdAt");
CREATE INDEX "LibraryContribution_entryId_status_idx" ON "library"."LibraryContribution"("entryId", "status");
CREATE INDEX "LibraryContribution_studentRefId_status_idx" ON "library"."LibraryContribution"("studentRefId", "status");
CREATE INDEX "LibraryContribution_sourceKind_sourceId_idx" ON "library"."LibraryContribution"("sourceKind", "sourceId");
CREATE INDEX "LibraryAssignment_studentRefId_status_dueAt_idx" ON "library"."LibraryAssignment"("studentRefId", "status", "dueAt");
CREATE INDEX "LibraryAssignment_entryId_status_idx" ON "library"."LibraryAssignment"("entryId", "status");
CREATE INDEX "LibraryDuplicateCase_status_normalizedKey_partOfSpeech_idx" ON "library"."LibraryDuplicateCase"("status", "normalizedKey", "partOfSpeech");
CREATE UNIQUE INDEX "LibraryAwlFamily_familyHeadword_sublist_key" ON "library"."LibraryAwlFamily"("familyHeadword", "sublist");
CREATE INDEX "LibraryAwlFamily_sublist_idx" ON "library"."LibraryAwlFamily"("sublist");
CREATE INDEX "LibraryAwlFamily_americanHeadword_idx" ON "library"."LibraryAwlFamily"("americanHeadword");

ALTER TABLE "library"."LibraryEntryRevision" ADD CONSTRAINT "LibraryEntryRevision_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "library"."LibraryEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "library"."LibraryContribution" ADD CONSTRAINT "LibraryContribution_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "library"."LibraryEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "library"."LibraryAssignment" ADD CONSTRAINT "LibraryAssignment_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "library"."LibraryEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "library"."LibraryContribution" ADD CONSTRAINT "LibraryContribution_studentRefId_fkey" FOREIGN KEY ("studentRefId") REFERENCES "public"."Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "library"."LibraryAssignment" ADD CONSTRAINT "LibraryAssignment_studentRefId_fkey" FOREIGN KEY ("studentRefId") REFERENCES "public"."Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve every historical source row as an attributed, reviewable contribution.
-- This migration deliberately does not create canonical entries or merge records:
-- an administrator must make those irreversible editorial decisions in Library Admin.
INSERT INTO "library"."LibraryContribution" ("id", "studentRefId", "contributorName", "sourceKind", "sourceId", "payloadJson", "status", "submittedAt")
SELECT
  'legacy-new-word-' || "StudentNewWord"."id",
  "StudentNewWord"."studentRefId",
  COALESCE(NULLIF("StudentProfile"."englishName", ''), NULLIF("StudentProfile"."fullName", ''), "Student"."eaglesId"),
  'legacy_new_word',
  "StudentNewWord"."id",
  jsonb_build_object('english', "StudentNewWord"."english", 'partOfSpeech', "StudentNewWord"."partOfSpeech", 'vietnamese', "StudentNewWord"."vietnamese", 'syllabication', "StudentNewWord"."syllabication", 'definition', "StudentNewWord"."definition", 'sourceReportId', "StudentNewWord"."sourceReportId"),
  'pending_review',
  "StudentNewWord"."createdAt"
FROM "public"."StudentNewWord"
JOIN "public"."Student" ON "Student"."id" = "StudentNewWord"."studentRefId"
LEFT JOIN "public"."StudentProfile" ON "StudentProfile"."studentRefId" = "StudentNewWord"."studentRefId";

INSERT INTO "library"."LibraryContribution" ("id", "studentRefId", "contributorName", "sourceKind", "sourceId", "payloadJson", "status", "submittedAt")
SELECT
  'legacy-news-vocabulary-' || "StudentNewsReport"."id" || '-' || item.ordinality,
  "StudentNewsReport"."studentRefId",
  COALESCE(NULLIF("StudentProfile"."englishName", ''), NULLIF("StudentProfile"."fullName", ''), "Student"."eaglesId"),
  'legacy_news_vocabulary',
  "StudentNewsReport"."id",
  item.value,
  'pending_review',
  "StudentNewsReport"."createdAt"
FROM "public"."StudentNewsReport"
JOIN "public"."Student" ON "Student"."id" = "StudentNewsReport"."studentRefId"
LEFT JOIN "public"."StudentProfile" ON "StudentProfile"."studentRefId" = "StudentNewsReport"."studentRefId"
CROSS JOIN LATERAL jsonb_array_elements(COALESCE("StudentNewsReport"."vocabularyJson", '[]'::jsonb)) WITH ORDINALITY AS item(value, ordinality)
WHERE "StudentNewsReport"."mmrPassedAt" IS NOT NULL OR "StudentNewsReport"."dateSatisfiedAt" IS NOT NULL OR ("StudentNewsReport"."submissionState" = 'submitted' AND "StudentNewsReport"."firstSubmittedAt" IS NOT NULL) OR "StudentNewsReport"."submissionState" = 'ready';
