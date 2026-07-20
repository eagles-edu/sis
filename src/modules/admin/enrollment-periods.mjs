// @ts-check

import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import {
  getConfiguredSchoolYear,
  getConfiguredSchoolYearStartDate,
} from "./school-setup-store.mjs"
import {
  canonicalizeLevel as canonicalizeCatalogLevel,
  resolveLevelVariants as resolveCatalogLevelVariants,
} from "./level-catalog.mjs"

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

function assertWithStatus(condition, status, message) {
  if (condition) return
  const error = new Error(message)
  error.statusCode = status
  throw error
}

function normalizeDate(value, fallback = null) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return new Date(value.getTime())
  const text = normalizeText(value)
  if (!text) return fallback
  const parsed = new Date(text)
  return Number.isNaN(parsed.valueOf()) ? fallback : parsed
}

function resolveBackfillStartedAt(fallback = new Date()) {
  const fallbackDate = normalizeDate(fallback, new Date()) || new Date()
  const configured = getConfiguredSchoolYearStartDate({ fallback: fallbackDate })
  const configuredDate = normalizeDate(configured, fallbackDate) || fallbackDate
  if (configuredDate.valueOf() > fallbackDate.valueOf()) return fallbackDate
  return configuredDate
}

function normalizeLevelKey(value) {
  return normalizeLower(value).replace(/[^a-z0-9]/g, "")
}

function normalizeKnownLevelAnomalyKey(value) {
  const key = normalizeLevelKey(value)
  if (key === "eggchicks") return "eggschicks"
  return key
}

const LEVEL_DEFINITIONS = [
  {
    canonical: "Eggs & Chicks",
    aliases: ["EggChic", "Eggs and Chicks", "Eggs Chicks"],
  },
  { canonical: "Pre-A1 Starters", aliases: ["Starters", "Pre A1 Starters"] },
  { canonical: "A1 Movers", aliases: ["Movers"] },
  { canonical: "A2 Flyers", aliases: ["Flyers"] },
  { canonical: "A2 KET", aliases: ["KET"] },
  { canonical: "B1 PET", aliases: ["PET"] },
  { canonical: "B2+ IELTS", aliases: ["IELTS", "B2 IELTS"] },
  { canonical: "C1+ TAYK", aliases: ["TAYK", "C1 TAYK"] },
  { canonical: "Private", aliases: ["Private Class", "1:1 Private"] },
]

const LEVEL_ALIAS_MAP = (() => {
  const map = new Map()
  LEVEL_DEFINITIONS.forEach((entry) => {
    ;[entry.canonical, ...(entry.aliases || [])].forEach((variant) => {
      const key = normalizeLevelKey(variant)
      if (key) map.set(key, entry.canonical)
    })
  })
  return map
})()

export const ENROLLMENT_STATUS_ACTIVE = "active"
export const ENROLLMENT_STATUS_UNENROLLED = "unenrolled"
export const ENROLLMENT_LEVEL_FILTER_UNENROLLED_ONLY = "__UNENROLLED_ONLY__"
export const STUDENT_UNENROLLMENT_REASONS = Object.freeze([
  "moved_residence",
  "changed_esl_center",
  "financial",
  "with_prejudice",
  "distance_traffic",
  "stopped_learning_esl",
  "changed_languages",
  "pre_high_school_exam_tutoring",
  "pre_college_exam_tutoring",
  "unknown",
])

function canonicalizeLevel(value) {
  return canonicalizeCatalogLevel(value)
}

function resolveLevelVariants(value) {
  return resolveCatalogLevelVariants(value)
}

function normalizeEnrollmentStatus(value, fallback = ENROLLMENT_STATUS_ACTIVE) {
  const text = normalizeLower(value)
  if (text === ENROLLMENT_STATUS_ACTIVE) return ENROLLMENT_STATUS_ACTIVE
  if (text === ENROLLMENT_STATUS_UNENROLLED) return ENROLLMENT_STATUS_UNENROLLED
  return fallback
}

