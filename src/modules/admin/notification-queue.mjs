// @ts-check
import crypto from "node:crypto"
import {
  ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL,
  enqueueAsyncSideEffectJob,
} from "../async/side-effect-jobs.mjs"
import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import { getConfiguredDatabaseUrlSync } from "./sis-config-store.mjs"
import {
  PARENT_REPORT_WORKFLOW_STATE_NOTIFICATION_QUEUED,
  PARENT_REPORT_WORKFLOW_STATE_NOTIFICATION_SENT,
  returnParentClassReportToAwaitingApproval,
} from "./parent-reports.mjs"
import { recordParentClassReportEvent } from "./parent-report-events.mjs"

/**
 * @typedef {{
 *   queueType?: unknown,
 *   deliveryMode?: unknown,
 *   status?: unknown,
 *   recipients?: unknown,
 *   assignmentTitle?: unknown,
 *   exerciseTitle?: unknown,
 *   dueAt?: unknown,
 *   level?: unknown,
 *   message?: unknown,
 *   senderName?: unknown,
 *   queuedByUsername?: unknown,
 *   reviewedByUsername?: unknown,
 *   scheduledFor?: unknown,
 *   sentAt?: unknown,
 *   attempts?: unknown,
 *   lastError?: unknown,
 *   payloadJson?: unknown,
 *   studentReviewedAt?: unknown,
 *   studentReviewedByUsername?: unknown,
 *   parentReviewedAt?: unknown,
 *   parentReviewedByUsername?: unknown,
 * }} QueueRecordLike
 *
 * @typedef {{
 *   queueType?: unknown,
 *   deliveryMode?: unknown,
 *   status?: unknown,
 *   recipients?: unknown,
 *   assignmentTitle?: unknown,
 *   exerciseTitle?: unknown,
 *   dueAt?: unknown,
 *   level?: unknown,
 *   message?: unknown,
 *   senderName?: unknown,
 *   queuedByUsername?: unknown,
 *   reviewedByUsername?: unknown,
 *   scheduledFor?: unknown,
 *   sentAt?: unknown,
 *   attempts?: unknown,
 *   lastError?: unknown,
 *   payloadJson?: unknown,
 *   studentReviewedAt?: unknown,
 *   studentReviewedByUsername?: unknown,
 *   parentReviewedAt?: unknown,
 *   parentReviewedByUsername?: unknown,
 * }} QueueUpdatePayload
 */

export { sendAnnouncementEmail } from "./announcement-email.mjs"

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase()
}

function normalizeUpper(value) {
  return normalizeText(value).toUpperCase()
}

function isEmailLike(value) {
  const text = normalizeText(value)
  if (!text) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
}

function normalizeRecipientList(value) {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .map((entry) => normalizeLower(entry))
        .filter((entry) => isEmailLike(entry))
    )
  )
}

const WEEKEND_BATCH_WINDOWS = Object.freeze([
  { day: 6, hour: 12, minute: 0, label: "Sat 12:00" },
  { day: 6, hour: 15, minute: 30, label: "Sat 15:30" },
  { day: 6, hour: 18, minute: 0, label: "Sat 18:00" },
  { day: 6, hour: 20, minute: 15, label: "Sat 20:15" },
  { day: 0, hour: 12, minute: 0, label: "Sun 12:00" },
  { day: 0, hour: 15, minute: 30, label: "Sun 15:30" },
  { day: 0, hour: 18, minute: 0, label: "Sun 18:00" },
  { day: 0, hour: 20, minute: 15, label: "Sun 20:15" },
])
export const NOTIFICATION_QUEUE_TYPE_PARENT_REPORT = "parent-report"
export const NOTIFICATION_QUEUE_TYPE_ANNOUNCEMENT = "announcement"
export const NOTIFICATION_QUEUE_STATUS_QUEUED = "queued"
export const NOTIFICATION_QUEUE_STATUS_HOLD = "hold"
export const NOTIFICATION_QUEUE_STATUS_SENT = "sent"
const EMAIL_QUEUE_BACKEND_MODE = (() => {
  const mode = normalizeLower(process.env.STUDENT_ADMIN_NOTIFY_QUEUE_BACKEND || "auto")
  if (mode === "database" || mode === "db" || mode === "postgres" || mode === "postgresql") return "database"
  if (mode === "memory" || mode === "in-memory") return "memory"
  return normalizeText(getConfiguredDatabaseUrlSync() || process.env.DATABASE_URL) ? "database" : "memory"
})()
const EMAIL_BATCH_QUEUE_LIMIT = Math.max(
  10,
  Number.parseInt(String(process.env.STUDENT_ADMIN_NOTIFY_BATCH_QUEUE_LIMIT || "4000"), 10) || 4000
)
const EMAIL_BATCH_QUEUE = []
let EMAIL_BATCH_LAST_RUN_AT = ""
let EMAIL_BATCH_LAST_RESULT = "idle"
let EMAIL_BATCH_LAST_ERROR = ""
let EMAIL_BATCH_LAST_KNOWN_SIZE = 0
let EMAIL_QUEUE_DB_DISABLED = EMAIL_QUEUE_BACKEND_MODE !== "database"
let EMAIL_QUEUE_DB_WARNED = false

function allowVolatileUnitTestStorage() {
  return normalizeLower(process.env.NODE_ENV) === "test"
}

function notificationPersistenceUnavailable() {
  const error = new Error("Notification queue persistence is unavailable")
  error.statusCode = 503
  return error
}

/**
 * @returns {string}
 */
export function nowIso() {
  return new Date().toISOString()
}

/**
 * @param {unknown} [prefix]
 * @returns {string}
 */
export function createQueueId(prefix = "notify") {
  const head = normalizeLower(prefix).replace(/[^a-z0-9]/g, "") || "notify"
  return `${head}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`
}

/**
 * @param {unknown} value
 * @returns {"parent-report" | "announcement"}
 */
export function normalizeQueueType(value) {
  const queueType = normalizeLower(value)
  if (queueType === NOTIFICATION_QUEUE_TYPE_PARENT_REPORT) return NOTIFICATION_QUEUE_TYPE_PARENT_REPORT
  return NOTIFICATION_QUEUE_TYPE_ANNOUNCEMENT
}

