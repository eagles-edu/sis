// @ts-check
import crypto from "node:crypto"
import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import { getConfiguredDatabaseUrlSync } from "../admin/sis-config-store.mjs"

/**
 * @typedef {{
 *   jobType?: unknown,
 *   status?: unknown,
 *   dedupeKey?: unknown,
 *   payloadJson?: unknown,
 *   resultJson?: unknown,
 *   lastError?: unknown,
 *   attempts?: unknown,
 *   availableAt?: unknown,
 *   lockedAt?: unknown,
 *   lockedBy?: unknown,
 *   completedAt?: unknown,
 *   createdAt?: unknown,
 *   updatedAt?: unknown,
 * }} JobRecordLike
 *
 * @typedef {{
 *   jobTypes?: Array<unknown>,
 *   take?: unknown,
 *   workerId?: unknown,
 *   now?: unknown,
 * }} ClaimJobOptions
 *
 * @typedef {{
 *   maxAttempts?: unknown,
 *   retryDelayMs?: unknown,
 * }} FailJobOptions
 */

export const ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL = "announcement-email"
export const ASYNC_SIDE_EFFECT_JOB_TYPE_REPORT_CARD_PDF = "report-card-pdf"
export const ASYNC_SIDE_EFFECT_JOB_TYPE_PARENT_PROFILE_INVITATION = "parent-profile-invitation"

export const ASYNC_SIDE_EFFECT_JOB_STATUS_QUEUED = "queued"
export const ASYNC_SIDE_EFFECT_JOB_STATUS_PROCESSING = "processing"
export const ASYNC_SIDE_EFFECT_JOB_STATUS_SUCCEEDED = "succeeded"
export const ASYNC_SIDE_EFFECT_JOB_STATUS_FAILED = "failed"

const MEMORY_JOBS = []
const DEFAULT_PROCESSING_LOCK_TIMEOUT_MS = 10 * 60 * 1000

function useVolatileTestStorage() {
  const backend = normalizeLower(process.env.ASYNC_SIDE_EFFECT_JOB_BACKEND)
  return normalizeLower(process.env.NODE_ENV) === "test" && ["memory", "in-memory"].includes(backend)
}

function hasConfiguredDatabaseUrl() {
  try {
    return Boolean(normalizeText(process.env.DATABASE_URL || getConfiguredDatabaseUrlSync()))
  } catch {
    return Boolean(normalizeText(process.env.DATABASE_URL))
  }
}

let SIDE_EFFECT_JOB_DB_DISABLED = useVolatileTestStorage() || !hasConfiguredDatabaseUrl()
let SIDE_EFFECT_JOB_DB_WARNED = false

function allowVolatileUnitTestStorage() {
  return normalizeLower(process.env.NODE_ENV) === "test" &&
    (useVolatileTestStorage() || !normalizeText(process.env.DATABASE_URL))
}

function sideEffectPersistenceUnavailable() {
  const error = new Error("Async side-effect persistence is unavailable")
  error.statusCode = 503
  return error
}

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase()
}

function normalizeJobType(value) {
  return normalizeLower(value) || ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL
}

function normalizeJobStatus(value) {
  const status = normalizeLower(value)
  if (status === ASYNC_SIDE_EFFECT_JOB_STATUS_PROCESSING) return ASYNC_SIDE_EFFECT_JOB_STATUS_PROCESSING
  if (status === ASYNC_SIDE_EFFECT_JOB_STATUS_SUCCEEDED) return ASYNC_SIDE_EFFECT_JOB_STATUS_SUCCEEDED
  if (status === ASYNC_SIDE_EFFECT_JOB_STATUS_FAILED) return ASYNC_SIDE_EFFECT_JOB_STATUS_FAILED
  return ASYNC_SIDE_EFFECT_JOB_STATUS_QUEUED
}

export function safeAsyncSideEffectFailureCode(error) {
  const statusCode = Number.parseInt(String(error?.statusCode || ""), 10)
  if (statusCode === 408 || statusCode === 504) return "provider_timeout"
  if (statusCode === 429) return "provider_rate_limited"
  if (statusCode >= 500 && statusCode <= 599) return "provider_unavailable"
  if (statusCode >= 400 && statusCode <= 499) return "provider_rejected"
  if (error?.name === "AbortError" || error?.name === "TimeoutError") return "operation_timeout"
  return "operation_failed"
}

function normalizePayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return { ...value }
}

function normalizeResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return { ...value }
}

function normalizeIsoDate(value) {
  if (!value) return ""
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.valueOf())) return ""
  return date.toISOString()
}

function createJobId() {
  return `job-${crypto.randomUUID()}`
}

