CREATE TABLE "AdminNotificationQueue" (
  "id" TEXT NOT NULL,
  "queueType" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "deliveryMode" TEXT NOT NULL,
  "recipients" TEXT[] NOT NULL,
  "assignmentTitle" TEXT NOT NULL,
  "exerciseTitle" TEXT,
  "level" TEXT,
  "dueAt" TEXT,
  "message" TEXT,
  "senderName" TEXT,
  "queuedByUsername" TEXT,
  "reviewedByUsername" TEXT,
  "scheduledFor" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "payloadJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AdminNotificationQueue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminNotificationQueue_queueType_status_createdAt_idx"
  ON "AdminNotificationQueue"("queueType", "status", "createdAt");

CREATE INDEX "AdminNotificationQueue_status_scheduledFor_createdAt_idx"
  ON "AdminNotificationQueue"("status", "scheduledFor", "createdAt");
