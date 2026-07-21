// src/modules/admin/parent-reports.mjs
// @ts-check

import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import { resolveEnrollmentPeriodForStudent } from "./enrollment-periods.mjs"
import { buildStudentReportCardPayload } from "../../../server/student-report-card-pdf.mjs"
import { recordParentClassReportEvent } from "./parent-report-events.mjs"
import { canonicalizeLevel as canonicalizeCatalogLevel } from "./level-catalog.mjs"
import { getSisConfigSnapshotSync } from "./sis-config-store.mjs"
import { courseWeekNumberForSchoolSetupDate } from "./course-week-calendar.mjs"

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeLower(value) {
  return normalizeText(value).toLowerCase()
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeNullableText(value) {
  const text = normalizeText(value)
  return text || null
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function normalizeInteger(value) {
  const text = normalizeText(value)
  if (!text) return null
  const parsed = Number.parseInt(text, 10)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function normalizeFloat(value) {
  if (value === undefined || value === null || value === "") return null
  const parsed = Number.parseFloat(String(value))
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * @param {unknown} value
 * @returns {Date | null}
 */
function normalizeDate(value) {
  const text = normalizeText(value)
  if (!text) return null
  const parsed = new Date(text)
  if (Number.isNaN(parsed.valueOf())) return null
  return parsed
}

/**
 * @param {unknown} value
 * @returns {Date | null}
 */
function parseDateOrNull(value) {
  if (value instanceof Date) return Number.isNaN(value.valueOf()) ? null : value
  return normalizeDate(value)
}

/**
 * @param {unknown[]} values
 * @returns {number | null}
 */
function average(values) {
  const numeric = values.filter((entry) => Number.isFinite(entry))
  if (!numeric.length) return null
  const total = numeric.reduce((sum, entry) => sum + entry, 0)
  return Number((total / numeric.length).toFixed(2))
}

/**
 * @param {number} numerator
 * @param {number} denominator
 * @returns {number | null}
 */
function percentage(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null
  return Number(((numerator / denominator) * 100).toFixed(2))
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeQuarter(value) {
  const text = normalizeLower(value)
  if (!text) return null
  if (["q1", "1", "quarter1", "quarter-1"].includes(text)) return "q1"
  if (["q2", "2", "quarter2", "quarter-2"].includes(text)) return "q2"
  if (["q3", "3", "quarter3", "quarter-3"].includes(text)) return "q3"
  if (["q4", "4", "quarter4", "quarter-4"].includes(text)) return "q4"
  return null
}

/**
 * @param {boolean} condition
 * @param {number} status
 * @param {string} message
 * @returns {true}
 */
function assertWithStatus(condition, status, message) {
  if (condition) return true
  /** @type {Error & { statusCode?: number }} */
  const error = new Error(message)
  error.statusCode = status
  throw error
}

export const PARENT_REPORT_WORKFLOW_STATE_DRAFT = "draft_pr"
export const PARENT_REPORT_WORKFLOW_STATE_SUBMITTED = "submitted_for_admin_review"
export const PARENT_REPORT_WORKFLOW_STATE_INCOMING = "incoming_admin_review"
export const PARENT_REPORT_WORKFLOW_STATE_AWAITING_APPROVAL = "awaiting_admin_approval"
export const PARENT_REPORT_WORKFLOW_STATE_APPROVED_FINAL = "approved_final"
export const PARENT_REPORT_WORKFLOW_STATE_PUBLISHED = "published"
export const PARENT_REPORT_WORKFLOW_STATE_NOTIFICATION_QUEUED = "notification_queued"
export const PARENT_REPORT_WORKFLOW_STATE_NOTIFICATION_SENT = "notification_sent"

const PARENT_REPORT_IMMUTABLE_WORKFLOW_STATES = new Set([
  PARENT_REPORT_WORKFLOW_STATE_PUBLISHED,
  PARENT_REPORT_WORKFLOW_STATE_NOTIFICATION_QUEUED,
  PARENT_REPORT_WORKFLOW_STATE_NOTIFICATION_SENT,
])

const PARENT_REPORT_REQUEUEABLE_WORKFLOW_STATES = new Set([
  PARENT_REPORT_WORKFLOW_STATE_APPROVED_FINAL,
  PARENT_REPORT_WORKFLOW_STATE_PUBLISHED,
  PARENT_REPORT_WORKFLOW_STATE_NOTIFICATION_QUEUED,
  PARENT_REPORT_WORKFLOW_STATE_NOTIFICATION_SENT,
])

const PARENT_REPORT_VISIBLE_WORKFLOW_STATES = new Set([
  PARENT_REPORT_WORKFLOW_STATE_PUBLISHED,
  PARENT_REPORT_WORKFLOW_STATE_NOTIFICATION_QUEUED,
  PARENT_REPORT_WORKFLOW_STATE_NOTIFICATION_SENT,
])

export function normalizeParentReportWorkflowState(value) {
  const normalized = normalizeLower(value)
  if (normalized === PARENT_REPORT_WORKFLOW_STATE_SUBMITTED) return PARENT_REPORT_WORKFLOW_STATE_SUBMITTED
  if (normalized === PARENT_REPORT_WORKFLOW_STATE_INCOMING) return PARENT_REPORT_WORKFLOW_STATE_INCOMING
  if (normalized === PARENT_REPORT_WORKFLOW_STATE_AWAITING_APPROVAL)
    return PARENT_REPORT_WORKFLOW_STATE_AWAITING_APPROVAL
  if (normalized === PARENT_REPORT_WORKFLOW_STATE_APPROVED_FINAL)
    return PARENT_REPORT_WORKFLOW_STATE_APPROVED_FINAL
  if (normalized === PARENT_REPORT_WORKFLOW_STATE_PUBLISHED) return PARENT_REPORT_WORKFLOW_STATE_PUBLISHED
  if (normalized === PARENT_REPORT_WORKFLOW_STATE_NOTIFICATION_QUEUED)
    return PARENT_REPORT_WORKFLOW_STATE_NOTIFICATION_QUEUED
  if (normalized === PARENT_REPORT_WORKFLOW_STATE_NOTIFICATION_SENT)
    return PARENT_REPORT_WORKFLOW_STATE_NOTIFICATION_SENT
  return PARENT_REPORT_WORKFLOW_STATE_DRAFT
}

export function isParentReportPortalVisible(record = null) {
  if (parseDateOrNull(record?.approvedAt)) return true
  return PARENT_REPORT_VISIBLE_WORKFLOW_STATES.has(
    normalizeParentReportWorkflowState(record?.workflowState)
  )
}

const LEVEL_DEFINITIONS = [
  {
    canonical: "Eggs & Chicks",
    aliases: ["EggChic", "Eggs and Chicks", "Eggs Chicks"],
  },
  {
    canonical: "Pre-A1 Starters",
    aliases: ["Starters", "Pre A1 Starters"],
  },
  {
    canonical: "A1 Movers",
    aliases: ["Movers"],
  },
  {
    canonical: "A2 Flyers",
    aliases: ["Flyers"],
  },
  {
    canonical: "A2 KET",
    aliases: ["KET"],
  },
  {
    canonical: "B1 PET",
    aliases: ["PET"],
  },
  {
    canonical: "B2+ IELTS",
    aliases: ["IELTS", "B2 IELTS"],
  },
  {
    canonical: "C1+ TAYK",
    aliases: ["TAYK", "C1 TAYK"],
  },
  {
    canonical: "Private",
    aliases: ["Private Class", "1:1 Private"],
  },
]

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeLevelKey(value) {
  return normalizeLower(value).replace(/[^a-z0-9]/g, "")
}

const LEVEL_ALIAS_MAP = (() => {
  /** @type {Map<string, string>} */
  const map = new Map()
  LEVEL_DEFINITIONS.forEach((entry) => {
    const variants = [entry.canonical, ...(entry.aliases || [])]
    variants.forEach((variant) => {
      const key = normalizeLevelKey(variant)
      if (key) map.set(key, entry.canonical)
    })
  })
  return map
})()

const PARENT_REPORT_DIGITAL_SKILL_MIN_LEVEL = "A2 Flyers"
const PARENT_REPORT_DIGITAL_SKILL_BLOCKED_KEYS = new Set([
  "pt_skill_internationalNews",
  "pt_skill_readingEnglishEnjoyment",
  "pt_skill_vocabularyLookup",
  "pt_rec_internationalNews",
  "pt_rec_readingEnglishEnjoyment",
  "pt_rec_vocabularyLookup",
])
const PARENT_REPORT_RUBRIC_MARKER_RE = /\[\[SIS-RUBRIC-V1:([A-Za-z0-9_-]+)\]\]\s*$/
const PARENT_REPORT_BUNDLE_MARKER_RE = /\[\[SIS-REPORT-BUNDLE-V2:([A-Za-z0-9_-]+)\]\]\s*$/
const PARENT_REPORT_VISION_STATUS_ALLOWED = new Set(["no-issues", "needs-check", "monitor"])
const PARENT_REPORT_PARTICIPATION_POINTS_MAX = 32

/**
 * @param {unknown} value
 * @returns {string}
 */
function canonicalizeLevel(value) {
  return canonicalizeCatalogLevel(value)
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function knownLevelIndex(value) {
  const canonical = canonicalizeLevel(value)
  return LEVEL_DEFINITIONS.findIndex(
    (entry) => normalizeLower(entry.canonical) === normalizeLower(canonical)
  )
}

/**
 * @param {unknown} [levelName]
 * @returns {boolean}
 */
function shouldRestrictParentReportDigitalSkills(levelName = "") {
  const currentIndex = knownLevelIndex(levelName)
  const minimumIndex = knownLevelIndex(PARENT_REPORT_DIGITAL_SKILL_MIN_LEVEL)
  if (currentIndex < 0 || minimumIndex < 0) return false
  return currentIndex < minimumIndex
}

export function normalizeReportParticipationPoints(value) {
  const parsed = normalizeInteger(value)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, Math.min(PARENT_REPORT_PARTICIPATION_POINTS_MAX, parsed))
}

/**
 * @param {Record<string, unknown> | null | undefined} [value]
 * @param {string} [requiredPrefix]
 * @param {Set<string> | null} [blockedKeys]
 * @returns {Record<string, string>}
 */
function normalizeParentReportScoreMap(value = {}, requiredPrefix = "", blockedKeys = null) {
  if (!value || typeof value !== "object") return {}
  return Object.entries(value).reduce((acc, [key, rawValue]) => {
    const normalizedKey = normalizeText(key)
    if (!normalizedKey.startsWith(requiredPrefix)) return acc
    if (blockedKeys instanceof Set && blockedKeys.has(normalizedKey)) return acc
    const parsed = Number.parseFloat(String(rawValue))
    if (!Number.isFinite(parsed)) return acc
    const clamped = Math.max(0, Math.min(5, Math.round(parsed)))
    acc[normalizedKey] = String(clamped)
    return acc
  }, {})
}

/**
 * @param {Record<string, unknown> | null | undefined} [value]
 * @param {Set<string> | null} [blockedKeys]
 * @returns {Record<string, string>}
 */
function normalizeParentReportRecommendationMap(value = {}, blockedKeys = null) {
  if (!value || typeof value !== "object") return {}
  return Object.entries(value).reduce((acc, [key, rawValue]) => {
    const normalizedKey = normalizeText(key)
    if (!normalizedKey.startsWith("pt_rec_")) return acc
    if (blockedKeys instanceof Set && blockedKeys.has(normalizedKey)) return acc
    const normalizedValue = normalizeText(rawValue)
    if (!normalizedValue) return acc
    acc[normalizedKey] = normalizedValue
    return acc
  }, {})
}

/**
 * @param {Record<string, unknown> | null | undefined} [value]
 * @param {{ level?: string, className?: string }} [options]
 * @returns {{
 *   skillScores: Record<string, string>,
 *   conductScores: Record<string, string>,
 *   recommendations: Record<string, string>,
 * } | null}
 */
export function normalizeParentReportRubricPayload(value = {}, options = {}) {
  if (!value || typeof value !== "object") return null
  const currentLevel = canonicalizeLevel(options?.level || options?.className || "")
  const blockedKeys = shouldRestrictParentReportDigitalSkills(currentLevel)
    ? PARENT_REPORT_DIGITAL_SKILL_BLOCKED_KEYS
    : null
  const skillScores = normalizeParentReportScoreMap(value.skillScores, "pt_skill_", blockedKeys)
  const conductScores = normalizeParentReportScoreMap(value.conductScores, "pt_conduct_", blockedKeys)
  const recommendations = normalizeParentReportRecommendationMap(value.recommendations, blockedKeys)
  if (!Object.keys(skillScores).length && !Object.keys(conductScores).length && !Object.keys(recommendations).length) {
    return null
  }
  return {
    skillScores,
    conductScores,
    recommendations,
  }
}

/**
 * @param {unknown} [value]
 * @returns {string | null}
 */
function normalizeParentReportVisionStatus(value = "") {
  const normalized = normalizeText(value)
  return PARENT_REPORT_VISION_STATUS_ALLOWED.has(normalized) ? normalized : null
}

/**
 * @param {Record<string, unknown> | null | undefined} [value]
 * @returns {Record<string, unknown> | null}
 */
function normalizeParentReportMetaPayload(value = {}) {
  if (!value || typeof value !== "object") return null
  const pastDueHomeworkCountValue =
    value.pastDueHomeworkCount !== undefined && value.pastDueHomeworkCount !== null
      ? value.pastDueHomeworkCount
      : value.overdueHomeworkCount
  const parsedPastDueHomeworkCount = Number.parseInt(String(pastDueHomeworkCountValue), 10)
  const normalizedRecipients = Array.isArray(value.recipients)
    ? value.recipients.map((entry) => normalizeText(entry)).filter(Boolean)
    : []
  const normalizedOutstandingAssignments = (Array.isArray(value.outstandingAssignments) ? value.outstandingAssignments : [])
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null
      const assignmentName = normalizeNullableText(entry.assignmentName)
      const dueAt = normalizeNullableText(entry.dueAt)
      if (!assignmentName && !dueAt) return null
      return {
        assignmentName,
        dueAt,
        className: normalizeNullableText(entry.className),
        quarter: normalizeNullableText(entry.quarter),
        deepLink: normalizeNullableText(entry.deepLink),
      }
    })
    .filter(Boolean)
  const normalized = {
    classDate: normalizeNullableText(value.classDate),
    classDay: normalizeNullableText(value.classDay),
    teacherName: normalizeNullableText(value.teacherName),
    lessonSummary: normalizeNullableText(value.lessonSummary),
    visionStatus: normalizeParentReportVisionStatus(value.visionStatus),
    homeworkAnnouncement: normalizeNullableText(value.homeworkAnnouncement),
    currentHomeworkStatus: normalizeNullableText(value.currentHomeworkStatus),
    currentHomeworkHeader: normalizeNullableText(value.currentHomeworkHeader),
    currentHomeworkSummary: normalizeNullableText(value.currentHomeworkSummary),
    pastDueHomeworkCount:
      Number.isFinite(parsedPastDueHomeworkCount) && parsedPastDueHomeworkCount >= 0
        ? String(parsedPastDueHomeworkCount)
        : null,
    pastDueHomeworkSummary: normalizeNullableText(value.pastDueHomeworkSummary),
    recipients: normalizedRecipients,
    outstandingAssignments: normalizedOutstandingAssignments,
  }
  if (
    !Object.entries(normalized).some(([key, entry]) => {
      if (key === "recipients" || key === "outstandingAssignments") {
        return Array.isArray(entry) && entry.length > 0
      }
      return entry !== null
    })
  ) {
    return null
  }
  return normalized
}

/**
 * @param {string} [value]
 * @returns {{
 *   comment: string | null,
 *   rubricPayload: {
 *     skillScores: Record<string, string>,
 *     conductScores: Record<string, string>,
 *     recommendations: Record<string, string>,
 *   } | null,
 *   metaPayload: Record<string, unknown> | null,
 * }}
 */
export function decodeLegacyParentReportCommentBundle(value = "") {
  const rawText = normalizeText(value)
  if (!rawText) return { comment: null, rubricPayload: null, metaPayload: null }

  const bundleMatch = rawText.match(PARENT_REPORT_BUNDLE_MARKER_RE)
  if (bundleMatch?.[1]) {
    let rubricPayload = null
    let metaPayload = null
    try {
      const decodedJson = Buffer.from(bundleMatch[1], "base64url").toString("utf8")
      const parsedPayload = JSON.parse(decodedJson)
      if (parsedPayload && typeof parsedPayload === "object") {
        rubricPayload = normalizeParentReportRubricPayload(parsedPayload.rubricPayload)
        metaPayload = normalizeParentReportMetaPayload(
          parsedPayload.metaPayload && typeof parsedPayload.metaPayload === "object"
            ? parsedPayload.metaPayload
            : parsedPayload.metadataPayload
        )
      }
    } catch {
      rubricPayload = null
      metaPayload = null
    }

    const commentOnlyText = normalizeNullableText(rawText.replace(PARENT_REPORT_BUNDLE_MARKER_RE, "").trimEnd())
    return {
      comment: commentOnlyText,
      rubricPayload,
      metaPayload,
    }
  }

  const markerMatch = rawText.match(PARENT_REPORT_RUBRIC_MARKER_RE)
  if (!markerMatch?.[1]) return { comment: normalizeNullableText(rawText), rubricPayload: null, metaPayload: null }

  let rubricPayload
  try {
    const decodedJson = Buffer.from(markerMatch[1], "base64url").toString("utf8")
    const parsedPayload = JSON.parse(decodedJson)
    rubricPayload = normalizeParentReportRubricPayload(parsedPayload)
  } catch {
    rubricPayload = null
  }

  const commentOnlyText = normalizeNullableText(rawText.replace(PARENT_REPORT_RUBRIC_MARKER_RE, "").trimEnd())
  return {
    comment: commentOnlyText,
    rubricPayload,
    metaPayload: null,
  }
}

/**
 * @param {Record<string, unknown> | null | undefined} report
 * @returns {Record<string, unknown> | null | undefined}
 */
export function mapParentClassReport(report) {
  if (!report) return report
  const decoded = decodeLegacyParentReportCommentBundle(report.comments)
  const rubricPayload =
    report?.rubricPayload && typeof report.rubricPayload === "object"
      ? normalizeParentReportRubricPayload(report.rubricPayload)
      : decoded.rubricPayload
  const metaPayload =
    report?.metaPayload && typeof report.metaPayload === "object"
      ? normalizeParentReportMetaPayload(report.metaPayload)
      : decoded.metaPayload && typeof decoded.metaPayload === "object"
        ? decoded.metaPayload
        : null
  return {
    ...report,
    className: canonicalizeLevel(report?.className),
    level: canonicalizeLevel(report?.level),
    enrollmentPeriodId: normalizeText(report?.enrollmentPeriodId),
    workflowState: normalizeParentReportWorkflowState(report?.workflowState),
    submittedAt: parseDateOrNull(report?.submittedAt)?.toISOString?.() || normalizeText(report?.submittedAt),
    submittedByUsername: normalizeText(report?.submittedByUsername),
    adminReviewStartedAt:
      parseDateOrNull(report?.adminReviewStartedAt)?.toISOString?.() || normalizeText(report?.adminReviewStartedAt),
    adminReviewStartedByUsername: normalizeText(report?.adminReviewStartedByUsername),
    rcDraftedAt: parseDateOrNull(report?.rcDraftedAt)?.toISOString?.() || normalizeText(report?.rcDraftedAt),
    rcDraftedByUsername: normalizeText(report?.rcDraftedByUsername),
    publishedAt: parseDateOrNull(report?.publishedAt)?.toISOString?.() || normalizeText(report?.publishedAt),
    notificationQueuedAt:
      parseDateOrNull(report?.notificationQueuedAt)?.toISOString?.()
      || normalizeText(report?.notificationQueuedAt),
    notificationSentAt:
      parseDateOrNull(report?.notificationSentAt)?.toISOString?.() || normalizeText(report?.notificationSentAt),
    finalArtifactVersion: normalizeInteger(report?.finalArtifactVersion) || 0,
    finalArtifactFrozenAt:
      parseDateOrNull(report?.finalArtifactFrozenAt)?.toISOString?.() || normalizeText(report?.finalArtifactFrozenAt),
    finalArtifactPayload:
      report?.finalArtifactPayload && typeof report.finalArtifactPayload === "object"
        ? report.finalArtifactPayload
        : null,
    comments: normalizeNullableText(decoded.comment ?? report?.comments),
    rubricPayload,
    metaPayload,
    ...(metaPayload || {}),
  }
}

/**
 * @param {unknown} error
 * @param {string} [argumentName]
 * @returns {boolean}
 */
function isUnknownPrismaArgumentError(error, argumentName = "") {
  const message = normalizeLower(error?.message || error)
  const normalizedArgument = normalizeLower(argumentName)
  return message.includes("unknown argument") && message.includes(`\`${normalizedArgument}\``)
}

/**
 * @param {unknown} error
 * @param {string} [fieldName]
 * @returns {boolean}
 */
function isUnknownPrismaFieldError(error, fieldName = "") {
  const message = normalizeLower(error?.message || error)
  const normalizedField = normalizeLower(fieldName)
  return message.includes("unknown field") && message.includes(`\`${normalizedField}\``)
}

/**
 * @param {unknown} error
 * @param {string} [columnName]
 * @returns {boolean}
 */
function isMissingPrismaColumnError(error, columnName = "") {
  const message = normalizeLower(error?.message || error)
  const normalizedColumn = normalizeLower(columnName)
  if (!normalizedColumn) return false
  return message.includes("column") && message.includes(normalizedColumn) && message.includes("does not exist")
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isLegacyParentReportApprovedAtSchemaError(error) {
  return (
    isUnknownPrismaArgumentError(error, "approvedAt")
    || isUnknownPrismaFieldError(error, "approvedAt")
  )
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isLegacyParentReportParticipationPointsSchemaError(error) {
  return (
    isUnknownPrismaArgumentError(error, "participationPointsAward")
    || isUnknownPrismaFieldError(error, "participationPointsAward")
    || isMissingPrismaColumnError(error, "participationPointsAward")
  )
}

/**
 * @param {Record<string, unknown> | null | undefined} [data]
 * @returns {Record<string, unknown>}
 */
function stripLegacyParentReportFields(data = {}) {
  if (!data || typeof data !== "object") return {}
  const next = { ...data }
  delete next.participationPointsAward
  return next
}

/**
 * @returns {Promise<import("@prisma/client").PrismaClient>}
 */
async function getPrismaClient() {
  return getSharedPrismaClient()
}

function isApprovedReportRecord(record = null) {
  return Boolean(parseDateOrNull(record?.approvedAt))
}

function isImmutableParentReportRecord(record = null) {
  return PARENT_REPORT_IMMUTABLE_WORKFLOW_STATES.has(
    normalizeParentReportWorkflowState(record?.workflowState)
  )
}

function parentReportLifecycleActor(username = "") {
  return normalizeText(username) || "system"
}

/**
 * @param {string} studentRefId
 * @param {Record<string, unknown>} [payload]
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function saveParentClassReport(studentRefId, payload = {}) {
  const prisma = await getPrismaClient()
  const studentRef = normalizeText(studentRefId)
  assertWithStatus(Boolean(studentRef), 400, "studentRefId is required")

  const className = canonicalizeLevel(payload.className)
  const schoolYear = normalizeText(payload.schoolYear)
  const quarter = normalizeQuarter(payload.quarter)

  assertWithStatus(Boolean(className), 400, "className is required")
  assertWithStatus(Boolean(schoolYear), 400, "schoolYear is required")
  assertWithStatus(Boolean(quarter), 400, "quarter is required")

  const normalizedRubricPayload = normalizeParentReportRubricPayload(payload.rubricPayload, {
    level: payload.level,
    className,
  })
  const normalizedMetaPayload = normalizeParentReportMetaPayload(
    payload.metaPayload && typeof payload.metaPayload === "object"
      ? payload.metaPayload
      : {
          classDate: payload.classDate,
          classDay: payload.classDay,
          teacherName: payload.teacherName,
          lessonSummary: payload.lessonSummary,
          visionStatus: payload.visionStatus,
          homeworkAnnouncement: payload.homeworkAnnouncement,
          currentHomeworkStatus: payload.currentHomeworkStatus,
          currentHomeworkHeader: payload.currentHomeworkHeader,
          currentHomeworkSummary: payload.currentHomeworkSummary,
          pastDueHomeworkCount: payload.pastDueHomeworkCount,
          pastDueHomeworkSummary: payload.pastDueHomeworkSummary,
          recipients: payload.recipients,
          outstandingAssignments: payload.outstandingAssignments,
        }
  )
  const participationPointsAward = normalizeReportParticipationPoints(payload.participationPointsAward)
  const reportDateForWeek = normalizeText(normalizedMetaPayload?.classDate) || normalizeText(payload.generatedAt)
  const configuredSchoolSetup = getSisConfigSnapshotSync()?.uiSettings?.schoolSetup || {}
  const reportData = {
    className,
    level: normalizeNullableText(canonicalizeLevel(payload.level)),
    schoolYear,
    quarter,
    weekNumber: courseWeekNumberForSchoolSetupDate(reportDateForWeek, schoolYear, configuredSchoolSetup),
    enrollmentPeriodId: normalizeNullableText(payload.enrollmentPeriodId),
    homeworkCompletionRate: normalizeFloat(payload.homeworkCompletionRate),
    homeworkOnTimeRate: normalizeFloat(payload.homeworkOnTimeRate),
    behaviorScore: normalizeFloat(payload.behaviorScore),
    participationScore: normalizeFloat(payload.participationScore),
    inClassScore: normalizeFloat(payload.inClassScore),
    participationPointsAward,
    comments: normalizeNullableText(payload.comments),
    rubricPayload: normalizedRubricPayload,
    metaPayload: normalizedMetaPayload,
    generatedAt: normalizeDate(payload.generatedAt) || new Date(),
  }
  const requestedWorkflowState = normalizeParentReportWorkflowState(payload.workflowState)
  const reportId = normalizeText(payload.id)

  if (reportId) {
    const existing = await prisma.parentClassReport.findUnique({ where: { id: reportId } })
    assertWithStatus(Boolean(existing), 404, "Parent report not found")
    assertWithStatus(existing.studentRefId === studentRef, 403, "Parent report does not belong to student")
    assertWithStatus(!isImmutableParentReportRecord(existing), 409, "Published parent reports are immutable")
    if (normalizeLower(payload.updatedByRole) === "teacher") {
      assertWithStatus(
        normalizeParentReportWorkflowState(existing.workflowState) === PARENT_REPORT_WORKFLOW_STATE_DRAFT,
        409,
        "Submitted parent reports are read-only for teachers"
      )
    }
    if (!reportData.enrollmentPeriodId) {
      reportData.enrollmentPeriodId = normalizeNullableText(existing.enrollmentPeriodId)
    }
    reportData.workflowState = requestedWorkflowState || normalizeParentReportWorkflowState(existing.workflowState)

    let updatedReport
    try {
      updatedReport = await prisma.parentClassReport.update({
        where: { id: reportId },
        data: reportData,
      })
    } catch (error) {
      if (!isLegacyParentReportParticipationPointsSchemaError(error)) throw error
      updatedReport = await prisma.parentClassReport.update({
        where: { id: reportId },
        data: stripLegacyParentReportFields(reportData),
      })
    }
    await recordParentClassReportEvent({
      reportId,
      artifactVersion: normalizeInteger(updatedReport?.finalArtifactVersion) || 0,
      eventType: "pr_draft_saved",
      actorType: "admin",
      actorId: normalizeText(payload.updatedByUsername || payload.submittedByUsername || payload.teacherName || "system"),
      metadata: {
        workflowState: normalizeParentReportWorkflowState(updatedReport?.workflowState),
      },
    })
    return mapParentClassReport(updatedReport)
  }

  if (!reportData.enrollmentPeriodId) {
    const period = await resolveEnrollmentPeriodForStudent(prisma, studentRef, {
      schoolYear,
      levelHint: reportData.level || "",
    })
    reportData.enrollmentPeriodId = normalizeNullableText(period?.id)
  }

  const existingScopedReport = await prisma.parentClassReport.findFirst({
    where: {
      studentRefId: studentRef,
      className,
      schoolYear,
      quarter,
      enrollmentPeriodId: reportData.enrollmentPeriodId,
    },
  })
  if (existingScopedReport) {
    if (normalizeLower(payload.updatedByRole) === "teacher") {
      assertWithStatus(
        normalizeParentReportWorkflowState(existingScopedReport.workflowState) === PARENT_REPORT_WORKFLOW_STATE_DRAFT,
        409,
        "Submitted parent reports are read-only for teachers"
      )
    }
    assertWithStatus(
      !isImmutableParentReportRecord(existingScopedReport),
      409,
      "Published parent reports are immutable"
    )
  }
  reportData.workflowState = requestedWorkflowState || PARENT_REPORT_WORKFLOW_STATE_DRAFT

  let upsertedReport
  try {
    upsertedReport = await prisma.parentClassReport.upsert({
      where: {
        studentRefId_className_schoolYear_quarter_enrollmentPeriodId: {
          studentRefId: studentRef,
          className,
          schoolYear,
          quarter,
          enrollmentPeriodId: reportData.enrollmentPeriodId,
        },
      },
      update: reportData,
      create: {
        studentRefId: studentRef,
        ...reportData,
      },
    })
  } catch (error) {
    if (!isLegacyParentReportParticipationPointsSchemaError(error)) throw error
    const legacyReportData = stripLegacyParentReportFields(reportData)
    upsertedReport = await prisma.parentClassReport.upsert({
      where: {
        studentRefId_className_schoolYear_quarter_enrollmentPeriodId: {
          studentRefId: studentRef,
          className,
          schoolYear,
          quarter,
          enrollmentPeriodId: reportData.enrollmentPeriodId,
        },
      },
      update: legacyReportData,
      create: {
        studentRefId: studentRef,
        ...legacyReportData,
      },
    })
  }
  await recordParentClassReportEvent({
    reportId: normalizeText(upsertedReport?.id),
    artifactVersion: normalizeInteger(upsertedReport?.finalArtifactVersion) || 0,
    eventType: "pr_draft_saved",
    actorType: "admin",
    actorId: normalizeText(payload.updatedByUsername || payload.submittedByUsername || payload.teacherName || "system"),
    metadata: {
      workflowState: normalizeParentReportWorkflowState(upsertedReport?.workflowState),
    },
  })
  return mapParentClassReport(upsertedReport)
}

/**
 * @param {string} studentRefId
 * @param {string} reportId
 * @returns {Promise<{ deleted: true, id: string }>}
 */
export async function deleteParentClassReport(studentRefId, reportId) {
  const prisma = await getPrismaClient()
  const studentRef = normalizeText(studentRefId)
  const id = normalizeText(reportId)
  assertWithStatus(Boolean(studentRef), 400, "studentRefId is required")
  assertWithStatus(Boolean(id), 400, "Report id is required")

  const existing = await prisma.parentClassReport.findUnique({ where: { id } })
  assertWithStatus(Boolean(existing), 404, "Parent report not found")
  assertWithStatus(existing.studentRefId === studentRef, 403, "Parent report does not belong to student")
  assertWithStatus(!isImmutableParentReportRecord(existing), 409, "Published parent reports are immutable")

  await prisma.parentClassReport.delete({ where: { id } })
  return { deleted: true, id }
}

/**
 * @param {string} studentRefId
 * @param {Record<string, unknown>} [payload]
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function generateParentClassReportFromGrades(studentRefId, payload = {}) {
  const prisma = await getPrismaClient()
  const studentRef = normalizeText(studentRefId)
  assertWithStatus(Boolean(studentRef), 400, "studentRefId is required")

  const className = canonicalizeLevel(payload.className)
  const schoolYear = normalizeText(payload.schoolYear)
  const quarter = normalizeQuarter(payload.quarter)

  assertWithStatus(Boolean(className), 400, "className is required")
  assertWithStatus(Boolean(schoolYear), 400, "schoolYear is required")
  assertWithStatus(Boolean(quarter), 400, "quarter is required")

  const grades = await prisma.studentGradeRecord.findMany({
    where: {
      studentRefId: studentRef,
      className,
      schoolYear,
      quarter,
    },
  })

  const homeworkTotal = grades.length
  const homeworkCompleted = grades.filter((entry) => {
    if (entry.homeworkCompleted === true) return true
    return Boolean(entry.submittedAt)
  }).length

  const homeworkOnTime = grades.filter((entry) => {
    if (entry.homeworkOnTime === true) return true
    if (!entry.dueAt || !entry.submittedAt) return false
    return entry.submittedAt.valueOf() <= entry.dueAt.valueOf()
  }).length

  const reportPayload = {
    className,
    level: normalizeNullableText(canonicalizeLevel(payload.level)),
    schoolYear,
    quarter,
    homeworkCompletionRate: percentage(homeworkCompleted, homeworkTotal),
    homeworkOnTimeRate: percentage(homeworkOnTime, homeworkTotal),
    behaviorScore: average(grades.map((entry) => entry.behaviorScore)),
    participationScore: average(grades.map((entry) => entry.participationScore)),
    inClassScore: average(grades.map((entry) => entry.inClassScore)),
    participationPointsAward: normalizeReportParticipationPoints(payload.participationPointsAward),
    comments: normalizeNullableText(payload.comments),
    generatedAt: new Date(),
  }

  return saveParentClassReport(studentRef, reportPayload)
}

async function loadReportWithStudentContext(prisma, reportId) {
  const report = await prisma.parentClassReport.findUnique({ where: { id: reportId } })
  assertWithStatus(Boolean(report), 404, "Parent report not found")
  const student = await prisma.student.findUnique({
    where: { id: report.studentRefId },
    include: {
      attendanceRecords: true,
      gradeRecords: true,
      parentReports: true,
      profile: true,
    },
  })
  assertWithStatus(Boolean(student), 404, "Student record not found for report")
  return { report, student }
}

export async function submitParentClassReportForAdminReview(reportId, payload = {}) {
  const prisma = await getPrismaClient()
  const id = normalizeText(reportId)
  assertWithStatus(Boolean(id), 400, "reportId is required")
  const existing = await prisma.parentClassReport.findUnique({ where: { id } })
  assertWithStatus(Boolean(existing), 404, "Parent report not found")
  assertWithStatus(
    normalizeParentReportWorkflowState(existing.workflowState) === PARENT_REPORT_WORKFLOW_STATE_DRAFT,
    409,
    "Only draft reports can be submitted for admin review"
  )
  const submittedByUsername = parentReportLifecycleActor(payload.submittedByUsername)
  const updated = await prisma.parentClassReport.update({
    where: { id },
    data: {
      workflowState: PARENT_REPORT_WORKFLOW_STATE_SUBMITTED,
      submittedAt: new Date(),
      submittedByUsername,
    },
  })
  await recordParentClassReportEvent({
    reportId: id,
    artifactVersion: normalizeInteger(updated?.finalArtifactVersion) || 0,
    eventType: "pr_submitted",
    actorType: "teacher",
    actorId: submittedByUsername,
    metadata: { workflowState: PARENT_REPORT_WORKFLOW_STATE_SUBMITTED },
  })
  return mapParentClassReport(updated)
}

export async function startParentClassReportAdminReview(reportId, payload = {}) {
  const prisma = await getPrismaClient()
  const id = normalizeText(reportId)
  assertWithStatus(Boolean(id), 400, "reportId is required")
  const existing = await prisma.parentClassReport.findUnique({ where: { id } })
  assertWithStatus(Boolean(existing), 404, "Parent report not found")
  const currentState = normalizeParentReportWorkflowState(existing.workflowState)
  assertWithStatus(
    currentState === PARENT_REPORT_WORKFLOW_STATE_SUBMITTED
      || currentState === PARENT_REPORT_WORKFLOW_STATE_INCOMING,
    409,
    "Only submitted reports can enter admin review"
  )
  const reviewedBy = parentReportLifecycleActor(payload.adminReviewStartedByUsername)
  const updated = await prisma.parentClassReport.update({
    where: { id },
    data: {
      workflowState: PARENT_REPORT_WORKFLOW_STATE_INCOMING,
      adminReviewStartedAt: existing.adminReviewStartedAt || new Date(),
      adminReviewStartedByUsername: normalizeText(existing.adminReviewStartedByUsername) || reviewedBy,
    },
  })
  await recordParentClassReportEvent({
    reportId: id,
    artifactVersion: normalizeInteger(updated?.finalArtifactVersion) || 0,
    eventType: "admin_review_started",
    actorType: "admin",
    actorId: reviewedBy,
    metadata: { workflowState: PARENT_REPORT_WORKFLOW_STATE_INCOMING },
  })
  return mapParentClassReport(updated)
}

export async function markParentClassReportAwaitingApproval(reportId, payload = {}) {
  const prisma = await getPrismaClient()
  const id = normalizeText(reportId)
  assertWithStatus(Boolean(id), 400, "reportId is required")
  const existing = await prisma.parentClassReport.findUnique({ where: { id } })
  assertWithStatus(Boolean(existing), 404, "Parent report not found")
  const currentState = normalizeParentReportWorkflowState(existing.workflowState)
  assertWithStatus(
    currentState === PARENT_REPORT_WORKFLOW_STATE_SUBMITTED
      || currentState === PARENT_REPORT_WORKFLOW_STATE_INCOMING
      || currentState === PARENT_REPORT_WORKFLOW_STATE_AWAITING_APPROVAL,
    409,
    "Only submitted reports can move into awaiting approval"
  )
  const draftedBy = parentReportLifecycleActor(payload.rcDraftedByUsername || payload.adminReviewStartedByUsername)
  const updated = await prisma.parentClassReport.update({
    where: { id },
    data: {
      workflowState: PARENT_REPORT_WORKFLOW_STATE_AWAITING_APPROVAL,
      adminReviewStartedAt: existing.adminReviewStartedAt || new Date(),
      adminReviewStartedByUsername: normalizeText(existing.adminReviewStartedByUsername) || draftedBy,
      rcDraftedAt: new Date(),
      rcDraftedByUsername: draftedBy,
    },
  })
  await recordParentClassReportEvent({
    reportId: id,
    artifactVersion: normalizeInteger(updated?.finalArtifactVersion) || 0,
    eventType: "admin_rc_draft_saved",
    actorType: "admin",
    actorId: draftedBy,
    metadata: { workflowState: PARENT_REPORT_WORKFLOW_STATE_AWAITING_APPROVAL },
  })
  return mapParentClassReport(updated)
}

export async function acknowledgeParentClassReportReview(reportId, payload = {}) {
  const prisma = await getPrismaClient()
  const id = normalizeText(reportId)
  assertWithStatus(Boolean(id), 400, "reportId is required")
  const existing = await prisma.parentClassReport.findUnique({ where: { id } })
  assertWithStatus(Boolean(existing), 404, "Parent report not found")
  assertWithStatus(isParentReportPortalVisible(existing), 403, "Performance report is not published")
  const actorType = normalizeLower(payload.viewerRole) === "student" ? "student" : "parent"
  const reviewedBy = parentReportLifecycleActor(payload.reviewedBy)
  const reviewedAt = new Date()
  const nextMeta = {
    ...(existing?.metaPayload && typeof existing.metaPayload === "object" ? existing.metaPayload : {}),
  }
  if (actorType === "student") {
    nextMeta.studentReviewedAt = reviewedAt.toISOString()
    nextMeta.studentReviewedByUsername = reviewedBy
  } else {
    nextMeta.parentReviewedAt = reviewedAt.toISOString()
    nextMeta.parentReviewedByUsername = reviewedBy
  }
  const updated = await prisma.parentClassReport.update({
    where: { id },
    data: {
      metaPayload: nextMeta,
    },
  })
  await recordParentClassReportEvent({
    reportId: id,
    artifactVersion: normalizeInteger(updated?.finalArtifactVersion) || 0,
    eventType: actorType === "student" ? "student_review_acknowledged" : "parent_review_acknowledged",
    actorType,
    actorId: reviewedBy,
    metadata: { workflowState: normalizeParentReportWorkflowState(updated?.workflowState) },
  })
  return mapParentClassReport(updated)
}

/**
 * @param {string} reportId
 * @param {Record<string, unknown>} [payload]
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function approveParentClassReport(reportId, payload = {}) {
  const prisma = await getPrismaClient()
  const id = normalizeText(reportId)
  assertWithStatus(Boolean(id), 400, "reportId is required")
  const expectedStudentRefId = normalizeText(payload.studentRefId)
  const { report: existing, student } = await loadReportWithStudentContext(prisma, id)
  if (expectedStudentRefId) {
    assertWithStatus(existing.studentRefId === expectedStudentRefId, 403, "Parent report does not belong to student")
  }
  const currentState = normalizeParentReportWorkflowState(existing.workflowState)
  assertWithStatus(
    currentState === PARENT_REPORT_WORKFLOW_STATE_AWAITING_APPROVAL
      || currentState === PARENT_REPORT_WORKFLOW_STATE_APPROVED_FINAL
      || currentState === PARENT_REPORT_WORKFLOW_STATE_PUBLISHED
      || currentState === PARENT_REPORT_WORKFLOW_STATE_NOTIFICATION_QUEUED
      || currentState === PARENT_REPORT_WORKFLOW_STATE_NOTIFICATION_SENT,
    409,
    "Performance report must be awaiting admin approval before final approval"
  )

  const artifactPayload = buildStudentReportCardPayload(student, {
    className: normalizeText(existing.className),
    schoolYear: normalizeText(existing.schoolYear),
    quarter: normalizeText(existing.quarter),
    reportId: id,
  })
  const approvedAt = parseDateOrNull(existing?.approvedAt) || new Date()
  const approvedByUsername = normalizeNullableText(payload.approvedByUsername)
  const nextVersion = Math.max(1, normalizeInteger(existing?.finalArtifactVersion) || 0) + 1
  let updated
  const data = {
    approvedAt,
    approvedByUsername: approvedByUsername || normalizeNullableText(existing?.approvedByUsername),
    workflowState: PARENT_REPORT_WORKFLOW_STATE_PUBLISHED,
    publishedAt: parseDateOrNull(existing?.publishedAt) || new Date(),
    finalArtifactVersion: nextVersion,
    finalArtifactPayload: artifactPayload,
    finalArtifactFrozenAt: new Date(),
  }
  try {
    updated = await prisma.parentClassReport.update({
      where: { id },
      data,
    })
  } catch (error) {
    if (!isLegacyParentReportParticipationPointsSchemaError(error)) throw error
    updated = await prisma.parentClassReport.update({
      where: { id },
      data: stripLegacyParentReportFields(data),
    })
  }
  await recordParentClassReportEvent({
    reportId: id,
    artifactVersion: normalizeInteger(updated?.finalArtifactVersion) || nextVersion,
    eventType: "admin_approved_final",
    actorType: "admin",
    actorId: parentReportLifecycleActor(approvedByUsername),
    metadata: { workflowState: PARENT_REPORT_WORKFLOW_STATE_APPROVED_FINAL },
  })
  await recordParentClassReportEvent({
    reportId: id,
    artifactVersion: normalizeInteger(updated?.finalArtifactVersion) || nextVersion,
    eventType: "report_published",
    actorType: "system",
    actorId: "system",
    metadata: { workflowState: PARENT_REPORT_WORKFLOW_STATE_PUBLISHED },
  })
  return mapParentClassReport(updated)
}

/**
 * @param {string} reportId
 * @param {Record<string, unknown>} [payload]
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function returnParentClassReportToAwaitingApproval(reportId, payload = {}) {
  const prisma = await getPrismaClient()
  const id = normalizeText(reportId)
  assertWithStatus(Boolean(id), 400, "reportId is required")
  const existing = await prisma.parentClassReport.findUnique({ where: { id } })
  assertWithStatus(Boolean(existing), 404, "Parent report not found")
  const currentState = normalizeParentReportWorkflowState(existing.workflowState)
  assertWithStatus(
    PARENT_REPORT_REQUEUEABLE_WORKFLOW_STATES.has(currentState),
    409,
    "Performance report must be approved before returning to approval queue"
  )
  const returnedBy = parentReportLifecycleActor(
    payload.returnedByUsername || payload.reviewedByUsername || payload.updatedByUsername
  )
  const updated = await prisma.parentClassReport.update({
    where: { id },
    data: {
      workflowState: PARENT_REPORT_WORKFLOW_STATE_AWAITING_APPROVAL,
      approvedAt: null,
      approvedByUsername: null,
      publishedAt: null,
      notificationQueuedAt: null,
      notificationSentAt: null,
    },
  })
  await recordParentClassReportEvent({
    reportId: id,
    artifactVersion: normalizeInteger(updated?.finalArtifactVersion) || 0,
    eventType: "admin_returned_to_approval_queue",
    actorType: "admin",
    actorId: returnedBy,
    metadata: {
      workflowState: PARENT_REPORT_WORKFLOW_STATE_AWAITING_APPROVAL,
      previousWorkflowState: currentState,
    },
  })
  return mapParentClassReport(updated)
}
