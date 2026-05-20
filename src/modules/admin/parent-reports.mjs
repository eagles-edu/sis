// src/modules/admin/parent-reports.mjs
// @ts-check

import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import { resolveEnrollmentPeriodForStudent } from "./enrollment-periods.mjs"

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
  const text = normalizeText(value)
  if (!text) return ""
  const key = normalizeLevelKey(text)
  return LEVEL_ALIAS_MAP.get(key) || text
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
 * @param {string} [comment]
 * @param {Record<string, unknown> | null} [rubricPayload]
 * @param {Record<string, unknown> | null} [metaPayload]
 * @returns {string}
 */
export function encodeParentReportCommentBundle(comment = "", rubricPayload = null, metaPayload = null) {
  const normalizedComment = normalizeNullableText(comment)
  const normalizedRubricPayload = normalizeParentReportRubricPayload(rubricPayload)
  const normalizedMetaPayload = normalizeParentReportMetaPayload(metaPayload)
  if (!normalizedRubricPayload && !normalizedMetaPayload) return normalizedComment
  if (normalizedRubricPayload && !normalizedMetaPayload) {
    const encodedRubricPayload = Buffer.from(JSON.stringify(normalizedRubricPayload), "utf8").toString("base64url")
    if (!encodedRubricPayload) return normalizedComment
    const marker = `[[SIS-RUBRIC-V1:${encodedRubricPayload}]]`
    return normalizedComment ? `${normalizedComment}\n${marker}` : marker
  }
  const encodedPayload = Buffer.from(
    JSON.stringify({
      rubricPayload: normalizedRubricPayload,
      metaPayload: normalizedMetaPayload,
    }),
    "utf8"
  ).toString("base64url")
  if (!encodedPayload) return normalizedComment
  const marker = `[[SIS-REPORT-BUNDLE-V2:${encodedPayload}]]`
  return normalizedComment ? `${normalizedComment}\n${marker}` : marker
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
export function decodeParentReportCommentBundle(value = "") {
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
  const decoded = decodeParentReportCommentBundle(report.comments)
  const metaPayload = decoded.metaPayload && typeof decoded.metaPayload === "object" ? decoded.metaPayload : null
  return {
    ...report,
    enrollmentPeriodId: normalizeText(report?.enrollmentPeriodId),
    comments: decoded.comment,
    rubricPayload: decoded.rubricPayload,
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

/**
 * @param {string} studentRefId
 * @param {Record<string, unknown>} [payload]
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function saveParentClassReport(studentRefId, payload = {}) {
  const prisma = await getPrismaClient()
  const studentRef = normalizeText(studentRefId)
  assertWithStatus(Boolean(studentRef), 400, "studentRefId is required")

  const className = normalizeText(payload.className)
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
  const reportData = {
    className,
    level: normalizeNullableText(payload.level),
    schoolYear,
    quarter,
    enrollmentPeriodId: normalizeNullableText(payload.enrollmentPeriodId),
    homeworkCompletionRate: normalizeFloat(payload.homeworkCompletionRate),
    homeworkOnTimeRate: normalizeFloat(payload.homeworkOnTimeRate),
    behaviorScore: normalizeFloat(payload.behaviorScore),
    participationScore: normalizeFloat(payload.participationScore),
    inClassScore: normalizeFloat(payload.inClassScore),
    participationPointsAward,
    comments: encodeParentReportCommentBundle(payload.comments, normalizedRubricPayload, normalizedMetaPayload),
    generatedAt: normalizeDate(payload.generatedAt) || new Date(),
  }
  const reportId = normalizeText(payload.id)

  if (reportId) {
    const existing = await prisma.parentClassReport.findUnique({ where: { id: reportId } })
    assertWithStatus(Boolean(existing), 404, "Parent report not found")
    assertWithStatus(existing.studentRefId === studentRef, 403, "Parent report does not belong to student")
    if (!reportData.enrollmentPeriodId) {
      reportData.enrollmentPeriodId = normalizeNullableText(existing.enrollmentPeriodId)
    }

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
    return mapParentClassReport(updatedReport)
  }

  if (!reportData.enrollmentPeriodId) {
    const period = await resolveEnrollmentPeriodForStudent(prisma, studentRef, {
      schoolYear,
      levelHint: reportData.level || "",
    })
    reportData.enrollmentPeriodId = normalizeNullableText(period?.id)
  }

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

  const className = normalizeText(payload.className)
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
    level: normalizeNullableText(payload.level),
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

/**
 * @param {string} reportId
 * @param {Record<string, unknown>} [payload]
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function approveParentClassReport(reportId, payload = {}) {
  const prisma = await getPrismaClient()
  const id = normalizeText(reportId)
  assertWithStatus(Boolean(id), 400, "reportId is required")

  const existing = await prisma.parentClassReport.findUnique({ where: { id } })
  assertWithStatus(Boolean(existing), 404, "Parent report not found")
  const expectedStudentRefId = normalizeText(payload.studentRefId)
  if (expectedStudentRefId) {
    assertWithStatus(existing.studentRefId === expectedStudentRefId, 403, "Parent report does not belong to student")
  }

  const data = {}
  if (!parseDateOrNull(existing?.approvedAt)) {
    data.approvedAt = new Date()
  }
  const approvedByUsername = normalizeNullableText(payload.approvedByUsername)
  if (approvedByUsername && !normalizeText(existing?.approvedByUsername)) {
    data.approvedByUsername = approvedByUsername
  }
  if (Object.prototype.hasOwnProperty.call(payload, "participationPointsAward")) {
    data.participationPointsAward = normalizeReportParticipationPoints(payload.participationPointsAward)
  }
  if (!Object.keys(data).length) return mapParentClassReport(existing)
  let updated
  try {
    updated = await prisma.parentClassReport.update({
      where: { id },
      data,
    })
  } catch (error) {
    if (!isLegacyParentReportParticipationPointsSchemaError(error)) throw error
    const legacyData = stripLegacyParentReportFields(data)
    if (!Object.keys(legacyData).length) return mapParentClassReport(existing)
    updated = await prisma.parentClassReport.update({
      where: { id },
      data: legacyData,
    })
  }
  return mapParentClassReport(updated)
}