function normalizeQueueStatus(value) {
  const status = normalizeLower(value)
  if (status === NOTIFICATION_QUEUE_STATUS_HOLD) return NOTIFICATION_QUEUE_STATUS_HOLD
  if (status === NOTIFICATION_QUEUE_STATUS_SENT) return NOTIFICATION_QUEUE_STATUS_SENT
  return NOTIFICATION_QUEUE_STATUS_QUEUED
}

function weekendBatchScheduleLabel() {
  return WEEKEND_BATCH_WINDOWS.map((entry) => entry.label).join(", ")
}

const FIXED_TIME_ZONE_OFFSET_MINUTES = 7 * 60
const FIXED_TIME_ZONE_OFFSET_MS = FIXED_TIME_ZONE_OFFSET_MINUTES * 60 * 1000

/**
 * @param {Date} value
 * @returns {Date}
 */
export function shiftToFixedTimeZone(value) {
  return new Date(value.getTime() + FIXED_TIME_ZONE_OFFSET_MS)
}

/**
 * @param {Date} value
 * @returns {Date}
 */
export function shiftFromFixedTimeZone(value) {
  return new Date(value.getTime() - FIXED_TIME_ZONE_OFFSET_MS)
}

/**
 * @param {unknown} value
 * @returns {Date | null}
 */
export function parseIsoDateTime(value) {
  const text = normalizeText(value)
  if (!text) return null
  const parsed = new Date(text)
  if (Number.isNaN(parsed.valueOf())) return null
  return parsed
}

/**
 * @param {Date | string | number} [value]
 * @returns {Date | null}
 */
export function nextWeekendBatchDispatchAt(value = new Date()) {
  const now = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (Number.isNaN(now.valueOf())) return null
  const shiftedNow = shiftToFixedTimeZone(now)

  for (let offset = 0; offset < 14; offset += 1) {
    const dayStart = new Date(
      Date.UTC(
        shiftedNow.getUTCFullYear(),
        shiftedNow.getUTCMonth(),
        shiftedNow.getUTCDate() + offset,
        0,
        0,
        0,
        0
      )
    )
    const dayOfWeek = dayStart.getUTCDay()
    if (dayOfWeek !== 0 && dayOfWeek !== 6) continue

    for (let i = 0; i < WEEKEND_BATCH_WINDOWS.length; i += 1) {
      const slot = WEEKEND_BATCH_WINDOWS[i]
      if (slot.day !== dayOfWeek) continue
      const candidateShifted = new Date(
        Date.UTC(
          dayStart.getUTCFullYear(),
          dayStart.getUTCMonth(),
          dayStart.getUTCDate(),
          slot.hour,
          slot.minute,
          0,
          0
        )
      )
      const candidate = shiftFromFixedTimeZone(candidateShifted)
      if (candidate > now) return candidate
    }
  }

  return null
}

/**
 * @param {unknown} value
 * @returns {"immediate" | "weekend-batch"}
 */
export function normalizeDeliveryMode(value) {
  const mode = normalizeLower(value)
  if (mode === "weekend-batch" || mode === "batch") return "weekend-batch"
  return "immediate"
}

function normalizeAnnouncementPayload(payload = {}, options = {}) {
  const allowEmptyRecipients = Boolean(options.allowEmptyRecipients)
  const recipients = normalizeRecipientList(payload.recipients)
  if (!recipients.length && !allowEmptyRecipients) {
    const error = new Error("At least one valid recipient email is required")
    error.statusCode = 400
    throw error
  }

  return {
    recipients,
    assignmentTitle: normalizeText(payload.assignmentTitle) || "Cập nhật bài tập",
    exerciseTitle: normalizeText(payload.exerciseTitle),
    dueAt: normalizeText(payload.dueAt),
    level: normalizeText(payload.level),
    message: normalizeText(payload.message),
    senderName: normalizeText(payload.senderName) || "Eagles Student Admin",
  }
}

function parentReportSnapshotText(report = {}) {
  if (!report || typeof report !== "object") return ""
  const identity = report?.identity && typeof report.identity === "object" ? report.identity : {}
  const scope = report?.scope && typeof report.scope === "object" ? report.scope : {}
  const snapshot = report?.snapshot && typeof report.snapshot === "object" ? report.snapshot : {}
  const attendance = report?.attendance && typeof report.attendance === "object" ? report.attendance : {}
  const metrics = report?.metrics && typeof report.metrics === "object" ? report.metrics : {}
  const rubric = report?.rubric && typeof report.rubric === "object" ? report.rubric : {}
  const rubricRows = Array.isArray(rubric.rows) ? rubric.rows : []
  const lines = [
    "Report Card Snapshot",
    `Snapshot ID: ${normalizeText(snapshot.reportId) || "-"}`,
    `Snapshot source: ${normalizeText(snapshot.source) || "-"}`,
    `Captured at: ${normalizeText(snapshot.capturedAtDisplay || snapshot.capturedAt) || "-"}`,
    `Approved at: ${normalizeText(snapshot.approvedAtDisplay || snapshot.approvedAt) || "-"}`,
    `Student: ${normalizeText(identity.fullName) || "-"}`,
    `English name: ${normalizeText(identity.englishName) || "-"}`,
    `Eagles ID: ${normalizeText(identity.eaglesId) || "-"}`,
    `Student number: ${normalizeText(identity.studentNumber) || "-"}`,
    `Scope: ${[
      normalizeText(scope.className) || normalizeText(snapshot.className),
      normalizeText(scope.schoolYear) || normalizeText(snapshot.schoolYear),
      normalizeText(scope.quarter) || normalizeText(snapshot.quarter),
    ].filter(Boolean).join(" | ") || "-"}`,
    `Attendance: total=${normalizeText(attendance.total) || "-"} | absences=${normalizeText(attendance.absences) || "-"} | tardy=${normalizeText(attendance.tardy) || "-"} | percent=${normalizeText(attendance.percent || attendance.rate) || "-"}`,
    `Metrics: homework completion=${normalizeText(metrics.homeworkCompletionRate) || "-"} | homework on-time=${normalizeText(metrics.homeworkOnTimeRate) || "-"} | behavior=${normalizeText(metrics.behaviorScore) || "-"} | skills=${normalizeText(metrics.participationScore) || "-"} | academic=${normalizeText(metrics.inClassScore) || "-"} | participation points=${normalizeText(metrics.participationPointsAward) || "-"}`,
    `Teacher snapshot: teacher=${normalizeText(metrics.teacherName) || "-"} | lesson=${normalizeText(metrics.lessonSummary) || "-"} | vision=${normalizeText(metrics.visionStatus) || "-"} | comment=${normalizeText(metrics.teacherComment) || "-"}`,
  ]
  if (rubricRows.length) {
    lines.push("", "Rubric:")
    rubricRows.forEach((row, index) => {
      const prompt = normalizeText(row?.prompt || row?.metric || row?.title) || `Row ${index + 1}`
      const score = normalizeText(row?.resultScore || row?.observedResult || row?.result || row?.observed) || "-"
      const explanation = normalizeText(row?.resultExplanation || row?.detail || row?.summary || row?.interpretation)
      const recommendation = normalizeText(row?.recommendation || row?.actionNote || row?.action || row?.note) || "-"
      lines.push(
        `${index + 1}. ${prompt} | rating=${score}${explanation ? ` | meaning=${explanation}` : ""} | comment=${recommendation}`
      )
    })
  }
  return lines.filter(Boolean).join("\n")
}

