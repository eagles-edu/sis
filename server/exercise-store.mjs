// server/exercise-store.mjs

import fs from "node:fs"
import path from "node:path"

import { getSharedPrismaClient } from "./prisma-client-factory.mjs"

export const INCOMING_EXERCISE_RESULT_STATUS_QUEUED = "queued"
export const INCOMING_EXERCISE_RESULT_STATUS_TEMPORARY = "temporary"
export const INCOMING_EXERCISE_RESULT_STATUS_ARCHIVED = "archived"
export const INCOMING_EXERCISE_RESULT_STATUS_RESOLVED = "resolved"

const INCOMING_EXERCISE_RESULT_STATUSES = new Set([
  INCOMING_EXERCISE_RESULT_STATUS_QUEUED,
  INCOMING_EXERCISE_RESULT_STATUS_TEMPORARY,
  INCOMING_EXERCISE_RESULT_STATUS_ARCHIVED,
  INCOMING_EXERCISE_RESULT_STATUS_RESOLVED,
])
const INCOMING_DUPLICATE_COMPLETED_AT_WINDOW_MS = 1500
const INCOMING_DUPLICATE_CREATED_AT_LOOKBACK_MS = 5 * 60 * 1000
const AUTO_IMPORTED_EXERCISE_COMMENT_PREFIX = "Auto-imported exercise score"
const FIXED_TIME_ZONE_OFFSET_MS = 7 * 60 * 60 * 1000
const DEFAULT_SYSTEM_SCHOOL_YEAR = "2026-2027"
const SCHOOL_YEAR_OVERRIDE_ENV_KEYS = [
  "SIS_CURRENT_SCHOOL_YEAR",
  "STUDENT_CURRENT_SCHOOL_YEAR",
  "STUDENT_ADMIN_CURRENT_SCHOOL_YEAR",
]

let cachedUiSettingsSchoolYear = {
  filePath: "",
  mtimeMs: -1,
  schoolYear: "",
  quarters: [],
}

function resolveBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value !== 0
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return fallback
    if (["true", "1", "yes"].includes(normalized)) return true
    if (["false", "0", "no"].includes(normalized)) return false
  }
  return fallback
}

function normalizeString(value) {
  if (typeof value !== "string") return ""
  return value.trim()
}

function normalizeLower(value) {
  return normalizeString(value).toLowerCase()
}

function normalizeQuarterCode(value) {
  const normalized = normalizeLower(value)
  if (normalized === "q1" || normalized === "q2" || normalized === "q3" || normalized === "q4") {
    return normalized
  }
  return ""
}

function isoDateKeyFromFixedTimeZone(value = new Date()) {
  const date = value instanceof Date ? value : parseCompletedAt(value)
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) return ""
  const shifted = shiftToFixedTimeZone(date)
  return shifted.toISOString().slice(0, 10)
}

function normalizeIsoDateKey(value) {
  const raw = normalizeString(value)
  if (!raw) return ""
  const match = raw.match(/^([0-9]{4}-[0-9]{2}-[0-9]{2})/)
  if (!match || !match[1]) return ""
  const parsed = new Date(`${match[1]}T00:00:00.000Z`)
  if (Number.isNaN(parsed.valueOf())) return ""
  return match[1]
}

function normalizeSchoolSetupQuarters(value) {
  const entries = Array.isArray(value) ? value : []
  const normalized = []
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const quarter = normalizeQuarterCode(entry?.quarter)
    const startDate = normalizeIsoDateKey(entry?.startDate)
    const endDate = normalizeIsoDateKey(entry?.endDate)
    if (!quarter || !startDate || !endDate) continue
    if (startDate > endDate) continue
    normalized.push({ quarter, startDate, endDate })
  }
  return normalized
}

function isSchoolYearLabel(value) {
  return /^[0-9]{4}-[0-9]{4}$/u.test(normalizeString(value))
}

function createStatusError(message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function isStoreEnabled() {
  const hasDatabaseUrl = Boolean(normalizeString(process.env.DATABASE_URL))
  return resolveBoolean(process.env.EXERCISE_STORE_ENABLED, hasDatabaseUrl)
}

export function isExerciseStoreEnabled() {
  return isStoreEnabled()
}

export function isExerciseStoreRequired() {
  return resolveBoolean(process.env.EXERCISE_STORE_REQUIRED, false)
}

let prismaClientPromise = null

async function getPrismaClient(options = {}) {
  if (options && typeof options.prisma === "object" && options.prisma) {
    return options.prisma
  }

  if (!isStoreEnabled()) return null
  if (prismaClientPromise) return prismaClientPromise

  prismaClientPromise = getSharedPrismaClient()

  try {
    return await prismaClientPromise
  } catch (error) {
    prismaClientPromise = null
    throw error
  }
}

async function requirePrismaClient(options = {}) {
  const prisma = await getPrismaClient(options)
  if (!prisma) throw createStatusError("Exercise store is disabled", 503)
  return prisma
}

function slugify(value) {
  const raw = normalizeLower(value)
  if (!raw) return "untitled-exercise"
  return raw
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
}

function parseCompletedAt(value) {
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.valueOf())) return parsed
  }
  return new Date()
}

