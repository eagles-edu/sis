// @ts-check
import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import {
  evaluateStudentNewsAutoApprovalState,
  getStudentNewsAutoApprovalConfigSync,
  reconcileStudentNewsAutoApprovals,
} from "./student-news-auto-approval.mjs"
import {
  buildStudentNewsFallbackOverlayIndex,
  isStudentNewsReportSchemaUnavailableError,
  isStudentNewsReviewSchemaUnavailableError,
  readStudentNewsFallbackEntries,
  resolveStudentNewsFallbackReviewOverlay,
  upsertStudentNewsReportInFallbackStore,
} from "./student-news-fallback.mjs"
import { canonicalizeLevel as canonicalizeCatalogLevel } from "./level-catalog.mjs"
import {
  evaluateStudentNewsCompliance,
  mergeStudentNewsReviewNoteWithCompliance,
  updateStudentNewsValidationIssues,
} from "./student-news-compliance.mjs"

const STUDENT_NEWS_SUBMISSION_STATE_SUBMITTED = "submitted"

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

const FIXED_TIME_ZONE_OFFSET_MINUTES = 7 * 60
const FIXED_TIME_ZONE_OFFSET_MS = FIXED_TIME_ZONE_OFFSET_MINUTES * 60 * 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000

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
 * @param {number} [days]
 * @returns {Date}
 */
function addDays(value = new Date(), days = 0) {
  const date = startOfDay(value)
  const shifted = shiftToFixedTimeZone(date)
  shifted.setUTCDate(shifted.getUTCDate() + (Number.parseInt(String(days), 10) || 0))
  return shiftFromFixedTimeZone(shifted)
}

/**
 * @param {unknown} [now]
 * @returns {Date}
 */
