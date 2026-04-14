// src/modules/admin/points.mjs

import {
  isLegacyParentReportApprovedAtSchemaError,
  isLegacyParentReportParticipationPointsSchemaError,
  normalizeReportParticipationPoints,
} from "./parent-reports.mjs"
import { listStudents } from "./student-roster.mjs"
import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase()
}

function normalizeInteger(value) {
  const text = normalizeText(value)
  if (!text) return null
  const parsed = Number.parseInt(text, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeNullableText(value) {
  const text = normalizeText(value)
  return text || null
}

function normalizeDate(value) {
  const text = normalizeText(value)
  if (!text) return null
  const parsed = new Date(text)
  if (Number.isNaN(parsed.valueOf())) return null
  return parsed
}

function parseDateOrNull(value) {
  if (value instanceof Date) return Number.isNaN(value.valueOf()) ? null : value
  return normalizeDate(value)
}

function assertWithStatus(condition, status, message) {
  if (condition) return true
  const error = new Error(message)
  error.statusCode = status
  throw error
}

function nowIso() {
  return new Date().toISOString()
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

function toLocalIsoDate(value) {
  const date = value instanceof Date ? value : parseDateOrNull(value)
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) return ""
  const shifted = shiftToFixedTimeZone(date)
  const year = shifted.getUTCFullYear()
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0")
  const day = String(shifted.getUTCDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function pointsEventDateValue(dateValue) {
  const parsed = parseDateOrNull(dateValue)
  return parsed instanceof Date ? parsed.valueOf() : 0
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

export const STUDENT_POINTS_SCHEDULED_ON_TIME_VALUE = 10
export const STUDENT_POINTS_ELECTIVE_SUBMISSION_VALUE = 21
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

const AUTO_IMPORTED_EXERCISE_COMMENT_PREFIX = "auto-imported exercise score"

function isCompletedGradeRecord(record) {
  if (record?.homeworkCompleted === true) return true
  if (record?.submittedAt) return true
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

function hasPrismaDelegateMethod(prisma, delegateName, methodName) {
  return Boolean(prisma?.[delegateName] && typeof prisma[delegateName][methodName] === "function")
}

function findManyOrEmpty(prisma, delegateName, query) {
  if (!hasPrismaDelegateMethod(prisma, delegateName, "findMany")) return Promise.resolve([])
  return prisma[delegateName].findMany(query)
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

async function resolveStudentPointsTotal(prisma, studentRefId) {
  const sourceRows = await loadPointsSourceRows(prisma, [studentRefId])
  const events = buildStudentPointsEvents(sourceRows)
  return sumStudentPointsEvents(events)
}

export async function listStudentPointsSnapshots({
  query = "",
  level = "",
  take = 250,
  sortField = "totalPoints",
  sortDir = "desc",
} = {}) {
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
  const prisma = await getSharedPrismaClient()
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

export async function getSchoolPointsYtdSummary({ startDate = "", endDate = "" } = {}) {
  const prisma = await getSharedPrismaClient()
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
  const prisma = await getSharedPrismaClient()
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
  const prisma = await getSharedPrismaClient()
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

export async function setStudentPointsTotal(studentRefId, payload = {}, options = {}) {
  const prisma = await getSharedPrismaClient()
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
