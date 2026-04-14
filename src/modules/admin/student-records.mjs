import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"

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

function parseDateOrNull(value) {
  const text = normalizeText(value)
  if (!text) return null
  const parsed = new Date(text)
  return Number.isNaN(parsed.valueOf()) ? null : parsed
}

function normalizeDate(value) {
  return parseDateOrNull(value)
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

function normalizePhoneDigits(value) {
  return normalizeText(value).replace(/[^0-9]/g, "")
}

function assertWithStatus(condition, status, message) {
  if (condition) return
  const error = new Error(message)
  error.statusCode = status
  throw error
}

async function getPrismaClient() {
  return getSharedPrismaClient()
}

const AUTO_IMPORTED_EXERCISE_COMMENT_PREFIX = "auto-imported exercise score"
const GRADE_RECORD_SOURCE_ASSIGNMENT = "assignment"
const GRADE_RECORD_SOURCE_MANUAL = "manual"
const GRADE_RECORD_SOURCE_AUTO_IMPORT = "auto-import"

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

export function mapGradeRecordForApi(record = {}) {
  if (!record || typeof record !== "object") return record
  return {
    ...record,
    source: inferGradeRecordSource(record),
  }
}

export { isCompletedGradeRecord, isOutstandingGradeRecord, isLateCompletedGradeRecord, isOnTimeCompletedGradeRecord, isAssignmentTrackingGradeRecord }

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
