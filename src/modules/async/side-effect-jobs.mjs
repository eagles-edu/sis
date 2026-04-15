// @ts-check
import crypto from "node:crypto"
import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"

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
 * }} ClaimJobOptions
 *
 * @typedef {{
 *   maxAttempts?: unknown,
 *   retryDelayMs?: unknown,
 * }} FailJobOptions
 */

export const ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL = "announcement-email"
export const ASYNC_SIDE_EFFECT_JOB_TYPE_REPORT_CARD_PDF = "report-card-pdf"

export const ASYNC_SIDE_EFFECT_JOB_STATUS_QUEUED = "queued"
export const ASYNC_SIDE_EFFECT_JOB_STATUS_PROCESSING = "processing"
export const ASYNC_SIDE_EFFECT_JOB_STATUS_SUCCEEDED = "succeeded"
export const ASYNC_SIDE_EFFECT_JOB_STATUS_FAILED = "failed"

const MEMORY_JOBS = []
let SIDE_EFFECT_JOB_DB_DISABLED = !String(process.env.DATABASE_URL || "").trim()
let SIDE_EFFECT_JOB_DB_WARNED = false

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
    console.warn(`async side effects falling back to memory: ${normalizeText(error?.message || error)}`)
  }
}

async function getJobPrismaClient() {
  if (SIDE_EFFECT_JOB_DB_DISABLED) return null
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
    markDatabaseFallback(error)
    return null
  }
}

function normalizeAvailableAt(value) {
  const date = value ? (value instanceof Date ? value : new Date(value)) : new Date()
  if (Number.isNaN(date.valueOf())) return new Date()
  return date
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
      markDatabaseFallback(error)
      MEMORY_JOBS.push(baseJob)
      return cloneMemoryJob(baseJob)
    }
    throw error
  }
}

/**
 * @param {ClaimJobOptions} [options]
 * @returns {Promise<Array<ReturnType<typeof mapJobRecord>>>}
 */
export async function claimAsyncSideEffectJobs({ jobTypes = [], take = 10, workerId = "" } = {}) {
  const limit = Math.max(1, Math.min(Number.parseInt(String(take || 10), 10) || 10, 100))
  const normalizedJobTypes = Array.from(
    new Set((Array.isArray(jobTypes) ? jobTypes : []).map((entry) => normalizeJobType(entry)).filter(Boolean))
  )
  const normalizedWorkerId = normalizeText(workerId) || `worker-${process.pid}`
  const availableAt = new Date()
  const prisma = await getJobPrismaClient()

  if (!prisma) {
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
  const lastError = normalizeText(error?.message || error)
  const retryAt = retryDelayMs ? new Date(Date.now() + retryDelayMs) : null

  const prisma = await getJobPrismaClient()
  if (!prisma) {
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
