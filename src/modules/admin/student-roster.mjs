// src/modules/admin/student-roster.mjs

import { mapParentClassReport } from "./parent-reports.mjs"
import { mapGradeRecordForApi } from "./student-records.mjs"
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

function normalizePositiveInteger(value) {
  const parsed = normalizeInteger(value)
  if (!Number.isFinite(parsed) || parsed < 1) return null
  return parsed
}

function assertWithStatus(condition, status, message) {
  if (condition) return
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
  const prisma = await getSharedPrismaClient()
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
  const prisma = await getSharedPrismaClient()
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
  const prisma = await getSharedPrismaClient()
  const startAt = normalizeStudentNumberFloor(floor)
  const nextStudentNumber = await resolveNextStudentNumberForClient(prisma, startAt)
  return {
    startAt,
    nextStudentNumber,
  }
}