function shiftToFixedTimeZone(value) {
  return new Date(value.getTime() + FIXED_TIME_ZONE_OFFSET_MS)
}

function resolveSchoolYearFromEnv() {
  for (let index = 0; index < SCHOOL_YEAR_OVERRIDE_ENV_KEYS.length; index += 1) {
    const key = SCHOOL_YEAR_OVERRIDE_ENV_KEYS[index]
    const value = normalizeString(process.env[key])
    if (isSchoolYearLabel(value)) return value
  }
  return ""
}

function resolveUiSettingsFilePath() {
  return path.resolve(
    process.cwd(),
    normalizeString(process.env.STUDENT_ADMIN_UI_SETTINGS_FILE) || "runtime-data/admin-ui-settings.json"
  )
}

function schoolSetupFromUiSettingsPayload(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      schoolYear: "",
      quarters: [],
    }
  }
  const wrapped = payload?.uiSettings && typeof payload.uiSettings === "object" ? payload.uiSettings : payload
  const candidate = normalizeString(wrapped?.schoolSetup?.schoolYear)
  return {
    schoolYear: isSchoolYearLabel(candidate) ? candidate : "",
    quarters: normalizeSchoolSetupQuarters(wrapped?.schoolSetup?.quarters),
  }
}

function readSchoolSetupFromUiSettingsFile() {
  const filePath = resolveUiSettingsFilePath()
  let stat
  try {
    stat = fs.statSync(filePath)
  } catch {
    cachedUiSettingsSchoolYear = {
      filePath,
      mtimeMs: -1,
      schoolYear: "",
      quarters: [],
    }
    return { schoolYear: "", quarters: [] }
  }

  const mtimeMs = Number.isFinite(stat?.mtimeMs) ? stat.mtimeMs : -1
  if (
    cachedUiSettingsSchoolYear.filePath === filePath
    && cachedUiSettingsSchoolYear.mtimeMs === mtimeMs
  ) {
    return {
      schoolYear: cachedUiSettingsSchoolYear.schoolYear,
      quarters: Array.isArray(cachedUiSettingsSchoolYear.quarters)
        ? [...cachedUiSettingsSchoolYear.quarters]
        : [],
    }
  }

  let schoolSetup = {
    schoolYear: "",
    quarters: [],
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8")
    if (normalizeString(raw)) {
      const parsed = JSON.parse(raw)
      schoolSetup = schoolSetupFromUiSettingsPayload(parsed)
    }
  } catch {
    schoolSetup = {
      schoolYear: "",
      quarters: [],
    }
  }

  cachedUiSettingsSchoolYear = {
    filePath,
    mtimeMs,
    schoolYear: schoolSetup.schoolYear,
    quarters: Array.isArray(schoolSetup.quarters) ? [...schoolSetup.quarters] : [],
  }
  return {
    schoolYear: schoolSetup.schoolYear,
    quarters: Array.isArray(schoolSetup.quarters) ? [...schoolSetup.quarters] : [],
  }
}

function schoolYearFromDate(value = new Date()) {
  const date = value instanceof Date ? value : parseCompletedAt(value)
  const shifted = shiftToFixedTimeZone(date)
  const year = shifted.getUTCFullYear()
  const month = shifted.getUTCMonth() + 1
  if (month >= 8) return `${year}-${year + 1}`
  return `${year - 1}-${year}`
}

function resolveCurrentSchoolYear(value = new Date()) {
  const fromEnv = resolveSchoolYearFromEnv()
  if (fromEnv) return fromEnv
  const fromUiSettings = readSchoolSetupFromUiSettingsFile().schoolYear
  if (fromUiSettings) return fromUiSettings
  if (isSchoolYearLabel(DEFAULT_SYSTEM_SCHOOL_YEAR)) return DEFAULT_SYSTEM_SCHOOL_YEAR
  return schoolYearFromDate(value)
}

function schoolSetupQuarterForDate(value = new Date(), schoolYear = "") {
  const setup = readSchoolSetupFromUiSettingsFile()
  const setupYear = normalizeString(setup?.schoolYear)
  const requestedSchoolYear = normalizeString(schoolYear)
  if (
    requestedSchoolYear
    && setupYear
    && requestedSchoolYear !== setupYear
  ) {
    return ""
  }
  const dateKey = isoDateKeyFromFixedTimeZone(value)
  if (!dateKey) return ""
  const quarters = Array.isArray(setup?.quarters) ? setup.quarters : []
  for (let index = 0; index < quarters.length; index += 1) {
    const entry = quarters[index]
    if (dateKey < entry.startDate || dateKey > entry.endDate) continue
    const quarter = normalizeQuarterCode(entry.quarter)
    if (quarter) return quarter
  }
  return ""
}

