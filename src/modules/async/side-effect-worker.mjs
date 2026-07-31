// @ts-check

import fs from "node:fs/promises"
import path from "node:path"
import {
  ASYNC_SIDE_EFFECT_JOB_STATUS_QUEUED,
  ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL,
  ASYNC_SIDE_EFFECT_JOB_TYPE_REPORT_CARD_PDF,
  ASYNC_SIDE_EFFECT_JOB_TYPE_PARENT_PROFILE_INVITATION,
  claimAsyncSideEffectJobs,
  completeAsyncSideEffectJob,
  failAsyncSideEffectJob,
} from "./side-effect-jobs.mjs"
import { sendAnnouncementEmail } from "../admin/announcement-email.mjs"
import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import { PARENT_REPORT_WORKFLOW_STATE_NOTIFICATION_SENT } from "../admin/parent-reports.mjs"
import { recordParentClassReportEvent } from "../admin/parent-report-events.mjs"
import {
  buildReportCardFilename,
  generateStudentReportCardPdf,
} from "../../../server/student-report-card-pdf.mjs"
import { markAssignmentReminderEngagementSent } from "../admin/assignment-reminder-dispatcher.mjs"
import { processParentProfileInvitationJob } from "../admin/parent-profile-invitations.mjs"

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

/**
 * @param {Record<string, unknown> | null | undefined} value
 * @returns {Record<string, unknown>}
 */
function normalizePayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return { ...value }
}

/**
 * @param {Record<string, unknown> | null | undefined} value
 * @returns {Record<string, unknown>}
 */
function normalizeFilters(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return { ...value }
}

/**
 * @param {Record<string, unknown> | null | undefined} job
 * @returns {Record<string, unknown>}
 */
function resolveAnnouncementPayload(job) {
  const payload = normalizePayload(job?.payloadJson)
  if (payload.announcementPayload && typeof payload.announcementPayload === "object") {
    return { ...payload.announcementPayload }
  }
  if (payload.emailPayload && typeof payload.emailPayload === "object") {
    return { ...payload.emailPayload }
  }
  return payload
}