/**
 * @param {JobRecordLike} [record]
 * @returns {{
 *   id: string,
 *   jobType: string,
 *   status: string,
 *   dedupeKey: string,
 *   payloadJson: Record<string, unknown>,
 *   resultJson: Record<string, unknown>,
 *   lastError: string,
 *   attempts: number,
 *   availableAt: string,
 *   lockedAt: string,
 *   lockedBy: string,
 *   completedAt: string,
 *   createdAt: string,
 *   updatedAt: string,
 * }}
 */
function mapJobRecord(record = {}) {
  return {
    id: normalizeText(record.id),
    jobType: normalizeJobType(record.jobType),
    status: normalizeJobStatus(record.status),
    dedupeKey: normalizeText(record.dedupeKey),
    payloadJson: normalizePayload(record.payloadJson),
    resultJson: normalizeResult(record.resultJson),
    lastError: normalizeText(record.lastError),
    attempts: Number.parseInt(String(record.attempts || 0), 10) || 0,
    availableAt: normalizeIsoDate(record.availableAt),
    lockedAt: normalizeIsoDate(record.lockedAt),
    lockedBy: normalizeText(record.lockedBy),
    completedAt: normalizeIsoDate(record.completedAt),
    createdAt: normalizeIsoDate(record.createdAt),
    updatedAt: normalizeIsoDate(record.updatedAt),
  }
}

function isJobTableMissingError(error) {
  const code = normalizeLower(error?.code)
  if (code === "p2021") return true
  const message = normalizeLower(error?.message || error)
  return message.includes("asyncsideeffectjob")
}

function markDatabaseFallback(error) {
  SIDE_EFFECT_JOB_DB_DISABLED = true
  if (!SIDE_EFFECT_JOB_DB_WARNED) {
    SIDE_EFFECT_JOB_DB_WARNED = true
    void error
    console.warn("async side effects falling back to memory: persistence_unavailable")
  }
}

async function getJobPrismaClient() {
  if (SIDE_EFFECT_JOB_DB_DISABLED) {
    if (useVolatileTestStorage() || !hasConfiguredDatabaseUrl()) return null
    SIDE_EFFECT_JOB_DB_DISABLED = false
  }
  try {
    const prisma = await getSharedPrismaClient()
    if (!prisma || !prisma.asyncSideEffectJob) {
      SIDE_EFFECT_JOB_DB_DISABLED = true
      if (!SIDE_EFFECT_JOB_DB_WARNED) {
        SIDE_EFFECT_JOB_DB_WARNED = true
        console.warn("async side effects falling back to memory: prisma model unavailable")
      }
      return null
    }
    return prisma
  } catch (error) {
    if (allowVolatileUnitTestStorage()) {
      markDatabaseFallback(error)
      return null
    }
    throw error
  }
}

function normalizeAvailableAt(value) {
  const date = value ? (value instanceof Date ? value : new Date(value)) : new Date()
  if (Number.isNaN(date.valueOf())) return new Date()
  return date
}

function processingLockTimeoutMs() {
  const configured = Number.parseInt(String(process.env.ASYNC_SIDE_EFFECT_JOB_LOCK_TIMEOUT_MS || DEFAULT_PROCESSING_LOCK_TIMEOUT_MS), 10)
  return Number.isFinite(configured) && configured >= 60 * 1000 ? configured : DEFAULT_PROCESSING_LOCK_TIMEOUT_MS
}

function cloneMemoryJob(job) {
  return mapJobRecord({ ...job, payloadJson: normalizePayload(job.payloadJson), resultJson: normalizeResult(job.resultJson) })
}

/**
 * @param {unknown} jobType
 * @param {Record<string, unknown>} [payload]
 * @param {{ dedupeKey?: unknown, availableAt?: unknown }} [options]
 * @returns {Promise<ReturnType<typeof mapJobRecord>>}
 */
