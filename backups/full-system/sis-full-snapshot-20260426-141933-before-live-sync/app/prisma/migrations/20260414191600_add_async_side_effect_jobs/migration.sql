-- CreateTable
CREATE TABLE "AsyncSideEffectJob" (
    "id" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "dedupeKey" TEXT,
    "payloadJson" JSONB,
    "resultJson" JSONB,
    "lastError" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AsyncSideEffectJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AsyncSideEffectJob_status_availableAt_createdAt_idx" ON "AsyncSideEffectJob"("status", "availableAt", "createdAt");

-- CreateIndex
CREATE INDEX "AsyncSideEffectJob_jobType_status_availableAt_createdAt_idx" ON "AsyncSideEffectJob"("jobType", "status", "availableAt", "createdAt");

-- CreateIndex
CREATE INDEX "AsyncSideEffectJob_lockedAt_idx" ON "AsyncSideEffectJob"("lockedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AsyncSideEffectJob_jobType_dedupeKey_key" ON "AsyncSideEffectJob"("jobType", "dedupeKey");