function parentReportEmailBodyFromPayload(payload = {}) {
  const reportSnapshot =
    payload?.reportSnapshot && typeof payload.reportSnapshot === "object" ? payload.reportSnapshot : null
  if (!reportSnapshot) return ""
  return normalizeText(parentReportSnapshotText(reportSnapshot))
}

function normalizeQueueMessage(payload = {}, normalizedPayload = {}) {
  if (normalizeQueueType(payload.queueType) === NOTIFICATION_QUEUE_TYPE_PARENT_REPORT) {
    const reportCardBody = parentReportEmailBodyFromPayload(payload)
    if (reportCardBody) return reportCardBody
  }
  return normalizeText(normalizedPayload.message)
}

/**
 * @param {QueueRecordLike} [record]
 * @returns {{
 *   id: string,
 *   queueType: string,
 *   status: string,
 *   deliveryMode: string,
 *   recipients: Array<string>,
 *   assignmentTitle: string,
 *   exerciseTitle: string,
 *   dueAt: string,
 *   level: string,
 *   message: string,
 *   senderName: string,
 *   queuedByUsername: string,
 *   reviewedByUsername: string,
 *   queuedAt: string,
 *   scheduledFor: string,
 *   sentAt: string,
 *   attempts: number,
 *   lastError: string,
 *   payloadJson: Record<string, unknown> | null,
 *   studentReviewedAt: string,
 *   studentReviewedByUsername: string,
 *   parentReviewedAt: string,
 *   parentReviewedByUsername: string,
 * }}
 */
function mapQueueRecord(record = {}) {
  return {
    id: normalizeText(record.id),
    queueType: normalizeQueueType(record.queueType),
    status: normalizeQueueStatus(record.status),
    deliveryMode: normalizeDeliveryMode(record.deliveryMode),
    recipients: normalizeRecipientList(record.recipients),
    assignmentTitle: normalizeText(record.assignmentTitle) || "Cập nhật bài tập",
    exerciseTitle: normalizeText(record.exerciseTitle),
    dueAt: normalizeText(record.dueAt),
    level: normalizeText(record.level),
    message: normalizeText(record.message),
    senderName: normalizeText(record.senderName) || "Eagles Student Admin",
    queuedByUsername: normalizeText(record.queuedByUsername),
    reviewedByUsername: normalizeText(record.reviewedByUsername),
    queuedAt: normalizeText(record.queuedAt || record.createdAt),
    scheduledFor: normalizeText(record.scheduledFor),
    sentAt: normalizeText(record.sentAt),
    attempts: Number.parseInt(String(record.attempts || 0), 10) || 0,
    lastError: normalizeText(record.lastError),
    payloadJson: record.payloadJson || null,
    studentReviewedAt: normalizeText(record.studentReviewedAt || record?.payloadJson?.studentReviewedAt),
    studentReviewedByUsername: normalizeText(
      record.studentReviewedByUsername || record?.payloadJson?.studentReviewedByUsername
    ),
    parentReviewedAt: normalizeText(record.parentReviewedAt || record?.payloadJson?.parentReviewedAt),
    parentReviewedByUsername: normalizeText(
      record.parentReviewedByUsername || record?.payloadJson?.parentReviewedByUsername
    ),
  }
}

function queueStatusFilter(statuses = []) {
  const normalized = Array.from(
    new Set((Array.isArray(statuses) ? statuses : []).map((entry) => normalizeQueueStatus(entry)))
  )
  return normalized
}

async function getNotificationQueuePrismaClient() {
  if (EMAIL_QUEUE_DB_DISABLED) return null
  try {
    const prisma = await getSharedPrismaClient()
    if (!prisma || !prisma.adminNotificationQueue) {
      EMAIL_QUEUE_DB_DISABLED = true
      if (!EMAIL_QUEUE_DB_WARNED) {
        EMAIL_QUEUE_DB_WARNED = true
        console.warn("admin notification queue falling back to memory: prisma model unavailable")
      }
      return null
    }
    return prisma
  } catch (error) {
    EMAIL_QUEUE_DB_DISABLED = true
    if (!EMAIL_QUEUE_DB_WARNED) {
      EMAIL_QUEUE_DB_WARNED = true
      console.warn(`admin notification queue falling back to memory: ${error.message}`)
    }
    return null
  }
}

async function updateParentReportNotificationState(reportId = "", patch = {}) {
  const id = normalizeText(reportId)
  if (!id) return null
  try {
    const prisma = await getSharedPrismaClient()
    if (!prisma?.parentClassReport?.update) return null
    return await prisma.parentClassReport.update({
      where: { id },
      data: patch,
    })
  } catch (error) {
    void error
    return null
  }
}