function resolveStudentNewsRevisionEditableUntil(now = new Date()) {
  return endOfDay(addDays(now, 15))
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
 * @param {unknown} prisma
 * @param {string} delegateName
 * @param {string} methodName
 * @returns {boolean}
 */
function hasPrismaDelegateMethod(prisma, delegateName, methodName) {
  const delegate = prisma && typeof prisma === "object" ? prisma[delegateName] : null
  return Boolean(delegate && typeof delegate[methodName] === "function")
}

/**
 * @param {string} [fieldKey]
 * @param {Record<string, unknown> | null | undefined} [entry]
 * @returns {{
 *   field: string,
 *   label: string,
 *   status: string,
 *   message: string,
 *   criterion: string,
 *   steps: string[],
 *   score: number | null,
 *   threshold: number | null,
 *   updatedAt: string,
 * } | null}
 */
function normalizeValidationIssueEntry(fieldKey = "", entry = {}) {
  const key = normalizeText(fieldKey)
  if (!key) return null
  const source = entry && typeof entry === "object" ? entry : {}
  const status = normalizeLower(source.status) === "fixed" ? "fixed" : "pending"
  const steps = Array.isArray(source.steps)
    ? source.steps.map((item) => normalizeText(item)).filter(Boolean)
    : []
  return {
    field: key,
    label: normalizeText(source.label || key),
    status,
    message: normalizeText(source.message),
    criterion: normalizeText(source.criterion),
    steps,
    score: Number.isFinite(Number(source.score)) ? Number(source.score) : null,
    threshold: Number.isFinite(Number(source.threshold)) ? Number(source.threshold) : null,
    updatedAt: parseDateOrNull(source.updatedAt)?.toISOString?.() || new Date().toISOString(),
  }
}

/**
 * @param {Record<string, unknown> | null | undefined} [value]
 * @returns {Record<string, ReturnType<typeof normalizeValidationIssueEntry>>}
 */
function normalizeValidationIssueMap(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {}
  const normalized = {}
  Object.keys(source).forEach((fieldKey) => {
    const entry = normalizeValidationIssueEntry(fieldKey, source[fieldKey])
    if (entry) normalized[fieldKey] = entry
  })
  return normalized
}

/**
 * @param {unknown} [note]
 * @returns {string}
 */
function stripAwaitingReReviewMarker(note = "") {
  return normalizeText(String(note || "").replaceAll("[[SIS-AWAITING-RE-REVIEW]]", ""))
}

/**
 * @param {unknown} [note]
 * @returns {string}
 */
function addAwaitingReReviewMarker(note = "") {
  const clean = stripAwaitingReReviewMarker(note)
  if (!clean) return "[[SIS-AWAITING-RE-REVIEW]]"
  return `${clean}\n[[SIS-AWAITING-RE-REVIEW]]`
}

/**
 * @param {Record<string, unknown> | null | undefined} [row]
 * @returns {boolean}
 */
function resolveStudentNewsAwaitingReReview(row = {}) {
  if (normalizeStudentNewsReviewStatus(row?.reviewStatus, STUDENT_NEWS_REVIEW_STATUS_SUBMITTED) !== STUDENT_NEWS_REVIEW_STATUS_SUBMITTED) {
    return false
  }
  if (row?.awaitingReReview === true) return true
  return normalizeText(row?.reviewNote).includes("[[SIS-AWAITING-RE-REVIEW]]")
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

/**
 * @param {unknown} value
 * @returns {string}
 */
function canonicalizeLevel(value) {
  return canonicalizeCatalogLevel(value)
}

const STUDENT_NEWS_REVIEW_STATUS_SUBMITTED = "submitted"
const STUDENT_NEWS_REVIEW_STATUS_APPROVED = "approved"
const STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED = "revision-requested"
const STUDENT_NEWS_REVIEW_STATUS_COLOR = {
  [STUDENT_NEWS_REVIEW_STATUS_APPROVED]: "green",
  [STUDENT_NEWS_REVIEW_STATUS_SUBMITTED]: "amber",
  [STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED]: "red",
}

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
 * @param {Record<string, unknown> | null | undefined} [student]
 * @param {string} [fallbackStudentRefId]
 * @returns {{
 *   studentRefId: string,
 *   eaglesId: string,
 *   studentNumber: number | null,
 *   fullName: string,
 *   englishName: string,
 *   level: string,
 * }}
 */
function mapStudentNewsReviewStudentSummary(student = {}, fallbackStudentRefId = "") {
  const profile = student?.profile && typeof student.profile === "object" ? student.profile : {}
  return {
    studentRefId: normalizeText(student?.id || fallbackStudentRefId),
    eaglesId: normalizeText(student?.eaglesId),
    studentNumber: normalizeInteger(student?.studentNumber),
    fullName: normalizeText(profile?.fullName || profile?.englishName),
    englishName: normalizeText(profile?.englishName),
    level: canonicalizeLevel(profile?.currentGrade || "") || "",
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
 *   submittedAt: string,
 *   reviewStatus: string,
 *   awaitingReReview: boolean,
 *   statusColor: string,
 *   reviewNote: string,
 *   validationIssuesJson: Record<string, ReturnType<typeof normalizeValidationIssueEntry>>,
 *   failedFields: string[],
 *   fixedFields: string[],
 *   reviewedByUsername: string,
 *   reviewedAt: string,
 * }}
 */
function mapStudentNewsReportRow(row = {}) {
  const sourceLink = normalizeText(row?.sourceLink || row?.sourceUrl)
  const articleTitle = normalizeText(row?.articleTitle || row?.headline)
  const leadSynopsis = normalizeText(row?.leadSynopsis || row?.summary)
  const biasAssessment = normalizeText(row?.biasAssessment || row?.reflection)
  const reviewStatus = normalizeStudentNewsReviewStatus(row?.reviewStatus, STUDENT_NEWS_REVIEW_STATUS_SUBMITTED)
  const awaitingReReview = resolveStudentNewsAwaitingReReview(row)
  const validationIssues = normalizeValidationIssueMap(/** @type {Record<string, unknown> | null | undefined} */ (row?.validationIssuesJson))
  const pendingFieldKeys = Object.keys(validationIssues).filter(
    (fieldKey) => normalizeLower(validationIssues?.[fieldKey]?.status) !== "fixed"
  )
  const fixedFieldKeys = Object.keys(validationIssues).filter(
    (fieldKey) => normalizeLower(validationIssues?.[fieldKey]?.status) === "fixed"
  )
  return {
    id: normalizeText(row?.id),
    studentRefId: normalizeText(row?.studentRefId),
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
    submittedAt: parseDateOrNull(row?.submittedAt)?.toISOString?.() || "",
    submissionState: normalizeText(row?.submissionState),
    reviewStatus,
    awaitingReReview,
    statusColor: resolveStudentNewsStatusColor(reviewStatus),
    reviewNote: stripAwaitingReReviewMarker(/** @type {unknown} */ (row?.reviewNote)),
    validationIssuesJson: validationIssues,
    failedFields: pendingFieldKeys,
    fixedFields: fixedFieldKeys,
    reviewedByUsername: normalizeText(row?.reviewedByUsername),
    reviewedAt: parseDateOrNull(row?.reviewedAt)?.toISOString?.() || "",
  }
}

/**
 * @param {Record<string, unknown> | null | undefined} [item]
 * @returns {number}
 */
function studentNewsReviewSortValue(item = {}) {
  const submittedAt = parseDateOrNull(item?.submittedAt)
  if (submittedAt instanceof Date && !Number.isNaN(submittedAt.valueOf())) return submittedAt.valueOf()
  const reportDate = parseLocalDateOnly(item?.reportDate)
  if (reportDate instanceof Date && !Number.isNaN(reportDate.valueOf())) return reportDate.valueOf()
  return 0
}

/**
 * @param {Record<string, unknown> | null | undefined} [item]
 * @returns {string}
 */
function studentNewsReviewSearchText(item = {}) {
  const student = item?.student && typeof item.student === "object" ? item.student : {}
  return normalizeLower([
    item?.articleTitle,
    item?.sourceLink,
    item?.leadSynopsis,
    item?.actionActor,
    item?.actionAffected,
    item?.actionWhere,
    item?.actionWhat,
    item?.actionWhy,
    student?.eaglesId,
    student?.fullName,
    student?.englishName,
    student?.level,
  ].map((entry) => normalizeText(entry)).filter(Boolean).join(" "))
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeStudentNewsReviewTake(value) {
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed)) return 200
  return Math.max(1, Math.min(parsed, 500))
}

/**
 * @param {Record<string, unknown> | null | undefined} prisma
 * @param {string[]} [studentRefIds]
 * @returns {Promise<Map<string, Record<string, unknown>>>}
 */
async function loadStudentNewsReviewStudentMap(prisma, studentRefIds = []) {
  const ids = Array.isArray(studentRefIds)
    ? Array.from(new Set(studentRefIds.map((entry) => normalizeText(entry)).filter(Boolean)))
    : []
  if (!ids.length || !hasPrismaDelegateMethod(prisma, "student", "findMany")) return new Map()
  const rows = await prisma.student.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      eaglesId: true,
      studentNumber: true,
      profile: true,
    },
  })
  return new Map(rows.map((row) => [normalizeText(row?.id), /** @type {Record<string, unknown>} */ (row)]))
}

