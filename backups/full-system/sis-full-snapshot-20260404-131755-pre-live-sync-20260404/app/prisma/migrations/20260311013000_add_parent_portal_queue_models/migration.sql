-- Parent portal account and queue models.

CREATE TABLE IF NOT EXISTS "ParentPortalAccount" (
  "id" TEXT NOT NULL,
  "parentsId" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ParentPortalAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ParentPortalAccount_parentsId_key" ON "ParentPortalAccount"("parentsId");
CREATE INDEX IF NOT EXISTS "ParentPortalAccount_status_idx" ON "ParentPortalAccount"("status");

CREATE TABLE IF NOT EXISTS "ParentPortalStudentLink" (
  "id" TEXT NOT NULL,
  "parentAccountId" TEXT NOT NULL,
  "studentRefId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ParentPortalStudentLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ParentPortalStudentLink_parentAccountId_fkey" FOREIGN KEY ("parentAccountId") REFERENCES "ParentPortalAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ParentPortalStudentLink_studentRefId_fkey" FOREIGN KEY ("studentRefId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ParentPortalStudentLink_parentAccountId_studentRefId_key" ON "ParentPortalStudentLink"("parentAccountId", "studentRefId");
CREATE INDEX IF NOT EXISTS "ParentPortalStudentLink_studentRefId_idx" ON "ParentPortalStudentLink"("studentRefId");

CREATE TABLE IF NOT EXISTS "ParentProfileSubmissionQueue" (
  "id" TEXT NOT NULL,
  "parentAccountId" TEXT NOT NULL,
  "studentRefId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "draftPayloadJson" JSONB,
  "adminEditedPayloadJson" JSONB,
  "diffPayloadJson" JSONB,
  "failurePoint" TEXT,
  "rejectionReason" TEXT,
  "comment" TEXT,
  "submittedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "reviewedByUsername" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ParentProfileSubmissionQueue_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ParentProfileSubmissionQueue_parentAccountId_fkey" FOREIGN KEY ("parentAccountId") REFERENCES "ParentPortalAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ParentProfileSubmissionQueue_studentRefId_fkey" FOREIGN KEY ("studentRefId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ParentProfileSubmissionQueue_status_submittedAt_createdAt_idx"
  ON "ParentProfileSubmissionQueue"("status", "submittedAt", "createdAt");
CREATE INDEX IF NOT EXISTS "ParentProfileSubmissionQueue_parentAccountId_status_createdAt_idx"
  ON "ParentProfileSubmissionQueue"("parentAccountId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "ParentProfileSubmissionQueue_studentRefId_status_createdAt_idx"
  ON "ParentProfileSubmissionQueue"("studentRefId", "status", "createdAt");

CREATE TABLE IF NOT EXISTS "ParentProfileFieldLock" (
  "id" TEXT NOT NULL,
  "studentRefId" TEXT NOT NULL,
  "fieldKey" TEXT NOT NULL,
  "locked" BOOLEAN NOT NULL DEFAULT true,
  "reason" TEXT,
  "lockedByUsername" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ParentProfileFieldLock_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ParentProfileFieldLock_studentRefId_fkey" FOREIGN KEY ("studentRefId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ParentProfileFieldLock_studentRefId_fieldKey_key"
  ON "ParentProfileFieldLock"("studentRefId", "fieldKey");
CREATE INDEX IF NOT EXISTS "ParentProfileFieldLock_studentRefId_locked_idx"
  ON "ParentProfileFieldLock"("studentRefId", "locked");