function isQueueTableMissingError(error) {
  const code = normalizeUpper(error?.code)
  if (code === "P2021") return true
  const message = normalizeLower(error?.message || error)
  return message.includes("adminnotificationqueue")
}

function isQueueDatabaseAuthFailureError(error) {
  const code = normalizeUpper(error?.code)
  if (code === "P1000") return true
  const message = normalizeLower(error?.message || error)
  return (
    message.includes("authentication failed against the database server") ||
    message.includes("provided database credentials") ||
    message.includes("invalid `prisma.adminnotificationqueue.") ||
    message.includes("invalid `prisma.adminnotificationqueue`")
  )
}

function isUniqueConstraintError(error) {
  return normalizeUpper(error?.code) === "P2002"
}

function markQueueDatabaseFallback(error) {
  EMAIL_QUEUE_DB_DISABLED = true
  EMAIL_BATCH_LAST_ERROR = normalizeText(error?.message || error)
  if (!EMAIL_QUEUE_DB_WARNED) {
    EMAIL_QUEUE_DB_WARNED = true
    console.warn(`admin notification queue falling back to memory: ${EMAIL_BATCH_LAST_ERROR}`)
  }
}

async function runQueueDbOperation(handler, fallbackHandler) {
  const prisma = await getNotificationQueuePrismaClient()
  if (!prisma) {
    if (allowVolatileUnitTestStorage()) return fallbackHandler()
    throw notificationPersistenceUnavailable()
  }
  try {
    return await handler(prisma)
  } catch (error) {
    if (isQueueTableMissingError(error) || isQueueDatabaseAuthFailureError(error)) {
      if (allowVolatileUnitTestStorage()) {
        markQueueDatabaseFallback(error)
        return fallbackHandler()
      }
      throw notificationPersistenceUnavailable()
    }
    throw error
  }
}

function buildQueuedAnnouncementEntry(payload = {}, options = {}) {
  const queueType = normalizeQueueType(payload.queueType)
  const normalizedPayload = normalizeAnnouncementPayload(payload, {
    allowEmptyRecipients: queueType === NOTIFICATION_QUEUE_TYPE_PARENT_REPORT,
  })
  const now = new Date()
  const scheduledAt = nextWeekendBatchDispatchAt(now)
  if (!scheduledAt) {
    const error = new Error("Unable to compute next weekend batch time")
    error.statusCode = 503
    throw error
  }
  return {
    id: normalizeText(payload.queueId) || createQueueId("notify"),
    queueType,
    status: NOTIFICATION_QUEUE_STATUS_QUEUED,
    deliveryMode: normalizeDeliveryMode(payload.deliveryMode),
    recipients: normalizedPayload.recipients,
    assignmentTitle: normalizedPayload.assignmentTitle,
    exerciseTitle: normalizedPayload.exerciseTitle,
    level: normalizedPayload.level,
    dueAt: normalizedPayload.dueAt,
    message: normalizeQueueMessage(payload, normalizedPayload),
    senderName: normalizedPayload.senderName,
    queuedByUsername: normalizeText(options.queuedByUsername || payload.queuedByUsername),
    reviewedByUsername: "",
    queuedAt: now.toISOString(),
    scheduledFor: scheduledAt.toISOString(),
    sentAt: "",
    attempts: 0,
    lastError: "",
    payloadJson: payload && typeof payload === "object" ? payload : {},
  }
}

function memoryQueueFilteredItems({ queueType = "", includeSent = false, statuses = [] } = {}) {
  const normalizedQueueType = normalizeQueueType(queueType)
  const statusFilter = queueStatusFilter(statuses)
  return EMAIL_BATCH_QUEUE.filter((entry) => {
    if (queueType && normalizeQueueType(entry.queueType) !== normalizedQueueType) return false
    const status = normalizeQueueStatus(entry.status)
    if (statusFilter.length) return statusFilter.includes(status)
    if (!includeSent && status === NOTIFICATION_QUEUE_STATUS_SENT) return false
    return true
  })
}

async function countQueuedAnnouncements({ queueType = "", includeSent = false, statuses = [] } = {}) {
  return runQueueDbOperation(
    async (prisma) => {
      const where = {}
      if (queueType) where.queueType = normalizeQueueType(queueType)
      const statusFilter = queueStatusFilter(statuses)
      if (statusFilter.length) where.status = { in: statusFilter }
      else if (!includeSent) where.status = { not: NOTIFICATION_QUEUE_STATUS_SENT }
      return prisma.adminNotificationQueue.count({ where })
    },
    async () => memoryQueueFilteredItems({ queueType, includeSent, statuses }).length
  )
}

/**
 * @param {{ queueType?: unknown, take?: unknown, includeSent?: boolean, statuses?: Array<unknown> }} [options]
 * @returns {Promise<{
 *   total: number,
 *   items: Array<ReturnType<typeof mapQueueRecord>>,
 *   hasMore: boolean,
 * }>}
 */
export async function listQueuedAnnouncements({ queueType = "", take = 10, includeSent = false, statuses = [] } = {}) {
  const limit = Math.max(1, Math.min(Number.parseInt(String(take || 10), 10) || 10, 1000))
  const total = await countQueuedAnnouncements({ queueType, includeSent, statuses })
  const items = await runQueueDbOperation(
    async (prisma) => {
      const where = {}
      if (queueType) where.queueType = normalizeQueueType(queueType)
      const statusFilter = queueStatusFilter(statuses)
      if (statusFilter.length) where.status = { in: statusFilter }
      else if (!includeSent) where.status = { not: NOTIFICATION_QUEUE_STATUS_SENT }
      const rows = await prisma.adminNotificationQueue.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
      })
      return rows.map((row) =>
        mapQueueRecord({
          ...row,
          queuedAt: row.createdAt?.toISOString?.() || "",
          scheduledFor: row.scheduledFor?.toISOString?.() || "",
          sentAt: row.sentAt?.toISOString?.() || "",
        })
      )
    },
    async () =>
      memoryQueueFilteredItems({ queueType, includeSent, statuses })
        .slice()
        .sort((left, right) => normalizeText(right.queuedAt).localeCompare(normalizeText(left.queuedAt)))
        .slice(0, limit)
        .map((entry) => mapQueueRecord(entry))
  )

  EMAIL_BATCH_LAST_KNOWN_SIZE = total
  return {
    total,
    items,
    hasMore: total > items.length,
  }
}

