CREATE TABLE "ParentProfileInvitation" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "studentRefId" TEXT NOT NULL,
    "parentAccountId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "batchId" TEXT,
    "providerMessageId" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParentProfileInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ParentProfileInvitation_tokenHash_key" ON "ParentProfileInvitation"("tokenHash");
CREATE INDEX "ParentProfileInvitation_studentRefId_status_createdAt_idx" ON "ParentProfileInvitation"("studentRefId", "status", "createdAt");
CREATE INDEX "ParentProfileInvitation_recipientEmail_status_createdAt_idx" ON "ParentProfileInvitation"("recipientEmail", "status", "createdAt");
CREATE INDEX "ParentProfileInvitation_expiresAt_status_idx" ON "ParentProfileInvitation"("expiresAt", "status");

ALTER TABLE "ParentProfileInvitation" ADD CONSTRAINT "ParentProfileInvitation_studentRefId_fkey" FOREIGN KEY ("studentRefId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParentProfileInvitation" ADD CONSTRAINT "ParentProfileInvitation_parentAccountId_fkey" FOREIGN KEY ("parentAccountId") REFERENCES "ParentPortalAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
