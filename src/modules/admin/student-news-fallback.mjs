import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

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

const FIXED_TIME_ZONE_OFFSET_MINUTES = 7 * 60
const FIXED_TIME_ZONE_OFFSET_MS = FIXED_TIME_ZONE_OFFSET_MINUTES * 60 * 1000

function shiftToFixedTimeZone(value) {
  return new Date(value.getTime() + FIXED_TIME_ZONE_OFFSET_MS)
}

function shiftFromFixedTimeZone(value) {
  return new Date(value.getTime() - FIXED_TIME_ZONE_OFFSET_MS)
}

function assertWithStatus(condition, status, message) {
  if (condition) return true
  const error = new Error(message)
  error.statusCode = status
  throw error
}

function isUnknownPrismaArgumentError(error, argumentName = "") {
  const message = normalizeLower(error?.message || error)
  const normalizedArgument = normalizeLower(argumentName)
  return message.includes("unknown argument") && message.includes(`\`${normalizedArgument}\``)
}

function isUnknownPrismaFieldError(error, fieldName = "") {
  const message = normalizeLower(error?.message || error)
  const normalizedField = normalizeLower(fieldName)
  return message.includes("unknown field") && message.includes(`\`${normalizedField}\``)
}

function isMissingPrismaColumnError(error, columnName = "") {
  const message = normalizeLower(error?.message || error)
  const normalizedColumn = normalizeLower(columnName)
  if (!normalizedColumn) return false
  return message.includes("column") && message.includes(normalizedColumn) && message.includes("does not exist")
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
  if (toLocalIsoDate(date) !== text) return null
  return date
}

const STUDENT_NEWS_FALLBACK_FILE_PATH = path.resolve(
  process.cwd(),
  normalizeText(process.env.STUDENT_NEWS_REPORTS_FALLBACK_FILE) || "runtime-data/student-news-reports.json"
)
const STUDENT_NEWS_FALLBACK_MAX_ITEMS = Math.max(
  200,
  Number.parseInt(String(process.env.STUDENT_NEWS_REPORTS_FALLBACK_MAX_ITEMS || "5000"), 10) || 5000
)
const STUDENT_NEWS_REVIEW_STATUS_SUBMITTED = "submitted"
const STUDENT_NEWS_REVIEW_STATUS_APPROVED = "approved"
const STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED = "revision-requested"

function isStudentNewsReportSchemaUnavailableError(error) {
  const code = normalizeText(error?.code).toUpperCase()
  if (code === "P2021") return true
  if (isMissingPrismaColumnError(error, "studentnewsreport")) return true
  const message = normalizeLower(error?.message || error)
  return (
    message.includes("studentnewsreport")
    && (
      message.includes("does not exist")
      || message.includes("unknown field")
      || message.includes("unknown argument")
      || message.includes("unknown arg")
    )
  )
}

function isStudentNewsReviewSchemaUnavailableError(error) {
  return (
    isStudentNewsReportSchemaUnavailableError(error)
    || isUnknownPrismaArgumentError(error, "reviewStatus")
    || isUnknownPrismaFieldError(error, "reviewStatus")
    || isMissingPrismaColumnError(error, "reviewStatus")
    || isUnknownPrismaArgumentError(error, "reviewNote")
    || isUnknownPrismaFieldError(error, "reviewNote")
    || isMissingPrismaColumnError(error, "reviewNote")
    || isUnknownPrismaArgumentError(error, "reviewedAt")
    || isUnknownPrismaFieldError(error, "reviewedAt")
    || isMissingPrismaColumnError(error, "reviewedAt")
    || isUnknownPrismaArgumentError(error, "reviewedByUsername")
    || isUnknownPrismaFieldError(error, "reviewedByUsername")
    || isMissingPrismaColumnError(error, "reviewedByUsername")
  )
}

function createStudentNewsFallbackId() {
  return `news-${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}`
}