/**
 * @param {Record<string, unknown> | null | undefined} [payload]
 * @returns {string}
 */
function resolveStudentNewsReviewActionStatus(payload = {}) {
  const action = normalizeLower(payload?.action || payload?.status)
  if (!action) return ""
  if (action === "approve" || action === "approved") return STUDENT_NEWS_REVIEW_STATUS_APPROVED
  if (
    action === "revision"
    || action === "revision-requested"
    || action === "revision_requested"
    || action === "revise"
    || action === "request-revision"
    || action === "request_revision"
  ) {
    return STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED
  }
  if (action === "submitted" || action === "reset") return STUDENT_NEWS_REVIEW_STATUS_SUBMITTED
  return ""
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
 * }}
 */
function normalizeStudentNewsReviewEditablePayload(payload = {}) {
  const sourceLink = normalizeHttpUrl(payload?.sourceLink)
  const articleTitle = normalizeText(payload?.articleTitle)
  const byline = normalizeText(payload?.byline)
  const articleDateline = normalizeText(payload?.articleDateline)
  const leadSynopsis = normalizeText(payload?.leadSynopsis)
  const actionActor = normalizeText(payload?.actionActor)
  const actionAffected = normalizeText(payload?.actionAffected)
  const actionWhere = normalizeText(payload?.actionWhere)
  const actionWhat = normalizeText(payload?.actionWhat)
  const actionWhy = normalizeText(payload?.actionWhy)
  const biasAssessment = normalizeText(payload?.biasAssessment)
  assertWithStatus(
    Boolean(
      sourceLink &&
        articleTitle &&
        byline &&
        articleDateline &&
        leadSynopsis &&
        actionActor &&
        actionAffected &&
        actionWhere &&
        actionWhat &&
        actionWhy &&
        biasAssessment,
    ),
    400,
    "All report fields are required.",
  )
  return {
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
  }
}

