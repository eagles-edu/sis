import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import {
  addAwaitingReReviewMarker,
  evaluateStudentNewsCompliance,
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

let prismaClientPromise = null

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase()
}

function normalizeNullableText(value) {
  const text = normalizeText(value)
  return text || null
}

function parseDateOrNull(value) {
  if (value instanceof Date) return Number.isNaN(value.valueOf()) ? null : value
  const text = normalizeText(value)
  if (!text) return null
  const parsed = new Date(text)
  return Number.isNaN(parsed.valueOf()) ? null : parsed
}

function normalizeDateValue(value, fallback = new Date()) {
  const parsed = value instanceof Date ? new Date(value.getTime()) : parseDateOrNull(value)
  if (parsed instanceof Date && !Number.isNaN(parsed.valueOf())) return parsed
  return fallback instanceof Date ? new Date(fallback.getTime()) : new Date()
}

const FIXED_TIME_ZONE_OFFSET_MINUTES = 7 * 60
const FIXED_TIME_ZONE_OFFSET_MS = FIXED_TIME_ZONE_OFFSET_MINUTES * 60 * 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000

function shiftToFixedTimeZone(value) {
  return new Date(value.getTime() + FIXED_TIME_ZONE_OFFSET_MS)
}

function shiftFromFixedTimeZone(value) {
  return new Date(value.getTime() - FIXED_TIME_ZONE_OFFSET_MS)
}

function startOfDay(value = new Date()) {
  const source = normalizeDateValue(value)
  const shifted = shiftToFixedTimeZone(source)
  shifted.setUTCHours(0, 0, 0, 0)
  return shiftFromFixedTimeZone(shifted)
}

function endOfDay(value = new Date()) {
  const date = startOfDay(value)
  return new Date(date.getTime() + ONE_DAY_MS - 1)
}

function startOfWeekSunday(value = new Date()) {
  const date = startOfDay(value)
  const shifted = shiftToFixedTimeZone(date)
  const day = shifted.getUTCDay()
  shifted.setUTCDate(shifted.getUTCDate() - day)
  return shiftFromFixedTimeZone(shifted)
}

function toLocalIsoDate(value) {
  const date = value instanceof Date ? value : parseDateOrNull(value)
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) return ""
  const shifted = shiftToFixedTimeZone(date)
  const year = shifted.getUTCFullYear()
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0")
  const day = String(shifted.getUTCDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

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

function addDays(dateValue, days = 0) {
  const date = startOfDay(dateValue)
  const shifted = shiftToFixedTimeZone(date)
  shifted.setUTCDate(shifted.getUTCDate() + (Number.parseInt(String(days), 10) || 0))
  return shiftFromFixedTimeZone(shifted)
}

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

function assertWithStatus(condition, status, message) {
  if (condition) return true
  const error = new Error(message)
  error.statusCode = status
  throw error
}

function hasPrismaDelegateMethod(prisma, delegateName, methodName) {
  return Boolean(prisma?.[delegateName] && typeof prisma[delegateName][methodName] === "function")
}

function isStudentAdminStoreEnabled() {
  const hasDatabaseUrl = Boolean(normalizeText(process.env.DATABASE_URL))
  const envFlag = normalizeLower(process.env.STUDENT_ADMIN_STORE_ENABLED)
  if (!envFlag) return hasDatabaseUrl
  if (["false", "0", "no"].includes(envFlag)) return false
  if (["true", "1", "yes"].includes(envFlag)) return true
  return hasDatabaseUrl
}

async function getPrismaClient() {
  if (!isStudentAdminStoreEnabled()) {
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
const STUDENT_NEWS_REVIEW_STATUS_COLOR = {
  [STUDENT_NEWS_REVIEW_STATUS_APPROVED]: "green",
  [STUDENT_NEWS_REVIEW_STATUS_SUBMITTED]: "amber",
  [STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED]: "red",
}

const STUDENT_NEWS_DEFAULT_DAYS = 14
const STUDENT_NEWS_MAX_DAYS = 60
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

function resolveStudentNewsStatusColor(status) {
  const normalized = normalizeStudentNewsReviewStatus(status, STUDENT_NEWS_REVIEW_STATUS_SUBMITTED)
  return STUDENT_NEWS_REVIEW_STATUS_COLOR[normalized] || "amber"
}

function normalizeStudentNewsDays(value) {
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed)) return STUDENT_NEWS_DEFAULT_DAYS
  return Math.max(7, Math.min(parsed, STUDENT_NEWS_MAX_DAYS))
}

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

export function mapStudentNewsReportRow(row = {}) {
  const sourceLink = normalizeText(row?.sourceLink || row?.sourceUrl)
  const articleTitle = normalizeText(row?.articleTitle || row?.headline)
  const leadSynopsis = normalizeText(row?.leadSynopsis || row?.summary)
  const biasAssessment = normalizeText(row?.biasAssessment || row?.reflection)
  const reviewStatus = normalizeStudentNewsReviewStatus(row?.reviewStatus, STUDENT_NEWS_REVIEW_STATUS_SUBMITTED)
  const awaitingReReview = resolveStudentNewsAwaitingReReview(row)
  const validationIssues = normalizeValidationIssueMap(row?.validationIssuesJson)
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
    submittedAt: parseDateOrNull(row?.submittedAt)?.toISOString?.() || "",
    reviewStatus,
    awaitingReReview,
    statusColor: resolveStudentNewsStatusColor(reviewStatus),
    reviewNote: stripAwaitingReReviewMarker(row?.reviewNote),
    validationIssuesJson: validationIssues,
    failedFields: pendingFieldKeys,
    fixedFields: fixedFieldKeys,
    reviewedByUsername: normalizeText(row?.reviewedByUsername),
    reviewedAt: parseDateOrNull(row?.reviewedAt)?.toISOString?.() || "",
  }
}