export async function enqueueAsyncSideEffectJob(jobType, payload = {}, options = {}) {
  const normalizedJobType = normalizeJobType(jobType)
  const normalizedPayload = normalizePayload(payload)
  const dedupeKey = normalizeText(options.dedupeKey)
  const availableAt = normalizeAvailableAt(options.availableAt)
  const baseJob = {
    id: createJobId(),
    jobType: normalizedJobType,
    status: ASYNC_SIDE_EFFECT_JOB_STATUS_QUEUED,
    dedupeKey,
    payloadJson: normalizedPayload,
    resultJson: {},
    lastError: "",
    attempts: 0,
    availableAt,
    lockedAt: null,
    lockedBy: "",
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const prisma = await getJobPrismaClient()
  if (!prisma) {
    if (!allowVolatileUnitTestStorage()) throw sideEffectPersistenceUnavailable()
    if (dedupeKey) {
      const existing = MEMORY_JOBS.find(
        (job) => normalizeJobType(job.jobType) === normalizedJobType && normalizeText(job.dedupeKey) === dedupeKey
      )
      if (existing) {
        const existingStatus = normalizeJobStatus(existing.status)
        if (
          existingStatus === ASYNC_SIDE_EFFECT_JOB_STATUS_QUEUED ||
          existingStatus === ASYNC_SIDE_EFFECT_JOB_STATUS_PROCESSING
        ) {
          return cloneMemoryJob(existing)
        }
        Object.assign(existing, {
          status: ASYNC_SIDE_EFFECT_JOB_STATUS_QUEUED,
          payloadJson: normalizedPayload,
          resultJson: {},
          lastError: "",
          attempts: 0,
          availableAt,
          lockedAt: null,
          lockedBy: "",
          completedAt: null,
          updatedAt: new Date(),
        })
        return cloneMemoryJob(existing)
      }
    }
    MEMORY_JOBS.push(baseJob)
    return cloneMemoryJob(baseJob)
  }

  try {
    if (dedupeKey) {
      const existing = await prisma.asyncSideEffectJob.findUnique({
        where: {
          jobType_dedupeKey: {
            jobType: normalizedJobType,
            dedupeKey,
          },
        },
      })
      if (existing) {
        const existingStatus = normalizeJobStatus(existing.status)
        if (
          existingStatus === ASYNC_SIDE_EFFECT_JOB_STATUS_QUEUED ||
          existingStatus === ASYNC_SIDE_EFFECT_JOB_STATUS_PROCESSING
        ) {
          return mapJobRecord(existing)
        }
        const revived = await prisma.asyncSideEffectJob.update({
          where: {
            jobType_dedupeKey: {
              jobType: normalizedJobType,
              dedupeKey,
            },
          },
          data: {
            status: ASYNC_SIDE_EFFECT_JOB_STATUS_QUEUED,
            payloadJson: normalizedPayload,
            resultJson: {},
            lastError: null,
            attempts: 0,
            availableAt,
            lockedAt: null,
            lockedBy: null,
            completedAt: null,
          },
        })
        return mapJobRecord(revived)
      }
    }

    const created = await prisma.asyncSideEffectJob.create({
      data: {
        id: baseJob.id,
        jobType: normalizedJobType,
        status: ASYNC_SIDE_EFFECT_JOB_STATUS_QUEUED,
        dedupeKey: dedupeKey || null,
        payloadJson: normalizedPayload,
        resultJson: {},
        lastError: null,
        attempts: 0,
        availableAt,
        lockedAt: null,
        lockedBy: null,
        completedAt: null,
      },
    })
    return mapJobRecord(created)
  } catch (error) {
    if (isJobTableMissingError(error)) {
      if (allowVolatileUnitTestStorage()) {
        MEMORY_JOBS.push(baseJob)
        return cloneMemoryJob(baseJob)
      }
      throw sideEffectPersistenceUnavailable()
    }
    throw error
  }
}

/**
 * List announcement email jobs that failed terminally or are waiting for a
 * retry after a delivery failure. Recipient and message payloads are excluded.
 * @param {{ take?: unknown }} [options]
 * @returns {Promise<Array<{ id: string, status: string, attempts: number, lastError: string, createdAt: string, updatedAt: string, completedAt: string }>>}
 */
export async function listAnnouncementDeliveryFailures({ take = 25 } = {}) {
  const limit = Math.max(1, Math.min(Number.parseInt(String(take || 25), 10) || 25, 100))
  const toInvestigationRow = (job) => ({
    id: normalizeText(job.id),
    status: normalizeJobStatus(job.status),
    attempts: Number.parseInt(String(job.attempts || 0), 10) || 0,
    lastError: normalizeText(job.lastError),
    createdAt: normalizeIsoDate(job.createdAt),
    updatedAt: normalizeIsoDate(job.updatedAt),
    completedAt: normalizeIsoDate(job.completedAt),
  })
  const prisma = await getJobPrismaClient()
  let jobs
  if (!prisma) {
    if (!allowVolatileUnitTestStorage()) throw sideEffectPersistenceUnavailable()
    jobs = MEMORY_JOBS
      .filter((job) => normalizeJobType(job.jobType) === ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL)
      .filter((job) => normalizeText(job.lastError))
      .sort((left, right) => new Date(right.updatedAt).valueOf() - new Date(left.updatedAt).valueOf())
      .slice(0, limit)
  } else {
    jobs = await prisma.asyncSideEffectJob.findMany({
      where: {
        jobType: ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL,
        lastError: { not: null },
        status: { in: [ASYNC_SIDE_EFFECT_JOB_STATUS_QUEUED, ASYNC_SIDE_EFFECT_JOB_STATUS_FAILED] },
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: limit,
      select: {
        id: true,
        status: true,
        attempts: true,
        lastError: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
      },
    })
  }
  return jobs.map(toInvestigationRow).filter((job) => job.id && job.lastError)
}

/**
 * @param {ClaimJobOptions} [options]
 * @returns {Promise<Array<ReturnType<typeof mapJobRecord>>>}
 */
export async function claimAsyncSideEffectJobs({ jobTypes = [], take = 10, workerId = "", now } = {}) {
  const limit = Math.max(1, Math.min(Number.parseInt(String(take || 10), 10) || 10, 100))
  const normalizedJobTypes = Array.from(
    new Set((Array.isArray(jobTypes) ? jobTypes : []).map((entry) => normalizeJobType(entry)).filter(Boolean))
  )
  const normalizedWorkerId = normalizeText(workerId) || `worker-${process.pid}`
  const availableAt = normalizeAvailableAt(now)
  const prisma = await getJobPrismaClient()

  if (!prisma) {
    if (!allowVolatileUnitTestStorage()) throw sideEffectPersistenceUnavailable()
    const staleBefore = new Date(availableAt.valueOf() - processingLockTimeoutMs())
    MEMORY_JOBS.forEach((job) => {
      if (normalizedJobTypes.length && !normalizedJobTypes.includes(normalizeJobType(job.jobType))) return
      if (normalizeJobStatus(job.status) !== ASYNC_SIDE_EFFECT_JOB_STATUS_PROCESSING) return
      const lockedAt = job.lockedAt ? new Date(job.lockedAt) : null
      if (!lockedAt || lockedAt > staleBefore) return
      job.status = ASYNC_SIDE_EFFECT_JOB_STATUS_QUEUED
      job.availableAt = availableAt
      job.lockedAt = null
      job.lockedBy = ""
      job.updatedAt = availableAt
    })

    const claimable = MEMORY_JOBS.filter((job) => {
      if (normalizedJobTypes.length && !normalizedJobTypes.includes(normalizeJobType(job.jobType))) return false
      if (normalizeJobStatus(job.status) !== ASYNC_SIDE_EFFECT_JOB_STATUS_QUEUED) return false
      const readyAt = job.availableAt ? new Date(job.availableAt) : null
      if (readyAt && readyAt > availableAt) return false
      return true
    })
      .sort((left, right) => {
        const leftReady = left.availableAt ? new Date(left.availableAt).valueOf() : 0
        const rightReady = right.availableAt ? new Date(right.availableAt).valueOf() : 0
        if (leftReady !== rightReady) return leftReady - rightReady
        return new Date(left.createdAt).valueOf() - new Date(right.createdAt).valueOf()
      })
      .slice(0, limit)

    return claimable.map((job) => {
      job.status = ASYNC_SIDE_EFFECT_JOB_STATUS_PROCESSING
      job.lockedAt = availableAt
      job.lockedBy = normalizedWorkerId
      job.attempts = (Number.parseInt(String(job.attempts || 0), 10) || 0) + 1
      job.updatedAt = new Date()
      return cloneMemoryJob(job)
    })
  }

  const where = {
    status: ASYNC_SIDE_EFFECT_JOB_STATUS_QUEUED,
    OR: [{ availableAt: null }, { availableAt: { lte: availableAt } }],
  }
  if (normalizedJobTypes.length) where.jobType = { in: normalizedJobTypes }

  const staleBefore = new Date(availableAt.valueOf() - processingLockTimeoutMs())
  const staleWhere = {
    status: ASYNC_SIDE_EFFECT_JOB_STATUS_PROCESSING,
    lockedAt: { lte: staleBefore },
  }
  if (normalizedJobTypes.length) staleWhere.jobType = { in: normalizedJobTypes }
  await prisma.asyncSideEffectJob.updateMany({
    where: staleWhere,
    data: {
      status: ASYNC_SIDE_EFFECT_JOB_STATUS_QUEUED,
      availableAt,
      lockedAt: null,
      lockedBy: null,
    },
  })

  const candidates = await prisma.asyncSideEffectJob.findMany({
    where,
    orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
    take: limit,
  })

  const claimed = []
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i]
    const updated = await prisma.asyncSideEffectJob.updateMany({
      where: {
        id: candidate.id,
        status: ASYNC_SIDE_EFFECT_JOB_STATUS_QUEUED,
      },
      data: {
        status: ASYNC_SIDE_EFFECT_JOB_STATUS_PROCESSING,
        lockedAt: availableAt,
        lockedBy: normalizedWorkerId,
        attempts: { increment: 1 },
        updatedAt: availableAt,
      },
    })
    if (!updated.count) continue
    claimed.push(
      mapJobRecord({
        ...candidate,
        status: ASYNC_SIDE_EFFECT_JOB_STATUS_PROCESSING,
        lockedAt: availableAt,
        lockedBy: normalizedWorkerId,
        attempts: (Number.parseInt(String(candidate.attempts || 0), 10) || 0) + 1,
        updatedAt: availableAt,
      })
    )
  }

  return claimed
}

