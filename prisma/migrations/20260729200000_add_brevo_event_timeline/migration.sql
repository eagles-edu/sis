ALTER TABLE "BrevoEmailDelivery"
  ADD COLUMN "queuedAt" TIMESTAMP(3),
  ADD COLUMN "proxyLoadedAt" TIMESTAMP(3),
  ADD COLUMN "firstOpenedAt" TIMESTAMP(3),
  ADD COLUMN "uniqueOpenedAt" TIMESTAMP(3),
  ADD COLUMN "errorAt" TIMESTAMP(3),
  ADD COLUMN "invalidAt" TIMESTAMP(3),
  ADD COLUMN "softBouncedAt" TIMESTAMP(3),
  ADD COLUMN "hardBouncedAt" TIMESTAMP(3);

UPDATE "BrevoEmailDelivery"
SET "queuedAt" = COALESCE("sentAt", "createdAt")
WHERE "queuedAt" IS NULL;
