// @ts-check
import process from "node:process"
import { URL } from "node:url"
import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import { getConfiguredDatabaseUrlSync } from "./sis-config-store.mjs"
import { resolveEnrollmentPeriodForStudent } from "./enrollment-periods.mjs"
import { getConfiguredSchoolYear } from "./school-setup-store.mjs"
import {
  getStudentNewsAutoApprovalConfigSync,
  reconcileStudentNewsAutoApprovals,
  resolveStudentNewsAutoApproveDueAt,
} from "./student-news-auto-approval.mjs"
import {
  addAwaitingReReviewMarker,
  evaluateStudentNewsCompliance,
  evaluateStudentNewsMinimumRequirements,
  mergeStudentNewsReviewNoteWithCompliance,
  normalizeValidationIssueMap,
  resolveStudentNewsAwaitingReReview,
  stripAwaitingReReviewMarker,
  updateStudentNewsValidationIssues,
} from "./student-news-compliance.mjs"
import {
  isStudentNewsReportSchemaUnavailableError,
  isStudentNewsReviewSchemaUnavailableError,
  listStudentNewsReportsFromFallbackStore,
  upsertStudentNewsReportInFallbackStore,
} from "./student-news-fallback.mjs"

/** @type {Promise<import("@prisma/client").PrismaClient> | null} */
let prismaClientPromise = null

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

function normalizeSyllabication(value) {
  const vowels = { a: "á", e: "é", i: "í", o: "ó", u: "ú", y: "ý" }
  return normalizeText(value).split("-").filter(Boolean).map((part) => {
    const stressed = /[A-Z]/u.test(part)
    const chars = Array.from(part.toLocaleLowerCase("en-US"))
    if (stressed && !chars.some((char) => /[áéíóúý]/u.test(char))) {
      const vowelIndex = chars.findIndex((char) => vowels[char])
      if (vowelIndex >= 0) chars[vowelIndex] = vowels[chars[vowelIndex]]
    }
    return chars.join("")
  }).join("-")
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
 * @returns {Date | null}
 */
function parseDateOrNull(value) {
  if (value instanceof Date) return Number.isNaN(value.valueOf()) ? null : value
  const text = normalizeText(value)
  if (!text) return null
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? `${text}T00:00:00+07:00`
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(text)
      ? `${text}+07:00`
      : text
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.valueOf()) ? null : parsed
}

/**
 * @param {unknown} value
 * @param {Date} [fallback]
 * @returns {Date}
 */
function normalizeDateValue(value, fallback = new Date()) {
  const parsed = value instanceof Date ? new Date(value.getTime()) : parseDateOrNull(value)
  if (parsed instanceof Date && !Number.isNaN(parsed.valueOf())) return parsed
  return fallback instanceof Date ? new Date(fallback.getTime()) : new Date()
}

const FIXED_TIME_ZONE_OFFSET_MINUTES = 7 * 60
const FIXED_TIME_ZONE_OFFSET_MS = FIXED_TIME_ZONE_OFFSET_MINUTES * 60 * 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000

/**
 * @param {Date} value
 * @returns {Date}
 */
function shiftToFixedTimeZone(value) {
  return new Date(value.getTime() + FIXED_TIME_ZONE_OFFSET_MS)
}

/**
 * @param {Date} value
 * @returns {Date}
 */
function shiftFromFixedTimeZone(value) {
  return new Date(value.getTime() - FIXED_TIME_ZONE_OFFSET_MS)
}

/**
 * @param {unknown} [value]
 * @returns {Date}
 */
function startOfDay(value = new Date()) {
  const source = normalizeDateValue(value)
  const shifted = shiftToFixedTimeZone(source)
  shifted.setUTCHours(0, 0, 0, 0)
  return shiftFromFixedTimeZone(shifted)
}

/**
 * @param {unknown} [value]
 * @returns {Date}
 */
function endOfDay(value = new Date()) {
  const date = startOfDay(value)
  return new Date(date.getTime() + ONE_DAY_MS - 1)
}

/**
 * @param {unknown} [value]
 * @returns {Date}
 */