function normalizeStudentNewsFallbackEntry(entry = {}) {
  const studentRefId = normalizeText(entry?.studentRefId)
  const reportDate = normalizeText(entry?.reportDate)
  if (!studentRefId) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return null
  const sourceLink = normalizeHttpUrl(entry?.sourceLink)
  const articleTitle = normalizeText(entry?.articleTitle)
  const leadSynopsis = normalizeText(entry?.leadSynopsis)
  const actionActor = normalizeText(entry?.actionActor)
  const actionAffected = normalizeText(entry?.actionAffected)
  const actionWhere = normalizeText(entry?.actionWhere)
  const actionWhat = normalizeText(entry?.actionWhat)
  const actionWhy = normalizeText(entry?.actionWhy)
  const reviewStatus = normalizeStudentNewsReviewStatus(entry?.reviewStatus, STUDENT_NEWS_REVIEW_STATUS_SUBMITTED)
  const reviewNote = normalizeNullableText(entry?.reviewNote)
  const reviewedAt = parseDateOrNull(entry?.reviewedAt)?.toISOString?.() || ""
  const reviewedByUsername = normalizeNullableText(entry?.reviewedByUsername)
  if (!sourceLink || !articleTitle || !leadSynopsis || !actionActor || !actionAffected || !actionWhere || !actionWhat || !actionWhy) {
    return null
  }
  const createdAt = parseDateOrNull(entry?.createdAt)?.toISOString?.() || new Date().toISOString()
  const updatedAt = parseDateOrNull(entry?.updatedAt)?.toISOString?.() || new Date().toISOString()
  return {
    id: normalizeText(entry?.id) || createStudentNewsFallbackId(),
    studentRefId,
    reportDate,
    sourceLink,
    articleTitle,
    byline: normalizeNullableText(entry?.byline),
    articleDateline: normalizeNullableText(entry?.articleDateline),
    leadSynopsis,
    actionActor,
    actionAffected,
    actionWhere,
    actionWhat,
    actionWhy,
    biasAssessment: normalizeNullableText(entry?.biasAssessment),
    reviewStatus,
    reviewNote,
    reviewedAt,
    reviewedByUsername,
    submittedAt: parseDateOrNull(entry?.submittedAt)?.toISOString?.() || createdAt,
    createdAt,
    updatedAt,
    validationIssuesJson:
      entry?.validationIssuesJson && typeof entry.validationIssuesJson === "object" && !Array.isArray(entry.validationIssuesJson)
        ? entry.validationIssuesJson
        : null,
  }
}

function readStudentNewsFallbackEntries() {
  if (!fs.existsSync(STUDENT_NEWS_FALLBACK_FILE_PATH)) return []
  try {
    const raw = fs.readFileSync(STUDENT_NEWS_FALLBACK_FILE_PATH, "utf8")
    const text = normalizeText(raw)
    if (!text) return []
    const parsed = JSON.parse(text)
    const source = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : []
    return source
      .map((entry) => normalizeStudentNewsFallbackEntry(entry))
      .filter(Boolean)
      .slice(-STUDENT_NEWS_FALLBACK_MAX_ITEMS)
  } catch (error) {
    console.warn(`student news fallback read failed: ${normalizeText(error?.message) || "unknown error"}`)
    return []
  }
}

