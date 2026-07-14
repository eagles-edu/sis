CREATE TABLE "StudentNewWord" (
    "id" TEXT NOT NULL,
    "studentRefId" TEXT NOT NULL,
    "englishKey" TEXT NOT NULL,
    "partOfSpeech" TEXT NOT NULL,
    "english" TEXT NOT NULL,
    "vietnamese" TEXT NOT NULL,
    "syllabication" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "syllableCount" INTEGER NOT NULL DEFAULT 0,
    "sourceReportDate" TIMESTAMP(3),
    "sourceReportId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentNewWord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudentNewWord_studentRefId_englishKey_key" ON "StudentNewWord"("studentRefId", "englishKey");
CREATE INDEX "StudentNewWord_studentRefId_sourceReportDate_idx" ON "StudentNewWord"("studentRefId", "sourceReportDate");
CREATE INDEX "StudentNewWord_studentRefId_partOfSpeech_idx" ON "StudentNewWord"("studentRefId", "partOfSpeech");