/**
 * @param {QueueUpdatePayload} [payload]
 * @param {{ queuedByUsername?: unknown }} [options]
 * @returns {Promise<{
 *   ok: true,
 *   queued: true,
 *   deliveryMode: "weekend-batch",
 *   queueId: string,
 *   queuedAt: string,
 *   scheduledFor: string,
 *   queueSize: number,
 *   schedule: string,
 * }>}
 */
export async function queueAnnouncementEmail(payload = {}, options = {}) {
  const queueType = normalizeQueueType(payload.queueType)
  const reportId = normalizeText(payload?.reportId || payload?.parentReportId)
  const explicitQueueId = normalizeText(payload.queueId)
  if (queueType === NOTIFICATION_QUEUE_TYPE_PARENT_REPORT && reportId) {
    const prisma = await getSharedPrismaClient().catch(() => null)
    if (prisma?.parentClassReport?.findUnique) {
      const report = await prisma.parentClassReport.findUnique({ where: { id: reportId } })
      const workflowState = normalizeLower(report?.workflowState)
      if (
        workflowState !== "published"
        && workflowState !== "notification_queued"
        && workflowState !== "notification_sent"
      ) {
        const error = new Error("Performance report must be published before notification queueing")
        error.statusCode = 409
        throw error
      }
    }
  }
  if (explicitQueueId) {
    const existing = await runQueueDbOperation(
      async (prisma) => {
        let row = await prisma.adminNotificationQueue.findUnique({ where: { id: explicitQueueId } })
        if (row && ["failed", "error"].includes(normalizeLower(row.status))) {
          row = await prisma.adminNotificationQueue.update({
            where: { id: explicitQueueId },
            data: { status: NOTIFICATION_QUEUE_STATUS_QUEUED, lastError: null, sentAt: null },
          })
        }
        return row
          ? mapQueueRecord({
              ...row,
              queuedAt: row.createdAt?.toISOString?.() || "",
              scheduledFor: row.scheduledFor?.toISOString?.() || "",
              sentAt: row.sentAt?.toISOString?.() || "",
            })
          : null
      },
      async () => {
        const existing = EMAIL_BATCH_QUEUE.find((entry) => normalizeText(entry.id) === explicitQueueId)
        if (existing && ["failed", "error"].includes(normalizeLower(existing.status))) {
          existing.status = NOTIFICATION_QUEUE_STATUS_QUEUED
          existing.lastError = ""
          existing.sentAt = ""
        }
        return mapQueueRecord(existing || {})
      }
    )
    if (existing?.id) {
      EMAIL_BATCH_LAST_KNOWN_SIZE = await countQueuedAnnouncements()
      return {
        ok: true,
        queued: true,
        duplicate: true,
        deliveryMode: "weekend-batch",
        queueId: existing.id,
        queuedAt: existing.queuedAt,
        scheduledFor: existing.scheduledFor,
        queueSize: EMAIL_BATCH_LAST_KNOWN_SIZE,
        schedule: weekendBatchScheduleLabel(),
      }
    }
  }

  const totalUnsent = await countQueuedAnnouncements()
  if (totalUnsent >= EMAIL_BATCH_QUEUE_LIMIT) {
    const error = new Error("Weekend email batch queue is full")
    error.statusCode = 503
    throw error
  }

  const entry = buildQueuedAnnouncementEntry(payload, options)
  const saved = await runQueueDbOperation(
    async (prisma) => {
      try {
        const created = await prisma.adminNotificationQueue.create({
          data: {
            id: entry.id,
            queueType: entry.queueType,
            status: entry.status,
            deliveryMode: entry.deliveryMode,
            recipients: entry.recipients,
            assignmentTitle: entry.assignmentTitle,
            exerciseTitle: entry.exerciseTitle || null,
            level: entry.level || null,
            dueAt: entry.dueAt || null,
            message: entry.message || null,
            senderName: entry.senderName || null,
            queuedByUsername: entry.queuedByUsername || null,
            reviewedByUsername: null,
            scheduledFor: parseIsoDateTime(entry.scheduledFor),
            sentAt: null,
            attempts: 0,
            lastError: null,
            payloadJson: entry.payloadJson || null,
          },
        })
        return mapQueueRecord({
          ...created,
          queuedAt: created.createdAt?.toISOString?.() || entry.queuedAt,
          scheduledFor: created.scheduledFor?.toISOString?.() || entry.scheduledFor,
        })
      } catch (error) {
        if (!explicitQueueId || !isUniqueConstraintError(error)) throw error
        const existing = await prisma.adminNotificationQueue.findUnique({ where: { id: explicitQueueId } })
        if (!existing) throw error
        return mapQueueRecord({
          ...existing,
          queuedAt: existing.createdAt?.toISOString?.() || entry.queuedAt,
          scheduledFor: existing.scheduledFor?.toISOString?.() || entry.scheduledFor,
          sentAt: existing.sentAt?.toISOString?.() || "",
        })
      }
    },
    async () => {
      const existing = EMAIL_BATCH_QUEUE.find((queued) => normalizeText(queued.id) === entry.id)
      if (existing) return mapQueueRecord(existing)
      EMAIL_BATCH_QUEUE.push(entry)
      return mapQueueRecord(entry)
    }
  )
  EMAIL_BATCH_LAST_KNOWN_SIZE = totalUnsent + 1
  if (queueType === NOTIFICATION_QUEUE_TYPE_PARENT_REPORT && reportId) {
    await updateParentReportNotificationState(reportId, {
      workflowState: PARENT_REPORT_WORKFLOW_STATE_NOTIFICATION_QUEUED,
      notificationQueuedAt: new Date(),
    })
    await recordParentClassReportEvent({
      reportId,
      artifactVersion: Number.parseInt(String(payload?.artifactVersion || 0), 10) || 0,
      eventType: "notification_queued",
      actorType: "system",
      actorId: normalizeText(options?.queuedByUsername || payload?.queuedByUsername || "system"),
      channel: "email",
      metadata: {
        queueId: saved.id,
        recipientCount: Array.isArray(payload?.recipients) ? payload.recipients.length : 0,
      },
    })
  }

  return {
    ok: true,
    queued: true,
    deliveryMode: "weekend-batch",
    queueId: saved.id,
    queuedAt: saved.queuedAt,
    scheduledFor: saved.scheduledFor,
    queueSize: EMAIL_BATCH_LAST_KNOWN_SIZE,
    schedule: weekendBatchScheduleLabel(),
  }
}