function writeStudentNewsFallbackEntries(entries = []) {
  const normalized = (Array.isArray(entries) ? entries : [])
    .map((entry) => normalizeStudentNewsFallbackEntry(entry))
    .filter(Boolean)
    .slice(-STUDENT_NEWS_FALLBACK_MAX_ITEMS)
  const payload = JSON.stringify({ items: normalized }, null, 2)
  fs.mkdirSync(path.dirname(STUDENT_NEWS_FALLBACK_FILE_PATH), { recursive: true })
  const tmpPath = `${STUDENT_NEWS_FALLBACK_FILE_PATH}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmpPath, payload, "utf8")
  fs.renameSync(tmpPath, STUDENT_NEWS_FALLBACK_FILE_PATH)
  return normalized
}

function listStudentNewsReportsFromFallbackStore(studentRefId, { startDate = "", endDate = "" } = {}) {
  const id = normalizeText(studentRefId)
  const start = normalizeText(startDate)
  const end = normalizeText(endDate)
  return readStudentNewsFallbackEntries()
    .filter((entry) => entry.studentRefId === id)
    .filter((entry) => !start || entry.reportDate >= start)
    .filter((entry) => !end || entry.reportDate <= end)
    .sort((left, right) => normalizeText(right.reportDate).localeCompare(normalizeText(left.reportDate)))
    .map((entry) => ({
      ...entry,
      reportDate: parseLocalDateOnly(entry.reportDate) || entry.reportDate,
      submittedAt: parseDateOrNull(entry.submittedAt) || entry.submittedAt,
    }))
}

function upsertStudentNewsReportInFallbackStore(studentRefId, reportDate, payload = {}) {
  const id = normalizeText(studentRefId)
  const dateKey = normalizeText(reportDate)
  const now = new Date().toISOString()
  const source = readStudentNewsFallbackEntries()
  const index = source.findIndex((entry) => entry.studentRefId === id && entry.reportDate === dateKey)
  const existing = index >= 0 ? source[index] : null
  if (normalizeStudentNewsReviewStatus(existing?.reviewStatus) === STUDENT_NEWS_REVIEW_STATUS_APPROVED) {
    const error = new Error("Approved news reports cannot be edited")
    error.statusCode = 403
    throw error
  }
  const normalized = normalizeStudentNewsFallbackEntry({
    ...(existing || {}),
    ...payload,
    id: normalizeText(existing?.id) || createStudentNewsFallbackId(),
    studentRefId: id,
    reportDate: dateKey,
    createdAt: normalizeText(existing?.createdAt) || now,
    updatedAt: now,
    reviewStatus: STUDENT_NEWS_REVIEW_STATUS_SUBMITTED,
    reviewNote: null,
    reviewedAt: null,
    reviewedByUsername: null,
  })
  assertWithStatus(Boolean(normalized), 500, "Unable to persist student news report")
  if (index >= 0) source[index] = normalized
  else source.push(normalized)
  writeStudentNewsFallbackEntries(source)
  return normalized
}

function buildStudentNewsFallbackOverlayIndex(entries = []) {
  const index = new Map()
  const source = Array.isArray(entries) ? entries : []
  source.forEach((entry) => {
    const normalized = normalizeStudentNewsFallbackEntry(entry)
    if (!normalized) return
    const reviewOverlay = {
      reviewStatus: normalized.reviewStatus,
      reviewNote: normalized.reviewNote,
      validationIssuesJson: normalized.validationIssuesJson,
      reviewedByUsername: normalized.reviewedByUsername,
      reviewedAt: normalized.reviewedAt,
    }
    if (normalized.id) {
      index.set(`id:${normalized.id}`, reviewOverlay)
    }
    if (normalized.studentRefId && normalized.reportDate) {
      index.set(`student:${normalized.studentRefId}|date:${normalized.reportDate}`, reviewOverlay)
    }
  })
  return index
}

function resolveStudentNewsFallbackReviewOverlay(row = {}, overlayIndex = null) {
  const index = overlayIndex instanceof Map ? overlayIndex : new Map()
  const rowId = normalizeText(row?.id)
  const studentRefId = normalizeText(row?.studentRefId)
  const reportDate = row?.reportDate instanceof Date
    ? toLocalIsoDate(row?.reportDate)
    : normalizeText(row?.reportDate) || toLocalIsoDate(row?.reportDate)

  const keys = []
  if (rowId) keys.push(`id:${rowId}`)
  if (studentRefId && reportDate) keys.push(`student:${studentRefId}|date:${reportDate}`)

  for (const key of keys) {
    if (!index.has(key)) continue
    const overlay = index.get(key) || {}
    return {
      reviewStatus: normalizeStudentNewsReviewStatus(overlay?.reviewStatus, STUDENT_NEWS_REVIEW_STATUS_SUBMITTED),
      reviewNote: normalizeNullableText(overlay?.reviewNote),
      validationIssuesJson:
        overlay?.validationIssuesJson && typeof overlay.validationIssuesJson === "object" && !Array.isArray(overlay.validationIssuesJson)
          ? overlay.validationIssuesJson
          : null,
      reviewedByUsername: normalizeNullableText(overlay?.reviewedByUsername),
      reviewedAt: parseDateOrNull(overlay?.reviewedAt)?.toISOString?.() || normalizeText(overlay?.reviewedAt),
    }
  }
  return null
}

export {
  buildStudentNewsFallbackOverlayIndex,
  isStudentNewsReportSchemaUnavailableError,
  isStudentNewsReviewSchemaUnavailableError,
  listStudentNewsReportsFromFallbackStore,
  readStudentNewsFallbackEntries,
  resolveStudentNewsFallbackReviewOverlay,
  upsertStudentNewsReportInFallbackStore,
}
