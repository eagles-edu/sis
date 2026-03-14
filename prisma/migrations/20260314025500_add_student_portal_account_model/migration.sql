-- Student portal DB-backed account model.

CREATE TABLE IF NOT EXISTS "StudentPortalAccount" (
  "id" TEXT NOT NULL,
  "eaglesId" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "studentRefId" TEXT,
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentPortalAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StudentPortalAccount_studentRefId_fkey" FOREIGN KEY ("studentRefId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "StudentPortalAccount_eaglesId_key"
  ON "StudentPortalAccount"("eaglesId");

CREATE UNIQUE INDEX IF NOT EXISTS "StudentPortalAccount_studentRefId_key"
  ON "StudentPortalAccount"("studentRefId");

CREATE INDEX IF NOT EXISTS "StudentPortalAccount_status_idx"
  ON "StudentPortalAccount"("status");

CREATE INDEX IF NOT EXISTS "StudentPortalAccount_studentRefId_idx"
  ON "StudentPortalAccount"("studentRefId");