/**
 * @param {unknown} queueType
 * @returns {Promise<{
 *   queueSize: number,
 *   nextScheduledFor: string,
 *   schedule: string,
 *   backend: string,
 *   lastRunAt: string,
 *   lastResult: string,
 *   lastError: string,
 *   processing: boolean,
 * }>}
 */
export async function getEmailBatchQueueStatus(queueType = "") {
  const listed = await listQueuedAnnouncements({
    queueType,
    take: 500,
    includeSent: false,
  })
  const nextScheduledFor = listed.items.reduce((earliest, entry) => {
    const candidate = parseIsoDateTime(entry.scheduledFor)
    if (!candidate) return earliest
    if (!earliest || candidate < earliest) return candidate
    return earliest
  }, null)

  return {
    queueSize: listed.total,
    nextScheduledFor: nextScheduledFor ? nextScheduledFor.toISOString() : "",
    schedule: weekendBatchScheduleLabel(),
    backend: EMAIL_QUEUE_DB_DISABLED ? "memory" : EMAIL_QUEUE_BACKEND_MODE,
    lastRunAt: EMAIL_BATCH_LAST_RUN_AT,
    lastResult: EMAIL_BATCH_LAST_RESULT,
    lastError: EMAIL_BATCH_LAST_ERROR,
    processing: false,
  }
}

/**
 * @returns {{
 *   queueSize: number,
 *   nextScheduledFor: string,
 *   schedule: string,
 *   backend: string,
 *   lastRunAt: string,
 *   lastResult: string,
 *   lastError: string,
 *   processing: boolean,
 * }}
 */
export function getEmailBatchQueueRuntimeStatus() {
  return {
    queueSize: EMAIL_BATCH_LAST_KNOWN_SIZE,
    nextScheduledFor: "",
    schedule: weekendBatchScheduleLabel(),
    backend: EMAIL_QUEUE_DB_DISABLED ? "memory" : EMAIL_QUEUE_BACKEND_MODE,
    lastRunAt: EMAIL_BATCH_LAST_RUN_AT,
    lastResult: EMAIL_BATCH_LAST_RESULT,
    lastError: EMAIL_BATCH_LAST_ERROR,
    processing: false,
  }
}

/**
 * @param {unknown} queueId
 * @param {QueueUpdatePayload} [updates]
 * @param {{ reviewedByUsername?: unknown }} [options]
 * @returns {Promise<ReturnType<typeof mapQueueRecord>>}
 */