/**
 * @param {unknown} jobId
 * @param {Record<string, unknown>} [resultJson]
 * @returns {Promise<ReturnType<typeof mapJobRecord> | null>}
 */
export async function completeAsyncSideEffectJob(jobId, resultJson = {}) {
  const id = normalizeText(jobId)
  const result = normalizeResult(resultJson)
  if (!id) return null

  const prisma = await getJobPrismaClient()
  if (!prisma) {
    if (!allowVolatileUnitTestStorage()) throw sideEffectPersistenceUnavailable()
    const index = MEMORY_JOBS.findIndex((job) => normalizeText(job.id) === id)
    if (index < 0) return null
    MEMORY_JOBS[index] = {
      ...MEMORY_JOBS[index],
      status: ASYNC_SIDE_EFFECT_JOB_STATUS_SUCCEEDED,
      resultJson: result,
      lastError: "",
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: "",
      updatedAt: new Date(),
    }
    return cloneMemoryJob(MEMORY_JOBS[index])
  }

  const updated = await prisma.asyncSideEffectJob.update({
    where: { id },
    data: {
      status: ASYNC_SIDE_EFFECT_JOB_STATUS_SUCCEEDED,
      resultJson: result,
      lastError: null,
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
    },
  })
  return mapJobRecord(updated)
}