function normalizeUnenrollmentReason(value) {
  const text = normalizeLower(value)
  return STUDENT_UNENROLLMENT_REASONS.includes(text) ? text : null
}

function mapEnrollmentPeriod(period = {}) {
  return {
    id: normalizeText(period?.id),
    studentRefId: normalizeText(period?.studentRefId),
    schoolYear: normalizeText(period?.schoolYear),
    level: normalizeText(period?.level),
    status: normalizeEnrollmentStatus(period?.status),
    startedAt: normalizeDate(period?.startedAt)?.toISOString?.() || "",
    endedAt: normalizeDate(period?.endedAt)?.toISOString?.() || "",
    unenrollmentReason: normalizeText(period?.unenrollmentReason),
    comment: normalizeText(period?.comment),
    promotedFromPeriodId: normalizeText(period?.promotedFromPeriodId),
    createdBy: normalizeText(period?.createdBy),
    updatedBy: normalizeText(period?.updatedBy),
    createdAt: normalizeDate(period?.createdAt)?.toISOString?.() || "",
    updatedAt: normalizeDate(period?.updatedAt)?.toISOString?.() || "",
  }
}

function buildEnrollmentProfileCreateData(studentRefId, currentGrade) {
  return {
    studentRefId,
    sourceFormId: "enrollment-admin",
    currentGrade,
    genderSelections: [],
    languagesAtHome: [],
    learningDisorders: [],
    covidShotHistory: [],
    feverMedicineAllowed: [],
  }
}

function sortEnrollmentPeriods(periods = []) {
  return [...(Array.isArray(periods) ? periods : [])].sort((left, right) => {
    const leftStart = normalizeDate(left?.startedAt)?.valueOf() || 0
    const rightStart = normalizeDate(right?.startedAt)?.valueOf() || 0
    if (leftStart !== rightStart) return rightStart - leftStart
    const leftCreated = normalizeDate(left?.createdAt)?.valueOf() || 0
    const rightCreated = normalizeDate(right?.createdAt)?.valueOf() || 0
    return rightCreated - leftCreated
  })
}

function resolveCurrentEnrollmentPeriod(periods = [], schoolYear = "") {
  const sorted = sortEnrollmentPeriods(periods).filter((entry) => normalizeText(entry?.schoolYear) === normalizeText(schoolYear))
  return sorted[0] || null
}

