CREATE TABLE "BrevoEmailDelivery" (
    "id" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "reportId" TEXT,
    "queueType" TEXT,
    "subject" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "blockedAt" TIMESTAMP(3),
    "complainedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrevoEmailDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BrevoEmailWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "recipientEmail" TEXT,
    "eventType" TEXT NOT NULL,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "subject" TEXT,
    "payloadJson" JSONB NOT NULL,
    "deliveryId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "BrevoEmailWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrevoEmailDelivery_providerMessageId_recipientEmail_key"
    ON "BrevoEmailDelivery"("providerMessageId", "recipientEmail");
CREATE INDEX "BrevoEmailDelivery_providerMessageId_idx"
    ON "BrevoEmailDelivery"("providerMessageId");
CREATE INDEX "BrevoEmailDelivery_recipientEmail_status_lastEventAt_idx"
    ON "BrevoEmailDelivery"("recipientEmail", "status", "lastEventAt");
CREATE INDEX "BrevoEmailDelivery_reportId_status_updatedAt_idx"
    ON "BrevoEmailDelivery"("reportId", "status", "updatedAt");
CREATE UNIQUE INDEX "BrevoEmailWebhookEvent_eventKey_key"
    ON "BrevoEmailWebhookEvent"("eventKey");
CREATE INDEX "BrevoEmailWebhookEvent_providerMessageId_recipientEmail_eventAt_idx"
    ON "BrevoEmailWebhookEvent"("providerMessageId", "recipientEmail", "eventAt");
CREATE INDEX "BrevoEmailWebhookEvent_eventType_eventAt_idx"
    ON "BrevoEmailWebhookEvent"("eventType", "eventAt");
CREATE INDEX "BrevoEmailWebhookEvent_deliveryId_eventAt_idx"
    ON "BrevoEmailWebhookEvent"("deliveryId", "eventAt");

ALTER TABLE "BrevoEmailDelivery"
    ADD CONSTRAINT "BrevoEmailDelivery_reportId_fkey"
    FOREIGN KEY ("reportId") REFERENCES "ParentClassReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BrevoEmailWebhookEvent"
    ADD CONSTRAINT "BrevoEmailWebhookEvent_deliveryId_fkey"
    FOREIGN KEY ("deliveryId") REFERENCES "BrevoEmailDelivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;
