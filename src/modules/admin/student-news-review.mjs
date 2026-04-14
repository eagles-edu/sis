import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import {
  buildStudentNewsFallbackOverlayIndex,
  isStudentNewsReportSchemaUnavailableError,
  isStudentNewsReviewSchemaUnavailableError,
  readStudentNewsFallbackEntries,
  resolveStudentNewsFallbackReviewOverlay,
  upsertStudentNewsReportInFallbackStore,
} from "./student-news-fallback.mjs"
import {
  evaluateStudentNewsCompliance,
  mergeStudentNewsReviewNoteWithCompliance,
  updateStudentNewsValidationIssues,
} from "./student-news-compliance.mjs"

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

function normalizeInteger(value) {
  const text = normalizeText(value)
  if (!text) return null
  const parsed = Number.parseInt(text, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function parseDateOrNull(value) {
  if (value instanceof Date) return Number.isNaN(value.valueOf()) ? null : value
  const text = normalizeText(value)
  if (!text) return null
  const parsed = new Date(text)
  return Number.isNaN(parsed.valueOf()) ? null : parsed
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

function normalizeDateValue(value, fallback = new Date()) {
  const parsed = value instanceof Date ? new Date(value.getTime()) : parseDateOrNull(value)
  if (parsed instanceof Date && !Number.isNaN(parsed.valueOf())) return parsed
  return fallback instanceof Date ? new Date(fallback.getTime()) : new Date()
}

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

function assertWithStatus(condition, status, message) {
  if (condition) return true
  const error = new Error(message)
  error.statusCode = status
  throw error
}

function hasPrismaDelegateMethod(prisma, delegateName, methodName) {
  return Boolean(prisma?.[delegateName] && typeof prisma[delegateName][methodName] === "function")
}

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

function normalizeValidationIssueMap(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {}
  const normalized = {}
  Object.keys(source).forEach((fieldKey) => {
    const entry = normalizeValidationIssueEntry(fieldKey, source[fieldKey])
    if (entry) normalized[fieldKey] = entry
  })
  return normalized
}

function stripAwaitingReReviewMarker(note = "") {
  return normalizeText(String(note || "").replaceAll("[[SIS-AWAITING-RE-REVIEW]]", ""))
}

function addAwaitingReReviewMarker(note = "") {
  const clean = stripAwaitingReReviewMarker(note)
  if (!clean) return "[[SIS-AWAITING-RE-REVIEW]]"
  return `${clean}\n[[SIS-AWAITING-RE-REVIEW]]`
}

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

function normalizeLevelKey(value) {
  return normalizeLower(value).replace(/[^a-z0-9]/g, "")
}

const LEVEL_ALIAS_MAP = (() => {
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

function canonicalizeLevel(value) {
  const text = normalizeText(value)
  if (!text) return ""
  const key = normalizeLevelKey(text)
  return LEVEL_ALIAS_MAP.get(key) || text
}

const STUDENT_NEWS_REVIEW_STATUS_SUBMITTED = "submitted"
const STUDENT_NEWS_REVIEW_STATUS_APPROVED = "approved"
const STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED = "revision-requested"
const STUDENT_NEWS_REVIEW_STATUS_COLOR = {
  [STUDENT_NEWS_REVIEW_STATUS_APPROVED]: "green",
  [STUDENT_NEWS_REVIEW_STATUS_SUBMITTED]: "amber",
  [STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED]: "red",
}

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

function mapStudentNewsReportRow(row = {}) {
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

function studentNewsReviewSortValue(item = {}) {
  const submittedAt = parseDateOrNull(item?.submittedAt)
  if (submittedAt instanceof Date && !Number.isNaN(submittedAt.valueOf())) return submittedAt.valueOf()
  const reportDate = parseLocalDateOnly(item?.reportDate)
  if (reportDate instanceof Date && !Number.isNaN(reportDate.valueOf())) return reportDate.valueOf()
  return 0
}

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

function normalizeStudentNewsReviewTake(value) {
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed)) return 200
  return Math.max(1, Math.min(parsed, 500))
}

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
  return new Map(rows.map((row) => [normalizeText(row?.id), row]))
}

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

function normalizeStudentNewsReviewDateFilter(value) {
  const date = parseLocalDateOnly(value)
  return date instanceof Date && !Number.isNaN(date.valueOf()) ? date : null
}

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
    submittedAt: true,
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
  const limit = normalizeStudentNewsReviewTake(take)
  const requestedStatus = normalizeStudentNewsReviewStatus(status, "all")
  const requestedLevel = canonicalizeLevel(level || "") || ""
  const requestedStudentRefId = normalizeText(studentRefId)
  const requestedQuery = normalizeLower(query)
  const fromDate = normalizeStudentNewsReviewDateFilter(dateFrom)
  const toDate = normalizeStudentNewsReviewDateFilter(dateTo)

  const where = {}
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
  const filtered = mapped.filter((entry) => {
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

export async function reviewStudentNewsReport(reportId, payload = {}, options = {}) {
  const prisma = await getSharedPrismaClient()
  const id = normalizeText(reportId)
  assertWithStatus(Boolean(id), 400, "reportId is required")
  const reviewStatus = resolveStudentNewsReviewActionStatus(payload)
  assertWithStatus(Boolean(reviewStatus), 400, "Unsupported news review action")

  const now = new Date()
  const reviewNote = normalizeNullableText(
    stripAwaitingReReviewMarker(payload?.reviewNote || payload?.note || payload?.comment)
  )
  const reviewedByUsername = normalizeNullableText(options?.reviewedByUsername || payload?.reviewedByUsername)
  const normalizedValidationIssues =
    payload?.validationIssuesJson && typeof payload.validationIssuesJson === "object" && !Array.isArray(payload.validationIssuesJson)
      ? normalizeValidationIssueMap(payload.validationIssuesJson)
      : null
  const updateData = {
    reviewStatus,
    reviewNote,
    reviewedByUsername,
    reviewedAt: now,
  }
  if (normalizedValidationIssues && Object.keys(normalizedValidationIssues).length) {
    updateData.validationIssuesJson = normalizedValidationIssues
  }

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
      reviewStatus,
      reviewNote,
      validationIssuesJson:
        updateData.validationIssuesJson
        || existingReport?.validationIssuesJson
        || null,
      reviewedByUsername,
      reviewedAt: now.toISOString(),
    })
    updatedReport = {
      ...existingReport,
      ...fallbackSaved,
      id,
      studentRefId,
      reportDate: existingReport?.reportDate || parseLocalDateOnly(reportDateKey) || reportDateKey,
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

export {
  buildStudentNewsReviewSelect,
  normalizeStudentNewsReviewStatus,
  normalizeStudentNewsReviewTake,
  resolveStudentNewsReviewActionStatus,
  resolveStudentNewsStatusColor,
}