/**
 * @param {Record<string, unknown>} [job]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function processAnnouncementEmailSideEffectJob(job = {}) {
  const payload = normalizePayload(job.payloadJson)
  const announcementPayload = resolveAnnouncementPayload(job)
  const result = await sendAnnouncementEmail(announcementPayload)
  const queueType = normalizeText(payload.queueType || announcementPayload.queueType || "")
  const reportId = normalizeText(payload.reportId || payload.parentReportId)
  if (normalizeText(payload.queueId)) {
    await markAssignmentReminderEngagementSent(normalizeText(payload.queueId), true)
  }
  if (queueType === "parent-report" && reportId) {
    try {
      const prisma = await getSharedPrismaClient()
      if (prisma?.parentClassReport?.update) {
        await prisma.parentClassReport.update({
          where: { id: reportId },
          data: {
            workflowState: PARENT_REPORT_WORKFLOW_STATE_NOTIFICATION_SENT,
            notificationSentAt: new Date(),
          },
        })
      }
      await recordParentClassReportEvent({
        reportId,
        artifactVersion: Number.parseInt(String(payload.artifactVersion || 0), 10) || 0,
        eventType: "notification_sent",
        actorType: "system",
        actorId: "worker",
        channel: "email",
        metadata: {
          queueId: normalizeText(payload.queueId || job.id),
          sent: Number.parseInt(String(result.sent || 0), 10) || 0,
          subject: normalizeText(result.subject),
        },
      })
    } catch (error) {
      void error
    }
  }

  return {
    ok: true,
    queueType,
    queueId: normalizeText(payload.queueId || job.id),
    reportId,
    sent: Number.parseInt(String(result.sent || 0), 10) || 0,
    subject: normalizeText(result.subject),
    deliveryMode: normalizeText(result.deliveryMode || "immediate"),
  }
}

/**
 * @param {Record<string, unknown>} [job]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function processReportCardPdfSideEffectJob(job = {}) {
  const payload = normalizePayload(job.payloadJson)
  const student = payload.student || {}
  const filters = normalizeFilters(payload.filters)
  const buffer = await generateStudentReportCardPdf(student, filters)
  const filename = normalizeText(payload.filename) || buildReportCardFilename(student, filters)
  const outputPath = normalizeText(payload.outputPath)
  let resolvedOutputPath = ""

  if (outputPath) {
    resolvedOutputPath = outputPath
  } else if (normalizeText(payload.outputDir)) {
    resolvedOutputPath = path.join(normalizeText(payload.outputDir), filename)
  }

  if (resolvedOutputPath) {
    await fs.mkdir(path.dirname(resolvedOutputPath), { recursive: true })
    await fs.writeFile(resolvedOutputPath, buffer)
  }

  return {
    ok: true,
    filename,
    bytes: buffer.length,
    outputPath: resolvedOutputPath,
  }
}

export async function processParentProfileInvitationSideEffectJob(job = {}) {
  return processParentProfileInvitationJob(job)
}

/**
 * @param {Record<string, unknown>} [job]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function processAsyncSideEffectJob(job = {}) {
  const jobType = normalizeText(job.jobType)
  if (jobType === ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL) {
    return processAnnouncementEmailSideEffectJob(job)
  }
  if (jobType === ASYNC_SIDE_EFFECT_JOB_TYPE_REPORT_CARD_PDF) {
    return processReportCardPdfSideEffectJob(job)
  }
  if (jobType === ASYNC_SIDE_EFFECT_JOB_TYPE_PARENT_PROFILE_INVITATION) {
    return processParentProfileInvitationSideEffectJob(job)
  }

  const error = new Error(`Unsupported async side effect job type: ${jobType || "(missing)"}`)
  error.statusCode = 400
  throw error
}

/**
 * @param {{
 *   jobTypes?: string[],
 *   take?: number,
 *   workerId?: string,
 *   maxAttempts?: number,
 *   retryDelayMs?: number,
 *   onJobComplete?: ((job: Record<string, unknown>, result: Record<string, unknown>, completed: Record<string, unknown>) => unknown) | null,
 *   onJobFailed?: ((job: Record<string, unknown>, error: unknown, updated: Record<string, unknown>) => unknown) | null,
 * }} [options]
 * @returns {Promise<{
 *   claimed: number,
 *   succeeded: number,
 *   failed: number,
 *   remaining: number,
 *   processing: number,
 * }>}
 */
export async function drainAsyncSideEffectJobs({
  jobTypes = [],
  take = 10,
  workerId = "",
  maxAttempts = 3,
  retryDelayMs = 0,
  onJobComplete = null,
  onJobFailed = null,
} = {}) {
  const claimed = await claimAsyncSideEffectJobs({
    jobTypes,
    take,
    workerId,
  })
  let succeeded = 0
  let failed = 0

  for (let i = 0; i < claimed.length; i += 1) {
    const job = claimed[i]
    try {
      const result = await processAsyncSideEffectJob(job)
      const completed = await completeAsyncSideEffectJob(job.id, result)
      if (typeof onJobComplete === "function") {
        await onJobComplete(job, result, completed)
      }
      succeeded += 1
    } catch (error) {
      const updated = await failAsyncSideEffectJob(job.id, error, { maxAttempts, retryDelayMs })
      if (typeof onJobFailed === "function") {
        await onJobFailed(job, error, updated)
      }
      failed += 1
    }
  }

  return {
    claimed: claimed.length,
    succeeded,
    failed,
    remaining: Math.max(0, claimed.length - succeeded - failed),
    processing: claimed.filter((entry) => entry.status === ASYNC_SIDE_EFFECT_JOB_STATUS_QUEUED).length,
  }
}
