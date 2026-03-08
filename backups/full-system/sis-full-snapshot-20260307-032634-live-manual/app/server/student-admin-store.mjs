// server/student-admin-store.mjs

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
    .split(/[;,]/g)
    .map((entry) => normalizeText(entry))
    .filter(Boolean)
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

function normalizeDate(value) {
  const text = normalizeText(value)
  if (!text) return null
  const parsed = new Date(text)
  if (Number.isNaN(parsed.valueOf())) return null
  return parsed
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
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

function endOfDay(value = new Date()) {
  const date = startOfDay(value)
  date.setDate(date.getDate() + 1)
  date.setMilliseconds(-1)
  return date
}

function startOfWeek(value = new Date()) {
  const date = startOfDay(value)
  const day = date.getDay()
  const diffToMonday = (day + 6) % 7
  date.setDate(date.getDate() - diffToMonday)
  return date
}

function endOfWeek(value = new Date()) {
  const date = startOfWeek(value)
  date.setDate(date.getDate() + 7)
  date.setMilliseconds(-1)
  return date
}

function startOfYear(value = new Date()) {
  return new Date(value.getFullYear(), 0, 1)
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

function mapStudent(student) {
  if (!student) return null
  const eaglesId = student.eaglesId
  return {
    id: student.id,
    externalKey: student.externalKey,
    studentNumber: student.studentNumber,
    eaglesId,
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
    parentReports: Array.isArray(student.parentReports) ? student.parentReports : undefined,
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

function mapImportRowToStudentPayload(row) {
  const eaglesId = normalizeText(getImportValue(row, ["eaglesId"]))
  const studentNumber = normalizePositiveInteger(getImportValue(row, ["studentNumber"]))

  const profile = {
    sourceFormId: "spreadsheet-import",
    sourceUrl: "local-import",
    fullName: normalizeText(getImportValue(row, ["fullName", "fullNameStudent"])),
    englishName: normalizeText(getImportValue(row, ["englishName"])),
    memberSince: normalizeText(getImportValue(row, ["memberSince"])),
    exercisePoints: normalizePositiveInteger(getImportValue(row, ["exercisePoints"])),
    parentsId: normalizeText(getImportValue(row, ["parentsId"])),
    photoUrl: normalizeText(getImportValue(row, ["photoUrl", "studentPhoto", "unnamed1"])),
    studentPhone: normalizeText(getImportValue(row, ["studentPhone"])),
    studentEmail: normalizeText(getImportValue(row, ["studentEmail"])),
    dobText: normalizeText(getImportValue(row, ["dobText", "dob"])),
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
    motherPhone: normalizeText(getImportValue(row, ["motherPhone", "mothersPhone"])),
    motherEmergencyContact: normalizeText(
      getImportValue(row, ["motherEmergencyContact", "emergencyContactMother"])
    ),
    fatherName: normalizeText(getImportValue(row, ["fatherName", "fullNameFather"])),
    fatherPhone: normalizeText(getImportValue(row, ["fatherPhone", "fathersPhone"])),
    fatherEmergencyContact: normalizeText(
      getImportValue(row, ["fatherEmergencyContact", "emergencyContactFather"])
    ),
  }

  return {
    eaglesId,
    studentNumber,
    email: normalizeText(getImportValue(row, ["email", "studentEmail"])),
    profile,
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
  const existingEaglesIds = new Set()
  const existingStudentNumbers = new Set()
  const rowErrors = new Map()

  const setRowError = (rowNumber, message) => {
    if (!Number.isInteger(rowNumber) || rowNumber < 1) return
    if (!normalizeText(message)) return
    if (!rowErrors.has(rowNumber)) rowErrors.set(rowNumber, message)
  }

  ;(Array.isArray(existingRows) ? existingRows : []).forEach((row) => {
    const eaglesIdKey = normalizeLower(row?.eaglesId)
    if (eaglesIdKey) existingEaglesIds.add(eaglesIdKey)
    const studentNumber = normalizePositiveInteger(row?.studentNumber)
    if (studentNumber) existingStudentNumbers.add(studentNumber)
  })

  for (let i = 0; i < prepared.rows.length; i += 1) {
    const rowNumber = i + 1
    const row = prepared.rows[i] || {}
    const eaglesId = normalizeText(row.eaglesId)
    const studentNumber = normalizePositiveInteger(row.studentNumber)

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

      if (existingEaglesIds.has(eaglesIdKey)) {
        setRowError(rowNumber, "eaglesId already exists in database")
      }
    }

    if (!studentNumber) {
      if (strictMode) {
        const strictMessage =
          "studentNumber is required (strict import mode requires explicit identity values)"
        setRowError(rowNumber, strictMessage)
      }
      continue
    }

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

    if (existingStudentNumbers.has(studentNumber)) {
      setRowError(rowNumber, "studentNumber already exists in database")
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
      requestedStudentNumber
      || normalizePositiveInteger(existing.studentNumber)
      || (await resolveNextStudentNumberForClient(client))
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

  const studentNumber = requestedStudentNumber || (await resolveNextStudentNumberForClient(client))
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
  if (preflightErrors.length) {
    return {
      processed: preparedRows.length,
      created: 0,
      updated: 0,
      failed: preflightErrors.length,
      autoFilledEaglesIds,
      autoFilledStudentNumbers,
      strictIdentity,
      committed: false,
      errors: preflightErrors,
    }
  }

  let created = 0
  let updated = 0
  const errors = []

  try {
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < preparedRows.length; i += 1) {
        try {
          const saved = await saveStudentWithClient(tx, preparedRows[i], "")
          if (saved.action === "created") created += 1
          if (saved.action === "updated") updated += 1
        } catch (error) {
          const wrapped = new Error(`Row ${i + 1}: ${String(error?.message || error)}`)
          wrapped.statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 400
          throw wrapped
        }
      }
    })
  } catch (error) {
    const text = normalizeText(error?.message || error) || "Import failed"
    const rowMatch = text.match(/^Row\s+(\d+):\s*(.+)$/i)
    errors.push({
      rowNumber: rowMatch ? Number.parseInt(rowMatch[1], 10) : 1,
      message: rowMatch ? rowMatch[2] : text,
    })
    created = 0
    updated = 0
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
    errors,
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
        level: true,
        dueAt: true,
        submittedAt: true,
        homeworkCompleted: true,
        homeworkOnTime: true,
        assignmentName: true,
      },
    }),
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

  let todayAttendanceCount = 0
  let todayAbsences = 0
  let tardy10PlusCount = 0
  let tardy30PlusCount = 0
  const attendanceByLevel = new Map()

  todayAttendance.forEach((row) => {
    const status = normalizeLower(row.status)
    const profile = profileByStudentRefId.get(row.studentRefId)
    const level = canonicalizeLevel(profile?.currentGrade || row.level || "") || "Unassigned"
    if (status === "absent") {
      todayAbsences += 1
      return
    }
    todayAttendanceCount += 1
    const presentByLevel = attendanceByLevel.get(level) || 0
    attendanceByLevel.set(level, presentByLevel + 1)

    if (status === "late") {
      const tardyMinutes = parseTardyMinutes(row.comments)
      if (tardyMinutes >= 10) tardy10PlusCount += 1
      if (tardyMinutes >= 30) tardy30PlusCount += 1
    }
  })

  const totalTodayTracked = todayAttendanceCount + todayAbsences

  const onTimeCompletions = allGradeRecords.filter((row) => isOnTimeCompletedGradeRecord(row)).length
  const lateCompletions = allGradeRecords.filter((row) => isLateCompletedGradeRecord(row)).length
  const outstanding = allGradeRecords.filter((row) => isOutstandingGradeRecord(row, now)).length
  const outstandingYtd = allGradeRecords.filter((row) => {
    if (!row.dueAt) return false
    const dueAt = new Date(row.dueAt)
    if (Number.isNaN(dueAt.valueOf())) return false
    if (dueAt < yearStart || dueAt > now) return false
    return isOutstandingGradeRecord(row, now)
  }).length

  const weeklyBuckets = Array.from({ length: 7 }, (_, index) => {
    const dayStart = new Date(weekStart)
    dayStart.setDate(dayStart.getDate() + index)
    return {
      index,
      label: weekDayLabels[index],
      date: dayStart.toISOString().slice(0, 10),
      students: new Map(),
    }
  })

  allGradeRecords.forEach((row) => {
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
  allGradeRecords.forEach((row) => {
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
    entry.eaglesId = normalizeText(profile?.student?.eaglesId || profile?.studentRefId || key)
    entry.fullName = normalizeText(profile?.fullName) || "(no name)"
    entry.level = canonicalizeLevel(profile?.currentGrade || "") || "Unassigned"
  })

  const atRiskStudents = Array.from(riskByStudent.values())
    .filter((entry) => entry.absences >= 2 || entry.late30Plus >= 1 || entry.outstandingWeek >= 2)
    .sort((left, right) => {
      const leftScore = left.absences * 3 + left.outstandingWeek * 2 + left.late30Plus * 2
      const rightScore = right.absences * 3 + right.outstandingWeek * 2 + right.late30Plus * 2
      if (leftScore !== rightScore) return rightScore - leftScore
      return normalizeText(left.fullName).localeCompare(normalizeText(right.fullName))
    })
    .slice(0, 30)

  const levels = Array.from(new Set([...enrolledByLevel.keys(), ...attendanceByLevel.keys()])).sort(
    compareKnownLevelOrder
  )

  const levelCompletionMap = new Map()
  const ensureLevelCompletion = (levelName) => {
    const level = canonicalizeLevel(levelName || "") || "Unassigned"
    if (!levelCompletionMap.has(level)) {
      levelCompletionMap.set(level, {
        level,
        enrolledStudents: 0,
        totalAssignments: 0,
        completedAssignments: 0,
        outstandingAssignments: 0,
        completedStudents: 0,
        uncompletedStudents: [],
        _studentsById: new Map(),
      })
    }
    return levelCompletionMap.get(level)
  }

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
    const bucket = ensureLevelCompletion(level)
    bucket.enrolledStudents += 1
    bucket._studentsById.set(profile.studentRefId, {
      studentRefId: profile.studentRefId,
      eaglesId: normalizeText(profile?.student?.eaglesId || profile.studentRefId),
      fullName: normalizeText(profile.fullName) || "(no name)",
      emails: toEmailList(profile),
      outstandingCount: 0,
      completedCount: 0,
      totalAssignments: 0,
      assignmentNames: [],
      nextDueAt: null,
    })
  })

  allGradeRecords.forEach((record) => {
    const profile = profileByStudentRefId.get(record.studentRefId)
    const level = canonicalizeLevel(profile?.currentGrade || record.level || "") || "Unassigned"
    const bucket = ensureLevelCompletion(level)
    bucket.totalAssignments += 1

    let student = bucket._studentsById.get(record.studentRefId)
    if (!student) {
      student = {
        studentRefId: record.studentRefId,
        eaglesId: normalizeText(profile?.student?.eaglesId || record.studentRefId),
        fullName: normalizeText(profile?.fullName) || "(no name)",
        emails: toEmailList(profile),
        outstandingCount: 0,
        completedCount: 0,
        totalAssignments: 0,
        assignmentNames: [],
        nextDueAt: null,
      }
      bucket._studentsById.set(record.studentRefId, student)
      bucket.enrolledStudents += 1
    }

    student.totalAssignments += 1
    if (isCompletedGradeRecord(record)) {
      bucket.completedAssignments += 1
      student.completedCount += 1
    }
    if (isOutstandingGradeRecord(record, now)) {
      bucket.outstandingAssignments += 1
      student.outstandingCount += 1
      const assignmentName = normalizeText(record.assignmentName)
      if (assignmentName && !student.assignmentNames.includes(assignmentName)) {
        student.assignmentNames.push(assignmentName)
      }
      if (record.dueAt) {
        const dueAt = new Date(record.dueAt)
        if (!Number.isNaN(dueAt.valueOf())) {
          if (!student.nextDueAt || dueAt < student.nextDueAt) student.nextDueAt = dueAt
        }
      }
    }
  })

  const levelCompletion = Array.from(levelCompletionMap.values())
    .map((bucket) => {
      const students = Array.from(bucket._studentsById.values())
      const uncompletedStudents = students
        .filter((entry) => entry.outstandingCount > 0)
        .sort((left, right) => {
          if (left.outstandingCount !== right.outstandingCount) return right.outstandingCount - left.outstandingCount
          return normalizeText(left.fullName).localeCompare(normalizeText(right.fullName))
        })
        .map((entry) => ({
          studentRefId: entry.studentRefId,
          eaglesId: entry.eaglesId,
          fullName: entry.fullName,
          emails: entry.emails,
          outstandingCount: entry.outstandingCount,
          assignmentNames: entry.assignmentNames,
          nextDueAt: entry.nextDueAt ? entry.nextDueAt.toISOString().slice(0, 10) : "",
        }))

      const completedStudents = students.filter((entry) => entry.totalAssignments > 0 && entry.outstandingCount === 0).length

      return {
        level: bucket.level,
        enrolledStudents: bucket.enrolledStudents,
        totalAssignments: bucket.totalAssignments,
        completedAssignments: bucket.completedAssignments,
        outstandingAssignments: bucket.outstandingAssignments,
        completedStudents,
        uncompletedStudents,
      }
    })
    .sort((left, right) => compareKnownLevelOrder(left.level, right.level))

  return {
    generatedAt: now.toISOString(),
    today: {
      date: todayStart.toISOString().slice(0, 10),
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
      total: allGradeRecords.length,
      completedOnTime: onTimeCompletions,
      completedLate: lateCompletions,
      outstanding,
      outstandingYtd,
    },
    atRiskWeek: {
      total: atRiskStudents.length,
      students: atRiskStudents,
    },
    levelCompletion,
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
    comments: normalizeNullableText(payload.comments),
    generatedAt: normalizeDate(payload.generatedAt) || new Date(),
  }

  const reportId = normalizeText(payload.id)

  if (reportId) {
    const existing = await prisma.parentClassReport.findUnique({ where: { id: reportId } })
    assertWithStatus(Boolean(existing), 404, "Parent report not found")
    assertWithStatus(existing.studentRefId === studentRef, 403, "Parent report does not belong to student")

    return prisma.parentClassReport.update({
      where: { id: reportId },
      data: reportData,
    })
  }

  return prisma.parentClassReport.upsert({
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
    comments: normalizeNullableText(payload.comments),
    generatedAt: new Date(),
  }

  return saveParentClassReport(studentRef, reportPayload)
}
