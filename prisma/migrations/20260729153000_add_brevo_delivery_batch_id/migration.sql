ALTER TABLE "BrevoEmailDelivery" ADD COLUMN "batchId" TEXT;

CREATE INDEX "BrevoEmailDelivery_batchId_recipientEmail_sentAt_idx"
ON "BrevoEmailDelivery"("batchId", "recipientEmail", "sentAt");
