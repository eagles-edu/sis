// @ts-check
import { buildAssignmentDashboardSlices, listAssignmentTemplates } from "./assignment-templates.mjs"
import {
  ENROLLMENT_STATUS_ACTIVE,
  ensureEnrollmentPeriodsBackfilled,
} from "./enrollment-periods.mjs"
import {
  isAssignmentTrackingGradeRecord,
  isCompletedGradeRecord,
  isLateCompletedGradeRecord,
  isOnTimeCompletedGradeRecord,
  isOutstandingGradeRecord,
} from "./student-records.mjs"
import { getConfiguredSchoolYear } from "./school-setup-store.mjs"
import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"

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
 * @returns {number | null}
 */
function normalizePositiveInteger(value) {
  const text = normalizeText(value)
  if (!text) return null
  const parsed = Number.parseInt(text, 10)
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
 * @param {Date} [fallback]
 * @returns {Date}
 */
function normalizeDateValue(value, fallback = new Date()) {
  const parsed = value instanceof Date ? new Date(value.getTime()) : normalizeDate(value)
  if (parsed instanceof Date && !Number.isNaN(parsed.valueOf())) return parsed
  return fallback instanceof Date ? new Date(fallback.getTime()) : new Date()
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
 * @param {unknown} [value]
 * @returns {Date}
 */
function startOfWeek(value = new Date()) {
  const date = startOfDay(value)
  const shifted = shiftToFixedTimeZone(date)
  const day = shifted.getUTCDay()
  const diffToMonday = (day + 6) % 7
  shifted.setUTCDate(shifted.getUTCDate() - diffToMonday)
  shifted.setUTCHours(0, 0, 0, 0)
  return shiftFromFixedTimeZone(shifted)
}

/**
 * @param {unknown} [value]
 * @returns {Date}
 */
function endOfWeek(value = new Date()) {
  const date = startOfWeek(value)
  return new Date(date.getTime() + (ONE_DAY_MS * 7) - 1)
}

/**
 * @param {unknown} [value]
 * @returns {Date}
 */
function startOfYear(value = new Date()) {
  const source = normalizeDateValue(value)
  const shifted = shiftToFixedTimeZone(source)
  const year = shifted.getUTCFullYear()
  return shiftFromFixedTimeZone(new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0)))
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function toLocalIsoDate(value) {
  const date = value instanceof Date ? value : normalizeDate(value)
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) return ""
  const shifted = shiftToFixedTimeZone(date)
  const year = shifted.getUTCFullYear()
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0")
  const day = String(shifted.getUTCDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

/**
 * @param {unknown} comments
 * @returns {number}
 */
function parseTardyMinutes(comments) {
  const text = normalizeLower(comments)
  if (!text) return 0
  const minuteMatch = text.match(/(\d{1,3})\s*\+?\s*(?:m|min|mins|minute|minutes)\b/)
  if (minuteMatch && minuteMatch[1]) return Number.parseInt(minuteMatch[1], 10) || 0
  const numberMatch = text.match(/\b(\d{1,3})\b/)
  if (numberMatch && numberMatch[1]) return Number.parseInt(numberMatch[1], 10) || 0
  return 0
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeOutstandingWeekCount(value) {
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

/**
 * @param {{ absences?: unknown, late30Plus?: unknown }} [options]
 * @returns {number}
 */
function normalizeAttendanceRiskScore({ absences = 0, late30Plus = 0 } = {}) {
  const normalizedAbsences = Math.max(0, Number.parseInt(String(absences), 10) || 0)
  const normalizedLate30Plus = Math.max(0, Number.parseInt(String(late30Plus), 10) || 0)
  return normalizedAbsences * 3 + normalizedLate30Plus * 2
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
  const text = normalizeText(value)
  if (!text) return ""
  const key = normalizeLevelKey(text)
  return LEVEL_ALIAS_MAP.get(key) || text
}

/**
 * @param {unknown} left
 * @param {unknown} right
 * @returns {number}
 */
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

/**
 * @param {unknown} value
 * @returns {Date | null}
 */
function parseDateOrNull(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return null
  return date
}

/**
 * @param {Record<string, unknown> | null | undefined} [student]
 * @param {string} [context]
 * @returns {{ eaglesId: string, studentNumber: number }}
 */
function assertStudentIdentityIntegrity(student = {}, context = "student") {
  const eaglesId = normalizeText(student?.eaglesId)
  const studentNumber = normalizePositiveInteger(student?.studentNumber)
  if (!eaglesId) {
    const error = new Error(`Data integrity error: eaglesId is required (${context})`)
    error.statusCode = 500
    throw error
  }
  if (!studentNumber) {
    const error = new Error(`Data integrity error: studentNumber is required (${context})`)
    error.statusCode = 500
    throw error
  }
  return {
    eaglesId,
    studentNumber,
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function toIsoDateText(value) {
  const date = value instanceof Date ? value : parseDateOrNull(value)
  if (!(date instanceof Date)) return ""
  if (Number.isNaN(date.valueOf())) return ""
  return toLocalIsoDate(date)
}

/**
 * @param {Record<string, unknown> | null | undefined} [left]
 * @param {Record<string, unknown> | null | undefined} [right]
 * @returns {number}
 */
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

/**
 * @param {unknown} targetDate
 * @param {unknown} [now]
 * @returns {number | null}
 */
function daysUntilDateFloor(targetDate, now = new Date()) {
  const dueAt = parseDateOrNull(targetDate)
  if (!(dueAt instanceof Date)) return null
  const today = startOfDay(now)
  const dueDay = startOfDay(dueAt)
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.round((dueDay.valueOf() - today.valueOf()) / msPerDay)
}

/**
 * @param {Array<{ outstandingWeek?: unknown, fullName?: unknown }>} [entries]
 * @returns {Array<{ outstandingWeek?: unknown, fullName?: unknown }>}
 */
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

/**
 * @param {Array<{ absences?: unknown, late30Plus?: unknown, fullName?: unknown }>} [entries]
 * @returns {Array<{ absences?: unknown, late30Plus?: unknown, fullName?: unknown }>}
 */
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

/**
 * @param {Array<{
 *   studentRefId?: unknown,
 *   level?: unknown,
 *   assignmentName?: unknown,
 *   dueAt?: unknown,
 *   submittedAt?: unknown,
 *   homeworkCompleted?: unknown,
 * }>} [entries]
 * @param {unknown} [now]
 * @returns {Array<{
 *   level: string,
 *   assignmentName: string,
 *   dueAt: string,
 *   students: Array<{
 *     studentRefId: string,
 *     completed: boolean,
 *     submittedAt: string,
 *   }>,
 * }>}
 */
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

/**
 * @param {{
 *   rows?: Array<{ studentRefId?: unknown, level?: unknown, status?: unknown, comments?: unknown }>,
 *   profileByStudentRefId?: Map<string, Record<string, unknown>>,
 *   totalEnrollment?: number,
 *   asOfDate?: unknown,
 * }} [options]
 * @returns {{
 *   todayAttendanceCount: number,
 *   todayAbsences: number,
 *   tardy10PlusCount: number,
 *   tardy30PlusCount: number,
 *   totalTodayTracked: number,
 *   attendanceByLevel: Map<string, number>,
 * }}
 */
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
    const unresolvedAbsences = Math.max(0, enrollmentTotal - (todayAttendanceCount + todayAbsences))
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

/**
 * @returns {Promise<{
 *   generatedAt: string,
 *   today: {
 *     date: string,
 *     totalStudents: number,
 *     totalEnrollment: number,
 *     attendancePercentOfEnrollment: number,
 *     unenrolledYtd: number,
 *     attendance: number,
 *     absences: number,
 *     tardy10PlusPercent: number,
 *     tardy30PlusPercent: number,
 *   },
 *   weeklyAssignmentCompletion: Array<{
 *     index: number,
 *     day: string,
 *     date: string,
 *     studentsWithAssignments: number,
 *     studentsCompletedAll: number,
 *   }>,
 *   classEnrollmentAttendance: Array<{
 *     level: string,
 *     enrolled: number,
 *     attendanceToday: number,
 *   }>,
 *   assignments: {
 *     total: number,
 *     completedOnTime: number,
 *     completedLate: number,
 *     outstanding: number,
 *     outstandingYtd: number,
 *     currentActiveLevels: number,
 *     currentTargetedStudents: number,
 *     currentCompletedStudents: number,
 *     currentPendingStudents: number,
 *     currentCompletionPercent: number,
 *     currentDueSoonLevels: number,
 *     currentDueSoonPendingStudents: number,
 *   },
 *   currentAssignmentMeta: unknown[],
 *   enrollmentOnlyLevels: string[],
 *   atRiskWeek: {
 *     total: number,
 *     students: unknown[],
 *   },
 *   attendanceRiskWeek: {
 *     total: number,
 *     students: unknown[],
 *   },
 *   levelCompletion: Array<{
 *     level: string,
 *     enrolledStudents: number,
 *     totalAssignments: number,
 *     completedAssignments: number,
 *     outstandingAssignments: number,
 *     completedStudents: number,
 *     completionPercent: number,
 *     assignmentName: string,
 *     dueAt: string,
 *     daysUntilDue: number | null,
 *     uncompletedStudents: unknown[],
 *   }>,
 *   parentReports: {
 *     total: number,
 *   },
 * }>}
 */
export async function getAdminDashboardSummary() {
  const prisma = await getSharedPrismaClient()
  const schoolYear = getConfiguredSchoolYear()
  if (schoolYear) {
    await ensureEnrollmentPeriodsBackfilled({ prisma, schoolYear })
  }
  const now = new Date()
  const todayStart = startOfDay(now)
  const todayEnd = endOfDay(now)
  const weekStart = startOfWeek(now)
  const weekEnd = endOfWeek(now)
  const yearStart = startOfYear(now)
  const weekDayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  const msPerDay = 24 * 60 * 60 * 1000

  const [
    activeEnrollmentPeriods,
    todayAttendance,
    weekAttendance,
    allGradeRecords,
    parentReportTotal,
  ] = await Promise.all([
    schoolYear
      ? prisma.studentEnrollmentPeriod.findMany({
          where: {
            schoolYear,
            status: ENROLLMENT_STATUS_ACTIVE,
            endedAt: null,
          },
          select: {
            id: true,
            studentRefId: true,
            level: true,
            student: {
              select: {
                eaglesId: true,
                studentNumber: true,
                email: true,
                profile: {
                  select: {
                    fullName: true,
                    currentGrade: true,
                    studentEmail: true,
                    motherEmail: true,
                    fatherEmail: true,
                  },
                },
              },
            },
          },
        })
      : prisma.studentProfile.findMany({
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
        ...(schoolYear ? { schoolYear, enrollmentPeriod: { is: { schoolYear, status: ENROLLMENT_STATUS_ACTIVE } } } : {}),
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
        ...(schoolYear ? { schoolYear, enrollmentPeriod: { is: { schoolYear, status: ENROLLMENT_STATUS_ACTIVE } } } : {}),
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
      where: schoolYear ? { schoolYear, enrollmentPeriod: { is: { schoolYear, status: ENROLLMENT_STATUS_ACTIVE } } } : {},
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
    prisma.parentClassReport.count({
      where: schoolYear ? { schoolYear, enrollmentPeriod: { is: { schoolYear, status: ENROLLMENT_STATUS_ACTIVE } } } : {},
    }),
  ])

  const profileByStudentRefId = new Map()
  const enrolledByLevel = new Map()
  let totalEnrollment = 0
  const enrolledProfiles = activeEnrollmentPeriods.map((entry) => {
    if (entry?.student?.profile) {
      return {
        studentRefId: entry.studentRefId,
        fullName: entry.student.profile.fullName,
        currentGrade: entry.level || entry.student.profile.currentGrade,
        studentEmail: entry.student.profile.studentEmail,
        motherEmail: entry.student.profile.motherEmail,
        fatherEmail: entry.student.profile.fatherEmail,
        student: {
          eaglesId: entry.student.eaglesId,
          studentNumber: entry.student.studentNumber,
          email: entry.student.email,
        },
      }
    }
    return entry
  })
  enrolledProfiles.forEach((profile) => {
    const canonicalLevel = canonicalizeLevel(profile.currentGrade || profile.level || "")
    if (canonicalLevel) totalEnrollment += 1
    const level = canonicalLevel || "Unassigned"
    const current = enrolledByLevel.get(level) || 0
    enrolledByLevel.set(level, current + 1)
    profileByStudentRefId.set(profile.studentRefId, profile)
  })
  const unenrolledYtd = 0

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
  const classEnrollmentAttendance = levels.map((level) => ({
    level,
    enrolled: enrolledByLevel.get(level) || 0,
    attendanceToday: attendanceByLevel.get(level) || 0,
  }))
  let assignmentTemplates = []
  try {
    assignmentTemplates = await listAssignmentTemplates({ take: 1000 })
  } catch (error) {
    void error
  }
  const { currentAssignmentMeta, enrollmentOnlyLevels } = buildAssignmentDashboardSlices({
    assignmentTemplates,
    classEnrollmentAttendance,
    now,
  })

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
    classEnrollmentAttendance,
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
    currentAssignmentMeta,
    enrollmentOnlyLevels,
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