/**
 * @param {unknown} value
 * @returns {Date | null}
 */
function normalizeStudentNewsReviewDateFilter(value) {
  const date = parseLocalDateOnly(value)
  return date instanceof Date && !Number.isNaN(date.valueOf()) ? date : null
}

/**
 * @param {{ includeReviewFields?: boolean }} [options]
 * @returns {Record<string, unknown>}
 */
function buildStudentNewsReviewSelect({ includeReviewFields = true } = {}) {
  const select = {
    id: true,
    studentRefId: true,
    reportDate: true,
    sourceLink: true,
    articleTitle: true,
    byline: true,
    articleDateline: true,
    leadSynopsis: true,
    actionActor: true,
    actionAffected: true,
    actionWhere: true,
    actionWhat: true,
    actionWhy: true,
    biasAssessment: true,
    vocabularyJson: true,
    submittedAt: true,
    submissionState: true,
    student: {
      select: {
        id: true,
        eaglesId: true,
        studentNumber: true,
        profile: true,
      },
    },
  }
  if (includeReviewFields) {
    select.reviewStatus = true
    select.reviewNote = true
    select.validationIssuesJson = true
    select.reviewedByUsername = true
    select.reviewedAt = true
  }
  return select
}

/**
 * @param {Record<string, unknown> | null | undefined} [row]
 * @param {{ studentByRefId?: Map<string, Record<string, unknown>> }} [options]
 * @returns {Record<string, unknown>}
 */
function mapStudentNewsReviewItem(row = {}, options = {}) {
  const studentByRefId = options?.studentByRefId instanceof Map ? options.studentByRefId : new Map()
  const report = mapStudentNewsReportRow(row)
  const fallbackStudent = studentByRefId.get(report.studentRefId) || {}
  const student = mapStudentNewsReviewStudentSummary(
    row?.student && typeof row.student === "object" ? row.student : fallbackStudent,
    report.studentRefId
  )
  return {
    ...report,
    student,
  }
}

/**
 * @param {{
 *   status?: string,
 *   level?: string,
 *   studentRefId?: string,
 *   dateFrom?: string,
 *   dateTo?: string,
 *   query?: string,
 *   take?: string | number,
 * }} [options]
 * @returns {Promise<{
 *   generatedAt: string,
 *   filters: {
 *     status: string,
 *     level: string,
 *     studentRefId: string,
 *     dateFrom: string,
 *     dateTo: string,
 *     query: string,
 *     take: number,
 *   },
 *   total: number,
 *   hasMore: boolean,
 *   statusSummary: {
 *     submitted: number,
 *     approved: number,
 *     revisionRequested: number,
 *   },
 *   items: Array<Record<string, unknown>>,
 * }>}
 */