export function buildStudentNewsCalendarRows({ now = new Date(), reports = [], days = STUDENT_NEWS_DEFAULT_DAYS } = {}) {
  const targetDays = normalizeStudentNewsDays(days)
  const window = resolveStudentNewsSubmissionWindow(now)
  const byDate = new Map(
    (Array.isArray(reports) ? reports : [])
      .map((entry) => mapStudentNewsReportRow(entry))
      .filter((entry) => normalizeText(entry?.reportDate))
      .map((entry) => [entry.reportDate, entry])
  )
  const rows = []
  const todayStart = startOfDay(parseDateOrNull(now) || new Date())
  for (let offset = 0; offset < targetDays; offset += 1) {
    const day = addDays(todayStart, -offset)
    const date = toLocalIsoDate(day)
    const saved = byDate.get(date) || null
    const isOpenDate = Boolean(window?.isOpen) && date === window.reportDate
    const status = saved
      ? "completed"
      : isOpenDate
        ? "open"
        : "missed"
    const statusColor = saved ? resolveStudentNewsStatusColor(saved?.reviewStatus) : status === "completed" ? "green" : status === "open" ? "amber" : "red"
    rows.push({
      date,
      status,
      color: statusColor,
      statusColor,
      reviewStatus: saved?.reviewStatus || "",
      awaitingReReview: saved?.awaitingReReview === true,
      canSubmit: status === "open",
      submittedAt: normalizeText(saved?.submittedAt),
    })
  }
  return rows
}

