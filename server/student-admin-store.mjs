// @ts-check
// server/student-admin-store.mjs

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import {
  mapParentClassReport,
} from "../src/modules/admin/parent-reports.mjs"
import {
  invalidateLevelAndSchoolFiltersCache,
} from "../src/modules/admin/student-admin-queries.mjs"
import { mapGradeRecordForApi } from "../src/modules/admin/student-records.mjs"
import { getStudentById as getStudentRosterById } from "../src/modules/admin/student-roster.mjs"
import { getSharedPrismaClient } from "../src/infra/db/prisma-client.mjs"
export {
  buildStudentNewsCalendarRows,
  listStudentNewsCalendar,
  mapStudentNewsReportRow,
  normalizeStudentNewsReviewStatus,
  resolveStudentNewsStatusColor,
  resolveStudentNewsSubmissionWindow,
  saveStudentNewsReport,
} from "../src/modules/admin/student-news-submissions.mjs"

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

export const STUDENT_POINTS_SCHEDULED_ON_TIME_VALUE = 10
export const STUDENT_POINTS_ELECTIVE_SUBMISSION_VALUE = 21
const FIXED_TIME_ZONE_OFFSET_MINUTES = 7 * 60
const FIXED_TIME_ZONE_OFFSET_MS = FIXED_TIME_ZONE_OFFSET_MINUTES * 60 * 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000

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
function parseDateOrNull(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return null
  return date
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

const LEVEL_DEFINITIONS = [
  {
    canonical: "Eggs & Chicks",
    aliases: ["EggChic", "EggChicks", "Eggs and Chicks", "Eggs Chicks"],
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

function knownLevelIndex(value) {
  const canonical = canonicalizeLevel(value)
  return LEVEL_DEFINITIONS.findIndex(
    (entry) => normalizeLower(entry.canonical) === normalizeLower(canonical)
  )
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

function nowIso() {
  return new Date().toISOString()
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

let prismaClientPromise = null

/**
 * @returns {boolean}
 */
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

function mergeImportPayloadForBackfill(importPayload = {}, existingStudent = {}) {
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

function applyImportIdentityDefaults(
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

function validateImportRowsForIdentity(
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

/**
 * @param {Record<string, unknown>} [payload]
 * @param {string} [studentRefId]
 * @param {{ skipFilterCacheInvalidation?: boolean }} [options]
 * @returns {Promise<{ action: string, student: unknown }>}
 */
async function saveStudent(payload = {}, studentRefId = "", options = {}) {
  const prisma = await getPrismaClient()
  const skipFilterCacheInvalidation = options.skipFilterCacheInvalidation === true
  const result = await prisma.$transaction((tx) => saveStudentWithClient(tx, payload, studentRefId))

  if (!skipFilterCacheInvalidation) {
    await invalidateLevelAndSchoolFiltersCache()
  }

  return {
    action: result.action,
    student: await getStudentRosterById(result.studentRefId),
  }
}

/**
 * @param {string} studentRefId
 * @returns {Promise<{ deleted: true, studentRefId: string }>}
 */
async function deleteStudent(studentRefId) {
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

/**
 * @param {Array<Record<string, unknown>>} [rows]
 * @returns {Promise<{
 *   processed: number,
 *   created: number,
 *   updated: number,
 *   failed: number,
 *   autoFilledEaglesIds: number,
 *   autoFilledStudentNumbers: number,
 *   strictIdentity: boolean,
 *   committed: boolean,
 *   partiallyCommitted: boolean,
 *   errors: Array<Record<string, unknown>>,
 *   rowResults: Array<Record<string, unknown>>,
 *   logFields: Array<string>,
 *   logs: Array<Record<string, unknown>>,
 * }>}
 */
async function importStudentsFromRows(rows = []) {
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