export async function updateQueuedAnnouncement(queueId, updates = {}, options = {}) {
  const id = normalizeText(queueId)
  if (!id) {
    const error = new Error("queueId is required")
    error.statusCode = 400
    throw error
  }
  const normalized = {
    status: updates.status !== undefined ? normalizeQueueStatus(updates.status) : undefined,
    assignmentTitle:
      updates.assignmentTitle !== undefined
        ? normalizeText(updates.assignmentTitle) || "Cập nhật bài tập"
        : undefined,
    exerciseTitle: updates.exerciseTitle !== undefined ? normalizeText(updates.exerciseTitle) : undefined,
    level: updates.level !== undefined ? normalizeText(updates.level) : undefined,
    dueAt: updates.dueAt !== undefined ? normalizeText(updates.dueAt) : undefined,
    message: updates.message !== undefined ? normalizeText(updates.message) : undefined,
    recipients: updates.recipients !== undefined ? normalizeRecipientList(updates.recipients) : undefined,
    reviewedByUsername:
      updates.reviewedByUsername !== undefined
        ? normalizeText(updates.reviewedByUsername)
        : normalizeText(options.reviewedByUsername),
    scheduledFor: updates.scheduledFor !== undefined ? parseIsoDateTime(updates.scheduledFor) : undefined,
    lastError: updates.lastError !== undefined ? normalizeText(updates.lastError) : undefined,
    sentAt: updates.sentAt !== undefined ? parseIsoDateTime(updates.sentAt) : undefined,
    attempts:
      updates.attempts !== undefined ? Number.parseInt(String(updates.attempts), 10) || 0 : undefined,
    studentReviewedAt:
      updates.studentReviewedAt !== undefined ? parseIsoDateTime(updates.studentReviewedAt) : undefined,
    studentReviewedByUsername:
      updates.studentReviewedByUsername !== undefined ? normalizeText(updates.studentReviewedByUsername) : undefined,
    parentReviewedAt:
      updates.parentReviewedAt !== undefined ? parseIsoDateTime(updates.parentReviewedAt) : undefined,
    parentReviewedByUsername:
      updates.parentReviewedByUsername !== undefined ? normalizeText(updates.parentReviewedByUsername) : undefined,
    payloadJson: updates.payloadJson && typeof updates.payloadJson === "object" ? updates.payloadJson : undefined,
  }

  return runQueueDbOperation(
    async (prisma) => {
      const patch = {}
      const existing = await prisma.adminNotificationQueue.findUnique({ where: { id } })
      const existingPayload =
        existing?.payloadJson && typeof existing.payloadJson === "object" ? existing.payloadJson : {}
      if (normalized.status !== undefined) patch.status = normalized.status
      if (normalized.assignmentTitle !== undefined) patch.assignmentTitle = normalized.assignmentTitle
      if (normalized.exerciseTitle !== undefined) patch.exerciseTitle = normalized.exerciseTitle || null
      if (normalized.level !== undefined) patch.level = normalized.level || null
      if (normalized.dueAt !== undefined) patch.dueAt = normalized.dueAt || null
      if (normalized.message !== undefined) patch.message = normalized.message || null
      if (normalized.recipients !== undefined) patch.recipients = normalized.recipients
      if (normalized.reviewedByUsername !== undefined) patch.reviewedByUsername = normalized.reviewedByUsername || null
      if (normalized.scheduledFor !== undefined) patch.scheduledFor = normalized.scheduledFor
      if (normalized.lastError !== undefined) patch.lastError = normalized.lastError || null
      if (normalized.sentAt !== undefined) patch.sentAt = normalized.sentAt
      if (normalized.attempts !== undefined) patch.attempts = normalized.attempts
      if (normalized.studentReviewedAt !== undefined) patch.studentReviewedAt = normalized.studentReviewedAt
      if (normalized.studentReviewedByUsername !== undefined)
        patch.studentReviewedByUsername = normalized.studentReviewedByUsername || null
      if (normalized.parentReviewedAt !== undefined) patch.parentReviewedAt = normalized.parentReviewedAt
      if (normalized.parentReviewedByUsername !== undefined)
        patch.parentReviewedByUsername = normalized.parentReviewedByUsername || null
      const payloadPatch = {}
      if (normalized.studentReviewedAt !== undefined)
        payloadPatch.studentReviewedAt = normalized.studentReviewedAt?.toISOString?.() || ""
      if (normalized.studentReviewedByUsername !== undefined)
        payloadPatch.studentReviewedByUsername = normalized.studentReviewedByUsername || ""
      if (normalized.parentReviewedAt !== undefined)
        payloadPatch.parentReviewedAt = normalized.parentReviewedAt?.toISOString?.() || ""
      if (normalized.parentReviewedByUsername !== undefined)
        payloadPatch.parentReviewedByUsername = normalized.parentReviewedByUsername || ""
      if (normalized.payloadJson !== undefined) Object.assign(payloadPatch, normalized.payloadJson)
      if (Object.keys(payloadPatch).length) patch.payloadJson = { ...existingPayload, ...payloadPatch }
      const updated = await prisma.adminNotificationQueue.update({
        where: { id },
        data: patch,
      })
      return mapQueueRecord({
        ...updated,
        queuedAt: updated.createdAt?.toISOString?.() || "",
        scheduledFor: updated.scheduledFor?.toISOString?.() || "",
        sentAt: updated.sentAt?.toISOString?.() || "",
      })
    },
    async () => {
      const index = EMAIL_BATCH_QUEUE.findIndex((entry) => normalizeText(entry.id) === id)
      if (index < 0) {
        const error = new Error("Queue item not found")
        error.statusCode = 404
        throw error
      }
      const current = mapQueueRecord(EMAIL_BATCH_QUEUE[index])
      const payload = { ...(current.payloadJson || {}) }
      const updated = {
        ...current,
        ...(normalized.status !== undefined ? { status: normalized.status } : {}),
        ...(normalized.assignmentTitle !== undefined ? { assignmentTitle: normalized.assignmentTitle } : {}),
        ...(normalized.exerciseTitle !== undefined ? { exerciseTitle: normalized.exerciseTitle } : {}),
        ...(normalized.level !== undefined ? { level: normalized.level } : {}),
        ...(normalized.dueAt !== undefined ? { dueAt: normalized.dueAt } : {}),
        ...(normalized.message !== undefined ? { message: normalized.message } : {}),
        ...(normalized.recipients !== undefined ? { recipients: normalized.recipients } : {}),
        ...(normalized.reviewedByUsername !== undefined ? { reviewedByUsername: normalized.reviewedByUsername } : {}),
        ...(normalized.scheduledFor !== undefined
          ? { scheduledFor: normalized.scheduledFor ? normalized.scheduledFor.toISOString() : "" }
          : {}),
        ...(normalized.lastError !== undefined ? { lastError: normalized.lastError } : {}),
        ...(normalized.sentAt !== undefined
          ? { sentAt: normalized.sentAt ? normalized.sentAt.toISOString() : "" }
          : {}),
        ...(normalized.attempts !== undefined ? { attempts: normalized.attempts } : {}),
        ...(normalized.studentReviewedAt !== undefined ? { studentReviewedAt: normalized.studentReviewedAt } : {}),
        ...(normalized.studentReviewedByUsername !== undefined
          ? { studentReviewedByUsername: normalized.studentReviewedByUsername }
          : {}),
        ...(normalized.parentReviewedAt !== undefined ? { parentReviewedAt: normalized.parentReviewedAt } : {}),
        ...(normalized.parentReviewedByUsername !== undefined
          ? { parentReviewedByUsername: normalized.parentReviewedByUsername }
          : {}),
      }
      if (normalized.studentReviewedAt !== undefined) payload.studentReviewedAt = normalized.studentReviewedAt
      if (normalized.studentReviewedByUsername !== undefined)
        payload.studentReviewedByUsername = normalized.studentReviewedByUsername
      if (normalized.parentReviewedAt !== undefined)
        payload.parentReviewedAt = normalized.parentReviewedAt
          ? normalized.parentReviewedAt.toISOString?.() || normalized.parentReviewedAt
          : ""
      if (normalized.parentReviewedByUsername !== undefined)
        payload.parentReviewedByUsername = normalized.parentReviewedByUsername
      if (normalized.payloadJson !== undefined) Object.assign(payload, normalized.payloadJson)
      updated.payloadJson = payload
      EMAIL_BATCH_QUEUE[index] = updated
      return mapQueueRecord(updated)
    }
  )
}

/**
 * @param {unknown} queueId
 * @returns {Promise<{ deleted: true, id: string }>}
 */