export async function listStudentNewsCalendar(studentRefId, { now = new Date(), days = STUDENT_NEWS_DEFAULT_DAYS } = {}) {
  const prisma = await getPrismaClient()
  const id = normalizeText(studentRefId)
  assertWithStatus(Boolean(id), 400, "studentRefId is required")
  const targetDays = normalizeStudentNewsDays(days)
  const nowDate = parseDateOrNull(now) || new Date()
  const todayStart = startOfDay(nowDate)
  const reportStart = addDays(todayStart, -(targetDays - 1))
  const reportEnd = endOfDay(todayStart)

  const fallbackRange = {
    startDate: toLocalIsoDate(reportStart),
    endDate: toLocalIsoDate(reportEnd),
  }
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

  const mappedReports = reports.map((entry) => mapStudentNewsReportRow(entry))
  const calendar = buildStudentNewsCalendarRows({
    now: nowDate,
    reports: mappedReports,
    days: targetDays,
  })
  const window = resolveStudentNewsSubmissionWindow(nowDate)
  const openReport = mappedReports.find((entry) => normalizeText(entry.reportDate) === window.reportDate) || null
  const statusSummary = mappedReports.reduce(
    (acc, entry) => {
      const status = normalizeStudentNewsReviewStatus(entry?.reviewStatus, STUDENT_NEWS_REVIEW_STATUS_SUBMITTED)
      if (status === STUDENT_NEWS_REVIEW_STATUS_APPROVED) acc.approved += 1
      else if (status === STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED) acc.revisionRequested += 1
      else acc.submitted += 1
      return acc
    },
    { submitted: 0, approved: 0, revisionRequested: 0 }
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

export async function saveStudentNewsReport(
  studentRefId,
  payload = {},
  { now = new Date(), validationConfig = {} } = {}
) {
  const prisma = await getPrismaClient()
  const id = normalizeText(studentRefId)
  assertWithStatus(Boolean(id), 400, "studentRefId is required")

  const sourceLinkRaw = clampText(payload?.sourceLink, STUDENT_NEWS_FIELD_MAX_LENGTHS.sourceLink).value
  const sourceLink = normalizeHttpUrl(sourceLinkRaw) || sourceLinkRaw
  const articleTitle = clampText(payload?.articleTitle, STUDENT_NEWS_FIELD_MAX_LENGTHS.articleTitle).value
  const byline = clampText(payload?.byline, STUDENT_NEWS_FIELD_MAX_LENGTHS.byline).value
  const articleDateline = clampText(payload?.articleDateline, STUDENT_NEWS_FIELD_MAX_LENGTHS.articleDateline).value
  const leadSynopsis = clampText(payload?.leadSynopsis, STUDENT_NEWS_FIELD_MAX_LENGTHS.leadSynopsis).value
  const actionActor = clampText(payload?.actionActor, STUDENT_NEWS_FIELD_MAX_LENGTHS.actionActor).value
  const actionAffected = clampText(payload?.actionAffected, STUDENT_NEWS_FIELD_MAX_LENGTHS.actionAffected).value
  const actionWhere = clampText(payload?.actionWhere, STUDENT_NEWS_FIELD_MAX_LENGTHS.actionWhere).value
  const actionWhat = clampText(payload?.actionWhat, STUDENT_NEWS_FIELD_MAX_LENGTHS.actionWhat).value
  const actionWhy = clampText(payload?.actionWhy, STUDENT_NEWS_FIELD_MAX_LENGTHS.actionWhy).value
  const biasAssessment = clampText(payload?.biasAssessment, STUDENT_NEWS_FIELD_MAX_LENGTHS.biasAssessment).value
  const reportDateText = normalizeText(payload?.reportDate)

  const window = resolveStudentNewsSubmissionWindow(now)
  assertWithStatus(Boolean(reportDateText), 400, "reportDate is required")
  const reportDate = parseLocalDateOnly(reportDateText)
  assertWithStatus(reportDate instanceof Date && !Number.isNaN(reportDate.valueOf()), 400, "Invalid reportDate")
  const reportDateRangeStart = new Date(reportDate.getTime())
  const reportDateRangeEnd = new Date(reportDateRangeStart.getTime() + 24 * 60 * 60 * 1000)

  let existing = null
  let fallbackOnly = false
  if (hasPrismaDelegateMethod(prisma, "studentNewsReport", "findUnique")) {
    try {
      existing = await prisma.studentNewsReport.findUnique({
        where: {
          studentRefId_reportDate: {
            studentRefId: id,
            reportDate,
          },
        },
        select: {
          id: true,
          reportDate: true,
          reviewStatus: true,
          reviewNote: true,
          validationIssuesJson: true,
        },
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
          studentRefId: id,
          reportDate: {
            gte: reportDateRangeStart,
            lt: reportDateRangeEnd,
          },
        },
        orderBy: {
          submittedAt: "desc",
        },
        select: {
          id: true,
          reportDate: true,
          reviewStatus: true,
          reviewNote: true,
          validationIssuesJson: true,
        },
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
    const fallbackExisting = listStudentNewsReportsFromFallbackStore(id, {
      startDate: reportDateText,
      endDate: reportDateText,
    })
    existing = Array.isArray(fallbackExisting) ? fallbackExisting[0] || null : null
  }

  if (!existing) {
    assertWithStatus(reportDateText === window.reportDate, 403, "News report for this date is locked")
  }

  if (existing) {
    const existingStatus = normalizeStudentNewsReviewStatus(
      existing.reviewStatus,
      STUDENT_NEWS_REVIEW_STATUS_SUBMITTED
    )
    const nowDate = parseDateOrNull(now) || new Date()
    const currentWeekStart = startOfWeekSunday(nowDate)
    const weeklyResubmitCutoff = new Date(currentWeekStart.getTime() + (ONE_DAY_MS * 7))
    const isBeforeWeeklyResubmitCutoff = nowDate < weeklyResubmitCutoff
    const isCurrentWeekReportDate = reportDate >= currentWeekStart && reportDate < weeklyResubmitCutoff
    const isApproved = existingStatus === STUDENT_NEWS_REVIEW_STATUS_APPROVED
    assertWithStatus(
      isBeforeWeeklyResubmitCutoff && isCurrentWeekReportDate,
      403,
      "News report for this date is locked"
    )
    assertWithStatus(!isApproved, 403, "Approved news reports cannot be edited")
  }

  const compliance = await evaluateStudentNewsCompliance({
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
  }, {
    validationConfig,
  })
  const previousIssues = normalizeValidationIssueMap(existing?.validationIssuesJson)
  const updatedIssues = updateStudentNewsValidationIssues(previousIssues, compliance)
  const mergedReviewNote = mergeStudentNewsReviewNoteWithCompliance(existing?.reviewNote, updatedIssues.issues)
  const hasFailures = Object.keys(compliance.failedFields || {}).length > 0
  const isResubmission = Boolean(existing)
  const existingStatus = normalizeStudentNewsReviewStatus(
    existing?.reviewStatus,
    STUDENT_NEWS_REVIEW_STATUS_SUBMITTED
  )
  let reviewNote = stripAwaitingReReviewMarker(mergedReviewNote)
  if (existingStatus === STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED) {
    reviewNote = addAwaitingReReviewMarker(reviewNote)
  }
  const submittedAt = new Date()
  const reviewStatus = hasFailures && !isResubmission
    ? STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED
    : STUDENT_NEWS_REVIEW_STATUS_SUBMITTED
  const reportData = {
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
    submittedAt,
    reviewStatus,
    reviewNote: normalizeNullableText(reviewNote),
    validationIssuesJson: updatedIssues.issues,
    reviewedAt: null,
    reviewedByUsername: null,
  }

  let saved = null
  const existingId = normalizeText(existing?.id)
  if (
    !fallbackOnly
    && existingId
    && hasPrismaDelegateMethod(prisma, "studentNewsReport", "update")
  ) {
    try {
      saved = await prisma.studentNewsReport.update({
        where: { id: existingId },
        data: reportData,
      })
    } catch (error) {
      const code = normalizeText(error?.code).toUpperCase()
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
  if (
    !saved
    && !fallbackOnly
    && hasPrismaDelegateMethod(prisma, "studentNewsReport", "upsert")
  ) {
    try {
      saved = await prisma.studentNewsReport.upsert({
        where: {
          studentRefId_reportDate: {
            studentRefId: id,
            reportDate,
          },
        },
        update: reportData,
        create: {
          studentRefId: id,
          reportDate,
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
      submittedAt: submittedAt.toISOString(),
      reviewedAt: null,
      reviewedByUsername: null,
    })
    saved = {
      ...fallbackSaved,
      reportDate: parseLocalDateOnly(fallbackSaved.reportDate) || fallbackSaved.reportDate,
      submittedAt: parseDateOrNull(fallbackSaved.submittedAt) || fallbackSaved.submittedAt,
    }
  }

  const mappedItem = mapStudentNewsReportRow(saved)
  const hasResubmissionFailures = hasFailures && isResubmission
  const responseMessage = hasResubmissionFailures
    ? "Saved with compliance guidance. Status remains waiting for admin review."
    : hasFailures
      ? "Saved and marked for revision. Update flagged fields and save again."
      : "Report saved."
  const responsePayload = {
    generatedAt: new Date().toISOString(),
    window,
    saved: true,
    message: responseMessage,
    complianceFailed: hasFailures,
    item: mappedItem,
    failedFields: compliance.failedFields,
    revisionTasks: compliance.revisionTasks,
    fixedFields: updatedIssues.newlyFixed,
    allowedSources: compliance?.config?.allowedDomains || [],
    validation: compliance.details,
  }

  return responsePayload
}

export {
  normalizeStudentNewsReviewStatus,
  resolveStudentNewsStatusColor,
}