function resolveActiveEnrollmentPeriod(periods = [], schoolYear = "") {
  const sorted = sortEnrollmentPeriods(periods).filter((entry) => normalizeText(entry?.schoolYear) === normalizeText(schoolYear))
  return (
    sorted.find(
      (entry) =>
        normalizeEnrollmentStatus(entry?.status) === ENROLLMENT_STATUS_ACTIVE && !normalizeDate(entry?.endedAt)
    ) || null
  )
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

function studentSearchComparable(student = {}) {
  const profile = student?.profile || {}
  const currentEnrollment = student?.currentEnrollment || {}
  return [
    student?.eaglesId,
    student?.email,
    profile?.fullName,
    profile?.englishName,
    profile?.motherName,
    profile?.fatherName,
    profile?.schoolName,
    currentEnrollment?.level,
    profile?.currentGrade,
  ]
    .map((entry) => normalizeSearchComparable(entry))
    .filter(Boolean)
    .join(" ")
}

function studentMatchesSearch(student = {}, query = "") {
  const needle = normalizeSearchComparable(query)
  if (!needle) return true
  return studentSearchComparable(student).includes(needle)
}

function mapEnrollmentStudent(student = {}, schoolYear = "") {
  const periods = sortEnrollmentPeriods(student?.enrollmentPeriods || [])
  const currentEnrollment = resolveCurrentEnrollmentPeriod(periods, schoolYear)
  return {
    id: normalizeText(student?.id),
    eaglesId: normalizeText(student?.eaglesId),
    studentNumber: Number.parseInt(String(student?.studentNumber || ""), 10) || null,
    email: normalizeText(student?.email),
    profile: student?.profile || null,
    currentEnrollment: currentEnrollment ? mapEnrollmentPeriod(currentEnrollment) : null,
    enrollmentPeriods: periods.map((entry) => mapEnrollmentPeriod(entry)),
  }
}

function selectEnrollmentPeriodIdForRows(rows = [], selectedEnrollmentPeriodId = "", currentEnrollmentPeriodId = "") {
  const selectedId = normalizeText(selectedEnrollmentPeriodId)
  if (selectedId) return selectedId
  const currentId = normalizeText(currentEnrollmentPeriodId)
  if (currentId) return currentId
  const rowIds = new Set(
    (Array.isArray(rows) ? rows : [])
      .map((entry) => normalizeText(entry?.enrollmentPeriodId))
      .filter(Boolean)
  )
  if (rowIds.size === 1) return [...rowIds][0]
  return ""
}

function filterRowsByEnrollmentPeriod(rows = [], enrollmentPeriodId = "") {
  const selectedId = normalizeText(enrollmentPeriodId)
  if (!selectedId) return Array.isArray(rows) ? rows : []
  return (Array.isArray(rows) ? rows : []).filter(
    (entry) => normalizeText(entry?.enrollmentPeriodId) === selectedId
  )
}

async function getPrismaClient() {
  return getSharedPrismaClient()
}

export async function ensureEnrollmentPeriodsBackfilled({
  prisma = null,
  schoolYear = "",
  updatedByUsername = "",
  studentRefId = "",
} = {}) {
  const client = prisma || (await getPrismaClient())
  const targetSchoolYear = normalizeText(schoolYear) || getConfiguredSchoolYear({ required: true })
  const startedAt = resolveBackfillStartedAt(new Date())
  const where = studentRefId ? { id: normalizeText(studentRefId) } : {}
  const students = await client.student.findMany({
    where,
    select: {
      id: true,
      profile: {
        select: {
          currentGrade: true,
        },
      },
      enrollmentPeriods: {
        where: { schoolYear: targetSchoolYear },
        select: {
          id: true,
        },
        take: 1,
      },
    },
  })

  for (let index = 0; index < students.length; index += 1) {
    const student = students[index]
    if (Array.isArray(student?.enrollmentPeriods) && student.enrollmentPeriods.length) continue
    const level = normalizeNullableText(canonicalizeLevel(student?.profile?.currentGrade))
    if (!level) continue
    await client.studentEnrollmentPeriod.create({
      data: {
        studentRefId: student.id,
        schoolYear: targetSchoolYear,
        level,
        status: ENROLLMENT_STATUS_ACTIVE,
        startedAt,
        createdBy: normalizeNullableText(updatedByUsername),
        updatedBy: normalizeNullableText(updatedByUsername),
      },
    })
  }
}

export async function resolveEnrollmentPeriodForStudent(
  prisma,
  studentRefId,
  { schoolYear = "", createIfMissing = true, levelHint = "", updatedByUsername = "" } = {}
) {
  const client = prisma || (await getPrismaClient())
  const targetStudentId = normalizeText(studentRefId)
  assertWithStatus(Boolean(targetStudentId), 400, "studentRefId is required")
  const targetSchoolYear = normalizeText(schoolYear) || getConfiguredSchoolYear({ required: true })

  const existing = await client.studentEnrollmentPeriod.findFirst({
    where: {
      studentRefId: targetStudentId,
      schoolYear: targetSchoolYear,
      status: ENROLLMENT_STATUS_ACTIVE,
      endedAt: null,
    },
    orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
  })
  if (existing) return existing
  if (!createIfMissing) return null

  const student = await client.student.findUnique({
    where: { id: targetStudentId },
    select: {
      id: true,
      profile: {
        select: {
          currentGrade: true,
        },
      },
    },
  })
  assertWithStatus(Boolean(student), 404, "Student not found")
  const level = normalizeNullableText(canonicalizeLevel(levelHint || student?.profile?.currentGrade))
  const created = await client.studentEnrollmentPeriod.create({
    data: {
      studentRefId: targetStudentId,
      schoolYear: targetSchoolYear,
      level,
      status: ENROLLMENT_STATUS_ACTIVE,
      startedAt: resolveBackfillStartedAt(new Date()),
      createdBy: normalizeNullableText(updatedByUsername),
      updatedBy: normalizeNullableText(updatedByUsername),
    },
  })
  return created
}

export async function backfillEnrollmentPeriodLinks({
  prisma = null,
  schoolYear = "",
  updatedByUsername = "",
} = {}) {
  const client = prisma || (await getPrismaClient())
  const targetSchoolYear = normalizeText(schoolYear) || getConfiguredSchoolYear({ required: true })
  await ensureEnrollmentPeriodsBackfilled({
    prisma: client,
    schoolYear: targetSchoolYear,
    updatedByUsername,
  })

  const periods = await client.studentEnrollmentPeriod.findMany({
    where: { schoolYear: targetSchoolYear },
    select: {
      id: true,
      studentRefId: true,
      level: true,
      status: true,
      startedAt: true,
      createdAt: true,
      endedAt: true,
    },
  })
  const byStudent = new Map()
  periods.forEach((period) => {
    const key = normalizeText(period.studentRefId)
    if (!key) return
    if (!byStudent.has(key)) byStudent.set(key, [])
    byStudent.get(key).push(period)
  })

  const resolveBestPeriodId = (studentRefId, level = "") => {
    const options = sortEnrollmentPeriods(byStudent.get(normalizeText(studentRefId)) || [])
    if (!options.length) return ""
    const canonicalLevel = canonicalizeLevel(level)
    if (canonicalLevel) {
      const levelMatch = options.find(
        (entry) => normalizeLower(canonicalizeLevel(entry?.level)) === normalizeLower(canonicalLevel)
      )
      if (levelMatch) return normalizeText(levelMatch.id)
    }
    const active = options.find(
      (entry) =>
        normalizeEnrollmentStatus(entry?.status) === ENROLLMENT_STATUS_ACTIVE && !normalizeDate(entry?.endedAt)
    )
    return normalizeText(active?.id || options[0]?.id)
  }

  const attendanceRows = await client.studentAttendance.findMany({
    where: {
      schoolYear: targetSchoolYear,
      enrollmentPeriodId: null,
    },
    select: { id: true, studentRefId: true, level: true },
  })
  for (let index = 0; index < attendanceRows.length; index += 1) {
    const row = attendanceRows[index]
    const enrollmentPeriodId = resolveBestPeriodId(row.studentRefId, row.level)
    if (!enrollmentPeriodId) continue
    await client.studentAttendance.update({
      where: { id: row.id },
      data: { enrollmentPeriodId },
    })
  }

  const gradeRows = await client.studentGradeRecord.findMany({
    where: {
      schoolYear: targetSchoolYear,
      enrollmentPeriodId: null,
    },
    select: { id: true, studentRefId: true, level: true },
  })
  for (let index = 0; index < gradeRows.length; index += 1) {
    const row = gradeRows[index]
    const enrollmentPeriodId = resolveBestPeriodId(row.studentRefId, row.level)
    if (!enrollmentPeriodId) continue
    await client.studentGradeRecord.update({
      where: { id: row.id },
      data: { enrollmentPeriodId },
    })
  }

  const reportRows = await client.parentClassReport.findMany({
    where: {
      schoolYear: targetSchoolYear,
      enrollmentPeriodId: null,
    },
    select: { id: true, studentRefId: true, level: true },
  })
  for (let index = 0; index < reportRows.length; index += 1) {
    const row = reportRows[index]
    const enrollmentPeriodId = resolveBestPeriodId(row.studentRefId, row.level)
    if (!enrollmentPeriodId) continue
    await client.parentClassReport.update({
      where: { id: row.id },
      data: { enrollmentPeriodId },
    })
  }

  const newsRows = await client.studentNewsReport.findMany({
    where: { enrollmentPeriodId: null },
    select: { id: true, studentRefId: true },
  })
  for (let index = 0; index < newsRows.length; index += 1) {
    const row = newsRows[index]
    const enrollmentPeriodId = resolveBestPeriodId(row.studentRefId)
    if (!enrollmentPeriodId) continue
    await client.studentNewsReport.update({
      where: { id: row.id },
      data: { enrollmentPeriodId },
    })
  }
}

export async function normalizeEnrollmentPeriodLevels({
  prisma = null,
  schoolYear = "",
  updatedByUsername = "",
} = {}) {
  const client = prisma || (await getPrismaClient())
  const targetSchoolYear = normalizeText(schoolYear) || getConfiguredSchoolYear({ required: true })
  const actor = normalizeNullableText(updatedByUsername)
  let enrollmentPeriodsUpdated = 0
  let studentProfilesUpdated = 0
  let attendanceRowsUpdated = 0
  let gradeRowsUpdated = 0
  let parentReportsUpdated = 0
  let enrollmentTimelineUpdated = 0

  const enrollmentPeriods = await client.studentEnrollmentPeriod.findMany({
    where: { schoolYear: targetSchoolYear },
    select: {
      id: true,
      level: true,
      startedAt: true,
      createdAt: true,
      promotedFromPeriodId: true,
    },
  })
  for (let index = 0; index < enrollmentPeriods.length; index += 1) {
    const row = enrollmentPeriods[index]
    const currentLevel = normalizeNullableText(row?.level)
    const canonicalLevel = normalizeNullableText(canonicalizeLevel(currentLevel))
    const startedAt = normalizeDate(row?.startedAt)
    const createdAt = normalizeDate(row?.createdAt)
    const hasFutureBackfillStart =
      !normalizeText(row?.promotedFromPeriodId) &&
      Boolean(startedAt && createdAt) &&
      startedAt.valueOf() > createdAt.valueOf()
    if (currentLevel === canonicalLevel && !hasFutureBackfillStart) continue
    const data = {
      updatedBy: actor,
    }
    if (currentLevel !== canonicalLevel) {
      data.level = canonicalLevel
      enrollmentPeriodsUpdated += 1
    }
    if (hasFutureBackfillStart && createdAt) {
      data.startedAt = createdAt
      enrollmentTimelineUpdated += 1
    }
    await client.studentEnrollmentPeriod.update({
      where: { id: row.id },
      data,
    })
  }

  const profiles = await client.studentProfile.findMany({
    where: {
      currentGrade: {
        not: null,
      },
      student: {
        enrollmentPeriods: {
          some: {
            schoolYear: targetSchoolYear,
          },
        },
      },
    },
    select: {
      studentRefId: true,
      currentGrade: true,
    },
  })
  for (let index = 0; index < profiles.length; index += 1) {
    const row = profiles[index]
    const currentGrade = normalizeNullableText(row?.currentGrade)
    const canonicalLevel = normalizeNullableText(canonicalizeLevel(currentGrade))
    if (currentGrade === canonicalLevel) continue
    await client.studentProfile.update({
      where: { studentRefId: row.studentRefId },
      data: { currentGrade: canonicalLevel },
    })
    studentProfilesUpdated += 1
  }

  const attendanceRows = await client.studentAttendance.findMany({
    where: {
      schoolYear: targetSchoolYear,
      level: {
        not: null,
      },
    },
    select: {
      id: true,
      level: true,
    },
  })
  for (let index = 0; index < attendanceRows.length; index += 1) {
    const row = attendanceRows[index]
    const currentLevel = normalizeNullableText(row?.level)
    const canonicalLevel = normalizeNullableText(canonicalizeLevel(currentLevel))
    if (currentLevel === canonicalLevel) continue
    await client.studentAttendance.update({
      where: { id: row.id },
      data: { level: canonicalLevel },
    })
    attendanceRowsUpdated += 1
  }

  const gradeRows = await client.studentGradeRecord.findMany({
    where: {
      schoolYear: targetSchoolYear,
      level: {
        not: null,
      },
    },
    select: {
      id: true,
      level: true,
    },
  })
  for (let index = 0; index < gradeRows.length; index += 1) {
    const row = gradeRows[index]
    const currentLevel = normalizeNullableText(row?.level)
    const canonicalLevel = normalizeNullableText(canonicalizeLevel(currentLevel))
    if (currentLevel === canonicalLevel) continue
    await client.studentGradeRecord.update({
      where: { id: row.id },
      data: { level: canonicalLevel },
    })
    gradeRowsUpdated += 1
  }

  const parentReports = await client.parentClassReport.findMany({
    where: {
      schoolYear: targetSchoolYear,
      level: {
        not: null,
      },
    },
    select: {
      id: true,
      level: true,
    },
  })
  for (let index = 0; index < parentReports.length; index += 1) {
    const row = parentReports[index]
    const currentLevel = normalizeNullableText(row?.level)
    const canonicalLevel = normalizeNullableText(canonicalizeLevel(currentLevel))
    if (currentLevel === canonicalLevel) continue
    await client.parentClassReport.update({
      where: { id: row.id },
      data: { level: canonicalLevel },
    })
    parentReportsUpdated += 1
  }

  return {
    schoolYear: targetSchoolYear,
    enrollmentPeriodsUpdated,
    studentProfilesUpdated,
    attendanceRowsUpdated,
    gradeRowsUpdated,
    parentReportsUpdated,
    enrollmentTimelineUpdated,
  }
}

export async function listEnrollmentRoster({
  query = "",
  level = "",
  includeUnenrolled = false,
  take = 250,
  schoolYear = "",
} = {}) {
  const prisma = await getPrismaClient()
  const targetSchoolYear = normalizeText(schoolYear) || getConfiguredSchoolYear()
  if (targetSchoolYear) {
    await ensureEnrollmentPeriodsBackfilled({ prisma, schoolYear: targetSchoolYear })
  }

  const limit = Math.max(1, Math.min(Number.parseInt(String(take), 10) || 250, 1000))
  const levelFilter = normalizeText(level)
  const levelVariants = resolveLevelVariants(levelFilter)
  const rows = await prisma.student.findMany({
    include: {
      profile: true,
      enrollmentPeriods: targetSchoolYear
        ? {
            where: { schoolYear: targetSchoolYear },
            orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
          }
        : {
            orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
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
    orderBy: [{ profile: { fullName: "asc" } }, { eaglesId: "asc" }],
    take: Math.max(limit, 1000),
  })

  const filtered = rows
    .map((entry) => mapEnrollmentStudent(entry, targetSchoolYear))
    .filter((entry) => studentMatchesSearch(entry, query))
    .filter((entry) => {
      const currentEnrollment = entry.currentEnrollment
      if (!currentEnrollment) return Boolean(includeUnenrolled)
      if (levelFilter === ENROLLMENT_LEVEL_FILTER_UNENROLLED_ONLY) {
        return currentEnrollment.status === ENROLLMENT_STATUS_UNENROLLED
      }
      if (levelVariants.length) {
        const entryLevel = canonicalizeLevel(currentEnrollment.level)
        if (!levelVariants.some((variant) => normalizeLower(canonicalizeLevel(variant)) === normalizeLower(entryLevel))) {
          return false
        }
      }
      if (currentEnrollment.status === ENROLLMENT_STATUS_UNENROLLED) return Boolean(includeUnenrolled)
      return currentEnrollment.status === ENROLLMENT_STATUS_ACTIVE
    })

  return {
    schoolYear: targetSchoolYear,
    total: filtered.length,
    items: filtered.slice(0, limit),
  }
}

export async function getStudentEnrollmentDetail(studentRefId, { schoolYear = "" } = {}) {
  const prisma = await getPrismaClient()
  const targetStudentId = normalizeText(studentRefId)
  assertWithStatus(Boolean(targetStudentId), 400, "studentRefId is required")
  const targetSchoolYear = normalizeText(schoolYear) || getConfiguredSchoolYear()
  if (targetSchoolYear) {
    await ensureEnrollmentPeriodsBackfilled({ prisma, schoolYear: targetSchoolYear, studentRefId: targetStudentId })
  }
  const student = await prisma.student.findUnique({
    where: { id: targetStudentId },
    include: {
      profile: true,
      enrollmentPeriods: targetSchoolYear
        ? {
            where: { schoolYear: targetSchoolYear },
            orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
          }
        : {
            orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
          },
    },
  })
  assertWithStatus(Boolean(student), 404, "Student not found")
  const mapped = mapEnrollmentStudent(student, targetSchoolYear)
  return {
    schoolYear: targetSchoolYear,
    student: mapped,
    currentEnrollment: mapped.currentEnrollment,
    enrollmentPeriods: mapped.enrollmentPeriods,
  }
}

export async function changeStudentEnrollment(
  studentRefId,
  payload = {},
  { updatedByUsername = "" } = {}
) {
  const prisma = await getPrismaClient()
  const targetStudentId = normalizeText(studentRefId)
  assertWithStatus(Boolean(targetStudentId), 400, "studentRefId is required")
  const action = normalizeLower(payload?.action)
  const targetSchoolYear = normalizeText(payload?.schoolYear) || getConfiguredSchoolYear({ required: true })
  assertWithStatus(Boolean(action), 400, "action is required")

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id
      FROM "Student"
      WHERE id = ${targetStudentId}
      FOR UPDATE
    `

    await ensureEnrollmentPeriodsBackfilled({
      prisma: tx,
      schoolYear: targetSchoolYear,
      updatedByUsername,
      studentRefId: targetStudentId,
    })

    const student = await tx.student.findUnique({
      where: { id: targetStudentId },
      include: {
        profile: true,
        enrollmentPeriods: {
          where: { schoolYear: targetSchoolYear },
          orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
        },
      },
    })
    assertWithStatus(Boolean(student), 404, "Student not found")

    const currentPeriod = resolveCurrentEnrollmentPeriod(student.enrollmentPeriods || [], targetSchoolYear)
    const activePeriod = resolveActiveEnrollmentPeriod(student.enrollmentPeriods || [], targetSchoolYear)
    assertWithStatus(Boolean(currentPeriod), 409, "Student has no enrollment period for the current school year")
    const now = normalizeDate(payload?.effectiveAt, new Date()) || new Date()
    const nextLevel = canonicalizeLevel(payload?.level || payload?.nextLevel)
    const comment = normalizeNullableText(payload?.comment)
    const actor = normalizeNullableText(updatedByUsername)
    const sourcePeriod = activePeriod || currentPeriod

    if (action === "promote" || action === "change-level" || action === "set-level") {
      assertWithStatus(Boolean(nextLevel), 400, "level is required")
      const currentLevel = normalizeLower(canonicalizeLevel(currentPeriod.level))
      const nextLevelToken = normalizeLower(canonicalizeLevel(nextLevel))
      if (
        normalizeEnrollmentStatus(currentPeriod.status) === ENROLLMENT_STATUS_ACTIVE &&
        !normalizeDate(currentPeriod.endedAt) &&
        currentLevel === nextLevelToken
      ) {
        return {
          ok: true,
          action: "noop",
          currentEnrollment: mapEnrollmentPeriod(currentPeriod),
        }
      }

      if (activePeriod) {
        await tx.studentEnrollmentPeriod.update({
          where: { id: activePeriod.id },
          data: {
            endedAt: now,
            updatedBy: actor,
            status: normalizeEnrollmentStatus(activePeriod.status),
          },
        })
      }

      const created = await tx.studentEnrollmentPeriod.create({
        data: {
          studentRefId: targetStudentId,
          schoolYear: targetSchoolYear,
          level: nextLevel,
          status: ENROLLMENT_STATUS_ACTIVE,
          startedAt: now,
          promotedFromPeriodId: normalizeText(sourcePeriod?.id) || null,
          comment,
          createdBy: actor,
          updatedBy: actor,
        },
      })

      await tx.studentProfile.upsert({
        where: { studentRefId: targetStudentId },
        update: { currentGrade: nextLevel },
        create: buildEnrollmentProfileCreateData(targetStudentId, nextLevel),
      })

      return {
        ok: true,
        action,
        currentEnrollment: mapEnrollmentPeriod(created),
      }
    }

    if (action === "unenroll") {
      const reason = normalizeUnenrollmentReason(payload?.unenrollmentReason)
      assertWithStatus(Boolean(reason), 400, "unenrollmentReason is required")
      const levelForArchive = normalizeNullableText(
        canonicalizeLevel(sourcePeriod?.level || student?.profile?.currentGrade)
      )

      if (normalizeEnrollmentStatus(currentPeriod.status) === ENROLLMENT_STATUS_UNENROLLED && !activePeriod) {
        return {
          ok: true,
          action: "noop",
          currentEnrollment: mapEnrollmentPeriod(currentPeriod),
        }
      }

      if (activePeriod) {
        await tx.studentEnrollmentPeriod.update({
          where: { id: activePeriod.id },
          data: {
            endedAt: now,
            updatedBy: actor,
          },
        })
      }

      const unenrolled = await tx.studentEnrollmentPeriod.create({
        data: {
          studentRefId: targetStudentId,
          schoolYear: targetSchoolYear,
          level: levelForArchive,
          status: ENROLLMENT_STATUS_UNENROLLED,
          startedAt: now,
          endedAt: now,
          unenrollmentReason: reason,
          comment,
          promotedFromPeriodId: normalizeText(sourcePeriod?.id) || null,
          createdBy: actor,
          updatedBy: actor,
        },
      })

      await tx.studentProfile.upsert({
        where: { studentRefId: targetStudentId },
        update: { currentGrade: null },
        create: buildEnrollmentProfileCreateData(targetStudentId, null),
      })

      return {
        ok: true,
        action,
        currentEnrollment: mapEnrollmentPeriod(unenrolled),
      }
    }

    assertWithStatus(false, 400, "Unsupported enrollment action")
  })
}

export function buildStudentEnrollmentSnapshot({
  student = {},
  attendanceRecords = [],
  gradeRecords = [],
  parentReports = [],
  selectedEnrollmentPeriodId = "",
} = {}) {
  const schoolYear = getConfiguredSchoolYear()
  const periods = sortEnrollmentPeriods(student?.enrollmentPeriods || [])
  const currentEnrollment = resolveCurrentEnrollmentPeriod(periods, schoolYear)
  const effectiveEnrollmentPeriodId = selectEnrollmentPeriodIdForRows(
    [
      ...(Array.isArray(attendanceRecords) ? attendanceRecords : []),
      ...(Array.isArray(gradeRecords) ? gradeRecords : []),
      ...(Array.isArray(parentReports) ? parentReports : []),
    ],
    selectedEnrollmentPeriodId,
    normalizeText(currentEnrollment?.id)
  )

  return {
    currentEnrollment: currentEnrollment ? mapEnrollmentPeriod(currentEnrollment) : null,
    selectedEnrollmentPeriodId: effectiveEnrollmentPeriodId,
    enrollmentPeriods: periods.map((entry) => mapEnrollmentPeriod(entry)),
    filteredAttendanceRecords: filterRowsByEnrollmentPeriod(attendanceRecords, effectiveEnrollmentPeriodId),
    filteredGradeRecords: filterRowsByEnrollmentPeriod(gradeRecords, effectiveEnrollmentPeriodId),
    filteredParentReports: filterRowsByEnrollmentPeriod(parentReports, effectiveEnrollmentPeriodId),
  }
}
