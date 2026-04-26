// @ts-check

import { drainAsyncSideEffectJobs } from "../src/modules/async/side-effect-worker.mjs"
import {
  ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL,
  ASYNC_SIDE_EFFECT_JOB_TYPE_REPORT_CARD_PDF,
} from "../src/modules/async/side-effect-jobs.mjs"
import { updateQueuedAnnouncement, nowIso } from "../src/modules/admin/notification-queue.mjs"
import path from "node:path"
import process from "node:process"
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
        lastError: normalizeText(failure?.message || failure),
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
    jobTypes: [ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL, ASYNC_SIDE_EFFECT_JOB_TYPE_REPORT_CARD_PDF],
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
        console.warn(`[async-side-effects] job ${job.id} failed: ${normalizeText(error?.message || error)}`)
      }
      void failure
    },
  })
}

export async function startAsyncSideEffectsWorker() {
  const pollIntervalMs = resolvePollIntervalMs()
  const once = shouldRunOnce()
  const run = async () => {
    const result = await runWorkerOnce()
    if (result.claimed || result.succeeded || result.failed) {
      console.log(
        `[async-side-effects] claimed=${result.claimed} succeeded=${result.succeeded} failed=${result.failed}`
      )
    }
    return result
  }

  await run()
  if (once) return { stop() {} }

  const timer = setInterval(() => {
    run().catch((error) => {
      console.error(`[async-side-effects] worker loop failed: ${normalizeText(error?.message || error)}`)
    })
  }, pollIntervalMs)
  if (typeof timer.unref === "function") timer.unref()

  return {
    stop() {
      clearInterval(timer)
    },
  }
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (invokedDirectly) {
  startAsyncSideEffectsWorker().catch((error) => {
    console.error(`[async-side-effects] worker start failed: ${normalizeText(error?.message || error)}`)
    process.exitCode = 1
  })
}