function startOfWeekSunday(value = new Date()) {
  const date = startOfDay(value)
  const shifted = shiftToFixedTimeZone(date)
  const day = shifted.getUTCDay()
  shifted.setUTCDate(shifted.getUTCDate() - day)
  return shiftFromFixedTimeZone(shifted)
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function toLocalIsoDate(value) {
  const date = value instanceof Date ? value : parseDateOrNull(value)
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) return ""
  const shifted = shiftToFixedTimeZone(date)
  const year = shifted.getUTCFullYear()
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0")
  const day = String(shifted.getUTCDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

/**
 * @param {unknown} value
 * @returns {Date | null}
 */
function parseLocalDateOnly(value) {
  const text = normalizeText(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const [yearText, monthText, dayText] = text.split("-")
  const year = Number.parseInt(yearText, 10)
  const month = Number.parseInt(monthText, 10)
  const day = Number.parseInt(dayText, 10)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  const date = shiftFromFixedTimeZone(new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0)))
  if (Number.isNaN(date.valueOf())) return null
  const normalized = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  if (toLocalIsoDate(date) !== normalized) return null
  return date
}

/**
 * @param {unknown} dateValue
 * @param {unknown} [days]
 * @returns {Date}
 */
function addDays(dateValue, days = 0) {
  const date = startOfDay(dateValue)
  const shifted = shiftToFixedTimeZone(date)
  shifted.setUTCDate(shifted.getUTCDate() + (Number.parseInt(String(days), 10) || 0))
  return shiftFromFixedTimeZone(shifted)
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeHttpUrl(value) {
  const text = normalizeText(value)
  if (!text) return ""
  try {
    const parsed = new URL(text)
    const protocol = normalizeLower(parsed.protocol)
    if (protocol !== "http:" && protocol !== "https:") return ""
    return parsed.toString()
  } catch (error) {
    void error
    return ""
  }
}

/**
 * @param {unknown} value
 * @param {unknown} [maxLength]
 * @returns {{ value: string, truncated: boolean }}
 */
function clampText(value, maxLength = 0) {
  const text = normalizeText(value)
  const max = Number.parseInt(String(maxLength), 10) || 0
  if (max <= 0) return { value: text, truncated: false }
  if (text.length <= max) return { value: text, truncated: false }
  return {
    value: text.slice(0, max),
    truncated: true,
  }
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

/**
 * @param {number} status
 * @param {string} message
 * @param {Record<string, unknown>} [payload]
 * @returns {never}
 */
function throwWithStatusPayload(status, message, payload = {}) {
  /** @type {Error & { statusCode?: number, payload?: Record<string, unknown> }} */
  const error = new Error(message)
  error.statusCode = status
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    error.payload = payload
  }
  throw error
}

/**
 * @param {unknown} prisma
 * @param {string} delegateName
 * @param {string} methodName
 * @returns {boolean}
 */
function hasPrismaDelegateMethod(prisma, delegateName, methodName) {
  const typedPrisma = /** @type {Record<string, Record<string, unknown>> | null | undefined} */ (prisma)
  const delegate = typedPrisma?.[delegateName]
  return Boolean(delegate && typeof delegate[methodName] === "function")
}

/**
 * @returns {boolean}
 */
function isStudentAdminStoreEnabled() {
  const hasDatabaseUrl = Boolean(normalizeText(getConfiguredDatabaseUrlSync() || process.env.DATABASE_URL))
  const envFlag = normalizeLower(process.env.STUDENT_ADMIN_STORE_ENABLED)
  if (!envFlag) return hasDatabaseUrl
  if (["false", "0", "no"].includes(envFlag)) return false
  if (["true", "1", "yes"].includes(envFlag)) return true
  return hasDatabaseUrl
}

/**
 * @returns {Promise<import("@prisma/client").PrismaClient>}
 */
async function getPrismaClient() {
  if (!isStudentAdminStoreEnabled()) {
    /** @type {Error & { statusCode?: number }} */
    const error = new Error("Student admin store is disabled")
    error.statusCode = 503
    throw error
  }
  if (prismaClientPromise) return prismaClientPromise

  prismaClientPromise = getSharedPrismaClient()

  try {
    return await prismaClientPromise
  } catch (error) {
    prismaClientPromise = null
    throw error
  }
}

const STUDENT_NEWS_REVIEW_STATUS_SUBMITTED = "submitted"
const STUDENT_NEWS_REVIEW_STATUS_APPROVED = "approved"
const STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED = "revision-requested"
const STUDENT_NEWS_SUBMISSION_STATE_DRAFT = "draft"
const STUDENT_NEWS_SUBMISSION_STATE_READY = "ready"
const STUDENT_NEWS_SUBMISSION_STATE_SUBMITTED = "submitted"

function normalizeStudentNewsSubmissionState(value, fallback = STUDENT_NEWS_SUBMISSION_STATE_SUBMITTED) {
  const token = normalizeLower(value)
  if (!token) return fallback
  if (token === STUDENT_NEWS_SUBMISSION_STATE_DRAFT) return STUDENT_NEWS_SUBMISSION_STATE_DRAFT
  if (token === STUDENT_NEWS_SUBMISSION_STATE_READY) return STUDENT_NEWS_SUBMISSION_STATE_READY
  if (token === STUDENT_NEWS_SUBMISSION_STATE_SUBMITTED) return STUDENT_NEWS_SUBMISSION_STATE_SUBMITTED
  return fallback
}
/** @type {Record<string, string>} */
const STUDENT_NEWS_REVIEW_STATUS_COLOR = {
  [STUDENT_NEWS_REVIEW_STATUS_APPROVED]: "green",
  [STUDENT_NEWS_REVIEW_STATUS_SUBMITTED]: "amber",
  [STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED]: "red",
}

const STUDENT_NEWS_DEFAULT_DAYS = 14
const STUDENT_NEWS_MAX_DAYS = 120
const STUDENT_NEWS_FIELD_MAX_LENGTHS = Object.freeze({
  sourceLink: 2048,
  articleTitle: 240,
  byline: 240,
  articleDateline: 240,
  leadSynopsis: 5000,
  actionActor: 2000,
  actionAffected: 2000,
  actionWhere: 2000,
  actionWhat: 4000,
  actionWhy: 4000,
  biasAssessment: 5000,
})

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
function normalizeStudentNewsReviewStatus(value, fallback = STUDENT_NEWS_REVIEW_STATUS_SUBMITTED) {
  const token = normalizeLower(value)
  if (!token) return fallback
  if (token === "all") return "all"
  if (token === "approved" || token === "approve") return STUDENT_NEWS_REVIEW_STATUS_APPROVED
  if (
    token === "revision-requested"
    || token === "revision_requested"
    || token === "revision"
    || token === "revise"
    || token === "request-revision"
    || token === "request_revision"
  ) {
    return STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED
  }
  if (
    token === "submitted"
    || token === "pending"
    || token === "needs-review"
    || token === "needs_review"
    || token === "needsreview"
  ) {
    return STUDENT_NEWS_REVIEW_STATUS_SUBMITTED
  }
  return fallback
}

/**
 * @param {unknown} status
 * @returns {string}
 */
function resolveStudentNewsStatusColor(status) {
  const normalized = normalizeStudentNewsReviewStatus(status, STUDENT_NEWS_REVIEW_STATUS_SUBMITTED)
  return STUDENT_NEWS_REVIEW_STATUS_COLOR[normalized] || "amber"
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeStudentNewsDays(value) {
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed)) return STUDENT_NEWS_DEFAULT_DAYS
  return Math.max(7, Math.min(parsed, STUDENT_NEWS_MAX_DAYS))
}

/**
 * @param {unknown} [now]
 * @returns {{
 *   opensAt: string,
 *   closesAt: string,
 *   reportDate: string,
 *   todayDate: string,
 *   isOpen: boolean,
 *   closedReason: string,
 * }}
 */
export function resolveStudentNewsSubmissionWindow(now = new Date()) {
  const currentDayStart = startOfDay(parseDateOrNull(now) || new Date())
  const todayDate = toLocalIsoDate(currentDayStart)
  return {
    opensAt: currentDayStart.toISOString(),
    closesAt: endOfDay(currentDayStart).toISOString(),
    reportDate: todayDate,
    todayDate,
    isOpen: true,
    closedReason: "",
  }
}

/**
 * @param {Record<string, unknown>} [payload]
 * @returns {{
 *   sourceLink: string,
 *   articleTitle: string,
 *   byline: string,
 *   articleDateline: string,
 *   leadSynopsis: string,
 *   actionActor: string,
 *   actionAffected: string,
 *   actionWhere: string,
 *   actionWhat: string,
 *   actionWhy: string,
 *   biasAssessment: string,
 *   reportDateText: string,
 * }}
 */
function normalizeStudentNewsPayload(payload = {}) {
  const sourceLinkRaw = clampText(payload?.sourceLink, STUDENT_NEWS_FIELD_MAX_LENGTHS.sourceLink).value
  return {
    sourceLink: normalizeHttpUrl(sourceLinkRaw) || sourceLinkRaw,
    articleTitle: clampText(payload?.articleTitle, STUDENT_NEWS_FIELD_MAX_LENGTHS.articleTitle).value,
    byline: clampText(payload?.byline, STUDENT_NEWS_FIELD_MAX_LENGTHS.byline).value,
    articleDateline: clampText(payload?.articleDateline, STUDENT_NEWS_FIELD_MAX_LENGTHS.articleDateline).value,
    leadSynopsis: clampText(payload?.leadSynopsis, STUDENT_NEWS_FIELD_MAX_LENGTHS.leadSynopsis).value,
    actionActor: clampText(payload?.actionActor, STUDENT_NEWS_FIELD_MAX_LENGTHS.actionActor).value,
    actionAffected: clampText(payload?.actionAffected, STUDENT_NEWS_FIELD_MAX_LENGTHS.actionAffected).value,
    actionWhere: clampText(payload?.actionWhere, STUDENT_NEWS_FIELD_MAX_LENGTHS.actionWhere).value,
    actionWhat: clampText(payload?.actionWhat, STUDENT_NEWS_FIELD_MAX_LENGTHS.actionWhat).value,
    actionWhy: clampText(payload?.actionWhy, STUDENT_NEWS_FIELD_MAX_LENGTHS.actionWhy).value,
    biasAssessment: clampText(payload?.biasAssessment, STUDENT_NEWS_FIELD_MAX_LENGTHS.biasAssessment).value,
    vocabulary: Array.isArray(payload?.vocabulary) ? payload.vocabulary.slice(0, 100).map((row) => ({
      partOfSpeech: normalizeText(row?.partOfSpeech).toLowerCase(),
      english: clampText(row?.english, 240).value,
      vietnamese: clampText(row?.vietnamese, 240).value,
      syllabication: normalizeSyllabication(clampText(row?.syllabication, 240).value),
      definition: clampText(row?.definition, 1000).value,
    })) : [],
    reportDateText: normalizeText(payload?.reportDate),
  }
}

/**
 * @param {Record<string, unknown>} [report]
 * @returns {{
 *   sourceLink: string,
 *   articleTitle: string,
 *   byline: string,
 *   articleDateline: string,
 *   leadSynopsis: string,
 *   actionActor: string,
 *   actionAffected: string,
 *   actionWhere: string,
 *   actionWhat: string,
 *   actionWhy: string,
 *   biasAssessment: string,
 * }}
 */
function buildStudentNewsValidationPayload(report = {}) {
  return {
    sourceLink: normalizeText(report?.sourceLink),
    articleTitle: normalizeText(report?.articleTitle),
    byline: normalizeText(report?.byline),
    articleDateline: normalizeText(report?.articleDateline),
    leadSynopsis: normalizeText(report?.leadSynopsis),
    actionActor: normalizeText(report?.actionActor),
    actionAffected: normalizeText(report?.actionAffected),
    actionWhere: normalizeText(report?.actionWhere),
    actionWhat: normalizeText(report?.actionWhat),
    actionWhy: normalizeText(report?.actionWhy),
    biasAssessment: normalizeText(report?.biasAssessment),
    vocabulary: report?.vocabulary === null || report?.vocabulary === undefined
      ? null
      : Array.isArray(report.vocabulary) ? report.vocabulary : [],
  }
}

/**
 * @param {unknown} reportDate
 * @returns {Date | null}
 */
function resolveStudentNewsEditableUntil(reportDate) {
  const parsed = reportDate instanceof Date ? reportDate : parseLocalDateOnly(reportDate)
  if (!(parsed instanceof Date) || Number.isNaN(parsed.valueOf())) return null
  const currentWeekStart = startOfWeekSunday(parsed)
  return new Date(currentWeekStart.getTime() + (ONE_DAY_MS * 7))
}

/**
 * @param {Record<string, unknown> | null | undefined} report
 * @returns {boolean}
 */
function hasStudentNewsDateSatisfied(report) {
  return Boolean(
    normalizeText(report?.dateSatisfiedAt)
    || normalizeText(report?.mmrPassedAt)
    || normalizeStudentNewsSubmissionState(report?.submissionState, "") === STUDENT_NEWS_SUBMISSION_STATE_READY
    || normalizeStudentNewsSubmissionState(report?.submissionState, "") === STUDENT_NEWS_SUBMISSION_STATE_SUBMITTED
  )
}

/**
 * @param {Record<string, unknown> | null | undefined} existing
 * @param {Date} nowDate
 * @param {string} reportDateText
 * @param {ReturnType<typeof resolveStudentNewsSubmissionWindow>} window
 * @returns {void}
 */
function assertStudentNewsEditability(existing, nowDate, reportDateText, window) {
  if (!existing) {
    assertWithStatus(reportDateText === window.reportDate, 403, "News report for this date is locked")
    return
  }
  const existingStatus = normalizeStudentNewsReviewStatus(
    existing.reviewStatus,
    STUDENT_NEWS_REVIEW_STATUS_SUBMITTED
  )
  const isApproved = existingStatus === STUDENT_NEWS_REVIEW_STATUS_APPROVED
  assertWithStatus(!isApproved, 403, "Approved news reports cannot be edited")

  const satisfied = hasStudentNewsDateSatisfied(existing)
  if (!satisfied) {
    assertWithStatus(reportDateText === window.reportDate, 403, "News report for this date is locked")
    return
  }

  const editableUntil =
    parseDateOrNull(existing.editableUntil)
    || resolveStudentNewsEditableUntil(existing.reportDate)
  assertWithStatus(
    editableUntil instanceof Date && !Number.isNaN(editableUntil.valueOf()) && nowDate < editableUntil,
    403,
    "News report for this date is locked"
  )
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {string} studentRefId
 * @param {Date} reportDateDate
 * @param {string} reportDateText
 * @returns {Promise<{ existing: Record<string, unknown> | null, fallbackOnly: boolean }>}
 */
async function findExistingStudentNewsReport(prisma, studentRefId, reportDateDate, reportDateText) {
  const reportDateRangeStart = new Date(reportDateDate.getTime())
  const reportDateRangeEnd = new Date(reportDateRangeStart.getTime() + ONE_DAY_MS)
  const select = {
    id: true,
    reportDate: true,
    enrollmentPeriodId: true,
    reviewStatus: true,
    reviewNote: true,
    validationIssuesJson: true,
    draftCheckedAt: true,
    mmrPassedAt: true,
    dateSatisfiedAt: true,
    reportDateLockedAt: true,
    firstSubmittedAt: true,
    lastSubmittedAt: true,
    editableUntil: true,
    submittedAt: true,
    submissionState: true,
    reviewedAt: true,
    reviewedByUsername: true,
    vocabularyJson: true,
  }

  /** @type {Record<string, unknown> | null} */
  let existing = null
  let fallbackOnly = false
  if (hasPrismaDelegateMethod(prisma, "studentNewsReport", "findUnique")) {
    try {
      existing = await prisma.studentNewsReport.findUnique({
        where: {
          studentRefId_reportDate: {
            studentRefId,
            reportDate: reportDateDate,
          },
        },
        select,
      })
    } catch (error) {
      if (
        isStudentNewsReportSchemaUnavailableError(error)
        || isStudentNewsReviewSchemaUnavailableError(error)
      ) {
        fallbackOnly = true
      } else {
        throw error
      }
    }
  } else {
    fallbackOnly = true
  }

  if (!existing && hasPrismaDelegateMethod(prisma, "studentNewsReport", "findFirst")) {
    try {
      existing = await prisma.studentNewsReport.findFirst({
        where: {
          studentRefId,
          reportDate: {
            gte: reportDateRangeStart,
            lt: reportDateRangeEnd,
          },
        },
        orderBy: {
          submittedAt: "desc",
        },
        select,
      })
      if (existing) fallbackOnly = false
    } catch (error) {
      if (
        isStudentNewsReportSchemaUnavailableError(error)
        || isStudentNewsReviewSchemaUnavailableError(error)
      ) {
        fallbackOnly = true
      } else {
        throw error
      }
    }
  }

  if (fallbackOnly && !existing) {
    const fallbackExisting = listStudentNewsReportsFromFallbackStore(studentRefId, {
      startDate: reportDateText,
      endDate: reportDateText,
    })
    existing = Array.isArray(fallbackExisting) ? fallbackExisting[0] || null : null
  }

  return { existing, fallbackOnly }
}

/**
 * @param {Record<string, unknown>} row
 * @param {{ validationConfig?: Record<string, unknown> }} [options]
 * @returns {Promise<ReturnType<typeof mapStudentNewsReportRow> & {
 *   currentMmrPassed: boolean,
 *   mmrFailedFields: Record<string, unknown>,
 *   requiredTasks: unknown[],
 *   warningFields: Record<string, unknown>,
 *   warningTasks: unknown[],
 *   dateSatisfied: boolean,
 *   reportDateLocked: boolean,
 * }>}
 */
async function buildStudentNewsClientItem(row, { validationConfig = {} } = {}) {
  const mapped = mapStudentNewsReportRow(row)
  const validationPayload = buildStudentNewsValidationPayload(mapped)
  const minimumRequirements = await evaluateStudentNewsMinimumRequirements(validationPayload, {
    validationConfig,
  })
  const storedValidationIssues = normalizeValidationIssueMap(mapped?.validationIssuesJson)
  const useStoredValidation = validationConfig && validationConfig.__useStoredValidation === true
  const compliance = useStoredValidation
    ? buildStoredStudentNewsComplianceState(storedValidationIssues)
    : await evaluateStudentNewsCompliance(validationPayload, { validationConfig })
  return {
    ...mapped,
    currentMmrPassed: minimumRequirements.passed === true,
    mmrFailedFields: minimumRequirements.failedFields || {},
    requiredTasks: Array.isArray(minimumRequirements.requiredTasks) ? minimumRequirements.requiredTasks : [],
    warningFields: compliance.warningFields || {},
    warningTasks: Array.isArray(compliance.warningTasks) ? compliance.warningTasks : [],
    dateSatisfied: hasStudentNewsDateSatisfied(mapped),
    reportDateLocked: Boolean(mapped.reportDateLockedAt),
  }
}

function buildStoredStudentNewsComplianceState(storedValidationIssues = {}) {
  const issueMap = normalizeValidationIssueMap(storedValidationIssues)
  const warningFields = {}
  const warningTasks = []

  Object.keys(issueMap).forEach((fieldKey) => {
    const entry = issueMap[fieldKey]
    if (!entry || normalizeLower(entry.status) === "fixed") return
    warningFields[fieldKey] = {
      message: normalizeText(entry.message),
      score: Number.isFinite(Number(entry.score)) ? Number(entry.score) : null,
      threshold: Number.isFinite(Number(entry.threshold)) ? Number(entry.threshold) : null,
    }
    warningTasks.push({
      field: fieldKey,
      label: normalizeText(entry.label || fieldKey),
      steps: Array.isArray(entry.steps) ? entry.steps : [],
      criterion: normalizeText(entry.criterion),
      score: Number.isFinite(Number(entry.score)) ? Number(entry.score) : null,
      threshold: Number.isFinite(Number(entry.threshold)) ? Number(entry.threshold) : null,
    })
  })

  return {
    passed: Object.keys(warningFields).length === 0,
    failedFields: warningFields,
    warningFields,
    revisionTasks: warningTasks,
    warningTasks,
    details: {
      skipped: true,
      reason: "stored-validation-state",
    },
    config: {},
  }
}

/**
 * @param {Record<string, unknown> | null | undefined} [row]
 * @returns {{
 *   id: string,
 *   studentRefId: string,
 *   reportDate: string,
 *   sourceLink: string,
 *   articleTitle: string,
 *   byline: string,
 *   articleDateline: string,
 *   leadSynopsis: string,
 *   actionActor: string,
 *   actionAffected: string,
 *   actionWhere: string,
 *   actionWhat: string,
 *   actionWhy: string,
 *   biasAssessment: string,
 *   submissionState: string,
 *   draftCheckedAt: string,
 *   mmrPassedAt: string,
 *   dateSatisfiedAt: string,
 *   reportDateLockedAt: string,
 *   firstSubmittedAt: string,
 *   lastSubmittedAt: string,
 *   editableUntil: string,
 *   submittedAt: string,
 *   reviewStatus: string,
 *   awaitingReReview: boolean,
 *   statusColor: string,
 *   reviewNote: string,
 *   validationIssuesJson: Record<string, unknown>,
 *   failedFields: string[],
 *   fixedFields: string[],
 *   reviewedByUsername: string,
 *   reviewedAt: string,
 * }}
 */
export function mapStudentNewsReportRow(row = {}) {
  const sourceLink = normalizeText(row?.sourceLink || row?.sourceUrl)
  const articleTitle = normalizeText(row?.articleTitle || row?.headline)
  const leadSynopsis = normalizeText(row?.leadSynopsis || row?.summary)
  const biasAssessment = normalizeText(row?.biasAssessment || row?.reflection)
  const reviewStatus = normalizeStudentNewsReviewStatus(row?.reviewStatus, STUDENT_NEWS_REVIEW_STATUS_SUBMITTED)
  const submissionState = normalizeStudentNewsSubmissionState(row?.submissionState, STUDENT_NEWS_SUBMISSION_STATE_SUBMITTED)
  const awaitingReReview = resolveStudentNewsAwaitingReReview(row)
  const validationIssues = normalizeValidationIssueMap(
    /** @type {Record<string, unknown> | null | undefined} */ (row?.validationIssuesJson)
  )
  const pendingFieldKeys = Object.keys(validationIssues).filter(
    (fieldKey) => normalizeLower(validationIssues?.[fieldKey]?.status) !== "fixed"
  )
  const fixedFieldKeys = Object.keys(validationIssues).filter(
    (fieldKey) => normalizeLower(validationIssues?.[fieldKey]?.status) === "fixed"
  )
  return {
    id: normalizeText(row?.id),
    studentRefId: normalizeText(row?.studentRefId),
    enrollmentPeriodId: normalizeText(row?.enrollmentPeriodId),
    reportDate: toLocalIsoDate(row?.reportDate),
    sourceLink,
    articleTitle,
    byline: normalizeText(row?.byline),
    articleDateline: normalizeText(row?.articleDateline),
    leadSynopsis,
    actionActor: normalizeText(row?.actionActor),
    actionAffected: normalizeText(row?.actionAffected),
    actionWhere: normalizeText(row?.actionWhere),
    actionWhat: normalizeText(row?.actionWhat),
    actionWhy: normalizeText(row?.actionWhy),
    biasAssessment,
    vocabulary: row?.vocabularyJson === undefined || row?.vocabularyJson === null
      ? null
      : Array.isArray(row.vocabularyJson) ? row.vocabularyJson : [],
    submissionState,
    draftCheckedAt: parseDateOrNull(row?.draftCheckedAt)?.toISOString?.() || "",
    mmrPassedAt: parseDateOrNull(row?.mmrPassedAt)?.toISOString?.() || "",
    dateSatisfiedAt: parseDateOrNull(row?.dateSatisfiedAt)?.toISOString?.() || "",
    reportDateLockedAt: parseDateOrNull(row?.reportDateLockedAt)?.toISOString?.() || "",
    firstSubmittedAt: parseDateOrNull(row?.firstSubmittedAt)?.toISOString?.() || "",
    lastSubmittedAt: parseDateOrNull(row?.lastSubmittedAt)?.toISOString?.() || "",
    editableUntil: parseDateOrNull(row?.editableUntil)?.toISOString?.() || "",
    submittedAt: parseDateOrNull(row?.submittedAt)?.toISOString?.() || "",
    reviewStatus,
    awaitingReReview,
    statusColor: resolveStudentNewsStatusColor(reviewStatus),
    reviewNote: stripAwaitingReReviewMarker(/** @type {string | undefined} */ (row?.reviewNote)),
    validationIssuesJson: validationIssues,
    failedFields: pendingFieldKeys,
    fixedFields: fixedFieldKeys,
    reviewedByUsername: normalizeText(row?.reviewedByUsername),
    reviewedAt: parseDateOrNull(row?.reviewedAt)?.toISOString?.() || "",
  }
}

/**
 * @param {{
 *   now?: unknown,
 *   reports?: unknown[],
 *   days?: number,
 * }} [options]
 * @returns {Array<{
 *   date: string,
 *   status: string,
 *   color: string,
 *   statusColor: string,
 *   reviewStatus: string,
 *   awaitingReReview: boolean,
 *   canSubmit: boolean,
 *   submittedAt: string,
 * }>}
 */
export function buildStudentNewsCalendarRows({ now = new Date(), reports = [], days = STUDENT_NEWS_DEFAULT_DAYS } = {}) {
  const targetDays = normalizeStudentNewsDays(days)
  const nowDate = parseDateOrNull(now) || new Date()
  const window = resolveStudentNewsSubmissionWindow(now)
  const byDate = new Map(
    (Array.isArray(reports) ? reports : [])
      .map((entry) =>
        mapStudentNewsReportRow(/** @type {Record<string, unknown> | null | undefined} */ (entry))
      )
      .filter((entry) => normalizeText(entry?.reportDate))
      .map((entry) => [entry.reportDate, entry])
  )
  const rows = []
  const todayStart = startOfDay(nowDate)
  for (let offset = 0; offset < targetDays; offset += 1) {
    const day = addDays(todayStart, -offset)
    const date = toLocalIsoDate(day)
    const saved = byDate.get(date) || null
    const isOpenDate = Boolean(window?.isOpen) && date === window.reportDate
    const editableUntil = parseDateOrNull(saved?.editableUntil)
    const canEditSaved = Boolean(editableUntil instanceof Date && !Number.isNaN(editableUntil.valueOf()) && nowDate < editableUntil)
    const submissionState = normalizeStudentNewsSubmissionState(saved?.submissionState, "")
    const status = saved
      ? submissionState === STUDENT_NEWS_SUBMISSION_STATE_DRAFT
        ? "draft"
        : submissionState === STUDENT_NEWS_SUBMISSION_STATE_READY
          ? "ready"
          : "completed"
      : isOpenDate
        ? "open"
        : "missed"
    const statusColor = saved
      ? submissionState === STUDENT_NEWS_SUBMISSION_STATE_DRAFT
        ? "blue"
        : submissionState === STUDENT_NEWS_SUBMISSION_STATE_READY
          ? "turquoise"
          : resolveStudentNewsStatusColor(saved?.reviewStatus)
      : status === "open"
        ? "amber"
        : "red"
    rows.push({
      date,
      status,
      color: statusColor,
      statusColor,
      reviewStatus: saved?.reviewStatus || "",
      submissionState: saved?.submissionState || "",
      awaitingReReview: saved?.awaitingReReview === true,
      canSubmit: saved
        ? status === "draft"
          ? isOpenDate
          : canEditSaved
        : status === "open",
      submittedAt: normalizeText(saved?.submittedAt),
    })
  }
  return rows
}

/**
 * @param {string} studentRefId
 * @param {{ now?: unknown, days?: number }} [options]
 * @returns {Promise<{
 *   generatedAt: string,
 *   studentRefId: string,
 *   days: number,
 *   window: ReturnType<typeof resolveStudentNewsSubmissionWindow>,
 *   openReport: ReturnType<typeof mapStudentNewsReportRow> | null,
 *   statusSummary: { draft: number, ready: number, submitted: number, approved: number, revisionRequested: number },
 *   items: Array<ReturnType<typeof mapStudentNewsReportRow>>,
 *   calendar: Array<ReturnType<typeof buildStudentNewsCalendarRows>[number]>,
 * }>}
 */
export async function listStudentNewsCalendar(studentRefId, { now = new Date(), days = STUDENT_NEWS_DEFAULT_DAYS } = {}) {
  const prisma = await getPrismaClient()
  const id = normalizeText(studentRefId)
  assertWithStatus(Boolean(id), 400, "studentRefId is required")
  await reconcileStudentNewsAutoApprovals({ studentRefId: id, now })
  const targetDays = normalizeStudentNewsDays(days)
  const nowDate = parseDateOrNull(now) || new Date()
  const todayStart = startOfDay(nowDate)
  const reportStart = addDays(todayStart, -(targetDays - 1))
  const reportEnd = endOfDay(todayStart)

  const fallbackRange = {
    startDate: toLocalIsoDate(reportStart),
    endDate: toLocalIsoDate(reportEnd),
  }
  /** @type {Array<Record<string, unknown>>} */
  let reports
  if (hasPrismaDelegateMethod(prisma, "studentNewsReport", "findMany")) {
    try {
      reports = await prisma.studentNewsReport.findMany({
        where: {
          studentRefId: id,
          reportDate: {
            gte: reportStart,
            lte: reportEnd,
          },
        },
        orderBy: { reportDate: "desc" },
      })
    } catch (error) {
      if (!isStudentNewsReportSchemaUnavailableError(error)) throw error
      reports = listStudentNewsReportsFromFallbackStore(id, fallbackRange)
    }
  } else {
    reports = listStudentNewsReportsFromFallbackStore(id, fallbackRange)
  }

  const mappedReports = await Promise.all(
    reports.map((entry) =>
      buildStudentNewsClientItem(entry, {
        validationConfig: {
          __useStoredValidation: true,
        },
      })
    )
  )
  const calendar = buildStudentNewsCalendarRows({
    now: nowDate,
    reports: mappedReports,
    days: targetDays,
  })
  const window = resolveStudentNewsSubmissionWindow(nowDate)
  const openReport = mappedReports.find((entry) => normalizeText(entry.reportDate) === window.reportDate) || null
  const statusSummary = mappedReports.reduce(
    (acc, entry) => {
      const submissionState = normalizeStudentNewsSubmissionState(entry?.submissionState, STUDENT_NEWS_SUBMISSION_STATE_SUBMITTED)
      if (submissionState === STUDENT_NEWS_SUBMISSION_STATE_DRAFT) {
        acc.draft += 1
        return acc
      }
      if (submissionState === STUDENT_NEWS_SUBMISSION_STATE_READY) {
        acc.ready += 1
        return acc
      }
      const status = normalizeStudentNewsReviewStatus(entry?.reviewStatus, STUDENT_NEWS_REVIEW_STATUS_SUBMITTED)
      if (status === STUDENT_NEWS_REVIEW_STATUS_APPROVED) acc.approved += 1
      else if (status === STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED) acc.revisionRequested += 1
      else acc.submitted += 1
      return acc
    },
    { draft: 0, ready: 0, submitted: 0, approved: 0, revisionRequested: 0 }
  )

  return {
    generatedAt: new Date().toISOString(),
    studentRefId: id,
    days: targetDays,
    window,
    openReport,
    statusSummary,
    items: mappedReports,
    calendar,
  }
}

/**
 * @param {string} studentRefId
 * @param {Record<string, unknown>} [payload]
 * @param {{ now?: unknown, validationConfig?: Record<string, unknown> }} [options]
 * @param {"check" | "submit"} mode
 * @returns {Promise<Record<string, unknown>>}
 */
async function persistStudentNewsReport(studentRefId, payload = {}, { now = new Date(), validationConfig = {} } = {}, mode) {
  const prisma = await getPrismaClient()
  const id = normalizeText(studentRefId)
  assertWithStatus(Boolean(id), 400, "studentRefId is required")

  const normalizedPayload = normalizeStudentNewsPayload(payload)
  const {
    sourceLink,
    articleTitle,
    byline,
    articleDateline,
    leadSynopsis,
    actionActor,
    actionAffected,
    actionWhere,
    actionWhat,
    actionWhy,
    biasAssessment,
    vocabulary,
    reportDateText,
  } = normalizedPayload

  const window = resolveStudentNewsSubmissionWindow(now)
  assertWithStatus(Boolean(reportDateText), 400, "reportDate is required")
  const reportDate = parseLocalDateOnly(reportDateText)
  assertWithStatus(reportDate instanceof Date && !Number.isNaN(reportDate.valueOf()), 400, "Invalid reportDate")
  const reportDateDate = /** @type {Date} */ (reportDate)
  const nowDate = parseDateOrNull(now) || new Date()
  const { existing, fallbackOnly } = await findExistingStudentNewsReport(prisma, id, reportDateDate, reportDateText)
  assertStudentNewsEditability(existing, nowDate, reportDateText, window)

  const validationPayload = {
    sourceLink,
    articleTitle,
    byline,
    articleDateline,
    leadSynopsis,
    actionActor,
    actionAffected,
    actionWhere,
    actionWhat,
    actionWhy,
    biasAssessment,
    vocabulary,
  }
  const [minimumRequirements, compliance] = mode === "draft"
    ? [
        { passed: false, failedFields: {}, requiredTasks: [] },
        { warningFields: {}, warningTasks: [], details: {}, config: {} },
      ]
    : await Promise.all([
        evaluateStudentNewsMinimumRequirements(validationPayload, { validationConfig }),
        evaluateStudentNewsCompliance(validationPayload, { validationConfig }),
      ])
  const previousIssues = normalizeValidationIssueMap(
    /** @type {Record<string, unknown> | null | undefined} */ (existing?.validationIssuesJson)
  )
  const updatedIssues = mode === "draft"
    ? { issues: previousIssues, newlyFixed: [] }
    : updateStudentNewsValidationIssues(previousIssues, compliance)
  const mergedReviewNote = mergeStudentNewsReviewNoteWithCompliance(
    /** @type {string | undefined} */ (existing?.reviewNote),
    updatedIssues.issues
  )
  const mmrPassed = mode === "draft"
    ? Boolean(existing?.mmrPassedAt || existing?.dateSatisfiedAt)
    : minimumRequirements.passed === true
  const existingStatus = normalizeStudentNewsReviewStatus(
    existing?.reviewStatus,
    STUDENT_NEWS_REVIEW_STATUS_SUBMITTED
  )
  const existingSubmissionState = normalizeStudentNewsSubmissionState(
    existing?.submissionState,
    normalizeText(existing?.firstSubmittedAt || existing?.submittedAt)
      ? STUDENT_NEWS_SUBMISSION_STATE_SUBMITTED
      : STUDENT_NEWS_SUBMISSION_STATE_DRAFT
  )
  let reviewNote = stripAwaitingReReviewMarker(mergedReviewNote)
  if (existingStatus === STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED) {
    reviewNote = addAwaitingReReviewMarker(reviewNote)
  }

  const submittedAt = mode === "draft"
    ? parseDateOrNull(existing?.submittedAt) || new Date(nowDate.getTime())
    : new Date(nowDate.getTime())
  let reviewStatus = existingStatus
  let submissionState = existingSubmissionState
  let draftCheckedAt = parseDateOrNull(existing?.draftCheckedAt)
  let mmrPassedAt = parseDateOrNull(existing?.mmrPassedAt)
  let dateSatisfiedAt = parseDateOrNull(existing?.dateSatisfiedAt)
  let reportDateLockedAt = parseDateOrNull(existing?.reportDateLockedAt)
  let firstSubmittedAt = parseDateOrNull(existing?.firstSubmittedAt)
  let lastSubmittedAt = parseDateOrNull(existing?.lastSubmittedAt)
  let editableUntil = parseDateOrNull(existing?.editableUntil)
  const computedEditableUntil = resolveStudentNewsEditableUntil(reportDateDate)

  if (mode === "draft") {
    submissionState = existingSubmissionState || STUDENT_NEWS_SUBMISSION_STATE_DRAFT
  } else if (mode === "check") {
    draftCheckedAt = submittedAt
    if (mmrPassed) {
      if (!(mmrPassedAt instanceof Date)) mmrPassedAt = submittedAt
      if (!(dateSatisfiedAt instanceof Date)) dateSatisfiedAt = submittedAt
      if (!(reportDateLockedAt instanceof Date)) reportDateLockedAt = submittedAt
      if (!(editableUntil instanceof Date) && computedEditableUntil instanceof Date) editableUntil = computedEditableUntil
      submissionState = firstSubmittedAt instanceof Date
        ? STUDENT_NEWS_SUBMISSION_STATE_SUBMITTED
        : STUDENT_NEWS_SUBMISSION_STATE_READY
    } else if (firstSubmittedAt instanceof Date) {
      submissionState = STUDENT_NEWS_SUBMISSION_STATE_SUBMITTED
    } else if (dateSatisfiedAt instanceof Date || mmrPassedAt instanceof Date) {
      submissionState = STUDENT_NEWS_SUBMISSION_STATE_READY
    } else {
      submissionState = STUDENT_NEWS_SUBMISSION_STATE_DRAFT
    }
  } else {
    const hasSatisfiedDate =
      mmrPassedAt instanceof Date
      || dateSatisfiedAt instanceof Date
      || reportDateLockedAt instanceof Date
      || existingSubmissionState === STUDENT_NEWS_SUBMISSION_STATE_READY
      || existingSubmissionState === STUDENT_NEWS_SUBMISSION_STATE_SUBMITTED
    if (!mmrPassed || !hasSatisfiedDate) {
      throwWithStatusPayload(409, "Minimum requirements have not been met. Run Check first.", {
        saved: false,
        item: existing ? await buildStudentNewsClientItem(existing, { validationConfig }) : null,
        mmrPassed: false,
        mmrFailedFields: minimumRequirements.failedFields || {},
        warningFields: compliance.warningFields || {},
        requiredTasks: minimumRequirements.requiredTasks || [],
        warningTasks: compliance.warningTasks || [],
        submissionState: existingSubmissionState,
        dateSatisfied: Boolean(dateSatisfiedAt),
        reportDateLocked: Boolean(reportDateLockedAt),
      })
    }
    if (!(reportDateLockedAt instanceof Date)) reportDateLockedAt = submittedAt
    if (!(mmrPassedAt instanceof Date)) mmrPassedAt = submittedAt
    if (!(dateSatisfiedAt instanceof Date)) dateSatisfiedAt = submittedAt
    if (!(editableUntil instanceof Date) && computedEditableUntil instanceof Date) editableUntil = computedEditableUntil
    if (!(firstSubmittedAt instanceof Date)) firstSubmittedAt = submittedAt
    lastSubmittedAt = submittedAt
    submissionState = STUDENT_NEWS_SUBMISSION_STATE_SUBMITTED
    reviewStatus = existingStatus === STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED
      ? STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED
      : STUDENT_NEWS_REVIEW_STATUS_SUBMITTED
  }

  let enrollmentPeriodId = normalizeText(payload?.enrollmentPeriodId)
  if (!enrollmentPeriodId && normalizeText(existing?.enrollmentPeriodId)) {
    enrollmentPeriodId = normalizeText(existing?.enrollmentPeriodId)
  }
  if (!enrollmentPeriodId) {
    const schoolYear = getConfiguredSchoolYear()
    const period = await resolveEnrollmentPeriodForStudent(prisma, id, {
      schoolYear,
    })
    enrollmentPeriodId = normalizeText(period?.id)
  }

  const reportData = {
    enrollmentPeriodId: enrollmentPeriodId || null,
    sourceLink,
    articleTitle,
    byline: normalizeNullableText(byline),
    articleDateline: normalizeNullableText(articleDateline),
    leadSynopsis,
    actionActor,
    actionAffected,
    actionWhere,
    actionWhat,
    actionWhy,
    biasAssessment: normalizeNullableText(biasAssessment),
    vocabularyJson: vocabulary,
    submittedAt,
    submissionState,
    draftCheckedAt,
    mmrPassedAt,
    dateSatisfiedAt,
    reportDateLockedAt,
    firstSubmittedAt,
    lastSubmittedAt,
    editableUntil,
    reviewStatus,
    reviewNote: normalizeNullableText(reviewNote),
    validationIssuesJson: updatedIssues.issues,
    reviewedAt: mode === "draft" ? parseDateOrNull(existing?.reviewedAt) : null,
    reviewedByUsername: mode === "draft"
      ? normalizeNullableText(existing?.reviewedByUsername)
      : null,
  }

  /** @type {Record<string, unknown> | null} */
  let saved = null
  const existingId = normalizeText(existing?.id)
  if (!fallbackOnly && existingId && hasPrismaDelegateMethod(prisma, "studentNewsReport", "update")) {
    try {
      saved = await prisma.studentNewsReport.update({
        where: { id: existingId },
        data: reportData,
      })
    } catch (error) {
      const code = normalizeText(/** @type {{ code?: unknown }} */ (error)?.code).toUpperCase()
      if (
        isStudentNewsReportSchemaUnavailableError(error)
        || isStudentNewsReviewSchemaUnavailableError(error)
        || code === "P2025"
      ) {
        saved = null
      } else {
        throw error
      }
    }
  }
  if (!saved && !fallbackOnly && hasPrismaDelegateMethod(prisma, "studentNewsReport", "upsert")) {
    try {
      saved = await prisma.studentNewsReport.upsert({
        where: {
          studentRefId_reportDate: {
            studentRefId: id,
            reportDate: reportDateDate,
          },
        },
        update: reportData,
        create: {
          studentRefId: id,
          reportDate: reportDateDate,
          ...reportData,
        },
      })
    } catch (error) {
      if (
        isStudentNewsReportSchemaUnavailableError(error)
        || isStudentNewsReviewSchemaUnavailableError(error)
      ) {
        saved = null
      } else {
        throw error
      }
    }
  }

  if (!saved) {
    const fallbackSaved = upsertStudentNewsReportInFallbackStore(id, reportDateText, {
      ...reportData,
      submittedAt: submittedAt?.toISOString?.() || null,
      draftCheckedAt: draftCheckedAt?.toISOString?.() || null,
      mmrPassedAt: mmrPassedAt?.toISOString?.() || null,
      dateSatisfiedAt: dateSatisfiedAt?.toISOString?.() || null,
      reportDateLockedAt: reportDateLockedAt?.toISOString?.() || null,
      firstSubmittedAt: firstSubmittedAt?.toISOString?.() || null,
      lastSubmittedAt: lastSubmittedAt?.toISOString?.() || null,
      editableUntil: editableUntil?.toISOString?.() || null,
      reviewedAt: null,
      reviewedByUsername: null,
    })
    saved = {
      ...fallbackSaved,
      reportDate: parseLocalDateOnly(fallbackSaved.reportDate) || fallbackSaved.reportDate,
      submittedAt: parseDateOrNull(fallbackSaved.submittedAt) || fallbackSaved.submittedAt,
    }
  }

  const mappedItem = await buildStudentNewsClientItem(saved, { validationConfig })
  const autoApproveConfig = getStudentNewsAutoApprovalConfigSync()
  const autoApproveDueAt =
    mode === "submit" && reviewStatus === STUDENT_NEWS_REVIEW_STATUS_SUBMITTED
      ? resolveStudentNewsAutoApproveDueAt(saved, autoApproveConfig)
      : null
  const responseMessage = mode === "draft"
    ? "Draft saved."
    : mode === "check"
    ? mmrPassed
      ? !(existing?.mmrPassedAt)
        ? "Minimum requirements met. Today's report date is satisfied and locked. You may keep improving before submit."
        : "Draft saved. Minimum requirements still met."
      : `Draft saved. ${Object.keys(minimumRequirements.failedFields || {}).length} required fixes remain.`
    : autoApproveConfig.autoApproveEnabled && autoApproveDueAt instanceof Date && !Number.isNaN(autoApproveDueAt.valueOf())
      ? `Submitted. Auto-approval is scheduled after ${autoApproveConfig.autoApproveDelayHours} hours while edits remain open until Sunday 00:00.`
      : "Submitted. You may continue improving until Sunday 00:00."

  return {
    generatedAt: new Date().toISOString(),
    window,
    saved: true,
    message: responseMessage,
    item: mappedItem,
    mmrPassed,
    mmrFailedFields: mode === "draft" ? {} : minimumRequirements.failedFields || {},
    warningFields: compliance.warningFields || {},
    requiredTasks: minimumRequirements.requiredTasks || [],
    warningTasks: compliance.warningTasks || [],
    submissionState,
    dateSatisfied: Boolean(dateSatisfiedAt),
    reportDateLocked: Boolean(reportDateLockedAt),
    firstSubmittedAt: parseDateOrNull(firstSubmittedAt)?.toISOString?.() || "",
    fixedFields: updatedIssues.newlyFixed,
    allowedSources: compliance?.config?.allowedDomains || [],
    validation: compliance.details,
    complianceFailed: !mmrPassed,
    failedFields: minimumRequirements.failedFields || {},
    revisionTasks: minimumRequirements.requiredTasks || [],
    autoApproveEnabled: autoApproveConfig.autoApproveEnabled,
    autoApproveDelayHours: autoApproveConfig.autoApproveDelayHours,
    autoApproveDueAt: autoApproveDueAt?.toISOString?.() || "",
  }
}

/**
 * @param {string} studentRefId
 * @param {Record<string, unknown>} [payload]
 * @param {{ now?: unknown, validationConfig?: Record<string, unknown> }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function saveStudentNewsDraftCheck(studentRefId, payload = {}, options = {}) {
  return persistStudentNewsReport(studentRefId, payload, options, "check")
}

/**
 * Save the current report without running MMR or changing submit eligibility.
 * This endpoint is used by the explicit Save button and background autosave.
 */
export async function saveStudentNewsDraft(studentRefId, payload = {}, options = {}) {
  return persistStudentNewsReport(studentRefId, payload, options, "draft")
}

/**
 * @param {string} studentRefId
 * @param {Record<string, unknown>} [payload]
 * @param {{ now?: unknown, validationConfig?: Record<string, unknown> }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function saveStudentNewsReport(studentRefId, payload = {}, options = {}) {
  return persistStudentNewsReport(studentRefId, payload, options, "submit")
}

export {
  normalizeStudentNewsReviewStatus,
  resolveStudentNewsStatusColor,
}
