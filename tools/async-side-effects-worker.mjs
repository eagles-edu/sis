// @ts-check

import { drainAsyncSideEffectJobs } from "../src/modules/async/side-effect-worker.mjs"
import {
  ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL,
  ASYNC_SIDE_EFFECT_JOB_TYPE_PARENT_PROFILE_INVITATION,
  ASYNC_SIDE_EFFECT_JOB_TYPE_REPORT_CARD_PDF,
} from "../src/modules/async/side-effect-jobs.mjs"
import { updateQueuedAnnouncement, nowIso } from "../src/modules/admin/notification-queue.mjs"
import { markAssignmentReminderEngagementSent } from "../src/modules/admin/assignment-reminder-dispatcher.mjs"
import path from "node:path"
import process from "node:process"
import fs from "node:fs"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function normalizeErrorMessage(error) {
  if (error instanceof Error) return normalizeText(error.message)
  return normalizeText(error)
}

/**
 * @returns {string}
 */
function resolveWorkerId() {
  return normalizeText(process.env.ASYNC_SIDE_EFFECTS_WORKER_ID) || `side-effects-${process.pid}`
}

/**
 * @returns {number}
 */
function resolvePollIntervalMs() {
  const raw = Number.parseInt(String(process.env.ASYNC_SIDE_EFFECTS_WORKER_POLL_MS || "5000"), 10)
  return Number.isFinite(raw) && raw >= 500 ? raw : 5000
}

/**
 * @returns {number}
 */
function resolveTake() {
  const raw = Number.parseInt(String(process.env.ASYNC_SIDE_EFFECTS_WORKER_TAKE || "10"), 10)
  return Number.isFinite(raw) && raw >= 1 ? raw : 10
}

/**
 * @returns {string[]}
 */
function resolveJobTypes() {
  const configured = normalizeText(process.env.ASYNC_SIDE_EFFECTS_WORKER_JOB_TYPES)
  if (!configured) {
    return [
      ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL,
      ASYNC_SIDE_EFFECT_JOB_TYPE_REPORT_CARD_PDF,
      ASYNC_SIDE_EFFECT_JOB_TYPE_PARENT_PROFILE_INVITATION,
    ]
  }
  return configured
    .split(/[\s,]+/u)
    .map((value) => normalizeText(value))
    .filter(Boolean)
}

let lastSuccessfulPollTimestamp = 0

export function resolveWorkerMonitoringEnvironment(environment = process.env) {
  if (
    environment.NODE_ENV === "development" &&
    environment.SIS_ENV_FILE === ".env.dev" &&
    environment.DOTENV_CONFIG_PATH === ".env.dev"
  ) return "dev"
  if (
    environment.NODE_ENV === "test" &&
    environment.SIS_ENV_FILE === ".env.test" &&
    environment.DOTENV_CONFIG_PATH === ".env.test"
  ) return "test"
  return ""
}

export function renderWorkerHeartbeat({ environmentLabel, success, checkedAt = Date.now() / 1000, lastSuccessfulPollTimestamp = 0 } = {}) {
  if (!["dev", "test"].includes(environmentLabel)) throw new Error("Worker heartbeat requires an explicit dev or test environment")
  const safeNumber = (value) => (Number.isFinite(value) && value >= 0 ? value.toFixed(6) : "0")
  const result = success ? 1 : 0
  return [
    "# HELP sis_async_side_effects_worker_last_poll_timestamp_seconds Unix timestamp of the last completed worker poll.",
    "# TYPE sis_async_side_effects_worker_last_poll_timestamp_seconds gauge",
    `sis_async_side_effects_worker_last_poll_timestamp_seconds{environment=\"${environmentLabel}\"} ${safeNumber(checkedAt)}`,
    "# HELP sis_async_side_effects_worker_last_poll_success Whether the latest worker poll completed successfully.",
    "# TYPE sis_async_side_effects_worker_last_poll_success gauge",
    `sis_async_side_effects_worker_last_poll_success{environment=\"${environmentLabel}\"} ${result}`,
    "# HELP sis_async_side_effects_worker_last_success_timestamp_seconds Unix timestamp of the last successful worker poll.",
    "# TYPE sis_async_side_effects_worker_last_success_timestamp_seconds gauge",
    `sis_async_side_effects_worker_last_success_timestamp_seconds{environment=\"${environmentLabel}\"} ${safeNumber(lastSuccessfulPollTimestamp)}`,
    "",
  ].join("\n")
}

