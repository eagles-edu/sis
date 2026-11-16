ALTER TABLE "public"."Student"
ADD COLUMN "moodleDeletionPending" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "public"."MoodleLevelMapping" (
    "id" TEXT NOT NULL,
    "canonicalLevel" TEXT NOT NULL,
    "courseIdnumber" TEXT NOT NULL,
    "cohortIdnumber" TEXT NOT NULL,
    "cohortName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MoodleLevelMapping_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."MoodleUserLink" (
    "id" TEXT NOT NULL,
    "studentRefId" TEXT NOT NULL,
    "eaglesId" TEXT NOT NULL,
    "studentNumber" INTEGER NOT NULL,
    "moodleUserId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastSyncedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MoodleUserLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."MoodleProvisioningCommand" (
    "id" TEXT NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "studentRefId" TEXT,
    "action" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadJson" JSONB,
    "encryptedPayload" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastErrorCode" TEXT,
    "terminalAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MoodleProvisioningCommand_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."MoodleProvisioningReceipt" (
    "id" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "resultJson" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MoodleProvisioningReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."MoodleProvisioningNonce" (
    "source" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MoodleProvisioningNonce_pkey" PRIMARY KEY ("source", "nonce")
);

CREATE UNIQUE INDEX "MoodleLevelMapping_canonicalLevel_key" ON "public"."MoodleLevelMapping"("canonicalLevel");
CREATE UNIQUE INDEX "MoodleLevelMapping_courseIdnumber_key" ON "public"."MoodleLevelMapping"("courseIdnumber");
CREATE UNIQUE INDEX "MoodleLevelMapping_cohortIdnumber_key" ON "public"."MoodleLevelMapping"("cohortIdnumber");
CREATE UNIQUE INDEX "MoodleUserLink_studentRefId_key" ON "public"."MoodleUserLink"("studentRefId");
CREATE UNIQUE INDEX "MoodleUserLink_eaglesId_key" ON "public"."MoodleUserLink"("eaglesId");
CREATE UNIQUE INDEX "MoodleUserLink_studentNumber_key" ON "public"."MoodleUserLink"("studentNumber");
CREATE UNIQUE INDEX "MoodleUserLink_moodleUserId_key" ON "public"."MoodleUserLink"("moodleUserId");
CREATE INDEX "MoodleUserLink_status_updatedAt_idx" ON "public"."MoodleUserLink"("status", "updatedAt");
CREATE INDEX "MoodleProvisioningCommand_status_nextAttemptAt_sequence_idx" ON "public"."MoodleProvisioningCommand"("status", "nextAttemptAt", "sequence");
CREATE INDEX "MoodleProvisioningCommand_studentRefId_sequence_idx" ON "public"."MoodleProvisioningCommand"("studentRefId", "sequence");
CREATE UNIQUE INDEX "MoodleProvisioningCommand_sequence_key" ON "public"."MoodleProvisioningCommand"("sequence");
CREATE UNIQUE INDEX "MoodleProvisioningCommand_idempotencyKey_key" ON "public"."MoodleProvisioningCommand"("idempotencyKey");
CREATE UNIQUE INDEX "MoodleProvisioningReceipt_commandId_key" ON "public"."MoodleProvisioningReceipt"("commandId");
CREATE INDEX "MoodleProvisioningReceipt_outcome_receivedAt_idx" ON "public"."MoodleProvisioningReceipt"("outcome", "receivedAt");
CREATE INDEX "MoodleProvisioningNonce_expiresAt_idx" ON "public"."MoodleProvisioningNonce"("expiresAt");

ALTER TABLE "public"."MoodleUserLink"
ADD CONSTRAINT "MoodleUserLink_studentRefId_fkey" FOREIGN KEY ("studentRefId") REFERENCES "public"."Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."MoodleProvisioningCommand"
ADD CONSTRAINT "MoodleProvisioningCommand_studentRefId_fkey" FOREIGN KEY ("studentRefId") REFERENCES "public"."Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."MoodleProvisioningReceipt"
ADD CONSTRAINT "MoodleProvisioningReceipt_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "public"."MoodleProvisioningCommand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
