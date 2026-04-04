// server/student-admin-store.mjs

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { getSharedPrismaClient } from "./prisma-client-factory.mjs"

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

function normalizeNullableEmail(value) {
  const text = normalizeLower(value)
  return text || null
}

function normalizeTextArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeText(entry))
      .filter(Boolean)
  }
  const text = normalizeText(value)
  if (!text) return []
  return text
    .split(/[;,|]/g)
    .map((entry) => normalizeText(entry))
    .filter(Boolean)
}

function canonicalizeGenderSelection(value) {
  const raw = normalizeText(value)
  const token = normalizeLower(raw)
  if (!token) return ""
  const femaleAliases = new Set(["female", "f", "girl", "woman", "women", "nu", "n\u1eef"])
  const maleAliases = new Set(["male", "m", "boy", "man", "men", "nam"])
  if (femaleAliases.has(token)) return "female"
  if (maleAliases.has(token)) return "male"
  return raw
}

function normalizeGenderSelections(value) {
  const selections = normalizeTextArray(value).map((entry) => canonicalizeGenderSelection(entry))
  const seen = new Set()
  const deduped = []
  selections.forEach((entry) => {
    const key = normalizeLower(entry)
    if (!key || seen.has(key)) return
    seen.add(key)
    deduped.push(entry)
  })
  return deduped
}