/**
 * @param {unknown} jobId
 * @param {unknown} error
 * @param {FailJobOptions} [options]
 * @returns {Promise<ReturnType<typeof mapJobRecord> | null>}
 */
export async function failAsyncSideEffectJob(jobId, error, options = {}) {
  const id = normalizeText(jobId)
  if (!id) return null
  const maxAttempts = Math.max(1, Number.parseInt(String(options.maxAttempts || 3), 10) || 3)
  const retryDelayMs = Math.max(0, Number.parseInt(String(options.retryDelayMs || 0), 10) || 0)
  const lastError = safeAsyncSideEffectFailureCode(error)
  const retryAt = retryDelayMs ? new Date(Date.now() + retryDelayMs) : null

  const prisma = await getJobPrismaClient()
  if (!prisma) {
    if (!allowVolatileUnitTestStorage()) throw sideEffectPersistenceUnavailable()
    const index = MEMORY_JOBS.findIndex((job) => normalizeText(job.id) === id)
    if (index < 0) return null
    const current = MEMORY_JOBS[index]
    const currentAttempts = Number.parseInt(String(current.attempts || 0), 10) || 0
    const shouldRetry = currentAttempts < maxAttempts && Boolean(retryAt)
    MEMORY_JOBS[index] = {
      ...current,
      status: shouldRetry ? ASYNC_SIDE_EFFECT_JOB_STATUS_QUEUED : ASYNC_SIDE_EFFECT_JOB_STATUS_FAILED,
      lastError,
      completedAt: shouldRetry ? null : new Date(),
      availableAt: shouldRetry ? retryAt : current.availableAt,
      lockedAt: null,
      lockedBy: "",
      updatedAt: new Date(),
    }
    return cloneMemoryJob(MEMORY_JOBS[index])
  }

  const existing = await prisma.asyncSideEffectJob.findUnique({ where: { id } })
  if (!existing) return null
  const currentAttempts = Number.parseInt(String(existing.attempts || 0), 10) || 0
  const shouldRetry = currentAttempts < maxAttempts && Boolean(retryAt)

  const updated = await prisma.asyncSideEffectJob.update({
    where: { id },
    data: shouldRetry
      ? {
          status: ASYNC_SIDE_EFFECT_JOB_STATUS_QUEUED,
          lastError,
          availableAt: retryAt,
          lockedAt: null,
          lockedBy: null,
        }
      : {
          status: ASYNC_SIDE_EFFECT_JOB_STATUS_FAILED,
          lastError,
          completedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
        },
  })
  return mapJobRecord(updated)
}
