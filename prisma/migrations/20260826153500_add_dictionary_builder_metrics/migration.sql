CREATE TABLE "library"."DictionaryProviderSuitabilityMetric" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "partOfSpeech" TEXT NOT NULL,
  "datum" TEXT NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "availableCount" INTEGER NOT NULL DEFAULT 0,
  "eligibleApplyCount" INTEGER NOT NULL DEFAULT 0,
  "selectedApplyCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DictionaryProviderSuitabilityMetric_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DictionaryProviderSuitabilityMetric_provider_partOfSpeech_datum_key"
  ON "library"."DictionaryProviderSuitabilityMetric"("provider", "partOfSpeech", "datum");
CREATE INDEX "DictionaryProviderSuitabilityMetric_provider_partOfSpeech_idx"
  ON "library"."DictionaryProviderSuitabilityMetric"("provider", "partOfSpeech");