export async function listStudentNewsReportsForReview({
  status = STUDENT_NEWS_REVIEW_STATUS_SUBMITTED,
  level = "",
  studentRefId = "",
  dateFrom = "",
  dateTo = "",
  query = "",
  take = "200",
} = {}) {
  const prisma = await getSharedPrismaClient()
  await reconcileStudentNewsAutoApprovals()
  const limit = normalizeStudentNewsReviewTake(take)
  const requestedStatus = normalizeStudentNewsReviewStatus(status, "all")
  const requestedLevel = canonicalizeLevel(level || "") || ""
  const requestedStudentRefId = normalizeText(studentRefId)
  const requestedQuery = normalizeLower(query)
  const fromDate = normalizeStudentNewsReviewDateFilter(dateFrom)
  const toDate = normalizeStudentNewsReviewDateFilter(dateTo)

  const where = {}
  const rawStatus = normalizeLower(status)
  const requestedSubmissionState = rawStatus === "draft" ? "draft" : ""
  if (requestedSubmissionState) where.submissionState = requestedSubmissionState
  else if (rawStatus !== "all") where.submissionState = STUDENT_NEWS_SUBMISSION_STATE_SUBMITTED
  if (requestedStudentRefId) where.studentRefId = requestedStudentRefId
  if (fromDate || toDate) {
    where.reportDate = {}
    if (fromDate) where.reportDate.gte = startOfDay(fromDate)
    if (toDate) where.reportDate.lte = endOfDay(toDate)
  }
  if (requestedStatus !== "all") {
    where.reviewStatus = requestedStatus
  }

  let reportRows = []
  let requiresFallback = false
  let reviewSchemaUnavailable = false
  if (hasPrismaDelegateMethod(prisma, "studentNewsReport", "findMany")) {
    const query = {
      where,
      select: buildStudentNewsReviewSelect({ includeReviewFields: true }),
      orderBy: [{ submittedAt: "desc" }, { reportDate: "desc" }],
      take: Math.max(limit * 3, limit + 50),
    }
    try {
      reportRows = await prisma.studentNewsReport.findMany(query)
    } catch (error) {
      if (isStudentNewsReviewSchemaUnavailableError(error)) {
        reviewSchemaUnavailable = true
        const legacyWhere = { ...where }
        delete legacyWhere.submissionState
        delete legacyWhere.reviewStatus
        try {
          reportRows = await prisma.studentNewsReport.findMany({
            ...query,
            where: legacyWhere,
            select: buildStudentNewsReviewSelect({ includeReviewFields: false }),
          })
        } catch (legacyError) {
          if (!isStudentNewsReportSchemaUnavailableError(legacyError)) throw legacyError
          requiresFallback = true
        }
      } else if (isStudentNewsReportSchemaUnavailableError(error)) {
        requiresFallback = true
      } else {
        throw error
      }
    }
  } else {
    requiresFallback = true
  }

  if (requiresFallback) {
    const fromDateKey = fromDate ? toLocalIsoDate(fromDate) : ""
    const toDateKey = toDate ? toLocalIsoDate(toDate) : ""
    reportRows = readStudentNewsFallbackEntries()
      .filter((entry) => {
        const submissionState = normalizeLower(entry?.submissionState)
        return requestedSubmissionState
          ? submissionState === requestedSubmissionState
          : rawStatus === "all" || !submissionState || submissionState === STUDENT_NEWS_SUBMISSION_STATE_SUBMITTED
      })
      .filter((entry) => !requestedStudentRefId || normalizeText(entry?.studentRefId) === requestedStudentRefId)
      .filter((entry) => !fromDateKey || normalizeText(entry?.reportDate) >= fromDateKey)
      .filter((entry) => !toDateKey || normalizeText(entry?.reportDate) <= toDateKey)
      .sort((left, right) => {
        const leftDate = parseDateOrNull(left?.submittedAt)?.valueOf?.() || parseLocalDateOnly(left?.reportDate)?.valueOf?.() || 0
        const rightDate = parseDateOrNull(right?.submittedAt)?.valueOf?.() || parseLocalDateOnly(right?.reportDate)?.valueOf?.() || 0
        if (leftDate !== rightDate) return rightDate - leftDate
        return normalizeText(left?.id).localeCompare(normalizeText(right?.id))
      })
  }

  const fallbackReviewOverlayIndex =
    reviewSchemaUnavailable && !requiresFallback
      ? buildStudentNewsFallbackOverlayIndex(readStudentNewsFallbackEntries())
      : null

  const studentByRefId = await loadStudentNewsReviewStudentMap(
    prisma,
    reportRows.map((entry) => normalizeText(entry?.studentRefId))
  )
  const mapped = reportRows.map((row) => {
    const reviewOverlay = resolveStudentNewsFallbackReviewOverlay(row, fallbackReviewOverlayIndex)
    const mappedRow = reviewOverlay
      ? {
          ...row,
          reviewStatus: reviewOverlay.reviewStatus,
          reviewNote: reviewOverlay.reviewNote,
          validationIssuesJson: reviewOverlay.validationIssuesJson,
          reviewedByUsername: reviewOverlay.reviewedByUsername,
          reviewedAt: reviewOverlay.reviewedAt,
        }
      : row
    return mapStudentNewsReviewItem(mappedRow, {
      studentByRefId,
    })
  })
  const autoApprovalConfig = getStudentNewsAutoApprovalConfigSync()
  const autoApprovalStates = await Promise.all(
    mapped.map((entry) =>
      evaluateStudentNewsAutoApprovalState(entry, {
        config: autoApprovalConfig,
      })
    )
  )
  const filtered = mapped.filter((entry, index) => {
    const autoApprovalState = autoApprovalStates[index] || null
    if (autoApprovalState?.enabled && autoApprovalState.candidate && !autoApprovalState.due) return false
    if (requestedStatus !== "all" && normalizeStudentNewsReviewStatus(entry?.reviewStatus, "") !== requestedStatus) return false
    if (requestedLevel) {
      const entryLevel = canonicalizeLevel(entry?.student?.level || "") || ""
      if (entryLevel !== requestedLevel) return false
    }
    if (requestedQuery && !studentNewsReviewSearchText(entry).includes(requestedQuery)) return false
    return true
  })
  filtered.sort((left, right) => {
    const diff = studentNewsReviewSortValue(right) - studentNewsReviewSortValue(left)
    if (diff !== 0) return diff
    return normalizeText(left?.id).localeCompare(normalizeText(right?.id))
  })

  const statusSummary = {
    submitted: 0,
    approved: 0,
    revisionRequested: 0,
  }
  filtered.forEach((entry) => {
    const entryStatus = normalizeStudentNewsReviewStatus(entry?.reviewStatus, STUDENT_NEWS_REVIEW_STATUS_SUBMITTED)
    if (entryStatus === STUDENT_NEWS_REVIEW_STATUS_APPROVED) statusSummary.approved += 1
    else if (entryStatus === STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED) statusSummary.revisionRequested += 1
    else statusSummary.submitted += 1
  })

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      status: requestedStatus || "all",
      level: requestedLevel,
      studentRefId: requestedStudentRefId,
      dateFrom: fromDate ? toLocalIsoDate(fromDate) : "",
      dateTo: toDate ? toLocalIsoDate(toDate) : "",
      query: normalizeText(query),
      take: limit,
    },
    total: filtered.length,
    hasMore: filtered.length > limit,
    statusSummary,
    items: filtered.slice(0, limit),
  }
}

