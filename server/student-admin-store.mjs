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

function normalizeParentReportScoreMap(value = {}, requiredPrefix = "", blockedKeys = null) {
  if (!value || typeof value !== "object") return {}
  return Object.entries(value).reduce((acc, [key, rawValue]) => {
    const normalizedKey = normalizeText(key)
    if (!normalizedKey.startsWith(requiredPrefix)) return acc
    if (blockedKeys instanceof Set && blockedKeys.has(normalizedKey)) return acc
    const parsed = Number.parseFloat(String(rawValue))
    if (!Number.isFinite(parsed)) return acc
    const clamped = Math.max(0, Math.min(10, Math.round(parsed)))
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

export function encodeParentReportCommentBundle(comment = "", rubricPayload = null) {
  const normalizedComment = normalizeNullableText(comment)
  const normalizedRubricPayload = normalizeParentReportRubricPayload(rubricPayload)
  if (!normalizedRubricPayload) return normalizedComment
  const encodedPayload = Buffer.from(JSON.stringify(normalizedRubricPayload), "utf8").toString("base64url")
  if (!encodedPayload) return normalizedComment
  const marker = `[[SIS-RUBRIC-V1:${encodedPayload}]]`
  return normalizedComment ? `${normalizedComment}\n${marker}` : marker
}

export function decodeParentReportCommentBundle(value = "") {
  const rawText = normalizeText(value)
  if (!rawText) return { comment: null, rubricPayload: null }
  const markerMatch = rawText.match(PARENT_REPORT_RUBRIC_MARKER_RE)
  if (!markerMatch?.[1]) return { comment: normalizeNullableText(rawText), rubricPayload: null }

  let rubricPayload = null
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
  }
}

function mapParentClassReport(report) {
  if (!report) return report
  const decoded = decodeParentReportCommentBundle(report.comments)
  return {
    ...report,
    comments: decoded.comment,
    rubricPayload: decoded.rubricPayload,
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
    gradeRecords: Array.isArray(student.gradeRecords) ? student.gradeRecords : undefined,
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

  void asOfDate
  void enrollmentTotal

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

    return prisma.studentGradeRecord.update({
      where: { id: recordId },
      data,
    })
  }

  return prisma.studentGradeRecord.create({
    data: {
      studentRefId: studentRef,
      ...data,
    },
  })
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
    comments: encodeParentReportCommentBundle(payload.comments, normalizedRubricPayload),
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
    let compare = 0
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
  const sourceLink = normalizeHttpUrl(entry?.sourceLink)
  const articleTitle = normalizeText(entry?.articleTitle)
  const leadSynopsis = normalizeText(entry?.leadSynopsis)
  const actionActor = normalizeText(entry?.actionActor)
  const actionAffected = normalizeText(entry?.actionAffected)
  const actionWhere = normalizeText(entry?.actionWhere)
  const actionWhat = normalizeText(entry?.actionWhat)
  const actionWhy = normalizeText(entry?.actionWhy)
  if (!sourceLink || !articleTitle || !leadSynopsis || !actionActor || !actionAffected || !actionWhere || !actionWhat || !actionWhy) {
    return null
  }
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
  const normalized = normalizeStudentNewsFallbackEntry({
    ...(existing || {}),
    ...payload,
    id: normalizeText(existing?.id) || createStudentNewsFallbackId(),
    studentRefId: id,
    reportDate: dateKey,
    createdAt: normalizeText(existing?.createdAt) || now,
    updatedAt: now,
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
    reviewStatus: normalizeStudentNewsReviewStatus(row?.reviewStatus, STUDENT_NEWS_REVIEW_STATUS_SUBMITTED),
    reviewNote: normalizeText(row?.reviewNote),
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
    rows.push({
      date,
      status,
      color: status === "completed"
        ? "green"
        : status === "missed"
          ? "red"
          : "amber",
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
  let reports = []
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

  return {
    generatedAt: nowIso(),
    studentRefId: id,
    days: targetDays,
    window,
    openReport,
    calendar,
  }
}

export async function saveStudentNewsReport(studentRefId, payload = {}, { now = new Date() } = {}) {
  const prisma = await getPrismaClient()
  const id = normalizeText(studentRefId)
  assertWithStatus(Boolean(id), 400, "studentRefId is required")

  const sourceLink = normalizeHttpUrl(payload.sourceLink)
  const articleTitle = normalizeText(payload.articleTitle)
  const byline = normalizeNullableText(payload.byline)
  const articleDateline = normalizeNullableText(payload.articleDateline)
  const leadSynopsis = normalizeText(payload.leadSynopsis)
  const actionActor = normalizeText(payload.actionActor)
  const actionAffected = normalizeText(payload.actionAffected)
  const actionWhere = normalizeText(payload.actionWhere)
  const actionWhat = normalizeText(payload.actionWhat)
  const actionWhy = normalizeText(payload.actionWhy)
  const biasAssessment = normalizeNullableText(payload.biasAssessment)
  const reportDateText = normalizeText(payload.reportDate)
  assertWithStatus(Boolean(sourceLink), 400, "sourceLink must be a valid http/https URL")
  assertWithStatus(Boolean(articleTitle), 400, "articleTitle is required")
  assertWithStatus(Boolean(leadSynopsis), 400, "leadSynopsis is required")
  assertWithStatus(Boolean(actionActor), 400, "actionActor is required")
  assertWithStatus(Boolean(actionAffected), 400, "actionAffected is required")
  assertWithStatus(Boolean(actionWhere), 400, "actionWhere is required")
  assertWithStatus(Boolean(actionWhat), 400, "actionWhat is required")
  assertWithStatus(Boolean(actionWhy), 400, "actionWhy is required")
  assertWithStatus(articleTitle.length <= 240, 400, "articleTitle exceeds 240 characters")
  assertWithStatus(!byline || byline.length <= 240, 400, "byline exceeds 240 characters")
  assertWithStatus(!articleDateline || articleDateline.length <= 120, 400, "articleDateline exceeds 120 characters")
  assertWithStatus(leadSynopsis.length <= 5000, 400, "leadSynopsis exceeds 5000 characters")
  assertWithStatus(actionActor.length <= 2000, 400, "actionActor exceeds 2000 characters")
  assertWithStatus(actionAffected.length <= 2000, 400, "actionAffected exceeds 2000 characters")
  assertWithStatus(actionWhere.length <= 2000, 400, "actionWhere exceeds 2000 characters")
  assertWithStatus(actionWhat.length <= 4000, 400, "actionWhat exceeds 4000 characters")
  assertWithStatus(actionWhy.length <= 4000, 400, "actionWhy exceeds 4000 characters")
  assertWithStatus(!biasAssessment || biasAssessment.length <= 5000, 400, "biasAssessment exceeds 5000 characters")

  const window = resolveStudentNewsSubmissionWindow(now)
  assertWithStatus(Boolean(reportDateText), 400, "reportDate is required")
  assertWithStatus(reportDateText === window.reportDate, 403, "News report for this date is locked")
  const reportDate = parseLocalDateOnly(reportDateText)
  assertWithStatus(reportDate instanceof Date && !Number.isNaN(reportDate.valueOf()), 400, "Invalid reportDate")
  const submittedAt = new Date()
  const reportData = {
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
    submittedAt,
  }

  let saved = null
  if (hasPrismaDelegateMethod(prisma, "studentNewsReport", "upsert")) {
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
      if (!isStudentNewsReportSchemaUnavailableError(error)) throw error
    }
  }

  if (!saved) {
    const fallbackSaved = upsertStudentNewsReportInFallbackStore(id, reportDateText, {
      ...reportData,
      submittedAt: submittedAt.toISOString(),
    })
    saved = {
      ...fallbackSaved,
      reportDate: parseLocalDateOnly(fallbackSaved.reportDate) || fallbackSaved.reportDate,
      submittedAt: parseDateOrNull(fallbackSaved.submittedAt) || fallbackSaved.submittedAt,
    }
  }

  return {
    generatedAt: nowIso(),
    window,
    item: mapStudentNewsReportRow(saved),
  }
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
  const reviewNote = normalizeNullableText(payload?.reviewNote || payload?.note || payload?.comment)
  const reviewedByUsername = normalizeNullableText(options?.reviewedByUsername || payload?.reviewedByUsername)
  let updatedReport
  try {
    updatedReport = await prisma.studentNewsReport.update({
      where: { id },
      data: {
        reviewStatus,
        reviewNote,
        reviewedByUsername,
        reviewedAt: now,
      },
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