function writeWorkerHeartbeat({ success, checkedAt = Date.now() / 1000 } = {}) {
  const environmentLabel = resolveWorkerMonitoringEnvironment()
  if (!environmentLabel) return
  const metricsFile = normalizeText(process.env.ASYNC_SIDE_EFFECTS_WORKER_METRICS_FILE) || path.join(
    process.cwd(),
    "runtime-data/prometheus",
    `async-side-effects-worker-${environmentLabel}.prom`,
  )
  const directory = path.dirname(metricsFile)
  if (success) lastSuccessfulPollTimestamp = checkedAt
  const contents = renderWorkerHeartbeat({ environmentLabel, success, checkedAt, lastSuccessfulPollTimestamp })
  fs.mkdirSync(directory, { recursive: true, mode: 0o750 })
  const temporaryFile = `${metricsFile}.${process.pid}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporaryFile, contents, { encoding: "utf8", flag: "wx", mode: 0o644 })
    fs.renameSync(temporaryFile, metricsFile)
  } catch (error) {
    fs.rmSync(temporaryFile, { force: true })
    throw error
  }
}

/**
 * @returns {boolean}
 */
function shouldRunOnce() {
  return String(process.env.ASYNC_SIDE_EFFECTS_WORKER_ONCE || "").trim().toLowerCase() === "true"
}

/**
 * @param {Record<string, unknown>} job
 * @param {Record<string, unknown> | null} result
 * @param {unknown} [failure]
 * @returns {Promise<void>}
 */
async function updateAnnouncementQueueItem(job, result, failure = null) {
  const payload = job?.payloadJson && typeof job.payloadJson === "object" ? /** @type {Record<string, unknown>} */ (job.payloadJson) : {}
  const queueId = normalizeText(payload.queueId)
  if (!queueId) return
  if (failure) {
    await updateQueuedAnnouncement(
      queueId,
      {
        status: "queued",
        lastError: normalizeErrorMessage(failure),
        attempts: (Number.parseInt(String(job.attempts || 0), 10) || 0),
      },
      {
        reviewedByUsername: normalizeText(payload.reviewedByUsername),
      }
    )
    return
  }

  await updateQueuedAnnouncement(
    queueId,
    {
      status: "sent",
      sentAt: nowIso(),
      lastError: "",
      attempts: (Number.parseInt(String(job.attempts || 0), 10) || 0),
    },
      {
        reviewedByUsername: normalizeText(payload.reviewedByUsername),
      }
    )
  void result
  if (queueId) {
    await markAssignmentReminderEngagementSent(queueId, true)
  }
}

/**
 * @returns {Promise<{
 *   claimed: number,
 *   succeeded: number,
 *   failed: number,
 *   remaining: number,
 *   processing: number,
 * }>}
 */
async function runWorkerOnce() {
  return drainAsyncSideEffectJobs({
    workerId: resolveWorkerId(),
    take: resolveTake(),
    jobTypes: resolveJobTypes(),
    maxAttempts: 3,
    retryDelayMs: 30 * 1000,
    onJobComplete: async (job, result) => {
      if (job.jobType === ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL) {
        await updateAnnouncementQueueItem(job, result, null)
      }
      if (job.jobType === ASYNC_SIDE_EFFECT_JOB_TYPE_REPORT_CARD_PDF) {
        console.log(
          `[async-side-effects] generated ${result.filename || "report-card.pdf"} (${result.bytes || 0} bytes)`
        )
      }
    },
    onJobFailed: async (job, error, failure) => {
      if (job.jobType === ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL) {
        await updateAnnouncementQueueItem(job, null, error)
      } else {
        console.warn(`[async-side-effects] job ${job.id} failed: ${normalizeErrorMessage(error)}`)
      }
      void failure
    },
  })
}

export async function startAsyncSideEffectsWorker() {
  const pollIntervalMs = resolvePollIntervalMs()
  const once = shouldRunOnce()
  const run = async () => {
    try {
      const result = await runWorkerOnce()
      writeWorkerHeartbeat({ success: true })
      if (result.claimed || result.succeeded || result.failed) {
        console.log(
          `[async-side-effects] claimed=${result.claimed} succeeded=${result.succeeded} failed=${result.failed}`
        )
      }
      return result
    } catch (error) {
      writeWorkerHeartbeat({ success: false })
      throw error
    }
  }

  await run()
  if (once) return { stop() {} }

  const timer = setInterval(() => {
    run().catch((error) => {
      console.error(`[async-side-effects] worker loop failed: ${normalizeErrorMessage(error)}`)
    })
  }, pollIntervalMs)

  return {
    stop() {
      clearInterval(timer)
    },
  }
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (invokedDirectly) {
  startAsyncSideEffectsWorker().catch((error) => {
    console.error(`[async-side-effects] worker start failed: ${normalizeErrorMessage(error)}`)
    process.exitCode = 1
  })
}