function quarterFromDate(value = new Date(), schoolYear = "") {
  const schoolSetupQuarter = schoolSetupQuarterForDate(value, schoolYear)
  if (schoolSetupQuarter) return schoolSetupQuarter
  const date = value instanceof Date ? value : parseCompletedAt(value)
  const shifted = shiftToFixedTimeZone(date)
  const month = shifted.getUTCMonth() + 1
  if (month >= 8 && month <= 10) return "q1"
  if (month >= 11 || month <= 1) return "q2"
  if (month >= 2 && month <= 4) return "q3"
  return "q4"
}

function parseRequiredString(value, fieldName) {
  const normalized = normalizeString(value)
  if (!normalized) throw createStatusError(`${fieldName} is required`, 400)
  return normalized
}

function parseRequiredNonNegativeInteger(value, fieldName) {
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw createStatusError(`${fieldName} must be a non-negative integer`, 400)
  }
  return parsed
}

function parseRequiredPercent(value, fieldName) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw createStatusError(`${fieldName} must be a number between 0 and 100`, 400)
  }
  return Number(parsed.toFixed(2))
}

function parseRequiredCompletedAt(value) {
  const raw = parseRequiredString(value, "completedAt")
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.valueOf())) {
    throw createStatusError("completedAt must be a valid date/time value", 400)
  }
  return parsed
}

function expectedScorePercent(correctCount, totalQuestions) {
  if (!Number.isFinite(totalQuestions) || totalQuestions <= 0) return 0
  return Number(((correctCount / totalQuestions) * 100).toFixed(2))
}

function buildSubmissionSummaryFromPayload(payload = {}) {
  const correctCount = parseRequiredNonNegativeInteger(payload?.correctCount, "correctCount")
  const pendingCount = parseRequiredNonNegativeInteger(payload?.pendingCount, "pendingCount")
  const incorrectCount = parseRequiredNonNegativeInteger(payload?.incorrectCount, "incorrectCount")
  const totalQuestions = parseRequiredNonNegativeInteger(payload?.totalQuestions, "totalQuestions")
  const scorePercent = parseRequiredPercent(payload?.scorePercent, "scorePercent")
  if (totalQuestions !== correctCount + pendingCount + incorrectCount) {
    throw createStatusError(
      "Invalid metrics: totalQuestions must equal correctCount + pendingCount + incorrectCount",
      400
    )
  }
  const expectedPercent = expectedScorePercent(correctCount, totalQuestions)
  if (Math.abs(scorePercent - expectedPercent) > 0.01) {
    throw createStatusError("Invalid metrics: scorePercent mismatch", 400)
  }
  return {
    totalQuestions,
    correctCount,
    pendingCount,
    incorrectCount,
    scorePercent,
  }
}

function buildSubmissionQuality(summary, completedAtValue) {
  const scorePercent = Number(summary?.scorePercent || 0)
  const totalQuestions = Number.parseInt(String(summary?.totalQuestions || 0), 10) || 0
  const correctCount = Number.parseInt(String(summary?.correctCount || 0), 10) || 0
  const pendingCount = Number.parseInt(String(summary?.pendingCount || 0), 10) || 0
  const completedAtMs =
    completedAtValue instanceof Date
      ? completedAtValue.valueOf()
      : Number.isFinite(Date.parse(String(completedAtValue || "")))
        ? Date.parse(String(completedAtValue))
        : 0

  return {
    scorePercent,
    totalQuestions,
    correctCount,
    pendingCount,
    completedAtMs,
  }
}

function isSubmissionQualityBetter(candidate, baseline) {
  if (candidate.scorePercent !== baseline.scorePercent) {
    return candidate.scorePercent > baseline.scorePercent
  }
  if (candidate.correctCount !== baseline.correctCount) {
    return candidate.correctCount > baseline.correctCount
  }
  if (candidate.totalQuestions !== baseline.totalQuestions) {
    return candidate.totalQuestions > baseline.totalQuestions
  }
  if (candidate.pendingCount !== baseline.pendingCount) {
    return candidate.pendingCount < baseline.pendingCount
  }
  return candidate.completedAtMs > baseline.completedAtMs
}

function normalizeRecipients(value) {
  if (!Array.isArray(value)) return null
  const cleaned = value
    .map((entry) => normalizeString(entry))
    .filter(Boolean)
  return cleaned.length ? cleaned : null
}