/**
 * @param {string} reportId
 * @param {Record<string, unknown>} [payload]
 * @param {Record<string, unknown>} [options]
 * @returns {Promise<{ generatedAt: string, item: Record<string, unknown> | null }>}
 */
export async function reviewStudentNewsReport(reportId, payload = {}, options = {}) {
  const prisma = await getSharedPrismaClient()
  const id = normalizeText(reportId)
  assertWithStatus(Boolean(id), 400, "reportId is required")
  const action = normalizeLower(payload?.action || payload?.status)
  const reviewStatus = resolveStudentNewsReviewActionStatus(payload)
  assertWithStatus(Boolean(action), 400, "Unsupported news review action")

  const now = new Date()
  const reviewNote = normalizeNullableText(
    stripAwaitingReReviewMarker(payload?.reviewNote || payload?.note || payload?.comment)
  )
  const reviewedByUsername = normalizeNullableText(options?.reviewedByUsername || payload?.reviewedByUsername)
  const normalizedValidationIssues =
    payload?.validationIssuesJson && typeof payload.validationIssuesJson === "object" && !Array.isArray(payload.validationIssuesJson)
      ? normalizeValidationIssueMap(/** @type {Record<string, unknown>} */ (payload.validationIssuesJson))
      : null

  /** @type {Record<string, unknown> | null} */
  let existingReport = null
  let fallbackOnly = false
  if (hasPrismaDelegateMethod(prisma, "studentNewsReport", "findUnique")) {
    try {
      existingReport = await prisma.studentNewsReport.findUnique({
        where: { id },
        select: buildStudentNewsReviewSelect({ includeReviewFields: false }),
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
  if (!existingReport && fallbackOnly) {
    existingReport =
      readStudentNewsFallbackEntries().find((entry) => normalizeText(entry?.id) === id) || null
  }
  assertWithStatus(Boolean(existingReport), 404, "Student news report not found")

  if (action === "save") {
    assertWithStatus(
      normalizeStudentNewsReviewStatus(existingReport?.reviewStatus, STUDENT_NEWS_REVIEW_STATUS_SUBMITTED) !== STUDENT_NEWS_REVIEW_STATUS_APPROVED,
      403,
      "Approved news reports cannot be edited",
    )
    const editablePayload = normalizeStudentNewsReviewEditablePayload(payload)
    // The admin viewer edits report prose, not vocabulary. Preserve the
    // stored vocabulary when the viewer save payload does not include it.
    if (Array.isArray(existingReport?.vocabularyJson)) {
      editablePayload.vocabularyJson = existingReport.vocabularyJson
    }
    const existingValidationIssues =
      existingReport?.validationIssuesJson && typeof existingReport.validationIssuesJson === "object" && !Array.isArray(existingReport.validationIssuesJson)
        ? normalizeValidationIssueMap(/** @type {Record<string, unknown>} */ (existingReport.validationIssuesJson))
        : {}
    const compliance = await evaluateStudentNewsCompliance(editablePayload, {
      validationConfig: options?.validationConfig || {},
    })
    const updatedIssues = updateStudentNewsValidationIssues(existingValidationIssues, compliance)
    const mergedReviewNote = mergeStudentNewsReviewNoteWithCompliance(reviewNote, updatedIssues.issues)
    const nextReviewNote = stripAwaitingReReviewMarker(mergedReviewNote)
    const updateData = {
      ...editablePayload,
      reviewNote: nextReviewNote,
      validationIssuesJson: updatedIssues.issues,
    }

    /** @type {Record<string, unknown> | null} */
    let updatedReport = null
    if (!fallbackOnly && hasPrismaDelegateMethod(prisma, "studentNewsReport", "update")) {
      try {
        updatedReport = await prisma.studentNewsReport.update({
          where: { id },
          data: updateData,
          select: buildStudentNewsReviewSelect({ includeReviewFields: true }),
        })
      } catch (error) {
        if (
          isStudentNewsReportSchemaUnavailableError(error)
          || isStudentNewsReviewSchemaUnavailableError(error)
        ) {
          // Fall back to file-backed persistence when review schema delegates are unavailable.
        } else if (normalizeText(error?.code).toUpperCase() === "P2025") {
          assertWithStatus(false, 404, "Student news report not found")
        } else {
          throw error
        }
      }
    }

    if (!updatedReport) {
      const studentRefId = normalizeText(existingReport?.studentRefId)
      const reportDateKey = normalizeText(toLocalIsoDate(existingReport?.reportDate))
      assertWithStatus(Boolean(studentRefId), 404, "Student news report not found")
      assertWithStatus(Boolean(reportDateKey), 404, "Student news report not found")
      const fallbackSaved = upsertStudentNewsReportInFallbackStore(studentRefId, reportDateKey, {
        ...existingReport,
        id,
        ...editablePayload,
        reviewNote: nextReviewNote,
        validationIssuesJson: updatedIssues.issues,
      })
      updatedReport = {
        ...existingReport,
        ...fallbackSaved,
        id,
        studentRefId,
        reportDate: existingReport?.reportDate || parseLocalDateOnly(reportDateKey) || new Date(reportDateKey),
      }
    }

    const studentByRefId = await loadStudentNewsReviewStudentMap(prisma, [normalizeText(updatedReport?.studentRefId)])
    const item = mapStudentNewsReviewItem(updatedReport, {
      studentByRefId,
    })

    return {
      generatedAt: new Date().toISOString(),
      item,
    }
  }

  assertWithStatus(Boolean(reviewStatus), 400, "Unsupported news review action")
  const updateData = {
    reviewStatus,
    reviewNote,
    reviewedByUsername,
    reviewedAt: now,
  }
  if (reviewStatus === STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED) {
    updateData.editableUntil = resolveStudentNewsRevisionEditableUntil(now)
  }
  if (normalizedValidationIssues && Object.keys(normalizedValidationIssues).length) {
    updateData.validationIssuesJson = normalizedValidationIssues
  }

  /** @type {Record<string, unknown> | null} */
  let updatedReport = null
  if (!fallbackOnly && hasPrismaDelegateMethod(prisma, "studentNewsReport", "update")) {
    try {
      updatedReport = await prisma.studentNewsReport.update({
        where: { id },
        data: updateData,
        select: buildStudentNewsReviewSelect({ includeReviewFields: true }),
      })
    } catch (error) {
      if (
        isStudentNewsReportSchemaUnavailableError(error)
        || isStudentNewsReviewSchemaUnavailableError(error)
      ) {
        // Fall back to file-backed persistence when review schema delegates are unavailable.
      } else if (normalizeText(error?.code).toUpperCase() === "P2025") {
        assertWithStatus(false, 404, "Student news report not found")
      } else {
        throw error
      }
    }
  }

  if (!updatedReport) {
    const studentRefId = normalizeText(existingReport?.studentRefId)
    const reportDateKey = normalizeText(toLocalIsoDate(existingReport?.reportDate))
    assertWithStatus(Boolean(studentRefId), 404, "Student news report not found")
    assertWithStatus(Boolean(reportDateKey), 404, "Student news report not found")
    const existingValidationIssues =
      existingReport?.validationIssuesJson && typeof existingReport.validationIssuesJson === "object" && !Array.isArray(existingReport.validationIssuesJson)
        ? /** @type {Record<string, unknown>} */ (existingReport.validationIssuesJson)
        : null
    const fallbackSaved = upsertStudentNewsReportInFallbackStore(studentRefId, reportDateKey, {
      ...existingReport,
      id,
      reviewStatus,
      reviewNote,
      editableUntil:
        updateData.editableUntil instanceof Date ?
          updateData.editableUntil.toISOString()
        : existingReport?.editableUntil || null,
      validationIssuesJson:
        updateData.validationIssuesJson
        || existingValidationIssues
        || null,
      reviewedByUsername,
      reviewedAt: now.toISOString(),
    })
    updatedReport = {
      ...existingReport,
      ...fallbackSaved,
      id,
      studentRefId,
      reportDate: existingReport?.reportDate || parseLocalDateOnly(reportDateKey) || new Date(reportDateKey),
    }
  }

  const studentByRefId = await loadStudentNewsReviewStudentMap(prisma, [normalizeText(updatedReport?.studentRefId)])
  const item = mapStudentNewsReviewItem(updatedReport, {
    studentByRefId,
  })

  return {
    generatedAt: new Date().toISOString(),
    item,
  }
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeStudentNewsBulkReportIds(value) {
  if (!Array.isArray(value)) return []
  const ids = []
  const seen = new Set()
  value.forEach((entry) => {
    const id = normalizeText(entry)
    if (!id || seen.has(id)) return
    seen.add(id)
    ids.push(id)
  })
  return ids
}

/**
 * @param {Record<string, unknown>} [payload]
 * @param {Record<string, unknown>} [options]
 * @returns {Promise<{
 *   generatedAt: string,
 *   action: string,
 *   processedCount: number,
 *   reportIds: string[],
 *   items: Array<Record<string, unknown>>,
 * }>}
 */
export async function reviewStudentNewsReportsBulk(payload = {}, options = {}) {
  const action = normalizeLower(payload?.action || payload?.status || "approve")
  assertWithStatus(action === "approve", 400, "Unsupported bulk news review action")
  const reportIds = normalizeStudentNewsBulkReportIds(payload?.reportIds)
  assertWithStatus(reportIds.length > 0, 400, "reportIds are required")
  assertWithStatus(reportIds.length <= 500, 400, "Too many reportIds")

  const reviewPayload = {
    ...(payload && typeof payload === "object" ? payload : {}),
    action,
  }
  delete reviewPayload.reportIds

  const items = []
  for (const reportId of reportIds) {
    const result = await reviewStudentNewsReport(reportId, reviewPayload, options)
    if (result?.item) items.push(result.item)
  }

  return {
    generatedAt: new Date().toISOString(),
    action,
    processedCount: items.length,
    reportIds,
    items,
  }
}

export {
  buildStudentNewsReviewSelect,
  normalizeStudentNewsReviewStatus,
  normalizeStudentNewsReviewTake,
  resolveStudentNewsReviewActionStatus,
  resolveStudentNewsStatusColor,
}
