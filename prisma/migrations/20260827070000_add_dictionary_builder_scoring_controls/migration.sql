CREATE TABLE "library"."DictionaryBuilderProviderSetting" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "timeoutMs" INTEGER NOT NULL DEFAULT 8000,
  "maxConcurrentRequests" INTEGER NOT NULL DEFAULT 2,
  "maxRequestsPerMinute" INTEGER NOT NULL DEFAULT 30,
  "updatedByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DictionaryBuilderProviderSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DictionaryBuilderProviderSetting_provider_key"
  ON "library"."DictionaryBuilderProviderSetting"("provider");

CREATE TABLE "library"."DictionaryBuilderDatumSetting" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "partOfSpeech" TEXT NOT NULL,
  "datum" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "qualityOverride" DECIMAL(4,2),
  "updatedByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DictionaryBuilderDatumSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DictionaryBuilderDatumSetting_provider_partOfSpeech_datum_key"
  ON "library"."DictionaryBuilderDatumSetting"("provider", "partOfSpeech", "datum");

CREATE INDEX "DictionaryBuilderDatumSetting_provider_partOfSpeech_idx"
  ON "library"."DictionaryBuilderDatumSetting"("provider", "partOfSpeech");