function canonicalizeExercisePageTitle(value) {
  let title = normalizeString(value)
  if (!title) return ""

  try {
    if (/%[0-9a-f]{2}/iu.test(title)) {
      const decoded = decodeURIComponent(title)
      if (normalizeString(decoded)) title = normalizeString(decoded)
    }
  } catch {
    // keep original title when URI decode fails
  }

  if (/^https?:\/\//iu.test(title)) {
    try {
      const parsed = new URL(title)
      const segments = parsed.pathname
        .split("/")
        .map((entry) => normalizeString(entry))
        .filter(Boolean)
      const lastSegment = segments.length ? segments[segments.length - 1] : ""
      if (lastSegment) title = lastSegment
    } catch {
      // keep original title when URL parse fails
    }
  }

  title = title
    .replace(/[?#].*$/u, "")
    .replace(/\.(?:html?|php|aspx?)$/iu, "")
    .replace(/\b\d+(?:\.\d+)+\b/gu, (token) => token.replace(/\./gu, " "))
    .replace(/[-_]+/gu, " ")
    .replace(/\s+\|\s+(?:id|sid|ref|session|attempt|timestamp|time|date)\s*[:=#-].*$/iu, "")
    .replace(/\s+/gu, " ")
    .trim()

  return normalizeString(title)
}

function normalizeSubmissionPayload(payload = {}) {
  if (Object.prototype.hasOwnProperty.call(payload, "studentId")) {
    throw createStatusError("Unsupported field: studentId", 400)
  }
  if (Object.prototype.hasOwnProperty.call(payload, "answers")) {
    throw createStatusError("Unsupported field: answers", 400)
  }
  const submittedEaglesId = parseRequiredString(payload?.eaglesId, "eaglesId")
  const submittedEmail = parseRequiredString(payload?.email, "email").toLowerCase()
  const pageTitle = canonicalizeExercisePageTitle(parseRequiredString(payload?.pageTitle, "pageTitle")) || "Untitled exercise"
  const completedAt = parseRequiredCompletedAt(payload?.completedAt)
  const summary = buildSubmissionSummaryFromPayload(payload)
  const recipientsJson = normalizeRecipients(payload?.recipients)

  return {
    submittedEaglesId,
    submittedEmail,
    pageTitle,
    completedAt,
    recipientsJson,
    summary,
  }
}

function normalizeStatus(value, fallback = INCOMING_EXERCISE_RESULT_STATUS_QUEUED) {
  const status = normalizeLower(value)
  if (INCOMING_EXERCISE_RESULT_STATUSES.has(status)) return status
  return fallback
}

function normalizeStatusList(value, fallback = []) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value
          .split(",")
          .map((entry) => normalizeString(entry))
          .filter(Boolean)
      : []

  const normalized = source
    .map((entry) => normalizeStatus(entry, ""))
    .filter(Boolean)

  if (normalized.length) return Array.from(new Set(normalized))
  return Array.from(new Set(fallback.map((entry) => normalizeStatus(entry, "")).filter(Boolean)))
}

function normalizeTake(value, fallback = 50, max = 500) {
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.min(parsed, max))
}

function buildIncomingWhere({ statuses = [], query = "" } = {}) {
  const where = {}
  const normalizedStatuses = normalizeStatusList(statuses)
  const search = normalizeString(query)

  if (normalizedStatuses.length) {
    where.status = { in: normalizedStatuses }
  }

  if (search) {
    where.OR = [
      {
        submittedEaglesId: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        submittedEmail: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        pageTitle: {
          contains: search,
          mode: "insensitive",
        },
      },
    ]
  }

  return where
}

async function findMatchedStudent(prisma, submission) {
  const submittedEaglesId = normalizeString(submission?.submittedEaglesId)
  const submittedEmail = normalizeLower(submission?.submittedEmail)

  if (submittedEaglesId) {
    const matchedById = await prisma.student.findFirst({
      where: {
        eaglesId: {
          equals: submittedEaglesId,
          mode: "insensitive",
        },
      },
      select: {
        id: true,
        eaglesId: true,
        email: true,
        profile: {
          select: {
            currentGrade: true,
          },
        },
      },
    })

    if (matchedById) return matchedById
  }

  if (submittedEmail) {
    const matchedByEmail = await prisma.student.findFirst({
      where: {
        OR: [
          {
            email: {
              equals: submittedEmail,
              mode: "insensitive",
            },
          },
          {
            profile: {
              is: {
                OR: [
                  {
                    studentEmail: {
                      equals: submittedEmail,
                      mode: "insensitive",
                    },
                  },
                  {
                    motherEmail: {
                      equals: submittedEmail,
                      mode: "insensitive",
                    },
                  },
                  {
                    fatherEmail: {
                      equals: submittedEmail,
                      mode: "insensitive",
                    },
                  },
                  {
                    signatureEmail: {
                      equals: submittedEmail,
                      mode: "insensitive",
                    },
                  },
                ],
              },
            },
          },
        ],
      },
      select: {
        id: true,
        eaglesId: true,
        email: true,
        profile: {
          select: {
            currentGrade: true,
          },
        },
      },
    })

    if (matchedByEmail) return matchedByEmail
  }

  return null
}

async function ensureExerciseRecord(tx, pageTitle) {
  const exerciseSlug = slugify(pageTitle)
  const exercise = await tx.exercise.upsert({
    where: { slug: exerciseSlug },
    update: {
      title: pageTitle,
    },
    create: {
      slug: exerciseSlug,
      title: pageTitle,
    },
  })
  return exercise
}

function buildExerciseSubmissionRecordData(studentRefId, exerciseRefId, submission, summary) {
  return {
    studentRefId,
    exerciseRefId,
    submittedEaglesId: submission.submittedEaglesId,
    submittedEmail: submission.submittedEmail || null,
    completedAt: submission.completedAt,
    totalQuestions: summary.totalQuestions,
    correctCount: summary.correctCount,
    pendingCount: summary.pendingCount,
    incorrectCount: summary.incorrectCount,
    scorePercent: summary.scorePercent,
    recipientsJson: submission.recipientsJson,
  }
}

function buildExerciseGradeRecordData(student, submission, summary) {
  const className = normalizeString(submission.pageTitle) || "Exercise Submission"
  const completedAt = submission.completedAt instanceof Date ? submission.completedAt : parseCompletedAt(submission.completedAt)
  const totalQuestions = Number.parseInt(String(summary.totalQuestions || 0), 10) || 0
  const correctCount = Number.parseInt(String(summary.correctCount || 0), 10) || 0
  const scorePercent = Number(summary.scorePercent || 0)
  const gradeLevel = normalizeString(student?.profile?.currentGrade)
  const comments = totalQuestions > 0
    ? `${AUTO_IMPORTED_EXERCISE_COMMENT_PREFIX} (${correctCount}/${totalQuestions} correct).`
    : `${AUTO_IMPORTED_EXERCISE_COMMENT_PREFIX}.`

  const schoolYear = resolveCurrentSchoolYear(completedAt)
  return {
    studentRefId: student.id,
    className,
    level: gradeLevel || null,
    schoolYear,
    quarter: quarterFromDate(completedAt, schoolYear),
    assignmentName: className,
    dueAt: completedAt,
    submittedAt: completedAt,
    score: scorePercent,
    maxScore: 100,
    homeworkCompleted: true,
    homeworkOnTime: true,
    comments,
  }
}

function buildIncomingQueueRecordData(submission, summary, options = {}) {
  return {
    status: INCOMING_EXERCISE_RESULT_STATUS_QUEUED,
    submittedEaglesId: submission.submittedEaglesId,
    submittedEmail: submission.submittedEmail || null,
    pageTitle: submission.pageTitle,
    completedAt: submission.completedAt,
    totalQuestions: summary.totalQuestions,
    correctCount: summary.correctCount,
    pendingCount: summary.pendingCount,
    incorrectCount: summary.incorrectCount,
    scorePercent: summary.scorePercent,
    recipientsJson: submission.recipientsJson,
    payloadJson:
      options.payloadJson && typeof options.payloadJson === "object" ? options.payloadJson : null,
    notes: normalizeString(options.notes) || null,
    reviewedByUsername: normalizeString(options.reviewedByUsername) || null,
    matchedStudentRefId: null,
    resolvedAt: null,
  }
}

function buildIncomingSummary(item) {
  return {
    totalQuestions: Number.parseInt(String(item?.totalQuestions || 0), 10) || 0,
    correctCount: Number.parseInt(String(item?.correctCount || 0), 10) || 0,
    pendingCount: Number.parseInt(String(item?.pendingCount || 0), 10) || 0,
    incorrectCount: Number.parseInt(String(item?.incorrectCount || 0), 10) || 0,
    scorePercent: Number(item?.scorePercent || 0),
  }
}

function buildExerciseSubmissionSummary(item) {
  return {
    totalQuestions: Number.parseInt(String(item?.totalQuestions || 0), 10) || 0,
    correctCount: Number.parseInt(String(item?.correctCount || 0), 10) || 0,
    pendingCount: Number.parseInt(String(item?.pendingCount || 0), 10) || 0,
    incorrectCount: Number.parseInt(String(item?.incorrectCount || 0), 10) || 0,
    scorePercent: Number(item?.scorePercent || 0),
  }
}

function buildIncomingDuplicateUpdateData(submission, summary, options = {}) {
  return {
    submittedEaglesId: submission.submittedEaglesId,
    submittedEmail: submission.submittedEmail || null,
    pageTitle: submission.pageTitle,
    completedAt: submission.completedAt,
    totalQuestions: summary.totalQuestions,
    correctCount: summary.correctCount,
    pendingCount: summary.pendingCount,
    incorrectCount: summary.incorrectCount,
    scorePercent: summary.scorePercent,
    recipientsJson: submission.recipientsJson,
    payloadJson:
      options.payloadJson && typeof options.payloadJson === "object" ? options.payloadJson : null,
  }
}

function buildCompletedAtRange(completedAt) {
  const ms = completedAt instanceof Date ? completedAt.valueOf() : Number.NaN
  if (!Number.isFinite(ms)) return null
  return {
    gte: new Date(ms - INCOMING_DUPLICATE_COMPLETED_AT_WINDOW_MS),
    lte: new Date(ms + INCOMING_DUPLICATE_COMPLETED_AT_WINDOW_MS),
  }
}

async function findIncomingDuplicate(prisma, submission) {
  const completedAtRange = buildCompletedAtRange(submission?.completedAt)
  if (!completedAtRange) return null

  return prisma.incomingExerciseResult.findFirst({
    where: {
      status: {
        in: [
          INCOMING_EXERCISE_RESULT_STATUS_QUEUED,
          INCOMING_EXERCISE_RESULT_STATUS_TEMPORARY,
        ],
      },
      submittedEaglesId: submission.submittedEaglesId,
      submittedEmail: submission.submittedEmail || null,
      pageTitle: submission.pageTitle,
      completedAt: completedAtRange,
      createdAt: {
        gte: new Date(Date.now() - INCOMING_DUPLICATE_CREATED_AT_LOOKBACK_MS),
      },
    },
    orderBy: [{ createdAt: "desc" }],
  })
}

async function findMatchedSubmissionDuplicate(prisma, studentRefId, exerciseRefId, submission) {
  const completedAtRange = buildCompletedAtRange(submission?.completedAt)
  if (!completedAtRange) return null

  return prisma.exerciseSubmission.findFirst({
    where: {
      studentRefId,
      exerciseRefId,
      completedAt: completedAtRange,
    },
    orderBy: [{ createdAt: "desc" }],
  })
}

async function findMatchedGradeDuplicate(prisma, studentRefId, pageTitle, completedAt) {
  const completedAtRange = buildCompletedAtRange(completedAt)
  if (!completedAtRange) return null

  return prisma.studentGradeRecord.findFirst({
    where: {
      studentRefId,
      className: pageTitle,
      assignmentName: pageTitle,
      dueAt: completedAtRange,
      submittedAt: completedAtRange,
      comments: {
        startsWith: AUTO_IMPORTED_EXERCISE_COMMENT_PREFIX,
        mode: "insensitive",
      },
    },
    orderBy: [{ createdAt: "desc" }],
  })
}

function mapIncomingExerciseResult(item) {
  if (!item) return null

  return {
    id: item.id,
    status: normalizeStatus(item.status),
    submittedEaglesId: normalizeString(item.submittedEaglesId),
    submittedEmail: normalizeString(item.submittedEmail),
    pageTitle: normalizeString(item.pageTitle),
    completedAt: item.completedAt ? new Date(item.completedAt).toISOString() : "",
    totalQuestions: Number.parseInt(String(item.totalQuestions || 0), 10) || 0,
    correctCount: Number.parseInt(String(item.correctCount || 0), 10) || 0,
    pendingCount: Number.parseInt(String(item.pendingCount || 0), 10) || 0,
    incorrectCount: Number.parseInt(String(item.incorrectCount || 0), 10) || 0,
    scorePercent: Number(item.scorePercent || 0),
    recipientsJson: item.recipientsJson,
    payloadJson: item.payloadJson,
    notes: normalizeString(item.notes),
    reviewedByUsername: normalizeString(item.reviewedByUsername),
    matchedStudentRefId: normalizeString(item.matchedStudentRefId),
    matchedEaglesId: normalizeString(item?.matchedStudent?.eaglesId),
    resolvedAt: item.resolvedAt ? new Date(item.resolvedAt).toISOString() : "",
    createdAt: item.createdAt ? new Date(item.createdAt).toISOString() : "",
    updatedAt: item.updatedAt ? new Date(item.updatedAt).toISOString() : "",
  }
}

export async function persistExerciseSubmission(payload, options = {}) {
  const prisma = await getPrismaClient(options)
  if (!prisma) return { saved: false, reason: "disabled" }

  const submission = normalizeSubmissionPayload(payload)
  const summary = submission.summary
  const matchedStudent = await findMatchedStudent(prisma, submission)

  if (!matchedStudent) {
    const existingIncoming = await findIncomingDuplicate(prisma, submission)
    if (existingIncoming) {
      const incomingQuality = buildSubmissionQuality(summary, submission.completedAt)
      const existingSummary = buildIncomingSummary(existingIncoming)
      const existingQuality = buildSubmissionQuality(
        existingSummary,
        existingIncoming.completedAt
      )

      const shouldReplaceExisting = isSubmissionQualityBetter(incomingQuality, existingQuality)

      if (shouldReplaceExisting) {
        await prisma.incomingExerciseResult.update({
          where: { id: existingIncoming.id },
          data: buildIncomingDuplicateUpdateData(submission, summary, {
            payloadJson: payload,
          }),
        })
      }

      return {
        saved: true,
        matched: false,
        queued: true,
        deduplicated: true,
        updatedExisting: shouldReplaceExisting,
        shouldNotify: false,
        incomingResultId: existingIncoming.id,
        summary: shouldReplaceExisting ? summary : existingSummary,
      }
    }

    const incoming = await prisma.incomingExerciseResult.create({
      data: buildIncomingQueueRecordData(submission, summary, {
        payloadJson: payload,
      }),
    })

    return {
      saved: true,
      matched: false,
      queued: true,
      deduplicated: false,
      updatedExisting: false,
      shouldNotify: true,
      incomingResultId: incoming.id,
      summary,
    }
  }

  const persisted = await prisma.$transaction(async (tx) => {
    const exercise = await ensureExerciseRecord(tx, submission.pageTitle)
    const existingSubmission = await findMatchedSubmissionDuplicate(
      tx,
      matchedStudent.id,
      exercise.id,
      submission
    )
    const incomingQuality = buildSubmissionQuality(summary, submission.completedAt)

    if (existingSubmission) {
      const existingSummary = buildExerciseSubmissionSummary(existingSubmission)
      const existingQuality = buildSubmissionQuality(
        existingSummary,
        existingSubmission.completedAt
      )
      const shouldReplaceExisting = isSubmissionQualityBetter(incomingQuality, existingQuality)

      const submissionRecord = shouldReplaceExisting
        ? await tx.exerciseSubmission.update({
            where: { id: existingSubmission.id },
            data: buildExerciseSubmissionRecordData(matchedStudent.id, exercise.id, submission, summary),
          })
        : existingSubmission

      const existingGradeRecord = await findMatchedGradeDuplicate(
        tx,
        matchedStudent.id,
        submission.pageTitle,
        submission.completedAt
      )

      const gradeRecord = existingGradeRecord
        ? shouldReplaceExisting
          ? await tx.studentGradeRecord.update({
              where: { id: existingGradeRecord.id },
              data: buildExerciseGradeRecordData(matchedStudent, submission, summary),
            })
          : existingGradeRecord
        : await tx.studentGradeRecord.create({
            data: buildExerciseGradeRecordData(matchedStudent, submission, summary),
          })

      return {
        submissionRecord,
        gradeRecord,
        deduplicated: true,
        updatedExisting: shouldReplaceExisting,
        shouldNotify: false,
        summary: shouldReplaceExisting ? summary : existingSummary,
      }
    }

    const submissionRecord = await tx.exerciseSubmission.create({
      data: buildExerciseSubmissionRecordData(matchedStudent.id, exercise.id, submission, summary),
    })
    const gradeRecord = await tx.studentGradeRecord.create({
      data: buildExerciseGradeRecordData(matchedStudent, submission, summary),
    })
    return {
      submissionRecord,
      gradeRecord,
      deduplicated: false,
      updatedExisting: false,
      shouldNotify: true,
      summary,
    }
  })

  return {
    saved: true,
    matched: true,
    queued: false,
    deduplicated: persisted.deduplicated,
    updatedExisting: persisted.updatedExisting,
    shouldNotify: persisted.shouldNotify,
    studentRefId: matchedStudent.id,
    submissionId: persisted.submissionRecord.id,
    gradeRecordId: persisted.gradeRecord.id,
    summary: persisted.summary,
  }
}

export async function listIncomingExerciseResults(params = {}, options = {}) {
  const prisma = await requirePrismaClient(options)
  const take = normalizeTake(params.take, 50, 500)
  const showAll = resolveBoolean(params.showAll, false)
  const statuses = normalizeStatusList(
    params.statuses,
    showAll
      ? []
      : [INCOMING_EXERCISE_RESULT_STATUS_QUEUED, INCOMING_EXERCISE_RESULT_STATUS_TEMPORARY]
  )

  const where = buildIncomingWhere({
    statuses,
    query: params.query,
  })

  const total = await prisma.incomingExerciseResult.count({ where })
  const rows = await prisma.incomingExerciseResult.findMany({
    where,
    include: {
      matchedStudent: {
        select: {
          id: true,
          eaglesId: true,
        },
      },
    },
    orderBy: [{ createdAt: "desc" }],
    take,
  })

  return {
    total,
    take,
    hasMore: total > rows.length,
    statuses,
    items: rows.map((entry) => mapIncomingExerciseResult(entry)),
  }
}

export async function getIncomingExerciseResultById(incomingResultId, options = {}) {
  const prisma = await requirePrismaClient(options)
  const id = normalizeString(incomingResultId)
  if (!id) throw createStatusError("incomingResultId is required", 400)

  const row = await prisma.incomingExerciseResult.findUnique({
    where: { id },
    include: {
      matchedStudent: {
        select: {
          id: true,
          eaglesId: true,
        },
      },
    },
  })

  if (!row) throw createStatusError("Incoming exercise result not found", 404)
  return mapIncomingExerciseResult(row)
}

export async function setIncomingExerciseResultStatus(
  incomingResultId,
  status,
  options = {}
) {
  const prisma = await requirePrismaClient(options)
  const id = normalizeString(incomingResultId)
  if (!id) throw createStatusError("incomingResultId is required", 400)

  const normalizedStatus = normalizeStatus(status, "")
  if (!normalizedStatus) throw createStatusError("Unsupported incoming result status", 400)

  const existing = await prisma.incomingExerciseResult.findUnique({ where: { id } })
  if (!existing) throw createStatusError("Incoming exercise result not found", 404)

  const patch = {
    status: normalizedStatus,
  }

  if (Object.prototype.hasOwnProperty.call(options, "notes")) {
    patch.notes = normalizeString(options.notes) || null
  }

  if (Object.prototype.hasOwnProperty.call(options, "reviewedByUsername")) {
    patch.reviewedByUsername = normalizeString(options.reviewedByUsername) || null
  }

  if (normalizedStatus === INCOMING_EXERCISE_RESULT_STATUS_RESOLVED) {
    patch.resolvedAt = new Date()
  }

  if (
    normalizedStatus === INCOMING_EXERCISE_RESULT_STATUS_ARCHIVED ||
    normalizedStatus === INCOMING_EXERCISE_RESULT_STATUS_QUEUED ||
    normalizedStatus === INCOMING_EXERCISE_RESULT_STATUS_TEMPORARY
  ) {
    patch.resolvedAt = null
  }

  const updated = await prisma.incomingExerciseResult.update({
    where: { id },
    data: patch,
    include: {
      matchedStudent: {
        select: {
          id: true,
          eaglesId: true,
        },
      },
    },
  })

  return mapIncomingExerciseResult(updated)
}

export async function deleteIncomingExerciseResultById(incomingResultId, options = {}) {
  const prisma = await requirePrismaClient(options)
  const id = normalizeString(incomingResultId)
  if (!id) throw createStatusError("incomingResultId is required", 400)

  const existing = await prisma.incomingExerciseResult.findUnique({ where: { id } })
  if (!existing) throw createStatusError("Incoming exercise result not found", 404)

  await prisma.incomingExerciseResult.delete({ where: { id } })

  return {
    deleted: true,
    id,
  }
}

function incomingResultToSubmissionPayload(row) {
  return {
    submittedEaglesId: normalizeString(row.submittedEaglesId),
    submittedEmail: normalizeLower(row.submittedEmail),
    pageTitle: normalizeString(row.pageTitle) || "Untitled exercise",
    completedAt: row.completedAt ? new Date(row.completedAt) : new Date(),
    recipientsJson: Array.isArray(row.recipientsJson) ? row.recipientsJson : null,
  }
}

function incomingResultToSummary(row) {
  return {
    totalQuestions: Number.parseInt(String(row.totalQuestions || 0), 10) || 0,
    correctCount: Number.parseInt(String(row.correctCount || 0), 10) || 0,
    pendingCount: Number.parseInt(String(row.pendingCount || 0), 10) || 0,
    incorrectCount: Number.parseInt(String(row.incorrectCount || 0), 10) || 0,
    scorePercent: Number(row.scorePercent || 0),
  }
}

export async function resolveIncomingExerciseResultToStudent(
  incomingResultId,
  studentRefId,
  options = {}
) {
  const prisma = await requirePrismaClient(options)
  const incomingId = normalizeString(incomingResultId)
  if (!incomingId) throw createStatusError("incomingResultId is required", 400)

  const resolvedStudentRefId = normalizeString(studentRefId)
  if (!resolvedStudentRefId) throw createStatusError("studentRefId is required", 400)

  const result = await prisma.$transaction(async (tx) => {
    const incoming = await tx.incomingExerciseResult.findUnique({ where: { id: incomingId } })
    if (!incoming) throw createStatusError("Incoming exercise result not found", 404)
    if (normalizeStatus(incoming.status) === INCOMING_EXERCISE_RESULT_STATUS_RESOLVED) {
      throw createStatusError("Incoming exercise result is already resolved", 409)
    }

    const student = await tx.student.findUnique({
      where: { id: resolvedStudentRefId },
      select: {
        id: true,
        eaglesId: true,
        profile: {
          select: {
            currentGrade: true,
          },
        },
      },
    })

    if (!student) throw createStatusError("Student not found", 404)

    const submission = incomingResultToSubmissionPayload(incoming)
    const summary = incomingResultToSummary(incoming)
    const exercise = await ensureExerciseRecord(tx, submission.pageTitle)

    const createdSubmission = await tx.exerciseSubmission.create({
      data: buildExerciseSubmissionRecordData(student.id, exercise.id, submission, summary),
    })
    const createdGradeRecord = await tx.studentGradeRecord.create({
      data: buildExerciseGradeRecordData(student, submission, summary),
    })

    const updatedIncoming = await tx.incomingExerciseResult.update({
      where: { id: incomingId },
      data: {
        status: INCOMING_EXERCISE_RESULT_STATUS_RESOLVED,
        matchedStudentRefId: student.id,
        resolvedAt: new Date(),
        reviewedByUsername: normalizeString(options.reviewedByUsername) || null,
        notes: Object.prototype.hasOwnProperty.call(options, "notes")
          ? normalizeString(options.notes) || null
          : incoming.notes,
      },
      include: {
        matchedStudent: {
          select: {
            id: true,
            eaglesId: true,
          },
        },
      },
    })

    return {
      createdSubmission,
      createdGradeRecord,
      updatedIncoming,
      student,
    }
  })

  return {
    resolved: true,
    studentRefId: result.student.id,
    eaglesId: normalizeString(result.student.eaglesId),
    submissionId: result.createdSubmission.id,
    gradeRecordId: result.createdGradeRecord.id,
    item: mapIncomingExerciseResult(result.updatedIncoming),
  }
}