function normalizeInteger(value) {
  const text = normalizeText(value)
  if (!text) return null
  const parsed = Number.parseInt(text, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizePositiveInteger(value) {
  const parsed = normalizeInteger(value)
  if (!Number.isFinite(parsed) || parsed < 1) return null
  return parsed
}

function normalizeFloat(value) {
  if (value === undefined || value === null || value === "") return null
  const parsed = Number.parseFloat(String(value))
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeBoolean(value) {
  if (value === undefined || value === null || value === "") return null
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value !== 0
  const text = normalizeLower(value)
  if (!text) return null
  if (["true", "1", "yes", "y", "checked"].includes(text)) return true
  if (["false", "0", "no", "n", "unchecked"].includes(text)) return false
  return null
}

const REPORT_PARTICIPATION_POINTS_MAX = 32
export const STUDENT_POINTS_SCHEDULED_ON_TIME_VALUE = 10
export const STUDENT_POINTS_ELECTIVE_SUBMISSION_VALUE = 21
const FIXED_TIME_ZONE_OFFSET_MINUTES = 7 * 60
const FIXED_TIME_ZONE_OFFSET_MS = FIXED_TIME_ZONE_OFFSET_MINUTES * 60 * 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000

function normalizeReportParticipationPoints(value) {
  const parsed = normalizeInteger(value)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, Math.min(REPORT_PARTICIPATION_POINTS_MAX, parsed))
}

function normalizeDate(value) {
  const text = normalizeText(value)
  if (!text) return null
  const parsed = new Date(text)
  if (Number.isNaN(parsed.valueOf())) return null
  return parsed
}

function shiftToFixedTimeZone(value) {
  return new Date(value.getTime() + FIXED_TIME_ZONE_OFFSET_MS)
}

function shiftFromFixedTimeZone(value) {
  return new Date(value.getTime() - FIXED_TIME_ZONE_OFFSET_MS)
}

function normalizeDateValue(value, fallback = new Date()) {
  const parsed = value instanceof Date ? new Date(value.getTime()) : parseDateOrNull(value)
  if (parsed instanceof Date && !Number.isNaN(parsed.valueOf())) return parsed
  return fallback instanceof Date ? new Date(fallback.getTime()) : new Date()
}

function parseLocalDateOnly(value) {
  const text = normalizeText(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const [yearText, monthText, dayText] = text.split("-")
  const year = Number.parseInt(yearText, 10)
  const month = Number.parseInt(monthText, 10)
  const day = Number.parseInt(dayText, 10)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  const fixedMidnightUtc = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - FIXED_TIME_ZONE_OFFSET_MS
  const date = new Date(fixedMidnightUtc)
  if (Number.isNaN(date.valueOf())) return null
  if (toLocalIsoDate(date) !== text) return null
  return date
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

function normalizeQuarter(value) {
  const text = normalizeLower(value)
  if (!text) return null
  if (["q1", "1", "quarter1", "quarter-1"].includes(text)) return "q1"
  if (["q2", "2", "quarter2", "quarter-2"].includes(text)) return "q2"
  if (["q3", "3", "quarter3", "quarter-3"].includes(text)) return "q3"
  if (["q4", "4", "quarter4", "quarter-4"].includes(text)) return "q4"
  return null
}

function normalizeAttendanceStatus(value) {
  const text = normalizeLower(value)
  if (!text) return "present"
  if (text === "present") return "present"
  if (text === "absent") return "absent"
  if (text === "late") return "late"
  if (text === "excused") return "excused"
  return "present"
}

function average(values) {
  const numeric = values.filter((entry) => Number.isFinite(entry))
  if (!numeric.length) return null
  const total = numeric.reduce((sum, entry) => sum + entry, 0)
  return Number((total / numeric.length).toFixed(2))
}

function percentage(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null
  return Number(((numerator / denominator) * 100).toFixed(2))
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

function startOfWeek(value = new Date()) {
  const date = startOfDay(value)
  const shifted = shiftToFixedTimeZone(date)
  const day = shifted.getUTCDay()
  const diffToMonday = (day + 6) % 7
  shifted.setUTCDate(shifted.getUTCDate() - diffToMonday)
  shifted.setUTCHours(0, 0, 0, 0)
  return shiftFromFixedTimeZone(shifted)
}

function endOfWeek(value = new Date()) {
  const date = startOfWeek(value)
  return new Date(date.getTime() + (ONE_DAY_MS * 7) - 1)
}

function startOfYear(value = new Date()) {
  const source = normalizeDateValue(value)
  const shifted = shiftToFixedTimeZone(source)
  const year = shifted.getUTCFullYear()
  return shiftFromFixedTimeZone(new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0)))
}

function parseTardyMinutes(comments) {
  const text = normalizeLower(comments)
  if (!text) return 0
  const minuteMatch = text.match(/(\d{1,3})\s*\+?\s*(?:m|min|mins|minute|minutes)\b/)
  if (minuteMatch && minuteMatch[1]) return Number.parseInt(minuteMatch[1], 10) || 0
  const numberMatch = text.match(/\b(\d{1,3})\b/)
  if (numberMatch && numberMatch[1]) return Number.parseInt(numberMatch[1], 10) || 0
  return 0
}

function isCompletedGradeRecord(record) {
  if (record?.homeworkCompleted === true) return true
  if (record?.submittedAt) return true
  return false
}

function isOutstandingGradeRecord(record, asOfDate = new Date()) {
  if (isCompletedGradeRecord(record)) return false
  if (!record?.dueAt) return true
  const dueAt = new Date(record.dueAt)
  if (Number.isNaN(dueAt.valueOf())) return true
  return dueAt <= asOfDate
}

function isLateCompletedGradeRecord(record) {
  if (!isCompletedGradeRecord(record)) return false
  if (record?.homeworkOnTime === false) return true
  if (record?.homeworkOnTime === true) return false
  if (record?.dueAt && record?.submittedAt) {
    const dueAt = new Date(record.dueAt)
    const submittedAt = new Date(record.submittedAt)
    if (!Number.isNaN(dueAt.valueOf()) && !Number.isNaN(submittedAt.valueOf())) {
      return submittedAt > dueAt
    }
  }
  return false
}

function isOnTimeCompletedGradeRecord(record) {
  if (!isCompletedGradeRecord(record)) return false
  if (record?.homeworkOnTime === true) return true
  if (record?.homeworkOnTime === false) return false
  if (record?.dueAt && record?.submittedAt) {
    const dueAt = new Date(record.dueAt)
    const submittedAt = new Date(record.submittedAt)
    if (!Number.isNaN(dueAt.valueOf()) && !Number.isNaN(submittedAt.valueOf())) {
      return submittedAt <= dueAt
    }
  }
  return Boolean(record?.submittedAt && !record?.dueAt)
}

const AUTO_IMPORTED_EXERCISE_COMMENT_PREFIX = "auto-imported exercise score"
const GRADE_RECORD_SOURCE_ASSIGNMENT = "assignment"
const GRADE_RECORD_SOURCE_MANUAL = "manual"
const GRADE_RECORD_SOURCE_AUTO_IMPORT = "auto-import"

function normalizeGradeRecordSource(value) {
  const source = normalizeLower(value)
  if (
    source === GRADE_RECORD_SOURCE_ASSIGNMENT
    || source === GRADE_RECORD_SOURCE_MANUAL
    || source === GRADE_RECORD_SOURCE_AUTO_IMPORT
  ) {
    return source
  }
  return ""
}

function datesShareExactTimestamp(left, right) {
  const leftDate = parseDateOrNull(left)
  const rightDate = parseDateOrNull(right)
  if (!(leftDate instanceof Date) || !(rightDate instanceof Date)) return false
  return leftDate.valueOf() === rightDate.valueOf()
}

function isAutoImportedExerciseGradeRecord(record = {}) {
  const assignmentName = normalizeLower(record?.assignmentName)
  const className = normalizeLower(record?.className)
  const comments = normalizeLower(record?.comments)
  const assignmentMatchesClass = Boolean(assignmentName && className && assignmentName === className)
  const sameDueAndSubmittedAt = datesShareExactTimestamp(record?.dueAt, record?.submittedAt)
  const markedComplete = record?.homeworkCompleted === true
  const markedOnTime = record?.homeworkOnTime === true
  const hasExerciseScore = Number.isFinite(Number(record?.score)) && Number(record?.maxScore) > 0
  const hasImportComment = comments.startsWith(AUTO_IMPORTED_EXERCISE_COMMENT_PREFIX)
  const isStandaloneCompletedImport = assignmentMatchesClass && sameDueAndSubmittedAt && markedComplete && markedOnTime
  return Boolean(isStandaloneCompletedImport && (hasImportComment || hasExerciseScore))
}

function isAssignmentTrackingGradeRecord(record = {}) {
  if (!record || typeof record !== "object") return false
  return !isAutoImportedExerciseGradeRecord(record)
}

function inferGradeRecordSource(record = {}) {
  const explicitSource = normalizeGradeRecordSource(record?.source)
  if (explicitSource) return explicitSource
  if (isAutoImportedExerciseGradeRecord(record)) return GRADE_RECORD_SOURCE_AUTO_IMPORT

  const hasAssignmentSignals = Boolean(
    parseDateOrNull(record?.dueAt)
    || parseDateOrNull(record?.submittedAt)
    || typeof record?.homeworkCompleted === "boolean"
    || typeof record?.homeworkOnTime === "boolean"
    || normalizeText(record?.assignmentName)
  )
  if (hasAssignmentSignals) return GRADE_RECORD_SOURCE_ASSIGNMENT
  return GRADE_RECORD_SOURCE_MANUAL
}

function mapGradeRecordForApi(record = {}) {
  if (!record || typeof record !== "object") return record
  return {
    ...record,
    source: inferGradeRecordSource(record),
  }
}

function normalizeOutstandingWeekCount(value) {
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

function normalizeAttendanceRiskScore({ absences = 0, late30Plus = 0 } = {}) {
  const normalizedAbsences = Math.max(0, Number.parseInt(String(absences), 10) || 0)
  const normalizedLate30Plus = Math.max(0, Number.parseInt(String(late30Plus), 10) || 0)
  return normalizedAbsences * 3 + normalizedLate30Plus * 2
}

export function selectAtRiskStudentsFromSignals(entries = []) {
  const rows = Array.isArray(entries) ? entries.slice() : []
  return rows
    .filter((entry) => normalizeOutstandingWeekCount(entry?.outstandingWeek) > 0)
    .sort((left, right) => {
      const leftOutstanding = normalizeOutstandingWeekCount(left?.outstandingWeek)
      const rightOutstanding = normalizeOutstandingWeekCount(right?.outstandingWeek)
      if (leftOutstanding !== rightOutstanding) return rightOutstanding - leftOutstanding
      return normalizeText(left?.fullName).localeCompare(normalizeText(right?.fullName))
    })
}

export function selectAttendanceRiskStudentsFromSignals(entries = []) {
  const rows = Array.isArray(entries) ? entries.slice() : []
  return rows
    .filter((entry) => {
      const absences = Math.max(0, Number.parseInt(String(entry?.absences), 10) || 0)
      const late30Plus = Math.max(0, Number.parseInt(String(entry?.late30Plus), 10) || 0)
      return absences >= 2 || late30Plus >= 1
    })
    .sort((left, right) => {
      const leftScore = normalizeAttendanceRiskScore(left)
      const rightScore = normalizeAttendanceRiskScore(right)
      if (leftScore !== rightScore) return rightScore - leftScore
      return normalizeText(left?.fullName).localeCompare(normalizeText(right?.fullName))
    })
}

function parseDateOrNull(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return null
  return date
}

function toIsoDateText(value) {
  const date = value instanceof Date ? value : parseDateOrNull(value)
  if (!(date instanceof Date)) return ""
  if (Number.isNaN(date.valueOf())) return ""
  return toLocalIsoDate(date)
}

function compareByDueAtThenCoverageThenName(left = {}, right = {}) {
  const leftDueAt = parseDateOrNull(left.dueAt)
  const rightDueAt = parseDateOrNull(right.dueAt)
  const leftDueValue = leftDueAt ? leftDueAt.valueOf() : Number.MAX_SAFE_INTEGER
  const rightDueValue = rightDueAt ? rightDueAt.valueOf() : Number.MAX_SAFE_INTEGER
  if (leftDueValue !== rightDueValue) return leftDueValue - rightDueValue
  const leftCoverage = Number.parseInt(String(left.students?.length || 0), 10) || 0
  const rightCoverage = Number.parseInt(String(right.students?.length || 0), 10) || 0
  if (leftCoverage !== rightCoverage) return rightCoverage - leftCoverage
  return normalizeText(left.assignmentName).localeCompare(normalizeText(right.assignmentName))
}

function daysUntilDateFloor(targetDate, now = new Date()) {
  const dueAt = parseDateOrNull(targetDate)
  if (!(dueAt instanceof Date)) return null
  const today = startOfDay(now)
  const dueDay = startOfDay(dueAt)
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.round((dueDay.valueOf() - today.valueOf()) / msPerDay)
}

export function selectCurrentNotYetDueAssignmentsByLevel(entries = [], now = new Date()) {
  const rows = Array.isArray(entries) ? entries : []
  const asOf = parseDateOrNull(now) || new Date()
  const groupsByLevel = new Map()

  rows.forEach((entry) => {
    if (!isAssignmentTrackingGradeRecord(entry)) return
    const studentRefId = normalizeText(entry?.studentRefId)
    if (!studentRefId) return
    const dueAt = parseDateOrNull(entry?.dueAt)
    if (!dueAt) return
    if (dueAt.valueOf() <= asOf.valueOf()) return

    const level = canonicalizeLevel(entry?.level || "") || "Unassigned"
    const assignmentName = normalizeText(entry?.assignmentName) || "Assignment"
    const dueDate = toIsoDateText(dueAt)
    const assignmentKey = `${normalizeLower(assignmentName)}|${dueDate}`
    if (!groupsByLevel.has(level)) groupsByLevel.set(level, new Map())
    const levelGroups = groupsByLevel.get(level)
    if (!levelGroups.has(assignmentKey)) {
      levelGroups.set(assignmentKey, {
        level,
        assignmentName,
        dueAt: dueDate,
        students: [],
      })
    }
    const group = levelGroups.get(assignmentKey)
    let studentEntry = group.students.find((item) => normalizeText(item.studentRefId) === studentRefId)
    if (!studentEntry) {
      studentEntry = {
        studentRefId,
        completed: false,
        submittedAt: "",
      }
      group.students.push(studentEntry)
    }
    if (isCompletedGradeRecord(entry)) studentEntry.completed = true
    const submittedAt = parseDateOrNull(entry?.submittedAt)
    if (submittedAt) {
      const submittedAtText = toIsoDateText(submittedAt)
      if (!studentEntry.submittedAt || submittedAtText < studentEntry.submittedAt) {
        studentEntry.submittedAt = submittedAtText
      }
    }
  })

  return Array.from(groupsByLevel.entries())
    .map(([level, levelGroups]) => {
      const selected = Array.from(levelGroups.values()).sort(compareByDueAtThenCoverageThenName)[0]
      const students = Array.isArray(selected?.students) ? selected.students : []
      return {
        level,
        assignmentName: normalizeText(selected?.assignmentName),
        dueAt: normalizeText(selected?.dueAt),
        students: students
          .slice()
          .sort((left, right) =>
            normalizeText(left?.studentRefId).localeCompare(normalizeText(right?.studentRefId))
          ),
      }
    })
    .sort((left, right) => compareKnownLevelOrder(left.level, right.level))
}

function compareKnownLevelOrder(left, right) {
  const leftCanonical = canonicalizeLevel(left)
  const rightCanonical = canonicalizeLevel(right)
  const leftIndex = LEVEL_DEFINITIONS.findIndex(
    (entry) => normalizeLower(entry.canonical) === normalizeLower(leftCanonical)
  )
  const rightIndex = LEVEL_DEFINITIONS.findIndex(
    (entry) => normalizeLower(entry.canonical) === normalizeLower(rightCanonical)
  )
  if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex
  if (leftIndex >= 0) return -1
  if (rightIndex >= 0) return 1
  return leftCanonical.localeCompare(rightCanonical)
}

function assertWithStatus(condition, status, message) {
  if (condition) return
  const error = new Error(message)
  error.statusCode = status
  throw error
}

function buildExternalKey(eaglesId) {
  return `sid:${normalizeLower(eaglesId)}`
}

function buildEaglesIdFromNumber(studentNumber) {
  const normalized = normalizePositiveInteger(studentNumber)
  if (!normalized) return ""
  return `SIS-${String(normalized).padStart(6, "0")}`
}

function buildUniqueEaglesIdCandidate(baseEaglesId, reservedEaglesIdKeys) {
  const base = normalizeText(baseEaglesId)
  if (!base) return ""
  let candidate = base
  let suffix = 2
  while (reservedEaglesIdKeys.has(normalizeLower(candidate))) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

const STUDENT_NUMBER_START = Math.max(
  100,
  normalizePositiveInteger(process.env.STUDENT_NUMBER_START) || 100
)

function resolveBooleanFlag(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value !== 0
  const normalized = normalizeLower(value)
  if (!normalized) return fallback
  if (["true", "1", "yes", "on"].includes(normalized)) return true
  if (["false", "0", "no", "off"].includes(normalized)) return false
  return fallback
}

const IMPORT_STRICT_IDENTITY_REQUIRED = resolveBooleanFlag(
  process.env.STUDENT_IMPORT_REQUIRE_EXPLICIT_IDENTITY,
  true
)

function normalizePhoneDigits(value) {
  return normalizeText(value).replace(/\D+/g, "")
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

const PARENT_REPORT_DIGITAL_SKILL_MIN_LEVEL = "A2 Flyers"
const PARENT_REPORT_DIGITAL_SKILL_BLOCKED_KEYS = new Set([
  "pt_skill_internationalNews",
  "pt_skill_readingEnglishEnjoyment",
  "pt_skill_vocabularyLookup",
  "pt_rec_internationalNews",
  "pt_rec_readingEnglishEnjoyment",
  "pt_rec_vocabularyLookup",
])

function canonicalizeLevel(value) {
  const text = normalizeText(value)
  if (!text) return ""
  const key = normalizeLevelKey(text)
  return LEVEL_ALIAS_MAP.get(key) || text
}

function knownLevelIndex(value) {
  const canonical = canonicalizeLevel(value)
  return LEVEL_DEFINITIONS.findIndex(
    (entry) => normalizeLower(entry.canonical) === normalizeLower(canonical)
  )
}

function shouldRestrictParentReportDigitalSkills(levelName = "") {
  const currentIndex = knownLevelIndex(levelName)
  const minimumIndex = knownLevelIndex(PARENT_REPORT_DIGITAL_SKILL_MIN_LEVEL)
  if (currentIndex < 0 || minimumIndex < 0) return false
  return currentIndex < minimumIndex
}

function resolveLevelVariants(value) {
  const text = normalizeText(value)
  if (!text) return []
  const canonical = canonicalizeLevel(text)
  const definition = LEVEL_DEFINITIONS.find(
    (entry) => normalizeLower(entry.canonical) === normalizeLower(canonical)
  )
  if (!definition) return [text]
  return Array.from(new Set([definition.canonical, ...(definition.aliases || [])]))
}

const FILTER_CACHE_TTL_SECONDS = Math.max(
  30,
  Number.parseInt(String(process.env.STUDENT_ADMIN_FILTER_CACHE_TTL_SECONDS || "300"), 10) || 300
)
const FILTER_CACHE_KEY =
  normalizeText(process.env.STUDENT_ADMIN_FILTER_CACHE_KEY) || "sis:admin:filters:v1"
const FILTER_CACHE_URL = normalizeText(process.env.REDIS_CACHE_URL) || normalizeText(process.env.REDIS_URL)

let filterCacheRedisClient = null
let filterCacheRedisConnectPromise = null
let filterCacheRedisDisabled = false
let memoryFilterCacheEntry = null

const FILTER_CACHE_STATE = {
  backend: FILTER_CACHE_URL ? "redis" : "memory",
  configuredRedisUrl: Boolean(FILTER_CACHE_URL),
  hits: 0,
  misses: 0,
  writes: 0,
  invalidations: 0,
  lastHitAt: null,
  lastMissAt: null,
  lastWriteAt: null,
  lastInvalidateAt: null,
  lastError: null,
}

function nowIso() {
  return new Date().toISOString()
}

function normalizeFilterList(values) {
  if (!Array.isArray(values)) return []
  return values
    .map((entry) => normalizeText(entry))
    .filter(Boolean)
}

function normalizeFilterPayload(payload = {}) {
  return {
    levels: normalizeFilterList(payload.levels),
    schools: normalizeFilterList(payload.schools),
  }
}

async function getFilterCacheRedisClient() {
  if (!FILTER_CACHE_URL || filterCacheRedisDisabled) return null
  if (filterCacheRedisClient) return filterCacheRedisClient
  if (filterCacheRedisConnectPromise) return filterCacheRedisConnectPromise

  filterCacheRedisConnectPromise = (async () => {
    try {
      const { createClient } = await import("redis")
      const client = createClient({ url: FILTER_CACHE_URL })
      client.on("error", (error) => {
        FILTER_CACHE_STATE.lastError = String(error?.message || error)
      })
      await client.connect()
      filterCacheRedisClient = client
      FILTER_CACHE_STATE.backend = "redis"
      FILTER_CACHE_STATE.lastError = null
      return client
    } catch (error) {
      filterCacheRedisDisabled = true
      FILTER_CACHE_STATE.backend = "memory"
      FILTER_CACHE_STATE.lastError = String(error?.message || error)
      console.warn(`student-admin filter cache falling back to memory: ${error.message}`)
      return null
    } finally {
      filterCacheRedisConnectPromise = null
    }
  })()

  return filterCacheRedisConnectPromise
}

async function readCachedLevelAndSchoolFilters() {
  const now = Date.now()
  if (memoryFilterCacheEntry && memoryFilterCacheEntry.expiresAtMs > now) {
    FILTER_CACHE_STATE.hits += 1
    FILTER_CACHE_STATE.lastHitAt = nowIso()
    return normalizeFilterPayload(memoryFilterCacheEntry.value)
  }

  const client = await getFilterCacheRedisClient()
  if (client) {
    try {
      const raw = await client.get(FILTER_CACHE_KEY)
      FILTER_CACHE_STATE.lastError = null
      if (raw) {
        const parsed = normalizeFilterPayload(JSON.parse(raw))
        memoryFilterCacheEntry = {
          value: parsed,
          expiresAtMs: now + FILTER_CACHE_TTL_SECONDS * 1000,
        }
        FILTER_CACHE_STATE.hits += 1
        FILTER_CACHE_STATE.lastHitAt = nowIso()
        return normalizeFilterPayload(parsed)
      }
    } catch (error) {
      FILTER_CACHE_STATE.lastError = String(error?.message || error)
    }
  }

  FILTER_CACHE_STATE.misses += 1
  FILTER_CACHE_STATE.lastMissAt = nowIso()
  return null
}

async function writeCachedLevelAndSchoolFilters(payload = {}) {
  const normalized = normalizeFilterPayload(payload)
  memoryFilterCacheEntry = {
    value: normalized,
    expiresAtMs: Date.now() + FILTER_CACHE_TTL_SECONDS * 1000,
  }
  FILTER_CACHE_STATE.writes += 1
  FILTER_CACHE_STATE.lastWriteAt = nowIso()

  const client = await getFilterCacheRedisClient()
  if (!client) return

  try {
    await client.set(FILTER_CACHE_KEY, JSON.stringify(normalized), { EX: FILTER_CACHE_TTL_SECONDS })
    FILTER_CACHE_STATE.lastError = null
  } catch (error) {
    FILTER_CACHE_STATE.lastError = String(error?.message || error)
  }
}

async function invalidateLevelAndSchoolFiltersCache() {
  memoryFilterCacheEntry = null
  FILTER_CACHE_STATE.invalidations += 1
  FILTER_CACHE_STATE.lastInvalidateAt = nowIso()

  const client = await getFilterCacheRedisClient()
  if (!client) return

  try {
    await client.del(FILTER_CACHE_KEY)
    FILTER_CACHE_STATE.lastError = null
  } catch (error) {
    FILTER_CACHE_STATE.lastError = String(error?.message || error)
  }
}

function normalizeProfilePayload(payload = {}) {
  const sourceFormId = normalizeText(payload.sourceFormId) || "admin-manual"

  return {
    sourceFormId,
    sourceUrl: normalizeNullableText(payload.sourceUrl),
    fullName: normalizeNullableText(payload.fullName),
    englishName: normalizeNullableText(payload.englishName),
    memberSince: normalizeNullableText(payload.memberSince),
    exercisePoints: normalizeInteger(payload.exercisePoints),
    parentsId: normalizeNullableText(payload.parentsId),
    photoUrl: normalizeNullableText(payload.photoUrl),
    genderSelections: normalizeTextArray(payload.genderSelections),
    studentPhone: normalizeNullableText(payload.studentPhone),
    studentEmail: normalizeNullableEmail(payload.studentEmail),
    hobbies: normalizeNullableText(payload.hobbies),
    dobText: normalizeNullableText(payload.dobText),
    birthOrder: normalizeInteger(payload.birthOrder),
    siblingBrothers: normalizeInteger(payload.siblingBrothers),
    siblingSisters: normalizeInteger(payload.siblingSisters),
    ethnicity: normalizeNullableText(payload.ethnicity),
    languagesAtHome: normalizeTextArray(payload.languagesAtHome),
    otherLanguage: normalizeNullableText(payload.otherLanguage),
    schoolName: normalizeNullableText(payload.schoolName),
    currentGrade: normalizeNullableText(canonicalizeLevel(payload.currentGrade)),
    currentSchoolGrade: normalizeNullableText(payload.currentSchoolGrade),
    motherName: normalizeNullableText(payload.motherName),
    motherEmail: normalizeNullableEmail(payload.motherEmail),
    motherPhone: normalizeNullableText(payload.motherPhone),
    motherEmergencyContact: normalizeNullableText(payload.motherEmergencyContact),
    motherMessenger: normalizeNullableText(payload.motherMessenger),
    fatherName: normalizeNullableText(payload.fatherName),
    fatherEmail: normalizeNullableEmail(payload.fatherEmail),
    fatherPhone: normalizeNullableText(payload.fatherPhone),
    fatherEmergencyContact: normalizeNullableText(payload.fatherEmergencyContact),
    fatherMessenger: normalizeNullableText(payload.fatherMessenger),
    streetAddress: normalizeNullableText(payload.streetAddress),
    newAddress: normalizeNullableText(payload.newAddress),
    wardDistrict: normalizeNullableText(payload.wardDistrict),
    city: normalizeNullableText(payload.city),
    postCode: normalizeNullableText(payload.postCode),
    hasGlasses: normalizeNullableText(payload.hasGlasses),
    hadEyeExam: normalizeNullableText(payload.hadEyeExam),
    lastEyeExamDateText: normalizeNullableText(payload.lastEyeExamDateText),
    prescriptionMedicine: normalizeNullableText(payload.prescriptionMedicine),
    prescriptionDetails: normalizeNullableText(payload.prescriptionDetails),
    learningDisorders: normalizeTextArray(payload.learningDisorders),
    learningDisorderDetails: normalizeNullableText(payload.learningDisorderDetails),
    drugAllergies: normalizeNullableText(payload.drugAllergies),
    foodEnvironmentalAllergies: normalizeNullableText(payload.foodEnvironmentalAllergies),
    vaccinesChildhoodUpToDate: normalizeNullableText(payload.vaccinesChildhoodUpToDate),
    hadCovidPositive: normalizeNullableText(payload.hadCovidPositive),
    covidNegativeDateText: normalizeNullableText(payload.covidNegativeDateText),
    covidShotAlready: normalizeNullableText(payload.covidShotAlready),
    covidVaccinesUpToDate: normalizeNullableText(payload.covidVaccinesUpToDate),
    covidShotHistory: normalizeTextArray(payload.covidShotHistory),
    mostRecentCovidShotDate: normalizeNullableText(payload.mostRecentCovidShotDate),
    feverMedicineAllowed: normalizeTextArray(payload.feverMedicineAllowed),
    whiteOilAllowed: normalizeNullableText(payload.whiteOilAllowed),
    signatureFullName: normalizeNullableText(payload.signatureFullName),
    signatureEmail: normalizeNullableEmail(payload.signatureEmail),
    extraComments: normalizeNullableText(payload.extraComments),
    requiredValidationOk: normalizeBoolean(payload.requiredValidationOk),
    rawFormPayload: payload.rawFormPayload && typeof payload.rawFormPayload === "object" ? payload.rawFormPayload : null,
    normalizedFormPayload:
      payload.normalizedFormPayload && typeof payload.normalizedFormPayload === "object"
        ? payload.normalizedFormPayload
        : null,
  }
}

const PARENT_REPORT_RUBRIC_MARKER_RE = /\[\[SIS-RUBRIC-V1:([A-Za-z0-9_-]+)\]\]\s*$/
const PARENT_REPORT_BUNDLE_MARKER_RE = /\[\[SIS-REPORT-BUNDLE-V2:([A-Za-z0-9_-]+)\]\]\s*$/
const PARENT_REPORT_VISION_STATUS_ALLOWED = new Set(["no-issues", "needs-check", "monitor"])

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

function normalizeParentReportVisionStatus(value = "") {
  const normalized = normalizeText(value)
  return PARENT_REPORT_VISION_STATUS_ALLOWED.has(normalized) ? normalized : null
}

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

function mapParentClassReport(report) {
  if (!report) return report
  const decoded = decodeParentReportCommentBundle(report.comments)
  const metaPayload = decoded.metaPayload && typeof decoded.metaPayload === "object" ? decoded.metaPayload : null
  return {
    ...report,
    comments: decoded.comment,
    rubricPayload: decoded.rubricPayload,
    metaPayload,
    ...(metaPayload || {}),
  }
}

function assertStudentIdentityIntegrity(student = {}, context = "student") {
  const eaglesId = normalizeText(student?.eaglesId)
  const studentNumber = normalizePositiveInteger(student?.studentNumber)
  assertWithStatus(Boolean(eaglesId), 500, `Data integrity error: eaglesId is required (${context})`)
  assertWithStatus(Boolean(studentNumber), 500, `Data integrity error: studentNumber is required (${context})`)
  return {
    eaglesId,
    studentNumber,
  }
}

function mapStudent(student) {
  if (!student) return null
  const identity = assertStudentIdentityIntegrity(student, `student ${normalizeText(student?.id)}`)
  return {
    id: student.id,
    externalKey: student.externalKey,
    studentNumber: identity.studentNumber,
    eaglesId: identity.eaglesId,
    email: student.email,
    createdAt: student.createdAt,
    updatedAt: student.updatedAt,
    profile: student.profile || null,
    counts: student._count || {
      submissions: 0,
      intakeSubmissions: 0,
      attendanceRecords: 0,
      gradeRecords: 0,
      parentReports: 0,
    },
    attendanceRecords: Array.isArray(student.attendanceRecords) ? student.attendanceRecords : undefined,
    gradeRecords: Array.isArray(student.gradeRecords)
      ? student.gradeRecords.map((entry) => mapGradeRecordForApi(entry))
      : undefined,
    parentReports: Array.isArray(student.parentReports)
      ? student.parentReports.map((entry) => mapParentClassReport(entry))
      : undefined,
  }
}

let prismaClientPromise = null

export function isStudentAdminStoreEnabled() {
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

function normalizeStudentNumberFloor(value = STUDENT_NUMBER_START) {
  return Math.max(100, normalizePositiveInteger(value) || STUDENT_NUMBER_START)
}

function maxStudentNumberFromRows(rows = [], floor = STUDENT_NUMBER_START) {
  const minimum = normalizeStudentNumberFloor(floor)
  return rows.reduce((highest, row) => {
    const candidate = normalizePositiveInteger(row?.studentNumber) || 0
    return candidate > highest ? candidate : highest
  }, minimum - 1)
}

async function resolveNextStudentNumberForClient(client, floor = STUDENT_NUMBER_START) {
  const minimum = normalizeStudentNumberFloor(floor)
  const rows = await client.student.findMany({
    select: {
      studentNumber: true,
    },
  })
  const highest = maxStudentNumberFromRows(rows, minimum)
  return Math.max(minimum, highest + 1)
}

function requestedStudentNumberFromPayload(payload = {}) {
  return normalizePositiveInteger(payload?.studentNumber)
}

function getImportValue(row, aliases) {
  const aliasSet = new Set(aliases.map((entry) => normalizeLower(entry)))
  const entries = Object.entries(row || {})
  for (let i = 0; i < entries.length; i += 1) {
    const [key, value] = entries[i]
    if (aliasSet.has(normalizeLower(key))) return value
  }
  return ""
}

export function mapImportRowToStudentPayload(row) {
  const eaglesId = normalizeText(getImportValue(row, ["eaglesId"]))
  const studentNumber = normalizePositiveInteger(getImportValue(row, ["studentNumber"]))
  const fullName = normalizeText(getImportValue(row, ["fullName", "fullNameStudent"]))
  const englishName = normalizeText(getImportValue(row, ["englishName"]))
  const genderSelections = normalizeGenderSelections(
    getImportValue(row, ["gender", "genderSelections", "sex"])
  )

  const profile = {
    sourceFormId: "spreadsheet-import",
    sourceUrl: "local-import",
    fullName,
    englishName,
    memberSince: normalizeText(getImportValue(row, ["memberSince"])),
    exercisePoints: normalizePositiveInteger(getImportValue(row, ["exercisePoints"])),
    parentsId: normalizeText(getImportValue(row, ["parentsId"])),
    photoUrl: normalizeText(getImportValue(row, ["photoUrl", "studentPhoto", "unnamed1"])),
    genderSelections,
    studentPhone: normalizeText(getImportValue(row, ["studentPhone"])),
    studentEmail: normalizeText(getImportValue(row, ["studentEmail"])),
    hobbies: normalizeText(getImportValue(row, ["hobbies"])),
    dobText: normalizeText(getImportValue(row, ["dobText", "dob"])),
    birthOrder: normalizePositiveInteger(getImportValue(row, ["birthOrder"])),
    siblingBrothers: normalizePositiveInteger(getImportValue(row, ["siblingBrothers", "numberOfSiblingsMale"])),
    siblingSisters: normalizePositiveInteger(getImportValue(row, ["siblingSisters", "numberOfSiblingsFemale"])),
    ethnicity: normalizeText(getImportValue(row, ["ethnicity"])),
    languagesAtHome: normalizeTextArray(getImportValue(row, ["languagesAtHome", "languagesHome"])),
    otherLanguage: normalizeText(getImportValue(row, ["otherLanguage", "describeOtherLanguage"])),
    schoolName: normalizeText(getImportValue(row, ["schoolName", "studentSchool"])),
    currentGrade: canonicalizeLevel(
      normalizeText(getImportValue(row, ["currentGrade", "classLevel"]))
    ),
    currentSchoolGrade: normalizeText(
      getImportValue(row, ["currentSchoolGrade", "studentCurrentGrade"])
    ),
    streetAddress: normalizeText(getImportValue(row, ["streetAddress"])),
    newAddress: normalizeText(getImportValue(row, ["newAddress"])),
    wardDistrict: normalizeText(getImportValue(row, ["wardDistrict"])),
    city: normalizeText(getImportValue(row, ["city"])),
    postCode: normalizeText(getImportValue(row, ["postCode"])),
    motherName: normalizeText(getImportValue(row, ["motherName", "fullNameMother"])),
    motherEmail: normalizeText(getImportValue(row, ["motherEmail", "emailMa"])),
    motherPhone: normalizeText(getImportValue(row, ["motherPhone", "mothersPhone"])),
    motherEmergencyContact: normalizeText(
      getImportValue(row, ["motherEmergencyContact", "emergencyContactMother"])
    ),
    motherMessenger: normalizeText(getImportValue(row, ["motherMessenger", "zaloImIdMother"])),
    fatherName: normalizeText(getImportValue(row, ["fatherName", "fullNameFather"])),
    fatherEmail: normalizeText(getImportValue(row, ["fatherEmail", "emailBa"])),
    fatherPhone: normalizeText(getImportValue(row, ["fatherPhone", "fathersPhone"])),
    fatherEmergencyContact: normalizeText(
      getImportValue(row, ["fatherEmergencyContact", "emergencyContactFather"])
    ),
    fatherMessenger: normalizeText(getImportValue(row, ["fatherMessenger", "zaloImIdBa"])),
    hasGlasses: normalizeText(getImportValue(row, ["hasGlasses", "wearGlasses"])),
    hadEyeExam: normalizeText(getImportValue(row, ["hadEyeExam", "lastEyeExam"])),
    lastEyeExamDateText: normalizeText(getImportValue(row, ["lastEyeExamDateText", "dateLastEyeExam"])),
    prescriptionMedicine: normalizeText(getImportValue(row, ["prescriptionMedicine"])),
    prescriptionDetails: normalizeText(getImportValue(row, ["prescriptionDetails", "explainListRxMeds"])),
    learningDisorders: normalizeTextArray(getImportValue(row, ["learningDisorders"])),
    learningDisorderDetails: normalizeText(getImportValue(row, ["learningDisorderDetails", "explainLdBd"])),
    drugAllergies: normalizeText(getImportValue(row, ["drugAllergies", "drugAllergiesList"])),
    foodEnvironmentalAllergies: normalizeText(
      getImportValue(row, ["foodEnvironmentalAllergies", "foodEnvironmentalAllergiesList"])
    ),
    vaccinesChildhoodUpToDate: normalizeText(
      getImportValue(row, ["vaccinesChildhoodUpToDate", "childhoodVaccinesUtd"])
    ),
    hadCovidPositive: normalizeText(getImportValue(row, ["hadCovidPositive", "covid19PositiveOrHadIt"])),
    covidNegativeDateText: normalizeText(
      getImportValue(row, ["covidNegativeDateText", "dateNegativeAfterInfections"])
    ),
    covidShotAlready: normalizeText(getImportValue(row, ["covidShotAlready", "hadCovidShotAlready"])),
    covidVaccinesUpToDate: normalizeText(getImportValue(row, ["covidVaccinesUpToDate", "covid19VaccineUtd"])),
    mostRecentCovidShotDate: normalizeText(
      getImportValue(row, ["mostRecentCovidShotDate", "mostRecentCovidShot"])
    ),
    covidShotHistory: normalizeTextArray(
      getImportValue(row, ["covidShotHistory", "checkEachCovidInjectionStudentHasHad"])
    ),
    feverMedicineAllowed: normalizeTextArray(getImportValue(row, ["feverMedicineAllowed", "feverMedicine"])),
    whiteOilAllowed: normalizeText(getImportValue(row, ["whiteOilAllowed", "dauTrangDuoc"])),
    signatureFullName: normalizeText(getImportValue(row, ["signatureFullName", "signature"])),
    signatureEmail: normalizeText(getImportValue(row, ["signatureEmail", "emailFormSig"])),
    extraComments: normalizeText(getImportValue(row, ["extraComments", "comments"])),
  }

  return {
    eaglesId,
    studentNumber,
    email: normalizeText(getImportValue(row, ["email", "studentEmail"])),
    profile,
  }
}

function hasBackfillImportValue(value) {
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === "number") return Number.isFinite(value)
  if (typeof value === "boolean") return true
  if (value && typeof value === "object") return Object.keys(value).length > 0
  return Boolean(normalizeText(value))
}

export function mergeImportPayloadForBackfill(importPayload = {}, existingStudent = {}) {
  const incoming = importPayload && typeof importPayload === "object" ? importPayload : {}
  const existing = existingStudent && typeof existingStudent === "object" ? existingStudent : {}
  const incomingProfile = incoming.profile && typeof incoming.profile === "object" ? incoming.profile : {}
  const existingProfile = existing.profile && typeof existing.profile === "object" ? existing.profile : {}

  const mergedProfile = { ...existingProfile }
  Object.entries(incomingProfile).forEach(([key, value]) => {
    if (!hasBackfillImportValue(value)) return
    mergedProfile[key] = value
  })
  if (!hasBackfillImportValue(mergedProfile.sourceFormId)) mergedProfile.sourceFormId = "spreadsheet-import"
  if (!hasBackfillImportValue(mergedProfile.sourceUrl)) mergedProfile.sourceUrl = "local-import"

  const incomingEmail = normalizeText(incoming.email)
  const existingEmail = normalizeText(existing.email)
  const mergedEmail = incomingEmail || existingEmail

  const incomingStudentNumber = normalizePositiveInteger(incoming.studentNumber)
  const existingStudentNumber = normalizePositiveInteger(existing.studentNumber)

  return {
    ...incoming,
    eaglesId: normalizeText(existing.eaglesId) || normalizeText(incoming.eaglesId),
    studentNumber: incomingStudentNumber || existingStudentNumber || null,
    email: mergedEmail,
    profile: mergedProfile,
  }
}

function valuesEqualForImportDiff(leftValue, rightValue) {
  if (Array.isArray(leftValue) || Array.isArray(rightValue)) {
    const left = Array.isArray(leftValue) ? leftValue.map((entry) => normalizeText(entry)).filter(Boolean) : []
    const right = Array.isArray(rightValue) ? rightValue.map((entry) => normalizeText(entry)).filter(Boolean) : []
    if (left.length !== right.length) return false
    return left.every((entry, index) => entry === right[index])
  }

  if (Number.isFinite(leftValue) || Number.isFinite(rightValue)) {
    const leftNumber = Number.isFinite(leftValue) ? Number(leftValue) : null
    const rightNumber = Number.isFinite(rightValue) ? Number(rightValue) : null
    return leftNumber === rightNumber
  }

  if (typeof leftValue === "boolean" || typeof rightValue === "boolean") {
    return Boolean(leftValue) === Boolean(rightValue)
  }

  return normalizeText(leftValue) === normalizeText(rightValue)
}

function collectImportChangedFieldNames(beforeState = {}, afterState = {}) {
  const changed = []
  const scalarKeys = ["email", "studentNumber"]
  scalarKeys.forEach((key) => {
    if (!valuesEqualForImportDiff(beforeState?.[key], afterState?.[key])) changed.push(key)
  })

  const beforeProfile = beforeState?.profile && typeof beforeState.profile === "object" ? beforeState.profile : {}
  const afterProfile = afterState?.profile && typeof afterState.profile === "object" ? afterState.profile : {}
  const profileKeys = Array.from(new Set([...Object.keys(beforeProfile), ...Object.keys(afterProfile)])).sort(
    (left, right) => left.localeCompare(right)
  )
  profileKeys.forEach((key) => {
    if (!valuesEqualForImportDiff(beforeProfile[key], afterProfile[key])) changed.push(`profile.${key}`)
  })

  return changed
}

function summarizeImportRowFields(row = {}) {
  const profile = row?.profile && typeof row.profile === "object" ? row.profile : {}
  return {
    eaglesId: normalizeText(row?.eaglesId) || null,
    studentNumber: normalizePositiveInteger(row?.studentNumber),
    fullName: normalizeText(profile.fullName) || null,
    englishName: normalizeText(profile.englishName) || null,
    email: normalizeNullableEmail(row?.email || profile.studentEmail),
  }
}

export function applyImportIdentityDefaults(
  mappedRows = [],
  {
    existingRows = [],
    studentNumberStart = STUDENT_NUMBER_START,
  } = {}
) {
  const minimumStudentNumber = normalizeStudentNumberFloor(studentNumberStart)
  const existingEaglesIdKeys = new Set()
  const reservedEaglesIdKeys = new Set()
  const reservedStudentNumbers = new Set()

  ;(Array.isArray(existingRows) ? existingRows : []).forEach((row) => {
    const idKey = normalizeLower(row?.eaglesId)
    if (idKey) {
      existingEaglesIdKeys.add(idKey)
      reservedEaglesIdKeys.add(idKey)
    }
    const number = normalizePositiveInteger(row?.studentNumber)
    if (number) reservedStudentNumbers.add(number)
  })

  const rows = (Array.isArray(mappedRows) ? mappedRows : []).map((row) => ({ ...(row || {}) }))
  rows.forEach((row) => {
    const idKey = normalizeLower(row?.eaglesId)
    if (idKey) reservedEaglesIdKeys.add(idKey)
    const number = normalizePositiveInteger(row?.studentNumber)
    if (number) reservedStudentNumbers.add(number)
  })

  let nextStudentNumber = minimumStudentNumber
  reservedStudentNumbers.forEach((number) => {
    if (number >= nextStudentNumber) nextStudentNumber = number + 1
  })

  let autoFilledEaglesIds = 0
  let autoFilledStudentNumbers = 0

  const nextRows = rows.map((row, index) => {
    const nextRow = { ...row }
    const explicitEaglesId = normalizeText(nextRow.eaglesId)
    const explicitEaglesIdKey = normalizeLower(explicitEaglesId)
    const explicitEaglesIdExists = explicitEaglesIdKey
      ? existingEaglesIdKeys.has(explicitEaglesIdKey)
      : false

    let studentNumber = normalizePositiveInteger(nextRow.studentNumber)
    if (!studentNumber && (!explicitEaglesId || !explicitEaglesIdExists)) {
      while (reservedStudentNumbers.has(nextStudentNumber)) nextStudentNumber += 1
      studentNumber = nextStudentNumber
      reservedStudentNumbers.add(studentNumber)
      nextStudentNumber += 1
      nextRow.studentNumber = studentNumber
      autoFilledStudentNumbers += 1
    }

    if (!explicitEaglesId) {
      if (!studentNumber) {
        while (reservedStudentNumbers.has(nextStudentNumber)) nextStudentNumber += 1
        studentNumber = nextStudentNumber
        reservedStudentNumbers.add(studentNumber)
        nextStudentNumber += 1
        nextRow.studentNumber = studentNumber
        autoFilledStudentNumbers += 1
      }

      const baseEaglesId =
        buildEaglesIdFromNumber(studentNumber) || `SIS-IMPORT-${String(index + 1).padStart(6, "0")}`
      const generatedEaglesId = buildUniqueEaglesIdCandidate(baseEaglesId, reservedEaglesIdKeys)
      nextRow.eaglesId = generatedEaglesId
      reservedEaglesIdKeys.add(normalizeLower(generatedEaglesId))
      autoFilledEaglesIds += 1
    }

    return nextRow
  })

  return {
    rows: nextRows,
    autoFilledEaglesIds,
    autoFilledStudentNumbers,
  }
}

export function validateImportRowsForIdentity(
  mappedRows = [],
  {
    existingRows = [],
    studentNumberStart = STUDENT_NUMBER_START,
    requireExplicitIdentity = IMPORT_STRICT_IDENTITY_REQUIRED,
  } = {}
) {
  const mapped = (Array.isArray(mappedRows) ? mappedRows : []).map((row) => ({ ...(row || {}) }))
  const strictMode = requireExplicitIdentity !== false
  const prepared = strictMode
    ? {
        rows: mapped,
        autoFilledEaglesIds: 0,
        autoFilledStudentNumbers: 0,
      }
    : applyImportIdentityDefaults(mapped, { existingRows, studentNumberStart })

  const seenEaglesIds = new Map()
  const seenStudentNumbers = new Map()
  const existingStudentNumbers = new Set()
  const existingIdentityByEaglesId = new Map()
  const rowErrors = new Map()

  const setRowError = (rowNumber, message) => {
    if (!Number.isInteger(rowNumber) || rowNumber < 1) return
    if (!normalizeText(message)) return
    if (!rowErrors.has(rowNumber)) rowErrors.set(rowNumber, message)
  }

  ;(Array.isArray(existingRows) ? existingRows : []).forEach((row) => {
    const eaglesIdKey = normalizeLower(row?.eaglesId)
    const studentNumber = normalizePositiveInteger(row?.studentNumber)
    if (studentNumber) existingStudentNumbers.add(studentNumber)
    if (eaglesIdKey) {
      existingIdentityByEaglesId.set(eaglesIdKey, {
        studentNumber,
      })
    }
  })

  for (let i = 0; i < prepared.rows.length; i += 1) {
    const rowNumber = i + 1
    const row = prepared.rows[i] || {}
    const eaglesId = normalizeText(row.eaglesId)
    const studentNumber = normalizePositiveInteger(row.studentNumber)
    const existingIdentity = eaglesId ? existingIdentityByEaglesId.get(normalizeLower(eaglesId)) || null : null

    if (!eaglesId) {
      const strictMessage = "eaglesId is required (strict import mode requires explicit identity values)"
      setRowError(rowNumber, strictMode ? strictMessage : "eaglesId is required")
    } else {
      const eaglesIdKey = normalizeLower(eaglesId)
      const duplicateEaglesRow = seenEaglesIds.get(eaglesIdKey)
      if (duplicateEaglesRow) {
        const duplicateMessage = `duplicate eaglesId (also in row ${rowNumber})`
        if (!rowErrors.has(duplicateEaglesRow)) setRowError(duplicateEaglesRow, duplicateMessage)
        setRowError(rowNumber, `duplicate eaglesId (also in row ${duplicateEaglesRow})`)
      } else {
        seenEaglesIds.set(eaglesIdKey, rowNumber)
      }
    }

    if (!studentNumber) continue

    const duplicateStudentNumberRow = seenStudentNumbers.get(studentNumber)
    if (duplicateStudentNumberRow) {
      const duplicateMessage = `duplicate studentNumber (also in row ${rowNumber})`
      if (!rowErrors.has(duplicateStudentNumberRow)) {
        setRowError(duplicateStudentNumberRow, duplicateMessage)
      }
      setRowError(rowNumber, `duplicate studentNumber (also in row ${duplicateStudentNumberRow})`)
      continue
    }
    seenStudentNumbers.set(studentNumber, rowNumber)

    const existingStudentNumber = normalizePositiveInteger(existingIdentity?.studentNumber)
    if (existingIdentity && existingStudentNumber && studentNumber !== existingStudentNumber) {
      setRowError(rowNumber, "studentNumber does not match existing eaglesId")
      continue
    }

    if (existingStudentNumbers.has(studentNumber)) {
      if (!existingIdentity) {
        setRowError(rowNumber, "studentNumber already exists in database")
      } else if (!existingStudentNumber) {
        setRowError(rowNumber, "studentNumber already exists in database")
      }
    }
  }

  const errors = Array.from(rowErrors.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([rowNumber, message]) => ({ rowNumber, message }))

  return {
    rows: prepared.rows,
    autoFilledEaglesIds: prepared.autoFilledEaglesIds,
    autoFilledStudentNumbers: prepared.autoFilledStudentNumbers,
    requireExplicitIdentity: strictMode,
    errors,
  }
}

function normalizeSearchComparable(value) {
  const folded = normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
  return folded.replace(/[^a-z0-9]+/g, " ").trim()
}

function studentSearchComparableHaystack(student = {}) {
  const profile = student?.profile || {}
  return [
    student?.eaglesId,
    student?.email,
    profile?.studentEmail,
    profile?.fullName,
    profile?.englishName,
    profile?.motherName,
    profile?.fatherName,
    profile?.schoolName,
    profile?.currentGrade,
  ]
    .map((entry) => normalizeSearchComparable(entry))
    .filter(Boolean)
    .join(" ")
}

function studentMatchesSearchComparable(student = {}, searchComparable = "") {
  const needle = normalizeSearchComparable(searchComparable)
  if (!needle) return true
  return studentSearchComparableHaystack(student).includes(needle)
}

const STUDENT_LIST_QUERY_INCLUDE = {
  profile: true,
  _count: {
    select: {
      submissions: true,
      intakeSubmissions: true,
      attendanceRecords: true,
      gradeRecords: true,
      parentReports: true,
    },
  },
}

const STUDENT_LIST_QUERY_ORDER_BY = [
  {
    profile: {
      fullName: "asc",
    },
  },
  { eaglesId: "asc" },
]

const STUDENT_SEARCH_FALLBACK_SCAN_BATCH = 250

function listStudentsBaseWhere({ levelFilter = "", schoolFilter = "", levelVariants = [] } = {}) {
  return {
    AND: [
      levelFilter
        ? {
            profile: {
              is: levelVariants.length
                ? {
                    OR: levelVariants.map((entry) => ({
                      currentGrade: {
                        equals: entry,
                        mode: "insensitive",
                      },
                    })),
                  }
                : {
                    currentGrade: {
                      equals: levelFilter,
                      mode: "insensitive",
                    },
                  },
            },
          }
        : {},
      schoolFilter
        ? {
            profile: {
              is: {
                schoolName: {
                  equals: schoolFilter,
                  mode: "insensitive",
                },
              },
            },
          }
        : {},
    ],
  }
}

function listStudentsSearchClause(searchQuery = "") {
  const queryText = normalizeText(searchQuery)
  if (!queryText) return null
  return {
    OR: [
      { eaglesId: { contains: queryText, mode: "insensitive" } },
      { email: { contains: queryText, mode: "insensitive" } },
      { profile: { is: { fullName: { contains: queryText, mode: "insensitive" } } } },
      { profile: { is: { englishName: { contains: queryText, mode: "insensitive" } } } },
      { profile: { is: { motherName: { contains: queryText, mode: "insensitive" } } } },
      { profile: { is: { fatherName: { contains: queryText, mode: "insensitive" } } } },
    ],
  }
}

async function findAccentInsensitiveStudentIds({ prisma, baseWhere = {}, searchComparable = "", limit = 250 } = {}) {
  const needle = normalizeSearchComparable(searchComparable)
  if (!needle || !Number.isFinite(limit) || limit <= 0) return []

  const matchedIds = []
  const matchedSet = new Set()
  let skip = 0

  while (matchedIds.length < limit) {
    const rows = await prisma.student.findMany({
      where: baseWhere,
      select: {
        id: true,
        eaglesId: true,
        email: true,
        profile: {
          select: {
            studentEmail: true,
            fullName: true,
            englishName: true,
            motherName: true,
            fatherName: true,
            schoolName: true,
            currentGrade: true,
          },
        },
      },
      orderBy: STUDENT_LIST_QUERY_ORDER_BY,
      skip,
      take: STUDENT_SEARCH_FALLBACK_SCAN_BATCH,
    })
    if (!rows.length) break

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      const rowId = normalizeText(row?.id)
      if (!rowId || matchedSet.has(rowId)) continue
      if (!studentMatchesSearchComparable(row, needle)) continue
      matchedIds.push(rowId)
      matchedSet.add(rowId)
      if (matchedIds.length >= limit) break
    }

    skip += rows.length
    if (rows.length < STUDENT_SEARCH_FALLBACK_SCAN_BATCH) break
  }

  return matchedIds
}

export async function listStudents({ query = "", level = "", school = "", take = 250 } = {}) {
  const prisma = await getPrismaClient()
  const searchQuery = normalizeText(query)
  const levelFilter = normalizeText(level)
  const schoolFilter = normalizeText(school)
  const limit = Math.max(1, Math.min(Number.parseInt(String(take), 10) || 250, 1000))
  const levelVariants = resolveLevelVariants(levelFilter)
  const baseWhere = listStudentsBaseWhere({ levelFilter, schoolFilter, levelVariants })
  const searchClause = listStudentsSearchClause(searchQuery)
  const where = searchClause ? { AND: [...(baseWhere.AND || []), searchClause] } : baseWhere

  let students = await prisma.student.findMany({
    where,
    include: STUDENT_LIST_QUERY_INCLUDE,
    orderBy: STUDENT_LIST_QUERY_ORDER_BY,
    take: limit,
  })

  if (searchQuery && students.length === 0) {
    const matchedIds = await findAccentInsensitiveStudentIds({
      prisma,
      baseWhere,
      searchComparable: searchQuery,
      limit,
    })
    if (matchedIds.length) {
      students = await prisma.student.findMany({
        where: {
          id: {
            in: matchedIds,
          },
        },
        include: STUDENT_LIST_QUERY_INCLUDE,
        orderBy: STUDENT_LIST_QUERY_ORDER_BY,
        take: limit,
      })
    }
  }

  return {
    total: students.length,
    items: students.map((entry) => mapStudent(entry)),
  }
}

export async function getStudentById(studentRefId) {
  const prisma = await getPrismaClient()
  const id = normalizeText(studentRefId)
  assertWithStatus(Boolean(id), 400, "studentRefId is required")

  const student = await prisma.student.findUnique({
    where: { id },
    include: {
      profile: true,
      attendanceRecords: {
        orderBy: { attendanceDate: "desc" },
        take: 300,
      },
      gradeRecords: {
        orderBy: [{ dueAt: "desc" }, { createdAt: "desc" }],
        take: 400,
      },
      parentReports: {
        orderBy: { generatedAt: "desc" },
        take: 200,
      },
      _count: {
        select: {
          submissions: true,
          intakeSubmissions: true,
          attendanceRecords: true,
          gradeRecords: true,
          parentReports: true,
        },
      },
    },
  })

  assertWithStatus(Boolean(student), 404, "Student not found")
  return mapStudent(student)
}

export async function getNextStudentNumber({ floor = STUDENT_NUMBER_START } = {}) {
  const prisma = await getPrismaClient()
  const startAt = normalizeStudentNumberFloor(floor)
  const nextStudentNumber = await resolveNextStudentNumberForClient(prisma, startAt)
  return {
    startAt,
    nextStudentNumber,
  }
}

async function assertStudentNumberIsUniqueForClient(client, studentNumber, excludedStudentId = "") {
  const normalizedNumber = normalizePositiveInteger(studentNumber)
  if (!normalizedNumber) return
  const duplicate = await client.student.findFirst({
    where: {
      studentNumber: normalizedNumber,
      ...(excludedStudentId
        ? {
            id: {
              not: excludedStudentId,
            },
          }
        : {}),
    },
  })
  assertWithStatus(!duplicate, 409, "studentNumber already exists")
}

async function saveStudentWithClient(client, payload = {}, studentRefId = "") {
  const eaglesId = normalizeText(payload.eaglesId)
  assertWithStatus(Boolean(eaglesId), 400, "eaglesId is required")

  const studentEmail = normalizeNullableEmail(payload.email)
  const profilePayload = normalizeProfilePayload(payload.profile || {})
  const profileEmail = profilePayload.studentEmail || null
  const persistedEmail = profileEmail || studentEmail
  const requestedStudentNumber = requestedStudentNumberFromPayload(payload)
  const requestedId = normalizeText(studentRefId)

  if (requestedId) {
    const existing = await client.student.findUnique({ where: { id: requestedId } })
    assertWithStatus(Boolean(existing), 404, "Student not found")
    assertWithStatus(
      normalizeLower(eaglesId) === normalizeLower(existing.eaglesId),
      409,
      "eaglesId is immutable and cannot be changed"
    )
    const existingStudentNumber = normalizePositiveInteger(existing.studentNumber)
    if (requestedStudentNumber && existingStudentNumber && requestedStudentNumber !== existingStudentNumber) {
      assertWithStatus(false, 409, "studentNumber is immutable and cannot be changed")
    }

    const duplicate = await client.student.findFirst({
      where: {
        eaglesId: eaglesId,
        id: {
          not: requestedId,
        },
      },
    })
    assertWithStatus(!duplicate, 409, "eaglesId already exists")

    const studentNumber =
      existingStudentNumber ||
      requestedStudentNumber ||
      (await resolveNextStudentNumberForClient(client, STUDENT_NUMBER_START))
    await assertStudentNumberIsUniqueForClient(client, studentNumber, requestedId)

    const student = await client.student.update({
      where: { id: requestedId },
      data: {
        studentNumber,
        eaglesId: eaglesId,
        externalKey: buildExternalKey(eaglesId),
        email: persistedEmail,
      },
    })

    await client.studentProfile.upsert({
      where: { studentRefId: student.id },
      update: profilePayload,
      create: {
        studentRefId: student.id,
        ...profilePayload,
      },
    })

    return {
      action: "updated",
      studentRefId: student.id,
    }
  }

  const existingByEaglesId = await client.student.findUnique({ where: { eaglesId: eaglesId } })
  assertWithStatus(!existingByEaglesId, 409, "eaglesId already exists")

  const studentNumber = requestedStudentNumber || (await resolveNextStudentNumberForClient(client, STUDENT_NUMBER_START))
  await assertStudentNumberIsUniqueForClient(client, studentNumber)

  const student = await client.student.create({
    data: {
      studentNumber,
      externalKey: buildExternalKey(eaglesId),
      eaglesId: eaglesId,
      email: persistedEmail,
    },
  })

  await client.studentProfile.create({
    data: {
      studentRefId: student.id,
      ...profilePayload,
    },
  })

  return {
    action: "created",
    studentRefId: student.id,
  }
}

export async function saveStudent(payload = {}, studentRefId = "", options = {}) {
  const prisma = await getPrismaClient()
  const skipFilterCacheInvalidation = options.skipFilterCacheInvalidation === true
  const result = await prisma.$transaction((tx) => saveStudentWithClient(tx, payload, studentRefId))

  if (!skipFilterCacheInvalidation) {
    await invalidateLevelAndSchoolFiltersCache()
  }

  return {
    action: result.action,
    student: await getStudentById(result.studentRefId),
  }
}

export async function deleteStudent(studentRefId) {
  const prisma = await getPrismaClient()
  const id = normalizeText(studentRefId)
  assertWithStatus(Boolean(id), 400, "studentRefId is required")

  await prisma.$transaction(async (tx) => {
    await tx.parentClassReport.deleteMany({ where: { studentRefId: id } })
    await tx.studentGradeRecord.deleteMany({ where: { studentRefId: id } })
    await tx.studentAttendance.deleteMany({ where: { studentRefId: id } })
    await tx.exerciseSubmission.deleteMany({ where: { studentRefId: id } })
    await tx.studentIntakeSubmission.deleteMany({ where: { studentRefId: id } })
    await tx.studentProfile.deleteMany({ where: { studentRefId: id } })
    await tx.student.delete({ where: { id } })
  })

  await invalidateLevelAndSchoolFiltersCache()

  return { deleted: true, studentRefId: id }
}

export async function importStudentsFromRows(rows = []) {
  assertWithStatus(Array.isArray(rows), 400, "rows must be an array")
  assertWithStatus(rows.length > 0, 400, "rows cannot be empty")

  const prisma = await getPrismaClient()
  const existingRows = await prisma.student.findMany({
    select: {
      eaglesId: true,
      studentNumber: true,
    },
  })

  const mappedRows = rows.map((row) => mapImportRowToStudentPayload(row))
  const validation = validateImportRowsForIdentity(mappedRows, {
    existingRows,
    studentNumberStart: STUDENT_NUMBER_START,
  })
  const preparedRows = validation.rows
  const autoFilledEaglesIds = validation.autoFilledEaglesIds
  const autoFilledStudentNumbers = validation.autoFilledStudentNumbers
  const strictIdentity = validation.requireExplicitIdentity
  const preflightErrors = Array.isArray(validation.errors) ? validation.errors : []
  const preflightErrorByRow = new Map()
  preflightErrors.forEach((entry) => {
    const rowNumber = Number.parseInt(String(entry?.rowNumber), 10)
    if (!Number.isInteger(rowNumber) || rowNumber < 1) return
    if (!preflightErrorByRow.has(rowNumber)) preflightErrorByRow.set(rowNumber, entry)
  })

  let created = 0
  let updated = 0
  const errors = []
  const rowResults = []
  const rowLogs = []

  for (let i = 0; i < preparedRows.length; i += 1) {
    const rowNumber = i + 1
    const preparedRow = preparedRows[i] || {}
    const rowFields = summarizeImportRowFields(preparedRow)
    const preflightError = preflightErrorByRow.get(rowNumber)

    if (preflightError) {
      const message = normalizeText(preflightError.message) || "Row failed preflight validation"
      const entry = {
        rowNumber,
        phase: "preflight",
        message,
        fields: rowFields,
      }
      errors.push(entry)
      rowResults.push({
        rowNumber,
        status: "rejected",
        ...entry,
      })
      rowLogs.push({
        rowNumber,
        status: "rejected",
        phase: "preflight",
        fields: rowFields,
        message,
      })
      continue
    }

    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const existing = await tx.student.findFirst({
          where: {
            eaglesId: {
              equals: normalizeText(preparedRow.eaglesId),
              mode: "insensitive",
            },
          },
          include: {
            profile: true,
          },
        })

        const payload = existing ? mergeImportPayloadForBackfill(preparedRow, existing) : preparedRow
        const beforeState = existing
          ? {
              email: existing.email,
              studentNumber: existing.studentNumber,
              profile: existing.profile || {},
            }
          : null
        const saved = await saveStudentWithClient(tx, payload, normalizeText(existing?.id))

        return {
          saved,
          payload,
          changedFields: existing ? collectImportChangedFieldNames(beforeState, payload) : [],
        }
      })

      if (outcome.saved.action === "created") created += 1
      if (outcome.saved.action === "updated") updated += 1

      const successEntry = {
        rowNumber,
        status: outcome.saved.action,
        studentRefId: outcome.saved.studentRefId,
        fields: summarizeImportRowFields(outcome.payload),
      }
      if (outcome.saved.action === "updated") {
        successEntry.changedCount = outcome.changedFields.length
        successEntry.changedFields = outcome.changedFields
      }
      rowResults.push(successEntry)
      rowLogs.push(successEntry)
    } catch (error) {
      const message = normalizeText(error?.message || error) || "Import failed"
      const entry = {
        rowNumber,
        phase: "write",
        message,
        fields: rowFields,
      }
      errors.push(entry)
      rowResults.push({
        rowNumber,
        status: "rejected",
        ...entry,
      })
      rowLogs.push({
        rowNumber,
        status: "rejected",
        phase: "write",
        fields: rowFields,
        message,
      })
    }
  }

  if (created > 0 || updated > 0) {
    await invalidateLevelAndSchoolFiltersCache()
  }

  return {
    processed: preparedRows.length,
    created,
    updated,
    failed: errors.length,
    autoFilledEaglesIds,
    autoFilledStudentNumbers,
    strictIdentity,
    committed: errors.length === 0,
    partiallyCommitted: errors.length > 0 && (created > 0 || updated > 0),
    errors,
    rowResults,
    logFields: ["eaglesId", "studentNumber", "fullName", "englishName", "email"],
    logs: rowLogs,
  }
}

export async function listLevelAndSchoolFilters() {
  const cached = await readCachedLevelAndSchoolFilters()
  if (cached) return cached

  const prisma = await getPrismaClient()

  const [levels, schools] = await Promise.all([
    prisma.studentProfile.findMany({
      where: { currentGrade: { not: null } },
      select: { currentGrade: true },
      distinct: ["currentGrade"],
      orderBy: { currentGrade: "asc" },
    }),
    prisma.studentProfile.findMany({
      where: { schoolName: { not: null } },
      select: { schoolName: true },
      distinct: ["schoolName"],
      orderBy: { schoolName: "asc" },
    }),
  ])

  const payload = {
    levels: levels
      .map((entry) => canonicalizeLevel(entry.currentGrade))
      .filter(Boolean),
    schools: schools
      .map((entry) => normalizeText(entry.schoolName))
      .filter(Boolean),
  }

  payload.levels = Array.from(new Set(payload.levels)).sort((a, b) => a.localeCompare(b))

  await writeCachedLevelAndSchoolFilters(payload)
  return payload
}

export async function listExerciseTitles({ query = "", take = 200 } = {}) {
  const prisma = await getPrismaClient()
  const search = normalizeText(query)
  const limit = Math.max(1, Math.min(Number.parseInt(String(take), 10) || 200, 1000))
  const where = search
    ? {
        title: {
          contains: search,
          mode: "insensitive",
        },
      }
    : {}

  const rows = await prisma.exercise.findMany({
    where,
    select: { title: true },
    orderBy: [{ updatedAt: "desc" }, { title: "asc" }],
    take: limit,
  })

  const titles = Array.from(
    new Set(
      rows
        .map((entry) => normalizeText(entry.title))
        .filter(Boolean)
    )
  )

  return {
    total: titles.length,
    items: titles,
  }
}

export function summarizeTodayAttendanceForDashboard({
  rows = [],
  profileByStudentRefId = new Map(),
  totalEnrollment = 0,
  asOfDate = new Date(),
} = {}) {
  const attendanceRows = Array.isArray(rows) ? rows : []
  const profileLookup = profileByStudentRefId instanceof Map ? profileByStudentRefId : new Map()
  const enrollmentTotal = Math.max(0, Number.parseInt(String(totalEnrollment), 10) || 0)
  const statusByStudentRefId = new Map()
  const attendanceByLevelStudents = new Map()

  attendanceRows.forEach((row) => {
    const studentRefId = normalizeText(row?.studentRefId)
    if (!studentRefId) return

    const profile = profileLookup.get(studentRefId)
    const canonicalLevel = canonicalizeLevel(profile?.currentGrade || row?.level || "")
    if (!canonicalLevel) return

    const status = normalizeLower(row?.status)
    const current = statusByStudentRefId.get(studentRefId) || {
      level: canonicalLevel,
      attended: false,
      absent: false,
      late10Plus: false,
      late30Plus: false,
    }
    current.level = canonicalLevel

    if (status === "absent") {
      if (!current.attended) current.absent = true
      statusByStudentRefId.set(studentRefId, current)
      return
    }

    current.attended = true
    current.absent = false
    if (status === "late") {
      const tardyMinutes = parseTardyMinutes(row?.comments)
      if (tardyMinutes >= 10) current.late10Plus = true
      if (tardyMinutes >= 30) current.late30Plus = true
    }
    statusByStudentRefId.set(studentRefId, current)

    if (!attendanceByLevelStudents.has(canonicalLevel)) {
      attendanceByLevelStudents.set(canonicalLevel, new Set())
    }
    attendanceByLevelStudents.get(canonicalLevel).add(studentRefId)
  })

  let todayAttendanceCount = 0
  let todayAbsences = 0
  let tardy10PlusCount = 0
  let tardy30PlusCount = 0
  const attendanceByLevel = new Map()

  attendanceByLevelStudents.forEach((studentIds, level) => {
    attendanceByLevel.set(level, studentIds.size)
  })

  statusByStudentRefId.forEach((entry) => {
    if (entry.attended) {
      todayAttendanceCount += 1
      if (entry.late10Plus) tardy10PlusCount += 1
      if (entry.late30Plus) tardy30PlusCount += 1
      return
    }
    if (entry.absent) todayAbsences += 1
  })

  const asOf = normalizeDateValue(asOfDate)
  const asOfShifted = shiftToFixedTimeZone(asOf)
  const localWeekday = asOfShifted.getUTCDay()
  const isWeekendLocal = localWeekday === 0 || localWeekday === 6

  if (isWeekendLocal && enrollmentTotal > 0) {
    const unresolvedAbsences = Math.max(
      0,
      enrollmentTotal - (todayAttendanceCount + todayAbsences)
    )
    todayAbsences += unresolvedAbsences
  }

  return {
    todayAttendanceCount,
    todayAbsences,
    tardy10PlusCount,
    tardy30PlusCount,
    totalTodayTracked: todayAttendanceCount + todayAbsences,
    attendanceByLevel,
  }
}

export async function getAdminDashboardSummary() {
  const prisma = await getPrismaClient()
  const now = new Date()
  const todayStart = startOfDay(now)
  const todayEnd = endOfDay(now)
  const weekStart = startOfWeek(now)
  const weekEnd = endOfWeek(now)
  const yearStart = startOfYear(now)
  const weekDayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  const msPerDay = 24 * 60 * 60 * 1000

  const [
    enrolledProfiles,
    todayAttendance,
    weekAttendance,
    allGradeRecords,
    parentReportTotal,
  ] = await Promise.all([
    prisma.studentProfile.findMany({
      select: {
        studentRefId: true,
        fullName: true,
        currentGrade: true,
        studentEmail: true,
        motherEmail: true,
        fatherEmail: true,
        student: {
          select: {
            eaglesId: true,
            studentNumber: true,
            email: true,
          },
        },
      },
    }),
    prisma.studentAttendance.findMany({
      where: {
        attendanceDate: {
          gte: todayStart,
          lte: todayEnd,
        },
      },
      select: {
        studentRefId: true,
        status: true,
        comments: true,
        level: true,
      },
    }),
    prisma.studentAttendance.findMany({
      where: {
        attendanceDate: {
          gte: weekStart,
          lte: weekEnd,
        },
      },
      select: {
        studentRefId: true,
        status: true,
        comments: true,
      },
    }),
    prisma.studentGradeRecord.findMany({
      select: {
        studentRefId: true,
        className: true,
        level: true,
        dueAt: true,
        submittedAt: true,
        homeworkCompleted: true,
        homeworkOnTime: true,
        assignmentName: true,
        score: true,
        maxScore: true,
        comments: true,
      },
    }),
    prisma.parentClassReport.count(),
  ])

  const profileByStudentRefId = new Map()
  const enrolledByLevel = new Map()
  let totalEnrollment = 0
  enrolledProfiles.forEach((profile) => {
    const canonicalLevel = canonicalizeLevel(profile.currentGrade || "")
    if (canonicalLevel) totalEnrollment += 1
    const level = canonicalLevel || "Unassigned"
    const current = enrolledByLevel.get(level) || 0
    enrolledByLevel.set(level, current + 1)
    profileByStudentRefId.set(profile.studentRefId, profile)
  })
  const unenrolledYtd = Math.max(0, enrolledProfiles.length - totalEnrollment)

  const todayAttendanceSummary = summarizeTodayAttendanceForDashboard({
    rows: todayAttendance,
    profileByStudentRefId,
    totalEnrollment,
    asOfDate: now,
  })
  const {
    todayAttendanceCount,
    todayAbsences,
    tardy10PlusCount,
    tardy30PlusCount,
    totalTodayTracked,
    attendanceByLevel,
  } = todayAttendanceSummary

  const assignmentTrackingGradeRecords = allGradeRecords.filter((row) => isAssignmentTrackingGradeRecord(row))

  const onTimeCompletions = assignmentTrackingGradeRecords.filter((row) => isOnTimeCompletedGradeRecord(row)).length
  const lateCompletions = assignmentTrackingGradeRecords.filter((row) => isLateCompletedGradeRecord(row)).length
  const outstanding = assignmentTrackingGradeRecords.filter((row) => isOutstandingGradeRecord(row, now)).length
  const outstandingYtd = assignmentTrackingGradeRecords.filter((row) => {
    if (!row.dueAt) return false
    const dueAt = new Date(row.dueAt)
    if (Number.isNaN(dueAt.valueOf())) return false
    if (dueAt < yearStart || dueAt > now) return false
    return isOutstandingGradeRecord(row, now)
  }).length

  const weeklyBuckets = Array.from({ length: 7 }, (_, index) => {
    const dayStart = addDays(weekStart, index)
    return {
      index,
      label: weekDayLabels[index],
      date: toLocalIsoDate(dayStart),
      students: new Map(),
    }
  })

  assignmentTrackingGradeRecords.forEach((row) => {
    if (!row.dueAt) return
    const dueAt = new Date(row.dueAt)
    if (Number.isNaN(dueAt.valueOf())) return
    if (dueAt < weekStart || dueAt > weekEnd) return
    const dayStart = startOfDay(dueAt)
    const dayIndex = Math.floor((dayStart.valueOf() - weekStart.valueOf()) / msPerDay)
    if (dayIndex < 0 || dayIndex >= weeklyBuckets.length) return

    const bucket = weeklyBuckets[dayIndex]
    const studentRefId = normalizeText(row.studentRefId)
    if (!studentRefId) return
    const current = bucket.students.get(studentRefId) || {
      totalAssignments: 0,
      completedAssignments: 0,
    }
    current.totalAssignments += 1
    if (isCompletedGradeRecord(row)) current.completedAssignments += 1
    bucket.students.set(studentRefId, current)
  })

  const weeklyAssignmentCompletion = weeklyBuckets.map((bucket) => {
    const entries = Array.from(bucket.students.values())
    const studentsWithAssignments = entries.filter((entry) => entry.totalAssignments > 0).length
    const studentsCompletedAll = entries.filter(
      (entry) => entry.totalAssignments > 0 && entry.completedAssignments >= entry.totalAssignments
    ).length
    return {
      index: bucket.index,
      day: bucket.label,
      date: bucket.date,
      studentsWithAssignments,
      studentsCompletedAll,
    }
  })

  const outstandingThisWeekByStudent = new Map()
  assignmentTrackingGradeRecords.forEach((row) => {
    if (!row.dueAt) return
    const dueAt = new Date(row.dueAt)
    if (Number.isNaN(dueAt.valueOf())) return
    if (dueAt < weekStart || dueAt > weekEnd) return
    if (!isOutstandingGradeRecord(row, now)) return
    const current = outstandingThisWeekByStudent.get(row.studentRefId) || 0
    outstandingThisWeekByStudent.set(row.studentRefId, current + 1)
  })

  const riskByStudent = new Map()
  weekAttendance.forEach((row) => {
    const key = row.studentRefId
    if (!key) return
    const current = riskByStudent.get(key) || {
      studentRefId: key,
      eaglesId: "",
      studentNumber: null,
      fullName: "",
      level: "",
      absences: 0,
      late30Plus: 0,
      outstandingWeek: 0,
    }
    const status = normalizeLower(row.status)
    if (status === "absent") current.absences += 1
    if (status === "late") {
      const minutes = parseTardyMinutes(row.comments)
      if (minutes >= 30) current.late30Plus += 1
    }
    riskByStudent.set(key, current)
  })

  outstandingThisWeekByStudent.forEach((count, key) => {
    const current = riskByStudent.get(key) || {
      studentRefId: key,
      eaglesId: "",
      studentNumber: null,
      fullName: "",
      level: "",
      absences: 0,
      late30Plus: 0,
      outstandingWeek: 0,
    }
    current.outstandingWeek = count
    riskByStudent.set(key, current)
  })

  riskByStudent.forEach((entry, key) => {
    const profile = profileByStudentRefId.get(key)
    const identity = assertStudentIdentityIntegrity(profile?.student, `dashboard risk studentRefId=${key}`)
    entry.eaglesId = identity.eaglesId
    entry.studentNumber = identity.studentNumber
    entry.fullName = normalizeText(profile?.fullName)
    entry.level = canonicalizeLevel(profile?.currentGrade || "") || "Unassigned"
  })

  const riskSignals = Array.from(riskByStudent.values())
  const atRiskStudents = selectAtRiskStudentsFromSignals(riskSignals).slice(0, 30)
  const attendanceRiskStudents = selectAttendanceRiskStudentsFromSignals(riskSignals).slice(0, 30)

  const levels = Array.from(new Set([...enrolledByLevel.keys(), ...attendanceByLevel.keys()])).sort(
    compareKnownLevelOrder
  )

  const levelEnrollmentMap = new Map()
  const toEmailList = (profile) =>
    Array.from(
      new Set(
        [
          normalizeLower(profile?.student?.email),
          normalizeLower(profile?.studentEmail),
          normalizeLower(profile?.motherEmail),
          normalizeLower(profile?.fatherEmail),
        ].filter(Boolean)
      )
    )

  enrolledProfiles.forEach((profile) => {
    const level = canonicalizeLevel(profile.currentGrade || "") || "Unassigned"
    if (!levelEnrollmentMap.has(level)) {
      levelEnrollmentMap.set(level, {
        level,
        students: [],
      })
    }
    const bucket = levelEnrollmentMap.get(level)
    const identity = assertStudentIdentityIntegrity(
      profile?.student,
      `dashboard levelCompletion enrolled studentRefId=${normalizeText(profile?.studentRefId)}`
    )
    bucket.students.push({
      studentRefId: profile.studentRefId,
      eaglesId: identity.eaglesId,
      studentNumber: identity.studentNumber,
      fullName: normalizeText(profile.fullName),
      emails: toEmailList(profile),
    })
  })

  const assignmentSignalRows = assignmentTrackingGradeRecords.map((record) => {
    const profile = profileByStudentRefId.get(record.studentRefId)
    return {
      studentRefId: normalizeText(record.studentRefId),
      level: canonicalizeLevel(profile?.currentGrade || record.level || "") || "Unassigned",
      className: normalizeText(record.className),
      assignmentName: normalizeText(record.assignmentName),
      dueAt: record.dueAt,
      submittedAt: record.submittedAt,
      homeworkCompleted: record.homeworkCompleted,
      homeworkOnTime: record.homeworkOnTime,
      score: record.score,
      maxScore: record.maxScore,
      comments: normalizeText(record.comments),
    }
  })

  const currentAssignmentSignals = selectCurrentNotYetDueAssignmentsByLevel(assignmentSignalRows, now)
  const currentAssignmentByLevel = new Map(
    currentAssignmentSignals.map((entry) => [canonicalizeLevel(entry?.level || "") || "Unassigned", entry])
  )

  const levelCompletion = Array.from(levelEnrollmentMap.values())
    .map((bucket) => {
      const currentAssignment = currentAssignmentByLevel.get(bucket.level)
      if (!currentAssignment) return null

      const assignmentName = normalizeText(currentAssignment.assignmentName)
      const dueAt = normalizeText(currentAssignment.dueAt)
      const completionByStudentRefId = new Map(
        (Array.isArray(currentAssignment.students) ? currentAssignment.students : []).map((entry) => [
          normalizeText(entry?.studentRefId),
          Boolean(entry?.completed),
        ])
      )

      let completedStudents = 0
      const uncompletedStudents = []
      bucket.students.forEach((student) => {
        if (completionByStudentRefId.get(student.studentRefId) === true) {
          completedStudents += 1
          return
        }
        uncompletedStudents.push({
          studentRefId: student.studentRefId,
          eaglesId: student.eaglesId,
          studentNumber: student.studentNumber,
          fullName: student.fullName,
          emails: student.emails,
          outstandingCount: 1,
          assignmentNames: assignmentName ? [assignmentName] : [],
          nextDueAt: dueAt,
        })
      })

      uncompletedStudents.sort((left, right) =>
        normalizeText(left?.fullName).localeCompare(normalizeText(right?.fullName))
      )

      const enrolledStudents = bucket.students.length
      const pendingStudents = Math.max(0, enrolledStudents - completedStudents)
      const completionPercent = percentage(completedStudents, enrolledStudents) || 0
      const daysUntilDue = daysUntilDateFloor(dueAt, now)

      return {
        level: bucket.level,
        enrolledStudents,
        totalAssignments: enrolledStudents,
        completedAssignments: completedStudents,
        outstandingAssignments: pendingStudents,
        completedStudents,
        completionPercent,
        assignmentName,
        dueAt,
        daysUntilDue,
        uncompletedStudents,
      }
    })
    .filter(Boolean)
    .sort((left, right) => compareKnownLevelOrder(left.level, right.level))

  const currentTargetedStudents = levelCompletion.reduce(
    (sum, row) => sum + (Number.parseInt(String(row?.totalAssignments || 0), 10) || 0),
    0
  )
  const currentCompletedStudents = levelCompletion.reduce(
    (sum, row) => sum + (Number.parseInt(String(row?.completedAssignments || 0), 10) || 0),
    0
  )
  const currentPendingStudents = levelCompletion.reduce(
    (sum, row) => sum + (Number.parseInt(String(row?.outstandingAssignments || 0), 10) || 0),
    0
  )
  const currentDueSoonLevels = levelCompletion.reduce((sum, row) => {
    const daysUntilDue = Number.parseInt(String(row?.daysUntilDue), 10)
    if (!Number.isFinite(daysUntilDue)) return sum
    if (daysUntilDue < 0 || daysUntilDue > 2) return sum
    return sum + 1
  }, 0)
  const currentDueSoonPendingStudents = levelCompletion.reduce((sum, row) => {
    const daysUntilDue = Number.parseInt(String(row?.daysUntilDue), 10)
    if (!Number.isFinite(daysUntilDue)) return sum
    if (daysUntilDue < 0 || daysUntilDue > 2) return sum
    return sum + (Number.parseInt(String(row?.outstandingAssignments || 0), 10) || 0)
  }, 0)

  return {
    generatedAt: now.toISOString(),
    today: {
      date: toLocalIsoDate(todayStart),
      totalStudents: enrolledProfiles.length,
      totalEnrollment,
      attendancePercentOfEnrollment: percentage(todayAttendanceCount, totalEnrollment) || 0,
      unenrolledYtd,
      attendance: todayAttendanceCount,
      absences: todayAbsences,
      tardy10PlusPercent: percentage(tardy10PlusCount, totalTodayTracked) || 0,
      tardy30PlusPercent: percentage(tardy30PlusCount, totalTodayTracked) || 0,
    },
    weeklyAssignmentCompletion,
    classEnrollmentAttendance: levels.map((level) => ({
      level,
      enrolled: enrolledByLevel.get(level) || 0,
      attendanceToday: attendanceByLevel.get(level) || 0,
    })),
    assignments: {
      total: assignmentTrackingGradeRecords.length,
      completedOnTime: onTimeCompletions,
      completedLate: lateCompletions,
      outstanding,
      outstandingYtd,
      currentActiveLevels: levelCompletion.length,
      currentTargetedStudents,
      currentCompletedStudents,
      currentPendingStudents,
      currentCompletionPercent: percentage(currentCompletedStudents, currentTargetedStudents) || 0,
      currentDueSoonLevels,
      currentDueSoonPendingStudents,
    },
    atRiskWeek: {
      total: atRiskStudents.length,
      students: atRiskStudents,
    },
    attendanceRiskWeek: {
      total: attendanceRiskStudents.length,
      students: attendanceRiskStudents,
    },
    levelCompletion,
    parentReports: {
      total: parentReportTotal,
    },
  }
}

export function getStudentAdminFilterCacheStatus() {
  return {
    backend: FILTER_CACHE_STATE.backend,
    configuredRedisUrl: FILTER_CACHE_STATE.configuredRedisUrl,
    key: FILTER_CACHE_KEY,
    ttlSeconds: FILTER_CACHE_TTL_SECONDS,
    hits: FILTER_CACHE_STATE.hits,
    misses: FILTER_CACHE_STATE.misses,
    writes: FILTER_CACHE_STATE.writes,
    invalidations: FILTER_CACHE_STATE.invalidations,
    lastHitAt: FILTER_CACHE_STATE.lastHitAt,
    lastMissAt: FILTER_CACHE_STATE.lastMissAt,
    lastWriteAt: FILTER_CACHE_STATE.lastWriteAt,
    lastInvalidateAt: FILTER_CACHE_STATE.lastInvalidateAt,
    lastError: FILTER_CACHE_STATE.lastError,
  }
}

export async function findFamilyByEmergencyPhone(phoneNumber) {
  const prisma = await getPrismaClient()
  const digits = normalizePhoneDigits(phoneNumber)
  assertWithStatus(Boolean(digits), 400, "Emergency phone is required")

  const rows = await prisma.$queryRaw`
    SELECT
      s."id" AS "studentRefId",
      s."eaglesId" AS "eaglesId",
      sp."fullName" AS "fullName",
      sp."motherName" AS "motherName",
      sp."fatherName" AS "fatherName",
      sp."motherEmergencyContact" AS "motherEmergencyContact",
      sp."fatherEmergencyContact" AS "fatherEmergencyContact",
      sp."motherPhone" AS "motherPhone",
      sp."fatherPhone" AS "fatherPhone",
      sp."currentGrade" AS "currentGrade",
      sp."schoolName" AS "schoolName"
    FROM "StudentProfile" sp
    INNER JOIN "Student" s ON s."id" = sp."studentRefId"
    WHERE
      regexp_replace(COALESCE(sp."motherEmergencyContact", ''), '[^0-9]', '', 'g') = ${digits}
      OR regexp_replace(COALESCE(sp."fatherEmergencyContact", ''), '[^0-9]', '', 'g') = ${digits}
      OR regexp_replace(COALESCE(sp."motherPhone", ''), '[^0-9]', '', 'g') = ${digits}
      OR regexp_replace(COALESCE(sp."fatherPhone", ''), '[^0-9]', '', 'g') = ${digits}
    ORDER BY sp."fullName" ASC
    LIMIT 500
  `

  return {
    phoneDigits: digits,
    total: Array.isArray(rows) ? rows.length : 0,
    items: Array.isArray(rows) ? rows : [],
  }
}

export async function saveAttendanceRecord(studentRefId, payload = {}) {
  const prisma = await getPrismaClient()
  const studentRef = normalizeText(studentRefId)
  assertWithStatus(Boolean(studentRef), 400, "studentRefId is required")

  const className = normalizeText(payload.className)
  const schoolYear = normalizeText(payload.schoolYear)
  const quarter = normalizeQuarter(payload.quarter)
  const attendanceDate = normalizeDate(payload.attendanceDate)

  assertWithStatus(Boolean(className), 400, "className is required")
  assertWithStatus(Boolean(schoolYear), 400, "schoolYear is required")
  assertWithStatus(Boolean(quarter), 400, "quarter is required")
  assertWithStatus(Boolean(attendanceDate), 400, "attendanceDate is required")

  const data = {
    className,
    level: normalizeNullableText(payload.level),
    schoolYear,
    quarter,
    attendanceDate,
    status: normalizeAttendanceStatus(payload.status),
    comments: normalizeNullableText(payload.comments),
  }

  const recordId = normalizeText(payload.id)

  if (recordId) {
    const existing = await prisma.studentAttendance.findUnique({ where: { id: recordId } })
    assertWithStatus(Boolean(existing), 404, "Attendance record not found")
    assertWithStatus(existing.studentRefId === studentRef, 403, "Attendance record does not belong to student")

    return prisma.studentAttendance.update({
      where: { id: recordId },
      data,
    })
  }

  return prisma.studentAttendance.create({
    data: {
      studentRefId: studentRef,
      ...data,
    },
  })
}

export async function deleteAttendanceRecord(studentRefId, attendanceId) {
  const prisma = await getPrismaClient()
  const studentRef = normalizeText(studentRefId)
  const id = normalizeText(attendanceId)
  assertWithStatus(Boolean(studentRef), 400, "studentRefId is required")
  assertWithStatus(Boolean(id), 400, "Attendance id is required")

  const existing = await prisma.studentAttendance.findUnique({ where: { id } })
  assertWithStatus(Boolean(existing), 404, "Attendance record not found")
  assertWithStatus(existing.studentRefId === studentRef, 403, "Attendance record does not belong to student")

  await prisma.studentAttendance.delete({ where: { id } })
  return { deleted: true, id }
}

export async function saveGradeRecord(studentRefId, payload = {}) {
  const prisma = await getPrismaClient()
  const studentRef = normalizeText(studentRefId)
  assertWithStatus(Boolean(studentRef), 400, "studentRefId is required")

  const className = normalizeText(payload.className)
  const schoolYear = normalizeText(payload.schoolYear)
  const quarter = normalizeQuarter(payload.quarter)
  const assignmentName = normalizeText(payload.assignmentName)

  assertWithStatus(Boolean(className), 400, "className is required")
  assertWithStatus(Boolean(schoolYear), 400, "schoolYear is required")
  assertWithStatus(Boolean(quarter), 400, "quarter is required")
  assertWithStatus(Boolean(assignmentName), 400, "assignmentName is required")

  const data = {
    className,
    level: normalizeNullableText(payload.level),
    schoolYear,
    quarter,
    assignmentName,
    dueAt: normalizeDate(payload.dueAt),
    submittedAt: normalizeDate(payload.submittedAt),
    score: normalizeFloat(payload.score),
    maxScore: normalizeFloat(payload.maxScore),
    homeworkCompleted: normalizeBoolean(payload.homeworkCompleted),
    homeworkOnTime: normalizeBoolean(payload.homeworkOnTime),
    behaviorScore: normalizeInteger(payload.behaviorScore),
    participationScore: normalizeInteger(payload.participationScore),
    inClassScore: normalizeInteger(payload.inClassScore),
    comments: normalizeNullableText(payload.comments),
  }

  const recordId = normalizeText(payload.id)

  if (recordId) {
    const existing = await prisma.studentGradeRecord.findUnique({ where: { id: recordId } })
    assertWithStatus(Boolean(existing), 404, "Grade record not found")
    assertWithStatus(existing.studentRefId === studentRef, 403, "Grade record does not belong to student")

    const updated = await prisma.studentGradeRecord.update({
      where: { id: recordId },
      data,
    })
    return mapGradeRecordForApi(updated)
  }

  const created = await prisma.studentGradeRecord.create({
    data: {
      studentRefId: studentRef,
      ...data,
    },
  })
  return mapGradeRecordForApi(created)
}

export async function deleteGradeRecord(studentRefId, gradeRecordId) {
  const prisma = await getPrismaClient()
  const studentRef = normalizeText(studentRefId)
  const id = normalizeText(gradeRecordId)
  assertWithStatus(Boolean(studentRef), 400, "studentRefId is required")
  assertWithStatus(Boolean(id), 400, "Grade id is required")

  const existing = await prisma.studentGradeRecord.findUnique({ where: { id } })
  assertWithStatus(Boolean(existing), 404, "Grade record not found")
  assertWithStatus(existing.studentRefId === studentRef, 403, "Grade record does not belong to student")

  await prisma.studentGradeRecord.delete({ where: { id } })
  return { deleted: true, id }
}

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

  let upsertedReport
  try {
    upsertedReport = await prisma.parentClassReport.upsert({
      where: {
        studentRefId_className_schoolYear_quarter: {
          studentRefId: studentRef,
          className,
          schoolYear,
          quarter,
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
        studentRefId_className_schoolYear_quarter: {
          studentRefId: studentRef,
          className,
          schoolYear,
          quarter,
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

const STUDENT_POINTS_EVENT_TYPE_SCHEDULED_ON_TIME = "scheduled-assignment-on-time"
const STUDENT_POINTS_EVENT_TYPE_ELECTIVE = "elective-assignment-submission"
const STUDENT_POINTS_EVENT_TYPE_REPORT_PARTICIPATION = "report-participation-approved"
const STUDENT_POINTS_EVENT_TYPE_ADMIN_ADJUSTMENT = "admin-adjustment"
const STUDENT_POINTS_SORT_FIELDS = new Set([
  "studentNumber",
  "eaglesId",
  "fullName",
  "level",
  "totalPoints",
  "lastActivityAt",
  "scheduledOnTimeCount",
  "electiveCount",
  "approvedReportCount",
  "adjustmentTotal",
])
const STUDENT_NEWS_DEFAULT_DAYS = 30
const STUDENT_NEWS_MAX_DAYS = 60
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
const STUDENT_NEWS_REVIEW_STATUS_COLOR = {
  [STUDENT_NEWS_REVIEW_STATUS_APPROVED]: "green",
  [STUDENT_NEWS_REVIEW_STATUS_SUBMITTED]: "amber",
  [STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED]: "red",
}
const STUDENT_NEWS_COMPLIANCE_NOTE_START = "[[SIS-COMPLIANCE-V1]]"
const STUDENT_NEWS_COMPLIANCE_NOTE_END = "[[/SIS-COMPLIANCE-V1]]"
const STUDENT_NEWS_FIXED_NOTE_PREFIX = "FIXED PER COMPLIANCE RESOLUTION ON SAVE"
const STUDENT_NEWS_AWAITING_RE_REVIEW_MARKER = "[[SIS-AWAITING-RE-REVIEW]]"
const STUDENT_NEWS_DEFAULT_ALLOWED_SOURCE_DOMAINS = Object.freeze(["cnn.com", "bbc.com"])
const STUDENT_NEWS_MAX_CUSTOM_ALLOWED_SOURCES = 8
const STUDENT_NEWS_SOURCE_DOMAIN_MAX_LENGTH = 140
const STUDENT_NEWS_HTTP_HEADERS = Object.freeze({
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
})
const STUDENT_NEWS_FIELD_LABELS = Object.freeze({
  sourceLink: "Source Full Web Address (url)",
  articleTitle: "Article Title",
  byline: "Byline (Author)",
  articleDateline: "Dateline",
  leadSynopsis: "Lead Synopsis",
})
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
const STUDENT_NEWS_DEFAULT_THRESHOLDS = Object.freeze({
  articleTitle: 0.7,
  byline: 0.7,
  articleDateline: 0.7,
  leadSynopsis: 0.5,
})

function normalizeDomainToken(value) {
  const raw = normalizeLower(value)
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/[#?].*$/, "")
    .replace(/^www\./, "")
    .trim()
  if (!raw) return ""
  if (raw.length > STUDENT_NEWS_SOURCE_DOMAIN_MAX_LENGTH) return ""
  if (!/^[a-z0-9.-]+$/.test(raw)) return ""
  if (!raw.includes(".")) return ""
  return raw
}

function hostnameFromUrl(value) {
  const text = normalizeText(value)
  if (!text) return ""
  try {
    const parsed = new URL(text)
    const protocol = normalizeLower(parsed.protocol)
    if (protocol !== "http:" && protocol !== "https:") return ""
    return normalizeDomainToken(parsed.hostname)
  } catch (error) {
    void error
    return ""
  }
}

function sourceDomainMatches(hostname, allowedDomain) {
  const host = normalizeDomainToken(hostname)
  const domain = normalizeDomainToken(allowedDomain)
  if (!host || !domain) return false
  return host === domain || host.endsWith(`.${domain}`)
}

function normalizeStudentNewsValidationConfig(config = {}) {
  const source = config && typeof config === "object" ? config : {}
  const incomingDomains = Array.isArray(source.allowedDomains)
    ? source.allowedDomains
    : []
  const normalizedDomains = incomingDomains
    .map((entry) => normalizeDomainToken(entry))
    .filter(Boolean)
  const allowedDomains = normalizedDomains.length
    ? Array.from(new Set(normalizedDomains))
    : [...STUDENT_NEWS_DEFAULT_ALLOWED_SOURCE_DOMAINS]

  const thresholds = {
    articleTitle: Number(source?.thresholds?.articleTitle),
    byline: Number(source?.thresholds?.byline),
    articleDateline: Number(source?.thresholds?.articleDateline),
    leadSynopsis: Number(source?.thresholds?.leadSynopsis),
  }
  return {
    allowedDomains,
    thresholds: {
      articleTitle: Number.isFinite(thresholds.articleTitle)
        ? Math.max(0.1, Math.min(1, thresholds.articleTitle))
        : STUDENT_NEWS_DEFAULT_THRESHOLDS.articleTitle,
      byline: Number.isFinite(thresholds.byline)
        ? Math.max(0.1, Math.min(1, thresholds.byline))
        : STUDENT_NEWS_DEFAULT_THRESHOLDS.byline,
      articleDateline: Number.isFinite(thresholds.articleDateline)
        ? Math.max(0.1, Math.min(1, thresholds.articleDateline))
        : STUDENT_NEWS_DEFAULT_THRESHOLDS.articleDateline,
      leadSynopsis: Number.isFinite(thresholds.leadSynopsis)
        ? Math.max(0.1, Math.min(1, thresholds.leadSynopsis))
        : STUDENT_NEWS_DEFAULT_THRESHOLDS.leadSynopsis,
    },
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

function decodeHtmlEntities(text = "") {
  return normalizeText(text)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
}

function stripTags(text = "") {
  return decodeHtmlEntities(
    normalizeText(text)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
  )
}

function extractMetaContent(html = "", selectorPattern = "") {
  const pattern = normalizeText(selectorPattern)
  if (!pattern) return ""
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const regexes = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, "i"),
  ]
  for (const regex of regexes) {
    const match = normalizeText(html).match(regex)
    if (match && match[1]) return stripTags(match[1])
  }
  return ""
}

function extractTitleFromHtml(html = "") {
  const h1TitleMatch = normalizeText(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
  const h1Title = h1TitleMatch && h1TitleMatch[1] ? stripTags(h1TitleMatch[1]) : ""
  const metaTitle = extractMetaContent(html, "og:title")
    || extractMetaContent(html, "twitter:title")
  const titleMatch = normalizeText(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const documentTitle = titleMatch && titleMatch[1] ? stripTags(titleMatch[1]) : ""
  const mergedMeta = chooseMoreSpecificTitle(metaTitle, documentTitle)
  return chooseMoreSpecificTitle(h1Title, mergedMeta)
}

function extractFirstParagraphFromHtml(html = "") {
  const body = normalizeText(html)
  const paragraphRegex = /<p\b[^>]*>([\s\S]*?)<\/p>/gi
  let match
  while ((match = paragraphRegex.exec(body))) {
    const text = stripTags(match[1])
    if (text.length >= 40) return text
  }
  return ""
}

function extractBylineFromHtml(html = "", plainText = "") {
  const metaByline = extractMetaContent(html, "author")
    || extractMetaContent(html, "article:author")
    || extractMetaContent(html, "parsely-author")
  if (metaByline) {
    const parsedMetaByline = parseJinaBylineCandidate(metaByline)
    if (parsedMetaByline) return parsedMetaByline
  }
  const htmlCandidateRegex =
    /<(?:span|div|p)[^>]*(?:data-testid|class|id)=["'][^"']*(?:byline|author)[^"']*["'][^>]*>([\s\S]{1,180}?)<\/(?:span|div|p)>/gi
  let htmlCandidateMatch
  while ((htmlCandidateMatch = htmlCandidateRegex.exec(normalizeText(html)))) {
    const candidate = stripTags(htmlCandidateMatch[1] || "")
    const parsedCandidate = parseJinaBylineCandidate(candidate)
    if (parsedCandidate) return parsedCandidate
  }
  const plainLines = normalizeText(plainText).split(/\r?\n/).map((line) => normalizeText(line)).filter(Boolean)
  for (const line of plainLines.slice(0, 120)) {
    const parsedCandidate = parseJinaBylineCandidate(line)
    if (parsedCandidate) return parsedCandidate
  }
  for (const line of plainLines.slice(0, 120)) {
    const prefixMatch = line.match(/^(?:by|written by)\s+/i)
    if (!prefixMatch) continue
    const candidate = normalizeText(line.slice(prefixMatch[0].length))
    const bylineMatch = candidate.match(
      /^([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){1,3})(?:\s*,\s*.+)?$/
    )
    if (bylineMatch && bylineMatch[1]) return normalizeText(bylineMatch[1])
  }
  return ""
}

function extractDatelineSnippets(html = "", plainText = "") {
  const publishedMeta = extractMetaContent(html, "article:published_time")
    || extractMetaContent(html, "og:published_time")
    || extractMetaContent(html, "publish_date")
  const updatedMeta = extractMetaContent(html, "article:modified_time")
    || extractMetaContent(html, "og:modified_time")
    || extractMetaContent(html, "lastmod")
  const relativeVisible = extractRelativeDatelineFragment(plainText)
  const publishedVisible = normalizeText(plainText).match(/(?:published|publish date)[^.\n]{0,220}/i)?.[0] || ""
  const updatedVisible = normalizeText(plainText).match(/(?:updated|last updated)[^.\n]{0,220}/i)?.[0] || ""
  const publish = publishedVisible || relativeVisible || publishedMeta
  const updated = updatedVisible || updatedMeta
  return {
    publish: normalizeText(publish),
    updated: normalizeText(updated),
    combined: [publish, updated].map((entry) => normalizeText(entry)).filter(Boolean).join(" | "),
  }
}

function isBbcLiveUrl(link = "") {
  const host = hostnameFromUrl(link)
  if (!host || !host.endsWith("bbc.com")) return false
  try {
    const { pathname } = new URL(link)
    return /\/news\/live\//i.test(pathname)
  } catch (error) {
    void error
    return false
  }
}

function isCnnUrl(link = "") {
  const host = hostnameFromUrl(link)
  return Boolean(host) && host.endsWith("cnn.com")
}

function resolveBbcAmpUrl(link = "") {
  try {
    const url = new URL(link)
    if (!url.pathname.endsWith(".amp")) {
      url.pathname = `${url.pathname.replace(/\/$/, "")}.amp`
    }
    return url.toString()
  } catch (error) {
    void error
    return ""
  }
}

function resolveCnnAmpUrl(link = "") {
  try {
    const url = new URL(link)
    url.searchParams.set("outputType", "amp")
    return url.toString()
  } catch (error) {
    void error
    return ""
  }
}

function isLikelyJinaMetadataLine(line = "") {
  const text = normalizeText(line)
  if (!text) return true
  if (/^(?:title|url source|published time|updated time|last updated|markdown content)\s*:/i.test(text)) {
    return true
  }
  if (/^\[[^\]]+\]\(https?:\/\/[^)]+\)\s*$/i.test(text)) return true
  if (/^!\[[^\]]*\]\(https?:\/\/[^)]+\)\s*$/i.test(text)) return true
  if (/^\*\s+\[[^\]]+\]\(https?:\/\/[^)]+\)\s*$/i.test(text)) return true
  if (/^add as preferred on google$/i.test(text)) return true
  if (/^(?:listen|download|podcast)$/i.test(text)) return true
  if (/^(?:share|save|share save)$/i.test(text)) return true
  if (
    /^(?:skip to content|watch live|home|news|sport|business|technology|health|culture|arts|travel|earth|audio|video|live|documentaries|weather|newsletters)$/i
      .test(text)
  ) {
    return true
  }
  return false
}

function isRelativeDatelineToken(value = "") {
  return /^\d+\s+(?:minutes?|hours?|days?|weeks?|months?|years?)\s+ago$/i.test(normalizeText(value))
}

function extractRelativeDatelineFragment(value = "") {
  const text = normalizeText(value)
  if (!text) return ""
  const match = text.match(/\b\d+\s+(?:minutes?|hours?|days?|weeks?|months?|years?)\s+ago\b/i)
  return match && match[0] ? normalizeText(match[0]) : ""
}

function parseJinaBylineCandidate(line = "") {
  const text = normalizeText(line)
  if (!text || isLikelyJinaMetadataLine(text) || isRelativeDatelineToken(text)) return ""
  if (/\b(?:getty images?|afp|reuters|associated press|ap photo)\b/i.test(text)) return ""
  const explicit = text.match(/^(?:byline|author)\s*:\s*(.+)$/i)
  const normalized = normalizeText(explicit && explicit[1] ? explicit[1] : text.replace(/^(?:by|written by)\s+/i, ""))
  if (!normalized || /^(?:share|save)$/i.test(normalized)) return ""
  const truncated = normalizeText(normalized.replace(/\s*(?:\||-)\s*(?:bbc|cnn|reuters|associated press|ap)\b.*$/i, ""))
  const compact = normalizeText(truncated.replace(/,\s*(?:bbc|cnn|reuters|associated press|ap)\b.*$/i, ""))
  const ranked = compact || normalized
  const roleByline = normalized.match(
    /^([A-Z][A-Za-z.'’-]+\s+[A-Z][A-Za-z.'’-]+)(?:\s+[A-Za-z][A-Za-z.'’-]*)*\s+(?:Correspondent|Reporter|Editor|Producer|Writer|Analyst|Presenter|Contributor|Columnist)\b/i
  )
  if (roleByline && roleByline[1]) {
    return normalizeText(roleByline[1])
  }
  const commaRoleByline = ranked.match(/^([A-Z][A-Za-z.'’-]+\s+[A-Z][A-Za-z.'’-]+),\s*.+$/)
  if (commaRoleByline && commaRoleByline[1]) {
    return normalizeText(commaRoleByline[1])
  }
  const candidate = ranked
  const match = candidate.match(/^([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){1,3})$/)
  if (!match || !match[1]) return ""
  return normalizeText(match[1])
}

function chooseBestJinaHeading(candidates = []) {
  const normalized = Array.isArray(candidates)
    ? candidates
      .map((entry) => {
        const level = Number.parseInt(String(entry?.level), 10) || 0
        const text = normalizeText(entry?.text)
        const words = text.split(/\s+/).filter(Boolean).length
        return { level, text, words }
      })
      .filter((entry) => entry.level >= 1 && Boolean(entry.text))
    : []
  if (!normalized.length) return ""
  const h1 = normalized.filter((entry) => entry.level === 1)
  const pool = h1.length ? h1 : normalized
  pool.sort((left, right) => {
    if (left.words !== right.words) return right.words - left.words
    return right.text.length - left.text.length
  })
  return pool[0]?.text || ""
}

function chooseMoreSpecificTitle(preferred = "", fallback = "") {
  const a = normalizeText(preferred)
  const b = normalizeText(fallback)
  if (!a) return b
  if (!b) return a
  const wordsA = a.split(/\s+/).filter(Boolean).length
  const wordsB = b.split(/\s+/).filter(Boolean).length
  if (wordsA !== wordsB) return wordsA > wordsB ? a : b
  return a.length >= b.length ? a : b
}

function isLikelyJinaParagraph(line = "") {
  const text = normalizeText(line)
  if (!text || text.length < 40) return false
  if (isLikelyJinaMetadataLine(text)) return false
  if (/^(?:\d+\.\s*)?#{1,6}\s+/.test(text)) return false
  if (/^(?:title|url source|published time|updated time|last updated|markdown content)\s*:/i.test(text)) return false
  if (/^(?:published|updated|last updated|publish date)\b/i.test(text)) return false
  if (isRelativeDatelineToken(text)) return false
  if (/^(?:by|author)\s+/i.test(text)) return false
  if (/^\[.*\]\(https?:\/\/[^)]+\)\s*$/i.test(text)) return false
  if (/!\[[^\]]*\]\(https?:\/\/[^)]+\)/i.test(text)) return false
  const words = text.split(/\s+/).filter(Boolean)
  return words.length >= 8
}

function parseGenericJinaMarkdown(markdownText = "") {
  const allLines = normalizeText(markdownText)
    .split(/\r?\n/)
    .map((raw) => normalizeText(stripTags(raw)))
    .filter((line) => line.length > 0)
  if (!allLines.length) {
    return { title: "", dateline: "", byline: "", firstParagraph: "" }
  }
  const contentStart = allLines.findIndex((line) => /^markdown content\s*:/i.test(line))
  const contentLines = contentStart >= 0 ? allLines.slice(contentStart + 1) : allLines
  const lines = contentLines.length ? contentLines : allLines
  const headingCandidates = []
  const paragraphCandidates = []
  let titleMeta = ""
  let publishedMeta = ""
  let updatedMeta = ""
  let visiblePublish = ""
  let visibleUpdated = ""
  let relativePublish = ""
  let byline = ""
  for (const line of allLines) {
    if (!line) continue
    if (!titleMeta) {
      const titleMetaMatch = line.match(/^title:\s*(.+)$/i)
      if (titleMetaMatch && titleMetaMatch[1]) {
        titleMeta = normalizeText(titleMetaMatch[1])
      }
    }
    if (!publishedMeta) {
      const publishedMetaMatch = line.match(/^published\s*time:\s*(.+)$/i)
      if (publishedMetaMatch && publishedMetaMatch[1]) {
        publishedMeta = normalizeText(publishedMetaMatch[1])
      }
    }
    if (!updatedMeta) {
      const updatedMetaMatch = line.match(/^updated\s*time:\s*(.+)$/i)
      if (updatedMetaMatch && updatedMetaMatch[1]) {
        updatedMeta = normalizeText(updatedMetaMatch[1])
      }
    }
  }
  for (const line of lines) {
    if (!visiblePublish) {
      const publishedVisibleMatch = line.match(/^(?:published|publish date)(?!\s*time\s*:)\b[^.\n]{0,220}/i)
      if (publishedVisibleMatch && publishedVisibleMatch[0]) {
        visiblePublish = normalizeText(publishedVisibleMatch[0])
      }
    }
    if (!visibleUpdated) {
      const updatedVisibleMatch = line.match(/^(?:updated|last updated)\b[^.\n]{0,220}/i)
      if (updatedVisibleMatch && updatedVisibleMatch[0]) {
        visibleUpdated = normalizeText(updatedVisibleMatch[0])
      }
    }
    if (!relativePublish) {
      const relativeFragment = extractRelativeDatelineFragment(line)
      if (relativeFragment) relativePublish = relativeFragment
    }
    if (!byline) {
      const bylineCandidate = parseJinaBylineCandidate(line)
      if (bylineCandidate) byline = bylineCandidate
    }
    const heading = line.match(/^(?:\d+\.\s*)?(#{1,6})\s+(.+)/)
    if (heading && heading[1] && heading[2]) {
      headingCandidates.push({
        level: heading[1].length,
        text: normalizeText(heading[2]),
      })
    }
    if (isLikelyJinaParagraph(line)) {
      paragraphCandidates.push(line)
    }
  }

  const headingTitle = chooseBestJinaHeading(headingCandidates)
  const title = chooseMoreSpecificTitle(headingTitle, titleMeta)
  const firstParagraph = paragraphCandidates.find((entry) => {
    if (!entry) return false
    if (/^url source:/i.test(entry)) return false
    if (title && normalizeLower(entry) === normalizeLower(title)) return false
    return true
  }) || ""
  const publish = visiblePublish || relativePublish || publishedMeta
  const updated = visibleUpdated || updatedMeta
  const dateline = [publish, updated].filter(Boolean).join(" | ")
  return { title, dateline, byline, firstParagraph }
}

async function fetchViaJinaProxy(link = "") {
  const target = normalizeHttpUrl(link)
  if (!target) throw new Error("Source link is not a valid http/https URL.")
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)
  try {
    const response = await fetch(`https://r.jina.ai/${target}`, {
      headers: STUDENT_NEWS_HTTP_HEADERS,
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!response.ok) throw new Error(`Proxy fetch returned HTTP ${response.status}`)
    return await response.text()
  } catch (error) {
    clearTimeout(timeout)
    throw error
  }
}

function parseBbcLiveMarkdown(markdownText = "") {
  const lines = normalizeText(markdownText).split(/\r?\n/)
  let title = ""
  let dateline = ""
  for (const line of lines) {
    const titleMatch = line.match(/^title:\s*(.+)$/i)
    if (!title && titleMatch && titleMatch[1]) title = normalizeText(titleMatch[1])
    const timeMatch = line.match(/^published\s*time:\s*(.+)$/i)
    if (!dateline && timeMatch && timeMatch[1]) dateline = normalizeText(timeMatch[1])
    if (title && dateline) break
  }

  let headingText = ""
  let firstParagraph = ""
  for (const raw of lines) {
    const line = raw.trim()
    if (!headingText) {
      const headingMatch = line.match(/^(?:\d+\.\s*)?(#+)\s+(.+)/)
      if (headingMatch && headingMatch[2]) {
        headingText = normalizeText(headingMatch[2])
        if (!title) title = headingText
        continue
      }
    }
    if (headingText && !firstParagraph) {
      if (!line) continue
      if (/^!\[.*\]\(.+\)/.test(line)) continue
      if (/^(?:\d+\.\s*)?(#+)\s+/.test(line)) continue
      firstParagraph = normalizeText(line)
      break
    }
  }

  return {
    ok: Boolean(title || firstParagraph || dateline),
    title,
    firstParagraph,
    dateline: dateline
      ? {
          publish: dateline,
          updated: "",
          combined: dateline,
        }
      : undefined,
  }
}

function tokenizeForSimilarity(value = "") {
  return new Set(
    normalizeLower(value)
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .map((entry) => normalizeText(entry))
      .filter((entry) => entry.length >= 2)
  )
}

export function studentNewsTextSimilarityScore(left = "", right = "") {
  const a = normalizeLower(left)
  const b = normalizeLower(right)
  if (!a || !b) return 0
  if (a === b) return 1
  if ((a.length >= 16 && b.includes(a)) || (b.length >= 16 && a.includes(b))) {
    return 0.92
  }
  const tokensA = tokenizeForSimilarity(a)
  const tokensB = tokenizeForSimilarity(b)
  if (!tokensA.size || !tokensB.size) return 0
  let intersection = 0
  tokensA.forEach((token) => {
    if (tokensB.has(token)) intersection += 1
  })
  const union = tokensA.size + tokensB.size - intersection
  if (union <= 0) return 0
  return intersection / union
}

function inferSourceOrganization(sourceLink = "") {
  const host = hostnameFromUrl(sourceLink)
  if (!host) return ""
  const parts = host.split(".").filter(Boolean)
  if (!parts.length) return ""
  if (parts.length === 1) return parts[0]
  return parts[parts.length - 2]
}

function statusErrorWithPayload(statusCode = 500, message = "Request failed", payload = {}) {
  const error = new Error(normalizeText(message) || "Request failed")
  error.statusCode = statusCode
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    error.payload = payload
  }
  return error
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
    label: normalizeText(source.label || STUDENT_NEWS_FIELD_LABELS[key] || key),
    status,
    message: normalizeText(source.message),
    criterion: normalizeText(source.criterion),
    steps,
    score: Number.isFinite(Number(source.score)) ? Number(source.score) : null,
    threshold: Number.isFinite(Number(source.threshold)) ? Number(source.threshold) : null,
    updatedAt: parseDateOrNull(source.updatedAt)?.toISOString?.() || nowIso(),
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
  return normalizeText(String(note || "").replaceAll(STUDENT_NEWS_AWAITING_RE_REVIEW_MARKER, ""))
}

function addAwaitingReReviewMarker(note = "") {
  const clean = stripAwaitingReReviewMarker(note)
  if (!clean) return STUDENT_NEWS_AWAITING_RE_REVIEW_MARKER
  return `${clean}\n${STUDENT_NEWS_AWAITING_RE_REVIEW_MARKER}`
}

function hasAwaitingReReviewMarker(note = "") {
  return normalizeText(note).includes(STUDENT_NEWS_AWAITING_RE_REVIEW_MARKER)
}

function resolveStudentNewsAwaitingReReview(row = {}) {
  if (
    normalizeStudentNewsReviewStatus(row?.reviewStatus, STUDENT_NEWS_REVIEW_STATUS_SUBMITTED)
    !== STUDENT_NEWS_REVIEW_STATUS_SUBMITTED
  ) {
    return false
  }
  if (row?.awaitingReReview === true) return true
  return hasAwaitingReReviewMarker(row?.reviewNote)
}

function stripComplianceBlockFromReviewNote(note = "") {
  const text = stripAwaitingReReviewMarker(note)
  if (!text) return ""
  const escapedStart = STUDENT_NEWS_COMPLIANCE_NOTE_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const escapedEnd = STUDENT_NEWS_COMPLIANCE_NOTE_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const blockRegex = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, "g")
  return normalizeText(text.replace(blockRegex, " ").replace(/\n{3,}/g, "\n\n"))
}

export function buildStudentNewsComplianceBlock(issueMap = {}) {
  const normalized = normalizeValidationIssueMap(issueMap)
  const fields = Object.keys(normalized)
  if (!fields.length) return ""
  const lines = fields
    .sort((left, right) => left.localeCompare(right))
    .map((fieldKey) => {
      const entry = normalized[fieldKey]
      const label = normalizeText(entry?.label || STUDENT_NEWS_FIELD_LABELS[fieldKey] || fieldKey)
      if (entry?.status === "fixed") {
        return `- [FIXED][${fieldKey}] ${STUDENT_NEWS_FIXED_NOTE_PREFIX} - ${label} now meets compliance criteria.`
      }
      const steps = Array.isArray(entry?.steps) && entry.steps.length
        ? entry.steps.map((step, index) => `Step ${index + 1}: ${normalizeText(step)}`).join(" ")
        : "Step 1: update this field to match the source article and save again."
      const criterion = normalizeText(entry?.criterion)
      const score = Number.isFinite(Number(entry?.score)) ? Number(entry.score).toFixed(2) : ""
      const threshold = Number.isFinite(Number(entry?.threshold)) ? Number(entry.threshold).toFixed(2) : ""
      const scoreToken = score && threshold ? ` (score ${score} < ${threshold})` : ""
      return `- [PENDING][${fieldKey}] ${label}: ${normalizeText(entry?.message)}${scoreToken}${criterion ? ` | Criteria: ${criterion}` : ""} | ${steps}`
    })
  return [STUDENT_NEWS_COMPLIANCE_NOTE_START, ...lines, STUDENT_NEWS_COMPLIANCE_NOTE_END].join("\n")
}

export function mergeStudentNewsReviewNoteWithCompliance(existingReviewNote = "", issueMap = {}) {
  const manual = stripComplianceBlockFromReviewNote(existingReviewNote)
  const complianceBlock = buildStudentNewsComplianceBlock(issueMap)
  if (manual && complianceBlock) return `${manual}\n\n${complianceBlock}`
  if (complianceBlock) return complianceBlock
  return manual
}

async function fetchStudentNewsArticleMetadata(sourceLink = "") {
  const link = normalizeHttpUrl(sourceLink)
  if (!link) {
    return {
      ok: false,
      error: "Source link is not a valid http/https URL.",
      sourceLink: normalizeText(sourceLink),
    }
  }
  const hostname = hostnameFromUrl(link)
  const isBbcDomain = Boolean(hostname && hostname.endsWith("bbc.com"))
  const isCnnDomain = Boolean(hostname && hostname.endsWith("cnn.com"))
  const bbcLive = isBbcLiveUrl(link)
  let primaryError = ""
  let primaryMetadata = null

  async function attemptHtmlFetch(url, viaLabel = "primary") {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 12000)
      const response = await fetch(url, {
        redirect: "follow",
        headers: STUDENT_NEWS_HTTP_HEADERS,
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (response.ok) {
        const html = await response.text()
        const plainText = stripTags(html)
        return {
          ok: true,
          via: viaLabel,
          sourceLink: url,
          hostname: hostnameFromUrl(url) || hostname,
          title: extractTitleFromHtml(html),
          byline: extractBylineFromHtml(html, plainText),
          dateline: extractDatelineSnippets(html, plainText),
          firstParagraph: extractFirstParagraphFromHtml(html),
        }
      }
      return {
        ok: false,
        error: `Source URL returned HTTP ${response.status}.`,
      }
    } catch (error) {
      return {
        ok: false,
        error: normalizeText(error?.message) || "Unable to fetch source article metadata.",
      }
    }
  }

  const primaryAttempt = await attemptHtmlFetch(link, "primary")
  if (primaryAttempt?.ok) {
    primaryMetadata = primaryAttempt
  } else {
    primaryError = primaryAttempt?.error || "Unable to fetch source article metadata."
  }

  let fallbackMetadata = null
  let fallbackError = ""
  const primaryDatelineCombined = normalizeText(primaryMetadata?.dateline?.combined)
  const needsAuthorDatelineEnrichment = (isBbcDomain || isCnnDomain)
    && !bbcLive
    && (!normalizeText(primaryMetadata?.byline) || !primaryDatelineCombined)
  const needsFallback = (
    !primaryMetadata?.ok
    || !primaryMetadata?.title
    || !primaryMetadata?.firstParagraph
    || needsAuthorDatelineEnrichment
  )
  const fallbackNeedsAuthorDateline = (candidate = {}) =>
    needsAuthorDatelineEnrichment
    && (
      !normalizeText(candidate?.byline)
      || !normalizeText(candidate?.dateline?.combined)
    )

  if (needsFallback) {
    const variantCandidates = []
    if (isBbcDomain) variantCandidates.push({ url: resolveBbcAmpUrl(link), via: "bbc-amp" })
    if (isCnnDomain) variantCandidates.push({ url: resolveCnnAmpUrl(link), via: "cnn-amp" })
    let bestVariantCandidate = null

    for (const candidate of variantCandidates) {
      if (!candidate?.url || candidate.url === link) continue
      const attempt = await attemptHtmlFetch(candidate.url, candidate.via)
      if (attempt?.ok && attempt?.title && attempt?.firstParagraph) {
        if (!bestVariantCandidate) bestVariantCandidate = attempt
        if (!fallbackNeedsAuthorDateline(attempt)) {
          fallbackMetadata = attempt
          break
        }
      }
      if (!fallbackError && attempt?.error) fallbackError = attempt.error
    }
    if (!fallbackMetadata?.ok && bestVariantCandidate?.ok) {
      fallbackMetadata = bestVariantCandidate
    }
  }

  if ((needsFallback && (!fallbackMetadata?.ok || fallbackNeedsAuthorDateline(fallbackMetadata))) && bbcLive) {
    try {
      const proxyBody = await fetchViaJinaProxy(link)
      const parsed = parseBbcLiveMarkdown(proxyBody)
      if (parsed.ok) {
        const seed = fallbackMetadata?.ok ? fallbackMetadata : primaryMetadata
        const seedDateline = normalizeText(seed?.dateline?.combined)
        fallbackMetadata = {
          ok: true,
          via: seed?.ok ? "primary+bbc-live-fallback" : "bbc-live-fallback",
          sourceLink: link,
          hostname,
          title: chooseMoreSpecificTitle(parsed.title, seed?.title),
          byline: normalizeText(seed?.byline) || "",
          dateline: seedDateline
            ? seed.dateline
            : (parsed.dateline || { publish: "", updated: "", combined: "" }),
          firstParagraph: parsed.firstParagraph || seed?.firstParagraph || "",
        }
      } else {
        fallbackError = "BBC liveblog fallback did not return usable content."
      }
    } catch (error) {
      fallbackError = normalizeText(error?.message) || "BBC liveblog fallback fetch failed."
    }
  }

  if ((needsFallback && (!fallbackMetadata?.ok || fallbackNeedsAuthorDateline(fallbackMetadata))) && (isBbcDomain || isCnnDomain)) {
    try {
      const proxyBody = await fetchViaJinaProxy(link)
      const parsed = parseGenericJinaMarkdown(proxyBody)
      if (parsed.title || parsed.firstParagraph || parsed.byline || parsed.dateline) {
        const seed = fallbackMetadata?.ok ? fallbackMetadata : primaryMetadata
        const proxyDateline = normalizeText(parsed.dateline)
        const seedDateline = normalizeText(seed?.dateline?.combined)
        let resolvedDateline = seed?.dateline || { publish: "", updated: "", combined: "" }
        if (proxyDateline) {
          resolvedDateline = {
            publish: proxyDateline,
            updated: "",
            combined: proxyDateline,
          }
        } else if (!seedDateline) {
          resolvedDateline = { publish: "", updated: "", combined: "" }
        }
        fallbackMetadata = {
          ok: true,
          via: seed?.ok ? "primary+proxy" : "proxy",
          sourceLink: link,
          hostname,
          title: chooseMoreSpecificTitle(parsed.title, seed?.title),
          byline: normalizeText(parsed.byline) || normalizeText(seed?.byline) || "",
          dateline: resolvedDateline,
          firstParagraph: parsed.firstParagraph || seed?.firstParagraph || "",
        }
      } else {
        fallbackError = "Proxy fetch returned no usable content."
      }
    } catch (error) {
      fallbackError = normalizeText(error?.message) || "Proxy fetch failed."
    }
  }

  const chosen = fallbackMetadata?.ok ? fallbackMetadata : primaryMetadata
  const ok = Boolean(chosen?.ok)
  if (ok) {
    return {
      ...chosen,
      via: chosen?.via || (fallbackMetadata?.ok ? fallbackMetadata.via : "primary"),
      primaryError: primaryError || undefined,
      fallbackError: fallbackError || undefined,
    }
  }

  return {
    ok: false,
    error: fallbackError || primaryError || "Unable to fetch source article metadata.",
    sourceLink: link,
    hostname,
    via: fallbackMetadata ? fallbackMetadata.via : "primary",
    primaryError: primaryError || undefined,
    fallbackError: fallbackError || undefined,
  }
}

function buildStudentNewsFieldRevisionTask(fieldKey = "", context = {}) {
  const allowedSourcesText = Array.isArray(context?.allowedDomains) && context.allowedDomains.length
    ? context.allowedDomains.join(", ")
    : STUDENT_NEWS_DEFAULT_ALLOWED_SOURCE_DOMAINS.join(", ")
  if (fieldKey === "sourceLink") {
    return {
      field: fieldKey,
      label: STUDENT_NEWS_FIELD_LABELS[fieldKey],
      steps: [
        `Use a full story URL (http/https) from an approved source: ${allowedSourcesText}.`,
        "Open the URL and confirm it loads the specific article (not homepage).",
        "Paste the exact URL including its path and save again.",
      ],
      criterion: `Hostname must match approved sources (${allowedSourcesText}).`,
    }
  }
  if (fieldKey === "articleTitle") {
    return {
      field: fieldKey,
      label: STUDENT_NEWS_FIELD_LABELS[fieldKey],
      steps: [
        "Copy the article headline exactly as displayed on the source page.",
        "Remove extra words that are not in the headline.",
        "Save again after title text matches the source.",
      ],
      criterion: "Headline similarity must be at least 0.70.",
    }
  }
  if (fieldKey === "byline") {
    return {
      field: fieldKey,
      label: STUDENT_NEWS_FIELD_LABELS[fieldKey],
      steps: [
        "Use the article author name as shown on the source page.",
        "If author is not listed, use the source organization/domain name (for example: bbc or cnn).",
        "Save again after byline matches author/organization.",
      ],
      criterion: "Byline similarity must be at least 0.70.",
    }
  }
  if (fieldKey === "articleDateline") {
    return {
      field: fieldKey,
      label: STUDENT_NEWS_FIELD_LABELS[fieldKey],
      steps: [
        "Enter the visible publish timestamp from the source page.",
        "If the page shows Updated timestamp, include it in the dateline text.",
        "If timezone text is used, include full timezone text and GMT offset (example: GMT+7).",
      ],
      criterion: "Dateline text similarity must be at least 0.70 and include required updated/timezone tokens.",
    }
  }
  if (fieldKey === "actionActor") {
    return {
      field: fieldKey,
      label: "Who/what did Action?",
      steps: [
        "Identify who or what performed the main action in the article.",
        "Use a clear noun or noun phrase.",
        "Save again after adding the actor phrase.",
      ],
      criterion: "Must contain at least one noun or noun phrase.",
    }
  }
  if (fieldKey === "actionAffected") {
    return {
      field: fieldKey,
      label: "Who/what was Affected by Action?",
      steps: [
        "Identify who or what received impact from the action.",
        "Use a clear noun or noun phrase.",
        "Save again after adding the affected entity.",
      ],
      criterion: "Must contain at least one noun or noun phrase.",
    }
  }
  if (fieldKey === "actionWhere") {
    return {
      field: fieldKey,
      label: "Where did Action take place?",
      steps: [
        "Enter the location of the event from the source article.",
        "Include at least a city or country.",
        "Save again after adding the location.",
      ],
      criterion: "Must include a location phrase (city/country/place).",
    }
  }
  if (fieldKey === "actionWhat") {
    return {
      field: fieldKey,
      label: "What Action Occurred?",
      steps: [
        "Describe the action in one complete sentence.",
        "Keep the sentence factual and source-aligned.",
        "Save again after updating the action sentence.",
      ],
      criterion: "Must be at least one sentence.",
    }
  }
  if (fieldKey === "actionWhy") {
    return {
      field: fieldKey,
      label: "Why did Action happen?",
      steps: [
        "Explain why the event happened in one complete sentence.",
        "Use source-supported reasons only.",
        "Save again after updating the why sentence.",
      ],
      criterion: "Must be at least one sentence.",
    }
  }
  if (fieldKey === "biasAssessment") {
    return {
      field: fieldKey,
      label: "Bias Assessment",
      steps: [
        "Write one clear sentence evaluating bias/spin in the report.",
        "Reference wording, framing, or omitted context.",
        "Save again after adding the bias sentence.",
      ],
      criterion: "Must be at least one sentence.",
    }
  }
  return {
    field: fieldKey,
    label: STUDENT_NEWS_FIELD_LABELS[fieldKey] || fieldKey,
    steps: [
      "Summarize only the first paragraph of the source article.",
      "Keep key facts and wording aligned with the source lead paragraph.",
      "Save again after synopsis reflects the source lead.",
    ],
    criterion: "Lead synopsis similarity must be at least 0.50.",
  }
}

function shouldRequireGmtOffset(datelineText = "") {
  const text = normalizeLower(datelineText)
  if (!text) return false
  return /(timezone|time zone|gmt|utc|ict|est|edt|pst|pdt|cst|bst)/i.test(text)
}

function hasTimezoneLiteral(datelineText = "") {
  const text = normalizeLower(datelineText)
  if (!text) return false
  return /\b(?:ict|est|edt|pst|pdt|cst|cdt|bst|cet|cest|ist|jst|aest|aedt|utc|gmt)\b/i.test(text)
}

function hasTimezoneDescriptor(datelineText = "") {
  const text = normalizeLower(datelineText)
  if (!text) return false
  return (
    /\b(?:timezone|time zone)\b/i.test(text)
    || /\b(?:indochina|eastern|pacific|central|british|coordinated universal|greenwich mean)\s+time\b/i.test(text)
    || /\([^)]*\btime\b[^)]*\)/i.test(text)
  )
}

function hasTimezoneOffset(datelineText = "") {
  const text = normalizeLower(datelineText)
  if (!text) return false
  return /\b(?:gmt|utc)\s*[+-]\s*\d{1,2}(?::?\d{2})?\b/i.test(text)
}

function parseRelativeDatelineToken(value = "") {
  const fragment = extractRelativeDatelineFragment(value)
  const text = normalizeLower(fragment)
  if (!text) return null
  const match = text.match(/\b(\d+)\s*(minutes?|hours?|days?|weeks?|months?|years?)\s+ago\b/i)
  if (!match || !match[1] || !match[2]) return null
  const amount = Number.parseInt(match[1], 10)
  if (!Number.isFinite(amount) || amount < 0) return null
  const rawUnit = normalizeLower(match[2]).replace(/s$/, "")
  const supportedUnits = new Set(["minute", "hour", "day", "week", "month", "year"])
  if (!supportedUnits.has(rawUnit)) return null
  return { amount, unit: rawUnit }
}

function relativeDatelineToMinutes(value = "") {
  const token = parseRelativeDatelineToken(value)
  if (!token) return Number.NaN
  const multipliers = {
    minute: 1,
    hour: 60,
    day: 60 * 24,
    week: 60 * 24 * 7,
    month: 60 * 24 * 30,
    year: 60 * 24 * 365,
  }
  const unitMinutes = multipliers[token.unit]
  if (!Number.isFinite(unitMinutes)) return Number.NaN
  return token.amount * unitMinutes
}

function monthTokenToNumber(token = "") {
  const value = normalizeLower(token).replace(/\.$/, "")
  if (value.startsWith("jan")) return 1
  if (value.startsWith("feb")) return 2
  if (value.startsWith("mar")) return 3
  if (value.startsWith("apr")) return 4
  if (value === "may") return 5
  if (value.startsWith("jun")) return 6
  if (value.startsWith("jul")) return 7
  if (value.startsWith("aug")) return 8
  if (value.startsWith("sep")) return 9
  if (value.startsWith("oct")) return 10
  if (value.startsWith("nov")) return 11
  if (value.startsWith("dec")) return 12
  return 0
}

function dateKeyFromParts(year = 0, month = 0, day = 0) {
  const y = Number.parseInt(String(year), 10)
  const m = Number.parseInt(String(month), 10)
  const d = Number.parseInt(String(day), 10)
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return ""
  if (y < 1900 || y > 2300 || m < 1 || m > 12 || d < 1 || d > 31) return ""
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

function localTodayDateKey() {
  const now = new Date()
  return dateKeyFromParts(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

function dateKeyToUtcMs(key = "") {
  const normalized = normalizeText(key)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return Number.NaN
  const [year, month, day] = normalized.split("-").map((part) => Number.parseInt(part, 10))
  if (
    !Number.isFinite(year)
    || !Number.isFinite(month)
    || !Number.isFinite(day)
    || month < 1
    || month > 12
    || day < 1
    || day > 31
  ) {
    return Number.NaN
  }
  return Date.UTC(year, month - 1, day)
}

function hasDateKeyNearLocalToday(dateKeys = [], windowDays = 0) {
  const keys = Array.isArray(dateKeys)
    ? dateKeys.map((entry) => normalizeText(entry)).filter(Boolean)
    : []
  if (!keys.length) return false
  const spanDays = Number.parseInt(String(windowDays), 10)
  const spanMs = Math.max(0, Number.isFinite(spanDays) ? spanDays : 0) * 24 * 60 * 60 * 1000
  const todayMs = dateKeyToUtcMs(localTodayDateKey())
  if (!Number.isFinite(todayMs)) return false
  return keys.some((key) => {
    const value = dateKeyToUtcMs(key)
    return Number.isFinite(value) && Math.abs(value - todayMs) <= spanMs
  })
}

function haveDateKeysWithinDays(leftKeys = [], rightKeys = [], windowDays = 0) {
  const left = Array.isArray(leftKeys)
    ? leftKeys.map((entry) => normalizeText(entry)).filter(Boolean)
    : []
  const right = Array.isArray(rightKeys)
    ? rightKeys.map((entry) => normalizeText(entry)).filter(Boolean)
    : []
  if (!left.length || !right.length) return false
  const spanDays = Number.parseInt(String(windowDays), 10)
  const spanMs = Math.max(0, Number.isFinite(spanDays) ? spanDays : 0) * 24 * 60 * 60 * 1000
  const leftValues = left.map((key) => dateKeyToUtcMs(key)).filter((value) => Number.isFinite(value))
  const rightValues = right.map((key) => dateKeyToUtcMs(key)).filter((value) => Number.isFinite(value))
  if (!leftValues.length || !rightValues.length) return false
  return leftValues.some((leftValue) =>
    rightValues.some((rightValue) => Math.abs(leftValue - rightValue) <= spanMs)
  )
}

function extractDateKeysFromDatelineText(value = "") {
  const text = normalizeText(value)
  if (!text) return []
  const keys = new Set()

  const isoRegex = /(\d{4})-(\d{2})-(\d{2})(?=[T\s]|$|[^\d])/g
  for (const match of text.matchAll(isoRegex)) {
    const key = dateKeyFromParts(match[1], match[2], match[3])
    if (key) keys.add(key)
  }

  const monthFirstRegex =
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+(\d{4})\b/gi
  for (const match of text.matchAll(monthFirstRegex)) {
    const month = monthTokenToNumber(match[1])
    const key = dateKeyFromParts(match[3], month, match[2])
    if (key) keys.add(key)
  }

  const dayFirstRegex =
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})\b/gi
  for (const match of text.matchAll(dayFirstRegex)) {
    const month = monthTokenToNumber(match[2])
    const key = dateKeyFromParts(match[3], month, match[1])
    if (key) keys.add(key)
  }

  return [...keys]
}

function hasNounLikePhrase(value = "") {
  const text = normalizeText(value)
  if (!text) return false
  const tokens = text
    .replace(/[^A-Za-z0-9\s-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
  return tokens.length >= 1
}

function isSentenceLike(value = "") {
  const text = normalizeText(value)
  if (!text) return false
  const tokens = text.split(/\s+/).filter(Boolean)
  if (tokens.length < 4) return false
  return /[.!?]$/.test(text) || text.length >= 24
}

function datelineHasExplicitUpdatedCue(value = "") {
  const text = normalizeText(value)
  if (!text) return false
  return /\b(?:updated|last updated)\b/i.test(text)
}

export async function evaluateStudentNewsCompliance(payload = {}, options = {}) {
  const config = normalizeStudentNewsValidationConfig(options?.validationConfig || {})
  const normalizedSourceLink = normalizeHttpUrl(payload?.sourceLink)
  const rawSourceLink = normalizeText(payload?.sourceLink)
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
  const failedFields = {}
  const validationDetails = {}

  const sourceHostname = hostnameFromUrl(normalizedSourceLink || rawSourceLink)
  const allowedDomains = Array.isArray(config.allowedDomains) ? config.allowedDomains : []
  if (!sourceHostname) {
    failedFields.sourceLink = {
      message: "Source must be a valid full story URL (http/https).",
      threshold: 1,
      score: 0,
    }
  } else {
    const sourceAllowed = allowedDomains.some((domain) => sourceDomainMatches(sourceHostname, domain))
    validationDetails.sourceLink = {
      hostname: sourceHostname,
      allowedDomains,
      sourceAllowed,
    }
    if (!sourceAllowed) {
      const allowedSourceText = allowedDomains.join(", ")
      failedFields.sourceLink = {
        message: `Source domain is not allowed. Approved sources: ${allowedSourceText || STUDENT_NEWS_DEFAULT_ALLOWED_SOURCE_DOMAINS.join(", ")}.`,
        threshold: 1,
        score: 0,
      }
    }
  }

  const metadata = await fetchStudentNewsArticleMetadata(normalizedSourceLink || rawSourceLink)
  validationDetails.metadata = metadata
  if (!metadata.ok) {
    failedFields.sourceLink = failedFields.sourceLink || {
      message: normalizeText(metadata.error) || "Unable to fetch source URL.",
      threshold: 1,
      score: 0,
    }
  }

  const titleScore = studentNewsTextSimilarityScore(articleTitle, metadata?.title)
  validationDetails.articleTitle = {
    score: titleScore,
    threshold: config.thresholds.articleTitle,
    fetchedTitle: normalizeText(metadata?.title),
  }
  if (!articleTitle || titleScore < config.thresholds.articleTitle) {
    failedFields.articleTitle = {
      message: "Article title does not closely match source title.",
      score: titleScore,
      threshold: config.thresholds.articleTitle,
    }
  }

  const bylineScore = studentNewsTextSimilarityScore(byline, metadata?.byline)
  const orgFallback = inferSourceOrganization(normalizedSourceLink || rawSourceLink)
  const bylineOrgScore = studentNewsTextSimilarityScore(byline, orgFallback)
  const bylineFinalScore = Math.max(bylineScore, bylineOrgScore)
  validationDetails.byline = {
    score: bylineFinalScore,
    threshold: config.thresholds.byline,
    fetchedByline: normalizeText(metadata?.byline),
    organizationFallback: orgFallback,
    fallbackScore: bylineOrgScore,
  }
  if (!byline || bylineFinalScore < config.thresholds.byline) {
    failedFields.byline = {
      message: "Byline must match fetched author or source organization.",
      score: bylineFinalScore,
      threshold: config.thresholds.byline,
    }
  }

  const datelineTarget = normalizeText(metadata?.dateline?.combined)
  const fetchedUpdatedDateline = normalizeText(metadata?.dateline?.updated)
  const datelineScore = studentNewsTextSimilarityScore(articleDateline, datelineTarget)
  const articleRelativeMinutes = relativeDatelineToMinutes(articleDateline)
  const targetRelativeMinutes = relativeDatelineToMinutes(datelineTarget)
  const targetIsRelative = Boolean(parseRelativeDatelineToken(datelineTarget))
  const relativeDatelineCompatible = Number.isFinite(articleRelativeMinutes)
    && Number.isFinite(targetRelativeMinutes)
    && Math.abs(articleRelativeMinutes - targetRelativeMinutes) <= 24 * 60
  const articleDateKeys = extractDateKeysFromDatelineText(articleDateline)
  const targetDateKeys = extractDateKeysFromDatelineText(datelineTarget)
  const todayKey = localTodayDateKey()
  const articleHasTodayWord = /\btoday\b/i.test(articleDateline)
  const articleHasTodayDate = articleDateKeys.includes(todayKey)
  const targetHasTodayDate = targetDateKeys.includes(todayKey)
  const articleHasNearTodayDate = hasDateKeyNearLocalToday(articleDateKeys, 1)
  const targetHasNearTodayDate = hasDateKeyNearLocalToday(targetDateKeys, 1)
  const dateKeyOverlap = articleDateKeys.some((key) => targetDateKeys.includes(key))
  const dateKeysNearMatch = haveDateKeysWithinDays(articleDateKeys, targetDateKeys, 1)
  const articleTodayEquivalent = articleHasTodayWord || articleHasTodayDate || articleHasNearTodayDate
  const targetTodayEquivalent = targetHasTodayDate || targetHasNearTodayDate
  const acceptsTodayStamp = articleTodayEquivalent
  const relaxedDatelineEquivalent = (
    relativeDatelineCompatible
    || dateKeyOverlap
    || dateKeysNearMatch
    || (targetIsRelative && articleTodayEquivalent)
    || (targetTodayEquivalent && articleTodayEquivalent)
  )
  const datelinePassesThreshold = datelineScore >= config.thresholds.articleDateline || relaxedDatelineEquivalent
  const requiresUpdatedToken =
    datelineHasExplicitUpdatedCue(datelineTarget)
    || datelineHasExplicitUpdatedCue(fetchedUpdatedDateline)
  const hasUpdatedToken = /updated/i.test(articleDateline)
  const requiresOffset = shouldRequireGmtOffset(datelineTarget) || shouldRequireGmtOffset(articleDateline)
  const hasLiteralTimezone = hasTimezoneLiteral(articleDateline)
  const hasFullTimezoneDescriptor = hasTimezoneDescriptor(articleDateline)
  const hasGmtOffset = hasTimezoneOffset(articleDateline)
  const missingRequiredOffset = requiresOffset && !hasGmtOffset
  const strictTimezoneOffsetRequired = missingRequiredOffset && hasLiteralTimezone
  const descriptorMismatch = hasLiteralTimezone && !hasFullTimezoneDescriptor
  validationDetails.articleDateline = {
    score: datelineScore,
    threshold: config.thresholds.articleDateline,
    fetchedDateline: datelineTarget,
    fetchedUpdatedDateline,
    requiresUpdatedToken,
    hasUpdatedToken,
    requiresOffset,
    hasLiteralTimezone,
    hasFullTimezoneDescriptor,
    hasGmtOffset,
    targetIsRelative,
    relativeDatelineCompatible,
    dateKeyOverlap,
    articleDateKeys,
    targetDateKeys,
    articleHasNearTodayDate,
    targetHasNearTodayDate,
    dateKeysNearMatch,
    articleTodayEquivalent,
    targetTodayEquivalent,
    acceptsTodayStamp,
    relaxedDatelineEquivalent,
    missingRequiredOffset,
    strictTimezoneOffsetRequired,
    descriptorMismatch,
  }
  if (
    !articleDateline
    || !datelinePassesThreshold
    || (!relaxedDatelineEquivalent && requiresUpdatedToken && !hasUpdatedToken)
    || strictTimezoneOffsetRequired
    || descriptorMismatch
    || (!relaxedDatelineEquivalent && missingRequiredOffset && !hasLiteralTimezone)
  ) {
    failedFields.articleDateline = {
      message: "Dateline must reflect visible publish/updated time and timezone requirements.",
      score: datelineScore,
      threshold: config.thresholds.articleDateline,
    }
  }

  const leadScore = studentNewsTextSimilarityScore(leadSynopsis, metadata?.firstParagraph)
  validationDetails.leadSynopsis = {
    score: leadScore,
    threshold: config.thresholds.leadSynopsis,
    fetchedLead: normalizeText(metadata?.firstParagraph),
  }
  if (!leadSynopsis || leadScore < config.thresholds.leadSynopsis) {
    failedFields.leadSynopsis = {
      message: "Lead synopsis must align with the first paragraph of the source article.",
      score: leadScore,
      threshold: config.thresholds.leadSynopsis,
    }
  }

  if (!hasNounLikePhrase(actionActor)) {
    failedFields.actionActor = {
      message: "Action actor must include a noun or noun phrase.",
      score: 0,
      threshold: 1,
    }
  }
  if (!hasNounLikePhrase(actionAffected)) {
    failedFields.actionAffected = {
      message: "Action affected must include a noun or noun phrase.",
      score: 0,
      threshold: 1,
    }
  }
  if (!hasNounLikePhrase(actionWhere)) {
    failedFields.actionWhere = {
      message: "Action location must include a place (city/country/location phrase).",
      score: 0,
      threshold: 1,
    }
  }
  if (!isSentenceLike(actionWhat)) {
    failedFields.actionWhat = {
      message: "Action description must be at least one sentence.",
      score: 0,
      threshold: 1,
    }
  }
  if (!isSentenceLike(actionWhy)) {
    failedFields.actionWhy = {
      message: "Action reason must be at least one sentence.",
      score: 0,
      threshold: 1,
    }
  }
  if (!isSentenceLike(biasAssessment)) {
    failedFields.biasAssessment = {
      message: "Bias assessment must be at least one sentence.",
      score: 0,
      threshold: 1,
    }
  }

  const revisionTasks = Object.keys(failedFields).map((fieldKey) =>
    buildStudentNewsFieldRevisionTask(fieldKey, {
      allowedDomains,
    })
  )
  return {
    passed: Object.keys(failedFields).length === 0,
    failedFields,
    revisionTasks,
    details: validationDetails,
    config,
  }
}

function revisionTasksByField(revisionTasks = []) {
  const source = Array.isArray(revisionTasks) ? revisionTasks : []
  const map = new Map()
  source.forEach((task) => {
    const field = normalizeText(task?.field)
    if (!field) return
    map.set(field, task)
  })
  return map
}

export function updateStudentNewsValidationIssues(previousIssues = {}, compliance = {}) {
  const previous = normalizeValidationIssueMap(previousIssues)
  const failedFields = compliance?.failedFields && typeof compliance.failedFields === "object"
    ? compliance.failedFields
    : {}
  const tasksByField = revisionTasksByField(compliance?.revisionTasks)
  const nextIssues = {}
  const newlyFixed = []
  const fieldKeys = new Set([
    ...Object.keys(previous),
    ...Object.keys(failedFields),
  ])
  fieldKeys.forEach((fieldKey) => {
    const previousEntry = previous[fieldKey]
    const failed = failedFields[fieldKey]
    if (failed) {
      const task = tasksByField.get(fieldKey) || buildStudentNewsFieldRevisionTask(fieldKey, {
        allowedDomains: compliance?.config?.allowedDomains || [],
      })
      nextIssues[fieldKey] = normalizeValidationIssueEntry(fieldKey, {
        ...(previousEntry || {}),
        status: "pending",
        label: task?.label || STUDENT_NEWS_FIELD_LABELS[fieldKey] || fieldKey,
        message: normalizeText(failed?.message),
        criterion: normalizeText(task?.criterion),
        steps: Array.isArray(task?.steps) ? task.steps : [],
        score: Number.isFinite(Number(failed?.score)) ? Number(failed?.score) : null,
        threshold: Number.isFinite(Number(failed?.threshold)) ? Number(failed?.threshold) : null,
        updatedAt: nowIso(),
      })
      return
    }
    if (!previousEntry) return
    if (normalizeLower(previousEntry.status) !== "fixed") newlyFixed.push(fieldKey)
    nextIssues[fieldKey] = normalizeValidationIssueEntry(fieldKey, {
      ...previousEntry,
      status: "fixed",
      message: "Resolved on latest save.",
      score: previousEntry?.score,
      threshold: previousEntry?.threshold,
      updatedAt: nowIso(),
    })
  })
  return {
    issues: nextIssues,
    newlyFixed,
  }
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

function startOfAcademicYear(value = new Date()) {
  const date = value instanceof Date ? value : parseDateOrNull(value)
  const now = date instanceof Date && !Number.isNaN(date.valueOf()) ? date : new Date()
  const shifted = shiftToFixedTimeZone(now)
  const month = shifted.getUTCMonth() + 1
  const year = month >= 8 ? shifted.getUTCFullYear() : shifted.getUTCFullYear() - 1
  return shiftFromFixedTimeZone(new Date(Date.UTC(year, 7, 1, 0, 0, 0, 0)))
}

function addDays(dateValue, days = 0) {
  const date = startOfDay(dateValue)
  const shifted = shiftToFixedTimeZone(date)
  shifted.setUTCDate(shifted.getUTCDate() + (Number.parseInt(String(days), 10) || 0))
  return shiftFromFixedTimeZone(shifted)
}

function pointsEventDateValue(dateValue) {
  const parsed = parseDateOrNull(dateValue)
  return parsed instanceof Date ? parsed.valueOf() : 0
}

function mapStudentPointsEventsForGradeRecords(rows = []) {
  const source = Array.isArray(rows) ? rows : []
  return source
    .map((row) => {
      const studentRefId = normalizeText(row?.studentRefId)
      if (!studentRefId || !isCompletedGradeRecord(row)) return null
      const hasDueAt = parseDateOrNull(row?.dueAt) instanceof Date
      const autoImported = isAutoImportedExerciseGradeRecord(row)
      const onTime = isOnTimeCompletedGradeRecord(row)
      if (!autoImported && hasDueAt && !onTime) return null

      const eventType =
        autoImported || !hasDueAt
          ? STUDENT_POINTS_EVENT_TYPE_ELECTIVE
          : STUDENT_POINTS_EVENT_TYPE_SCHEDULED_ON_TIME
      const points =
        eventType === STUDENT_POINTS_EVENT_TYPE_ELECTIVE
          ? STUDENT_POINTS_ELECTIVE_SUBMISSION_VALUE
          : STUDENT_POINTS_SCHEDULED_ON_TIME_VALUE
      const occurredAt =
        parseDateOrNull(row?.submittedAt)
        || parseDateOrNull(row?.dueAt)
        || parseDateOrNull(row?.updatedAt)
        || parseDateOrNull(row?.createdAt)
        || new Date()

      return {
        id: `grade:${normalizeText(row?.id) || `${studentRefId}:${normalizeText(row?.assignmentName)}`}`,
        studentRefId,
        eventType,
        points,
        occurredAt: occurredAt.toISOString(),
        sourceType: "gradeRecord",
        sourceId: normalizeText(row?.id),
        title: normalizeText(row?.assignmentName) || "Assignment",
        details: normalizeText(row?.className),
      }
    })
    .filter(Boolean)
}

function mapStudentPointsEventsForApprovedReports(rows = []) {
  const source = Array.isArray(rows) ? rows : []
  return source
    .map((row) => {
      const studentRefId = normalizeText(row?.studentRefId)
      const approvedAt = parseDateOrNull(row?.approvedAt)
      const points = normalizeReportParticipationPoints(row?.participationPointsAward)
      if (!studentRefId || !(approvedAt instanceof Date) || !Number.isFinite(points) || points <= 0) return null
      return {
        id: `report:${normalizeText(row?.id) || `${studentRefId}:${approvedAt.toISOString()}`}`,
        studentRefId,
        eventType: STUDENT_POINTS_EVENT_TYPE_REPORT_PARTICIPATION,
        points,
        occurredAt: approvedAt.toISOString(),
        sourceType: "parentReport",
        sourceId: normalizeText(row?.id),
        title: "Approved Performance Report",
        details: normalizeText(row?.className),
      }
    })
    .filter(Boolean)
}

function mapStudentPointsEventsForAdjustments(rows = []) {
  const source = Array.isArray(rows) ? rows : []
  return source
    .map((row) => {
      const studentRefId = normalizeText(row?.studentRefId)
      const pointsDelta = normalizeInteger(row?.pointsDelta)
      if (!studentRefId || !Number.isFinite(pointsDelta) || pointsDelta === 0) return null
      const occurredAt =
        parseDateOrNull(row?.appliedAt)
        || parseDateOrNull(row?.createdAt)
        || parseDateOrNull(row?.updatedAt)
        || new Date()
      return {
        id: `adjustment:${normalizeText(row?.id) || `${studentRefId}:${occurredAt.toISOString()}`}`,
        studentRefId,
        eventType: STUDENT_POINTS_EVENT_TYPE_ADMIN_ADJUSTMENT,
        points: pointsDelta,
        occurredAt: occurredAt.toISOString(),
        sourceType: "adjustment",
        sourceId: normalizeText(row?.id),
        title: "Manual Adjustment",
        details: normalizeText(row?.reason),
        adjustedByUsername: normalizeText(row?.adjustedByUsername),
      }
    })
    .filter(Boolean)
}

export function buildStudentPointsEvents({
  gradeRecords = [],
  approvedReports = [],
  adjustments = [],
} = {}) {
  const events = [
    ...mapStudentPointsEventsForGradeRecords(gradeRecords),
    ...mapStudentPointsEventsForApprovedReports(approvedReports),
    ...mapStudentPointsEventsForAdjustments(adjustments),
  ]
  events.sort((left, right) => {
    const diff = pointsEventDateValue(left?.occurredAt) - pointsEventDateValue(right?.occurredAt)
    if (diff !== 0) return diff
    return normalizeText(left?.id).localeCompare(normalizeText(right?.id))
  })
  return events
}

export function sumStudentPointsEvents(events = []) {
  const source = Array.isArray(events) ? events : []
  return source.reduce((sum, entry) => sum + (normalizeInteger(entry?.points) || 0), 0)
}

function studentPointsSummaryFromEvents(events = []) {
  const source = Array.isArray(events) ? events : []
  const totals = {
    totalPoints: sumStudentPointsEvents(source),
    scheduledOnTimeCount: 0,
    electiveCount: 0,
    approvedReportCount: 0,
    adjustmentTotal: 0,
    lastActivityAt: "",
  }
  source.forEach((event) => {
    const type = normalizeText(event?.eventType)
    if (type === STUDENT_POINTS_EVENT_TYPE_SCHEDULED_ON_TIME) totals.scheduledOnTimeCount += 1
    if (type === STUDENT_POINTS_EVENT_TYPE_ELECTIVE) totals.electiveCount += 1
    if (type === STUDENT_POINTS_EVENT_TYPE_REPORT_PARTICIPATION) totals.approvedReportCount += 1
    if (type === STUDENT_POINTS_EVENT_TYPE_ADMIN_ADJUSTMENT) totals.adjustmentTotal += normalizeInteger(event?.points) || 0
    const occurredAt = parseDateOrNull(event?.occurredAt)
    if (!(occurredAt instanceof Date)) return
    if (!totals.lastActivityAt || occurredAt.valueOf() > pointsEventDateValue(totals.lastActivityAt)) {
      totals.lastActivityAt = occurredAt.toISOString()
    }
  })
  return totals
}

function studentFullName(student = {}) {
  return normalizeText(student?.profile?.fullName || student?.profile?.englishName || student?.eaglesId)
}

function studentLevelName(student = {}) {
  return canonicalizeLevel(student?.profile?.currentGrade || "") || ""
}

function normalizeStudentPointsSortField(value) {
  const field = normalizeText(value)
  if (!field || !STUDENT_POINTS_SORT_FIELDS.has(field)) return "totalPoints"
  return field
}

function normalizeStudentPointsSortDir(value) {
  return normalizeLower(value) === "asc" ? "asc" : "desc"
}

function sortStudentPointsRows(rows = [], sortField = "totalPoints", sortDir = "desc") {
  const source = Array.isArray(rows) ? rows.slice() : []
  const direction = normalizeStudentPointsSortDir(sortDir) === "asc" ? 1 : -1
  const field = normalizeStudentPointsSortField(sortField)
  source.sort((left, right) => {
    let compare
    if (field === "studentNumber") {
      compare = (normalizeInteger(left?.studentNumber) || 0) - (normalizeInteger(right?.studentNumber) || 0)
    } else if (field === "eaglesId") {
      compare = normalizeText(left?.eaglesId).localeCompare(normalizeText(right?.eaglesId))
    } else if (field === "fullName") {
      compare = normalizeText(left?.fullName).localeCompare(normalizeText(right?.fullName))
    } else if (field === "level") {
      compare = compareKnownLevelOrder(normalizeText(left?.level), normalizeText(right?.level))
    } else if (field === "lastActivityAt") {
      compare = pointsEventDateValue(left?.lastActivityAt) - pointsEventDateValue(right?.lastActivityAt)
    } else {
      compare = (normalizeInteger(left?.[field]) || 0) - (normalizeInteger(right?.[field]) || 0)
    }
    if (compare !== 0) return compare * direction
    return normalizeText(left?.fullName).localeCompare(normalizeText(right?.fullName))
  })
  return source
}

function normalizePointsRange({ startDate = "", endDate = "", now = new Date() } = {}) {
  const fallbackNow = parseDateOrNull(now) || new Date()
  const parsedStart = parseDateOrNull(startDate) || startOfAcademicYear(fallbackNow)
  const parsedEnd = parseDateOrNull(endDate) || fallbackNow
  let rangeStart = startOfDay(parsedStart)
  let rangeEnd = endOfDay(parsedEnd)
  if (rangeEnd.valueOf() < rangeStart.valueOf()) {
    const swappedStart = startOfDay(parsedEnd)
    rangeEnd = endOfDay(parsedStart)
    rangeStart = swappedStart
  }
  return {
    start: rangeStart,
    end: rangeEnd,
    startDate: toLocalIsoDate(rangeStart),
    endDate: toLocalIsoDate(rangeEnd),
  }
}

function hasPrismaDelegateMethod(prisma, delegateName, methodName) {
  return Boolean(prisma?.[delegateName] && typeof prisma[delegateName][methodName] === "function")
}

function findManyOrEmpty(prisma, delegateName, query) {
  if (!hasPrismaDelegateMethod(prisma, delegateName, "findMany")) return Promise.resolve([])
  return prisma[delegateName].findMany(query)
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

function isLegacyParentReportApprovedAtSchemaError(error) {
  return (
    isUnknownPrismaArgumentError(error, "approvedAt")
    || isUnknownPrismaFieldError(error, "approvedAt")
  )
}

function isLegacyParentReportParticipationPointsSchemaError(error) {
  return (
    isUnknownPrismaArgumentError(error, "participationPointsAward")
    || isUnknownPrismaFieldError(error, "participationPointsAward")
    || isMissingPrismaColumnError(error, "participationPointsAward")
  )
}

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
    || isUnknownPrismaArgumentError(error, "validationIssuesJson")
    || isUnknownPrismaFieldError(error, "validationIssuesJson")
    || isMissingPrismaColumnError(error, "validationIssuesJson")
  )
}

function stripLegacyParentReportFields(data = {}) {
  if (!data || typeof data !== "object") return {}
  const next = { ...data }
  delete next.participationPointsAward
  return next
}

function createStudentNewsFallbackId() {
  return `news-${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}`
}

function normalizeStudentNewsFallbackEntry(entry = {}) {
  const studentRefId = normalizeText(entry?.studentRefId)
  const reportDate = normalizeText(entry?.reportDate)
  if (!studentRefId) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return null
  const sourceLink = normalizeText(entry?.sourceLink)
  const articleTitle = normalizeText(entry?.articleTitle)
  const leadSynopsis = normalizeText(entry?.leadSynopsis)
  const actionActor = normalizeText(entry?.actionActor)
  const actionAffected = normalizeText(entry?.actionAffected)
  const actionWhere = normalizeText(entry?.actionWhere)
  const actionWhat = normalizeText(entry?.actionWhat)
  const actionWhy = normalizeText(entry?.actionWhy)
  const reviewStatus = normalizeStudentNewsReviewStatus(entry?.reviewStatus, STUDENT_NEWS_REVIEW_STATUS_SUBMITTED)
  const reviewNote = normalizeNullableText(entry?.reviewNote)
  const validationIssuesJson = normalizeValidationIssueMap(entry?.validationIssuesJson)
  const reviewedAt = parseDateOrNull(entry?.reviewedAt)?.toISOString?.() || ""
  const reviewedByUsername = normalizeNullableText(entry?.reviewedByUsername)
  const createdAt = parseDateOrNull(entry?.createdAt)?.toISOString?.() || new Date().toISOString()
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
    validationIssuesJson,
    reviewedAt,
    reviewedByUsername,
    submittedAt: parseDateOrNull(entry?.submittedAt)?.toISOString?.() || new Date().toISOString(),
    createdAt,
    updatedAt: parseDateOrNull(entry?.updatedAt)?.toISOString?.() || new Date().toISOString(),
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
    console.warn(`student news fallback read failed: ${error.message}`)
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
    reviewStatus: normalizeStudentNewsReviewStatus(payload?.reviewStatus, STUDENT_NEWS_REVIEW_STATUS_SUBMITTED),
    reviewNote: payload?.reviewNote,
    validationIssuesJson: payload?.validationIssuesJson,
    reviewedAt: payload?.reviewedAt || null,
    reviewedByUsername: payload?.reviewedByUsername || null,
  })
  assertWithStatus(Boolean(normalized), 500, "Unable to persist student news report")
  if (index >= 0) source[index] = normalized
  else source.push(normalized)
  writeStudentNewsFallbackEntries(source)
  return normalized
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
  const ids = Array.isArray(studentRefIds) ? Array.from(new Set(studentRefIds.map((entry) => normalizeText(entry)).filter(Boolean))) : []
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
    || action === "request-revision"
    || action === "request_revision"
  ) {
    return STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED
  }
  if (action === "submitted" || action === "reset") return STUDENT_NEWS_REVIEW_STATUS_SUBMITTED
  return ""
}

async function loadApprovedParentReportRowsForPoints(prisma, idFilter = {}) {
  if (!hasPrismaDelegateMethod(prisma, "parentClassReport", "findMany")) return []
  try {
    return await prisma.parentClassReport.findMany({
      where: {
        ...idFilter,
        approvedAt: { not: null },
      },
      select: {
        id: true,
        studentRefId: true,
        className: true,
        participationPointsAward: true,
        approvedAt: true,
      },
    })
  } catch (error) {
    if (
      isLegacyParentReportApprovedAtSchemaError(error)
      || isLegacyParentReportParticipationPointsSchemaError(error)
    ) {
      return []
    }
    throw error
  }
}

async function loadPointsSourceRows(prisma, studentRefIds = []) {
  const ids = Array.isArray(studentRefIds) ? studentRefIds.map((entry) => normalizeText(entry)).filter(Boolean) : []
  const idFilter = ids.length ? { studentRefId: { in: ids } } : {}
  const [gradeRecords, approvedReports, adjustments] = await Promise.all([
    findManyOrEmpty(prisma, "studentGradeRecord", {
      where: idFilter,
      select: {
        id: true,
        studentRefId: true,
        assignmentName: true,
        className: true,
        dueAt: true,
        submittedAt: true,
        homeworkCompleted: true,
        homeworkOnTime: true,
        comments: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    loadApprovedParentReportRowsForPoints(prisma, idFilter),
    findManyOrEmpty(prisma, "studentPointsAdjustment", {
      where: idFilter,
      select: {
        id: true,
        studentRefId: true,
        pointsDelta: true,
        reason: true,
        adjustedByUsername: true,
        appliedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ])
  return { gradeRecords, approvedReports, adjustments }
}

function groupStudentPointsEventsByStudentRefId(events = []) {
  const map = new Map()
  const source = Array.isArray(events) ? events : []
  source.forEach((event) => {
    const studentRefId = normalizeText(event?.studentRefId)
    if (!studentRefId) return
    if (!map.has(studentRefId)) map.set(studentRefId, [])
    map.get(studentRefId).push(event)
  })
  return map
}

export async function listStudentPointsSnapshots({
  query = "",
  level = "",
  take = 250,
  sortField = "totalPoints",
  sortDir = "desc",
} = {}) {
  const prisma = await getPrismaClient()
  const limit = Math.max(1, Math.min(Number.parseInt(String(take), 10) || 250, 1000))
  const listed = await listStudents({ query, level, take: limit })
  const students = Array.isArray(listed?.items) ? listed.items : []
  const studentRefIds = students.map((entry) => normalizeText(entry?.id)).filter(Boolean)
  if (!studentRefIds.length) {
    return {
      generatedAt: nowIso(),
      total: 0,
      sortField: normalizeStudentPointsSortField(sortField),
      sortDir: normalizeStudentPointsSortDir(sortDir),
      items: [],
    }
  }
  const sourceRows = await loadPointsSourceRows(prisma, studentRefIds)
  const events = buildStudentPointsEvents(sourceRows)
  const groupedEvents = groupStudentPointsEventsByStudentRefId(events)
  const rows = students.map((student) => {
    const studentRefId = normalizeText(student?.id)
    const studentEvents = groupedEvents.get(studentRefId) || []
    const summary = studentPointsSummaryFromEvents(studentEvents)
    return {
      studentRefId,
      studentNumber: normalizeInteger(student?.studentNumber),
      eaglesId: normalizeText(student?.eaglesId),
      fullName: studentFullName(student),
      englishName: normalizeText(student?.profile?.englishName),
      level: studentLevelName(student),
      totalPoints: summary.totalPoints,
      scheduledOnTimeCount: summary.scheduledOnTimeCount,
      electiveCount: summary.electiveCount,
      approvedReportCount: summary.approvedReportCount,
      adjustmentTotal: summary.adjustmentTotal,
      lastActivityAt: summary.lastActivityAt,
    }
  })
  const sorted = sortStudentPointsRows(rows, sortField, sortDir)
  return {
    generatedAt: nowIso(),
    total: sorted.length,
    sortField: normalizeStudentPointsSortField(sortField),
    sortDir: normalizeStudentPointsSortDir(sortDir),
    items: sorted,
  }
}

function pointsEventsWithinRange(events = [], range = {}) {
  const startValue = pointsEventDateValue(range?.start)
  const endValue = pointsEventDateValue(range?.end)
  return (Array.isArray(events) ? events : []).filter((event) => {
    const occurredValue = pointsEventDateValue(event?.occurredAt)
    if (startValue && occurredValue < startValue) return false
    if (endValue && occurredValue > endValue) return false
    return true
  })
}

export async function getSchoolPointsYtdSummary({ startDate = "", endDate = "" } = {}) {
  const prisma = await getPrismaClient()
  const range = normalizePointsRange({ startDate, endDate, now: new Date() })
  const sourceRows = await loadPointsSourceRows(prisma)
  const events = pointsEventsWithinRange(buildStudentPointsEvents(sourceRows), range)
  const dailyTotals = new Map()

  events.forEach((event) => {
    const dateKey = toLocalIsoDate(event?.occurredAt)
    if (!dateKey) return
    if (!dailyTotals.has(dateKey)) {
      dailyTotals.set(dateKey, {
        date: dateKey,
        totalPoints: 0,
        scheduledOnTimePoints: 0,
        electivePoints: 0,
        reportParticipationPoints: 0,
        adjustmentPoints: 0,
      })
    }
    const bucket = dailyTotals.get(dateKey)
    const points = normalizeInteger(event?.points) || 0
    bucket.totalPoints += points
    const type = normalizeText(event?.eventType)
    if (type === STUDENT_POINTS_EVENT_TYPE_SCHEDULED_ON_TIME) bucket.scheduledOnTimePoints += points
    if (type === STUDENT_POINTS_EVENT_TYPE_ELECTIVE) bucket.electivePoints += points
    if (type === STUDENT_POINTS_EVENT_TYPE_REPORT_PARTICIPATION) bucket.reportParticipationPoints += points
    if (type === STUDENT_POINTS_EVENT_TYPE_ADMIN_ADJUSTMENT) bucket.adjustmentPoints += points
  })

  const series = []
  let cumulative = 0
  for (let cursor = new Date(range.start); cursor.valueOf() <= range.end.valueOf(); cursor = addDays(cursor, 1)) {
    const key = toLocalIsoDate(cursor)
    const bucket = dailyTotals.get(key) || {
      date: key,
      totalPoints: 0,
      scheduledOnTimePoints: 0,
      electivePoints: 0,
      reportParticipationPoints: 0,
      adjustmentPoints: 0,
    }
    cumulative += bucket.totalPoints
    series.push({
      ...bucket,
      cumulativePoints: cumulative,
    })
  }

  return {
    generatedAt: nowIso(),
    startDate: range.startDate,
    endDate: range.endDate,
    totalPoints: cumulative,
    series,
  }
}

export async function listStudentPointsLedger(studentRefId, { take = 200, startDate = "", endDate = "" } = {}) {
  const prisma = await getPrismaClient()
  const id = normalizeText(studentRefId)
  assertWithStatus(Boolean(id), 400, "studentRefId is required")
  const student = await prisma.student.findUnique({
    where: { id },
    include: { profile: true },
  })
  assertWithStatus(Boolean(student), 404, "Student not found")

  const sourceRows = await loadPointsSourceRows(prisma, [id])
  const events = buildStudentPointsEvents(sourceRows)
  const range = normalizePointsRange({ startDate, endDate, now: new Date() })
  const filtered = pointsEventsWithinRange(events, range)
    .sort((left, right) => {
      const diff = pointsEventDateValue(right?.occurredAt) - pointsEventDateValue(left?.occurredAt)
      if (diff !== 0) return diff
      return normalizeText(left?.id).localeCompare(normalizeText(right?.id))
    })
    .slice(0, Math.max(1, Math.min(Number.parseInt(String(take), 10) || 200, 1000)))
  const summary = studentPointsSummaryFromEvents(events)

  return {
    generatedAt: nowIso(),
    startDate: range.startDate,
    endDate: range.endDate,
    student: {
      id,
      eaglesId: normalizeText(student?.eaglesId),
      studentNumber: normalizeInteger(student?.studentNumber),
      fullName: studentFullName(student),
      level: studentLevelName(student),
    },
    summary,
    total: filtered.length,
    items: filtered,
  }
}

export async function createStudentPointsAdjustment(studentRefId, payload = {}, options = {}) {
  const prisma = await getPrismaClient()
  const id = normalizeText(studentRefId)
  assertWithStatus(Boolean(id), 400, "studentRefId is required")
  const pointsDelta = normalizeInteger(payload.pointsDelta)
  assertWithStatus(Number.isFinite(pointsDelta) && pointsDelta !== 0, 400, "pointsDelta must be a non-zero integer")

  const student = await prisma.student.findUnique({
    where: { id },
    select: { id: true },
  })
  assertWithStatus(Boolean(student), 404, "Student not found")
  assertWithStatus(
    hasPrismaDelegateMethod(prisma, "studentPointsAdjustment", "create"),
    503,
    "Student points adjustments are unavailable"
  )

  const created = await prisma.studentPointsAdjustment.create({
    data: {
      studentRefId: id,
      pointsDelta,
      reason: normalizeNullableText(payload.reason),
      adjustedByUsername: normalizeNullableText(options.adjustedByUsername || payload.adjustedByUsername),
      appliedAt: normalizeDate(payload.appliedAt) || new Date(),
    },
  })
  return mapStudentPointsEventsForAdjustments([created])[0]
}

async function resolveStudentPointsTotal(prisma, studentRefId) {
  const sourceRows = await loadPointsSourceRows(prisma, [studentRefId])
  const events = buildStudentPointsEvents(sourceRows)
  return sumStudentPointsEvents(events)
}

export async function setStudentPointsTotal(studentRefId, payload = {}, options = {}) {
  const prisma = await getPrismaClient()
  const id = normalizeText(studentRefId)
  assertWithStatus(Boolean(id), 400, "studentRefId is required")
  const targetPoints = normalizeInteger(payload.targetPoints)
  assertWithStatus(Number.isFinite(targetPoints) && targetPoints >= 0, 400, "targetPoints must be a non-negative integer")

  const student = await prisma.student.findUnique({
    where: { id },
    select: { id: true },
  })
  assertWithStatus(Boolean(student), 404, "Student not found")

  const currentPoints = await resolveStudentPointsTotal(prisma, id)
  const delta = targetPoints - currentPoints
  if (delta === 0) {
    return {
      changed: false,
      studentRefId: id,
      currentPoints,
      targetPoints,
      delta,
      adjustment: null,
    }
  }
  const adjustment = await createStudentPointsAdjustment(
    id,
    {
      pointsDelta: delta,
      reason: normalizeText(payload.reason) || `Manual total override to ${targetPoints}`,
    },
    {
      adjustedByUsername: options.adjustedByUsername || payload.adjustedByUsername,
    }
  )
  return {
    changed: true,
    studentRefId: id,
    currentPoints,
    targetPoints,
    delta,
    adjustment,
  }
}

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

function normalizeStudentNewsDays(value) {
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed)) return STUDENT_NEWS_DEFAULT_DAYS
  return Math.max(7, Math.min(parsed, STUDENT_NEWS_MAX_DAYS))
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
    generatedAt: nowIso(),
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
    const currentWeekStart = startOfWeek(nowDate)
    const weeklyResubmitCutoff = new Date(currentWeekStart.getTime() + (ONE_DAY_MS * 6))
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
    generatedAt: nowIso(),
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

export async function listStudentNewsReportsForReview({
  status = STUDENT_NEWS_REVIEW_STATUS_SUBMITTED,
  level = "",
  studentRefId = "",
  dateFrom = "",
  dateTo = "",
  query = "",
  take = "200",
} = {}) {
  const prisma = await getPrismaClient()
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

  const studentByRefId = await loadStudentNewsReviewStudentMap(
    prisma,
    reportRows.map((entry) => normalizeText(entry?.studentRefId))
  )
  const mapped = reportRows.map((row) =>
    mapStudentNewsReviewItem(row, {
      studentByRefId,
    })
  )
  const filtered = mapped.filter((entry) => {
    if (
      reviewSchemaUnavailable
      && requestedStatus !== "all"
      && requestedStatus !== STUDENT_NEWS_REVIEW_STATUS_SUBMITTED
    ) {
      return false
    }
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
    generatedAt: nowIso(),
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
  const prisma = await getPrismaClient()
  const id = normalizeText(reportId)
  assertWithStatus(Boolean(id), 400, "reportId is required")
  const reviewStatus = resolveStudentNewsReviewActionStatus(payload)
  assertWithStatus(Boolean(reviewStatus), 400, "Unsupported news review action")
  assertWithStatus(
    hasPrismaDelegateMethod(prisma, "studentNewsReport", "findUnique")
    && hasPrismaDelegateMethod(prisma, "studentNewsReport", "update"),
    503,
    "Student news review persistence is unavailable"
  )

  let existingReport
  try {
    existingReport = await prisma.studentNewsReport.findUnique({
      where: { id },
      select: buildStudentNewsReviewSelect({ includeReviewFields: false }),
    })
  } catch (error) {
    if (isStudentNewsReportSchemaUnavailableError(error)) {
      assertWithStatus(false, 503, "Student news review persistence is unavailable")
    }
    if (isStudentNewsReviewSchemaUnavailableError(error)) {
      assertWithStatus(
        false,
        503,
        "Student news review fields are unavailable. Run Prisma migration and regenerate the client."
      )
    }
    throw error
  }
  assertWithStatus(Boolean(existingReport), 404, "Student news report not found")

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
  let updatedReport
  try {
    updatedReport = await prisma.studentNewsReport.update({
      where: { id },
      data: updateData,
      select: buildStudentNewsReviewSelect({ includeReviewFields: true }),
    })
  } catch (error) {
    if (isStudentNewsReportSchemaUnavailableError(error)) {
      assertWithStatus(false, 503, "Student news review persistence is unavailable")
    }
    if (isStudentNewsReviewSchemaUnavailableError(error)) {
      assertWithStatus(
        false,
        503,
        "Student news review fields are unavailable. Run Prisma migration and regenerate the client."
      )
    }
    if (normalizeText(error?.code).toUpperCase() === "P2025") {
      assertWithStatus(false, 404, "Student news report not found")
    }
    throw error
  }
  const studentByRefId = await loadStudentNewsReviewStudentMap(prisma, [normalizeText(updatedReport?.studentRefId)])
  const item = mapStudentNewsReviewItem(updatedReport, {
    studentByRefId,
  })

  return {
    generatedAt: nowIso(),
    item,
  }
}