export async function deleteQueuedAnnouncement(queueId) {
  const id = normalizeText(queueId)
  if (!id) {
    const error = new Error("queueId is required")
    error.statusCode = 400
    throw error
  }

  return runQueueDbOperation(
    async (prisma) => {
      const existing = await prisma.adminNotificationQueue.findUnique({ where: { id } })
      if (!existing) {
        const error = new Error("Queue item not found")
        error.statusCode = 404
        throw error
      }
      await prisma.adminNotificationQueue.delete({ where: { id } })
      return { deleted: true, id }
    },
    async () => {
      const index = EMAIL_BATCH_QUEUE.findIndex((entry) => normalizeText(entry.id) === id)
      if (index < 0) {
        const error = new Error("Queue item not found")
        error.statusCode = 404
        throw error
      }
      EMAIL_BATCH_QUEUE.splice(index, 1)
      return { deleted: true, id }
    }
  )
}

/**
 * @param {unknown} queueId
 * @param {{ returnedByUsername?: unknown }} [options]
 * @returns {Promise<{ deleted: true, id: string, report: Record<string, unknown> | null }>}
 */
export async function unqueueQueuedAnnouncement(queueId, options = {}) {
  const id = normalizeText(queueId)
  if (!id) {
    const error = new Error("queueId is required")
    error.statusCode = 400
    throw error
  }

  return runQueueDbOperation(
    async (prisma) => {
      const existing = await prisma.adminNotificationQueue.findUnique({ where: { id } })
      if (!existing) {
        const error = new Error("Queue item not found")
        error.statusCode = 404
        throw error
      }
      const reportId = normalizeText(existing.reportId || existing?.payloadJson?.reportId)
      let report = null
      if (reportId && normalizeQueueType(existing.queueType) === NOTIFICATION_QUEUE_TYPE_PARENT_REPORT) {
        report = await returnParentClassReportToAwaitingApproval(reportId, {
          returnedByUsername: options.returnedByUsername,
        })
      }
      await prisma.adminNotificationQueue.delete({ where: { id } })
      return { deleted: true, id, report }
    },
    async () => {
      const index = EMAIL_BATCH_QUEUE.findIndex((entry) => normalizeText(entry.id) === id)
      if (index < 0) {
        const error = new Error("Queue item not found")
        error.statusCode = 404
        throw error
      }
      const existing = mapQueueRecord(EMAIL_BATCH_QUEUE[index])
      const reportId = normalizeText(existing.reportId || existing?.payloadJson?.reportId)
      let report = null
      if (reportId && normalizeQueueType(existing.queueType) === NOTIFICATION_QUEUE_TYPE_PARENT_REPORT) {
        report = await returnParentClassReportToAwaitingApproval(reportId, {
          returnedByUsername: options.returnedByUsername,
        })
      }
      EMAIL_BATCH_QUEUE.splice(index, 1)
      return { deleted: true, id, report }
    }
  )
}

/**
 * @param {{ queueType?: unknown, reviewedByUsername?: unknown }} [options]
 * @returns {Promise<{
 *   ok: true,
 *   queueType: string,
 *   processed: number,
 *   sent: number,
 *   failed: number,
 *   queued?: number,
 * }>}
 */
export async function sendAllQueuedAnnouncements({ queueType = "", reviewedByUsername = "", queueIds = null } = {}) {
  const queueIdsProvided = Array.isArray(queueIds)
  const selectedQueueIds = Array.from(
    new Set(
      (queueIdsProvided ? queueIds : [])
        .map((entry) => normalizeText(entry))
        .filter(Boolean)
    )
  )
  const source = await listQueuedAnnouncements({
    queueType: queueType || NOTIFICATION_QUEUE_TYPE_PARENT_REPORT,
    includeSent: false,
    statuses: [NOTIFICATION_QUEUE_STATUS_QUEUED],
    take: 1000,
  })
  const filteredItems = queueIdsProvided ?
    source.items.filter((item) => selectedQueueIds.includes(normalizeText(item.id)))
    : source.items

  if (!filteredItems.length) {
    EMAIL_BATCH_LAST_RUN_AT = nowIso()
    EMAIL_BATCH_LAST_RESULT = "manual-send sent=0 failed=0"
    EMAIL_BATCH_LAST_ERROR = ""
    return {
      ok: true,
      queueType: queueType || NOTIFICATION_QUEUE_TYPE_PARENT_REPORT,
      processed: 0,
      sent: 0,
      failed: 0,
    }
  }

  for (let i = 0; i < filteredItems.length; i += 1) {
    const item = filteredItems[i]
    await enqueueAsyncSideEffectJob(
      ASYNC_SIDE_EFFECT_JOB_TYPE_ANNOUNCEMENT_EMAIL,
      {
        queueId: item.id,
        queueType: normalizeQueueType(item.queueType),
        reviewedByUsername: normalizeText(reviewedByUsername),
        participationPointsAward: item?.payloadJson?.participationPointsAward,
        reportId: normalizeText(item?.payloadJson?.reportId || item?.reportId),
        reportSnapshot:
          item?.payloadJson?.reportSnapshot && typeof item.payloadJson.reportSnapshot === "object"
            ? item.payloadJson.reportSnapshot
            : null,
        announcementPayload: {
          queueId: item.id,
          recipients: item.recipients,
          assignmentTitle: item.assignmentTitle,
          exerciseTitle: item.exerciseTitle,
          dueAt: item.dueAt,
          level: item.level,
          message:
            normalizeQueueType(item.queueType) === NOTIFICATION_QUEUE_TYPE_PARENT_REPORT
              ? parentReportEmailBodyFromPayload(item?.payloadJson || {}) || item.message
              : item.message,
          senderName: item.senderName,
          requestOrigin: normalizeText(item?.payloadJson?.requestOrigin),
          reminderEngagementToken: normalizeText(item?.payloadJson?.reminderEngagementToken),
          libraryAssignmentToken: normalizeText(item?.payloadJson?.libraryAssignmentToken),
        },
      },
      { dedupeKey: item.id }
    )
  }

  EMAIL_BATCH_LAST_RUN_AT = nowIso()
  EMAIL_BATCH_LAST_RESULT = `manual-send queued=${filteredItems.length}`
  EMAIL_BATCH_LAST_ERROR = ""

  return {
    ok: true,
    queueType: queueType || NOTIFICATION_QUEUE_TYPE_PARENT_REPORT,
    processed: filteredItems.length,
    sent: 0,
    failed: 0,
    queued: filteredItems.length,
  }
}
