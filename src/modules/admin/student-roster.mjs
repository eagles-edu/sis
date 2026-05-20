// src/modules/admin/student-roster.mjs
// @ts-check

import { mapParentClassReport } from "./parent-reports.mjs"
import { mapGradeRecordForApi } from "./student-records.mjs"
import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import {
  buildStudentEnrollmentSnapshot,
  ENROLLMENT_LEVEL_FILTER_UNENROLLED_ONLY,
  ENROLLMENT_STATUS_ACTIVE,
  ENROLLMENT_STATUS_UNENROLLED,
  ensureEnrollmentPeriodsBackfilled,
  getStudentEnrollmentDetail,
  listEnrollmentRoster,
} from "./enrollment-periods.mjs"
import { getConfiguredSchoolYear } from "./school-setup-store.mjs"

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
function normalizeInteger(value) {
  const text = normalizeText(value)
  if (!text) return null
  const parsed = Number.parseInt(text, 10)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function normalizePositiveInteger(value) {
  const parsed = normalizeInteger(value)
  if (!Number.isFinite(parsed) || parsed < 1) return null
  return parsed
}

/**
 * @param {boolean} condition
 * @param {number} status
 * @param {string} message
 * @returns {void}
 */
function assertWithStatus(condition, status, message) {
  if (condition) return
  /** @type {Error & { statusCode?: number }} */
  const error = new Error(message)
  error.statusCode = status
  throw error
}

const STUDENT_NUMBER_START = Math.max(100, normalizePositiveInteger(process.env.STUDENT_NUMBER_START) || 100)

const LEVEL_DEFINITIONS = [
  { canonical: "Eggs & Chicks", aliases: ["EggChic", "Eggs and Chicks", "Eggs Chicks"] },
  { canonical: "Pre-A1 Starters", aliases: ["Starters", "Pre A1 Starters"] },
  { canonical: "A1 Movers", aliases: ["Movers"] },
  { canonical: "A2 Flyers", aliases: ["Flyers"] },
  { canonical: "A2 KET", aliases: ["KET"] },
  { canonical: "B1 PET", aliases: ["PET"] },
  { canonical: "B2+ IELTS", aliases: ["IELTS", "B2 IELTS"] },
  { canonical: "C1+ TAYK", aliases: ["TAYK", "C1 TAYK"] },
  { canonical: "Private", aliases: ["Private Class", "1:1 Private"] },
]

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeLevelKey(value) {
  return normalizeLower(value).replace(/[^a-z0-9]/g, "")
}

const LEVEL_ALIAS_MAP = (() => {
  /** @type {Map<string, string>} */
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
 * @param {unknown} value
 * @returns {string[]}
 */
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

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeSearchComparable(value) {
  const folded = normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
  return folded.replace(/[^a-z0-9]+/g, " ").trim()
}

/**
 * @param {Record<string, unknown> | null | undefined} [student]
 * @returns {string}
 */
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

/**
 * @param {Record<string, unknown> | null | undefined} [student]
 * @param {string} [searchComparable]
 * @returns {boolean}
 */
function studentMatchesSearchComparable(student = {}, searchComparable = "") {
  const needle = normalizeSearchComparable(searchComparable)
  if (!needle) return true
  return studentSearchComparableHaystack(student).includes(needle)
}

/**
 * @param {unknown} [value]
 * @returns {number}
 */
function normalizeStudentNumberFloor(value = STUDENT_NUMBER_START) {
  return Math.max(100, normalizePositiveInteger(value) || STUDENT_NUMBER_START)
}

/**
 * @param {Array<{ studentNumber?: unknown }>} [rows]
 * @param {unknown} [floor]
 * @returns {number}
 */
function maxStudentNumberFromRows(rows = [], floor = STUDENT_NUMBER_START) {
  const minimum = normalizeStudentNumberFloor(floor)
  return rows.reduce((highest, row) => {
    const candidate = normalizePositiveInteger(row?.studentNumber) || 0
    return candidate > highest ? candidate : highest
  }, minimum - 1)
}

/**
 * @param {Record<string, unknown> & { student: { findMany: Function } }} client
 * @param {unknown} [floor]
 * @returns {Promise<number>}
 */
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

/**
 * @param {Record<string, unknown> | null | undefined} [student]
 * @param {string} [context]
 * @returns {{ eaglesId: string, studentNumber: number }}
 */
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

/**
 * @param {Record<string, unknown> | null | undefined} student
 * @returns {{
 *   id: string,
 *   externalKey: string | null | undefined,
 *   studentNumber: number,
 *   eaglesId: string,
 *   email: string | null | undefined,
 *   createdAt: unknown,
 *   updatedAt: unknown,
 *   profile: unknown,
 *   counts: {
 *     submissions: number,
 *     intakeSubmissions: number,
 *     attendanceRecords: number,
 *     gradeRecords: number,
 *     parentReports: number,
 *   },
 *   attendanceRecords?: unknown[],
 *   gradeRecords?: unknown[],
 *   parentReports?: unknown[],
 * } | null}
 */
function mapStudent(student) {
  if (!student) return null
  const identity = assertStudentIdentityIntegrity(student, `student ${normalizeText(student?.id)}`)
  const enrollmentSnapshot = buildStudentEnrollmentSnapshot({
    student,
    attendanceRecords: student?.attendanceRecords,
    gradeRecords: student?.gradeRecords,
    parentReports: student?.parentReports,
    selectedEnrollmentPeriodId: student?.selectedEnrollmentPeriodId,
  })
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
    currentEnrollment: enrollmentSnapshot.currentEnrollment,
    enrollmentPeriods: enrollmentSnapshot.enrollmentPeriods,
    selectedEnrollmentPeriodId: enrollmentSnapshot.selectedEnrollmentPeriodId,
  }
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

/**
 * @param {{ levelFilter?: string, schoolFilter?: string, levelVariants?: string[] }} [options]
 * @returns {Record<string, unknown>}
 */
function listStudentsBaseWhere({ schoolFilter = "" } = {}) {
  return {
    AND: [
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

/**
 * @param {string} [searchQuery]
 * @returns {Record<string, unknown> | null}
 */
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

/**
 * @param {{
 *   prisma: Record<string, unknown> & { student: { findMany: Function } },
 *   baseWhere?: Record<string, unknown>,
 *   searchComparable?: string,
 *   limit?: number,
 * }} options
 * @returns {Promise<string[]>}
 */
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

/**
 * @param {{ query?: string, level?: string, school?: string, take?: number, includeUnenrolled?: boolean }} [options]
 * @returns {Promise<{ total: number, items: Array<ReturnType<typeof mapStudent>> }>}
 */
export async function listStudents({ query = "", level = "", school = "", take = 250, includeUnenrolled = false } = {}) {
  const prisma = await getSharedPrismaClient()
  const searchQuery = normalizeText(query)
  const levelFilter = normalizeText(level)
  const schoolFilter = normalizeText(school)
  const limit = Math.max(1, Math.min(Number.parseInt(String(take), 10) || 250, 1000))
  const baseWhere = listStudentsBaseWhere({ schoolFilter })
  const searchClause = listStudentsSearchClause(searchQuery)
  const where = searchClause ? { AND: [...(baseWhere.AND || []), searchClause] } : baseWhere
  const targetSchoolYear = getConfiguredSchoolYear()
  if (targetSchoolYear) {
    await ensureEnrollmentPeriodsBackfilled({ prisma, schoolYear: targetSchoolYear })
  }
  const enrollmentRoster = await listEnrollmentRoster({
    query: searchQuery,
    level: levelFilter,
    includeUnenrolled,
    take: limit,
    schoolYear: targetSchoolYear,
  })
  const rosterIds = Array.isArray(enrollmentRoster?.items)
    ? enrollmentRoster.items.map((entry) => normalizeText(entry?.id)).filter(Boolean)
    : []

  let students = rosterIds.length
    ? await prisma.student.findMany({
        where: {
          id: { in: rosterIds },
        },
        include: {
          ...STUDENT_LIST_QUERY_INCLUDE,
          enrollmentPeriods: targetSchoolYear
            ? {
                where: { schoolYear: targetSchoolYear },
                orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
              }
            : {
                orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
              },
        },
        orderBy: STUDENT_LIST_QUERY_ORDER_BY,
        take: limit,
      })
    : []

  if (searchQuery && students.length === 0) {
    const matchedIds = await findAccentInsensitiveStudentIds({
      prisma,
      baseWhere,
      searchComparable: searchQuery,
      limit,
    })
    if (matchedIds.length) {
      const fallbackRoster = await listEnrollmentRoster({
        query: "",
        level: levelFilter,
        includeUnenrolled,
        take: 1000,
        schoolYear: targetSchoolYear,
      })
      const allowedIds = new Set(
        (fallbackRoster.items || []).map((entry) => normalizeText(entry?.id)).filter(Boolean)
      )
      const finalIds = matchedIds.filter((id) => allowedIds.has(normalizeText(id)))
      if (finalIds.length) {
        students = await prisma.student.findMany({
          where: {
            id: {
              in: finalIds,
            },
          },
          include: {
            ...STUDENT_LIST_QUERY_INCLUDE,
            enrollmentPeriods: targetSchoolYear
              ? {
                  where: { schoolYear: targetSchoolYear },
                  orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
                }
              : {
                  orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
                },
          },
          orderBy: STUDENT_LIST_QUERY_ORDER_BY,
          take: limit,
        })
      }
    }
  }

  return {
    total: students.length,
    items: students.map((entry) => mapStudent(entry)),
  }
}

/**
 * @param {string} studentRefId
 * @param {{ enrollmentPeriodId?: string }} [options]
 * @returns {Promise<ReturnType<typeof mapStudent>>}
 */
export async function getStudentById(studentRefId, { enrollmentPeriodId = "" } = {}) {
  const prisma = await getSharedPrismaClient()
  const id = normalizeText(studentRefId)
  assertWithStatus(Boolean(id), 400, "studentRefId is required")
  const targetSchoolYear = getConfiguredSchoolYear()
  if (targetSchoolYear) {
    await ensureEnrollmentPeriodsBackfilled({ prisma, schoolYear: targetSchoolYear, studentRefId: id })
  }

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
  })

  assertWithStatus(Boolean(student), 404, "Student not found")
  const enrollmentSnapshot = buildStudentEnrollmentSnapshot({
    student,
    attendanceRecords: student.attendanceRecords,
    gradeRecords: student.gradeRecords,
    parentReports: student.parentReports,
    selectedEnrollmentPeriodId: enrollmentPeriodId,
  })

  return mapStudent({
    ...student,
    selectedEnrollmentPeriodId: enrollmentSnapshot.selectedEnrollmentPeriodId,
    attendanceRecords: enrollmentSnapshot.filteredAttendanceRecords,
    gradeRecords: enrollmentSnapshot.filteredGradeRecords,
    parentReports: enrollmentSnapshot.filteredParentReports,
  })
}

/**
 * @param {{ floor?: number }} [options]
 * @returns {Promise<{ startAt: number, nextStudentNumber: number }>}
 */
export async function getNextStudentNumber({ floor = STUDENT_NUMBER_START } = {}) {
  const prisma = await getSharedPrismaClient()
  const startAt = normalizeStudentNumberFloor(floor)
  const nextStudentNumber = await resolveNextStudentNumberForClient(prisma, startAt)
  return {
    startAt,
    nextStudentNumber,
  }
}
