// @ts-check
import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import { getConfiguredDatabaseUrlSync } from "./sis-config-store.mjs"
import { invalidateLevelAndSchoolFiltersCache } from "./student-admin-queries.mjs"
import { getStudentById as getStudentRosterById } from "./student-roster.mjs"
import { canonicalizeLevel as canonicalizeCatalogLevel } from "./level-catalog.mjs"
import { hashScryptPassword } from "./users.mjs"
import { writeStudentProfileBackupSnapshot } from "./student-profile-backups.mjs"

/**
 * @typedef {{
 *   eaglesId?: unknown,
 *   studentNumber?: unknown,
 *   email?: unknown,
 *   profile?: Record<string, unknown>,
 * }} ImportStudentPayload
 *
 * @typedef {{
 *   existingRows?: Array<Record<string, unknown>>,
 *   studentNumberStart?: number,
 *   requireExplicitIdentity?: boolean,
 * }} ImportIdentityValidationOptions
 *
 * @typedef {{
 *   skipFilterCacheInvalidation?: boolean,
 *   updatedByUsername?: unknown,
 *   updatedByRole?: unknown,
 * }} SaveStudentOptions
 */

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
 * @returns {string | null}
 */
function normalizeNullableText(value) {
  const text = normalizeText(value)
  return text || null
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeNullableEmail(value) {
  const text = normalizeLower(value)
  return text || null
}

/**
 * @param {unknown} value
 * @returns {Array<string>}
 */
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

/**
 * @param {unknown} value
 * @returns {string}
 */
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

/**
 * @param {unknown} value
 * @returns {Array<string>}
 */
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
 * @param {unknown} value
 * @returns {boolean | null}
 */
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

/**
 * @param {boolean} condition
 * @param {number} status
 * @param {string} message
 * @returns {asserts condition}
 */
function assertWithStatus(condition, status, message) {
  if (condition) return
  /** @type {Error & { statusCode?: number }} */
  const error = new Error(message)
  error.statusCode = status
  throw error
}

/**
 * @param {unknown} value
 * @param {boolean} [fallback]
 * @returns {boolean}
 */
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

const STUDENT_NUMBER_START = Math.max(
  100,
  normalizePositiveInteger(process.env.STUDENT_NUMBER_START) || 100
)

const IMPORT_STRICT_IDENTITY_REQUIRED = resolveBooleanFlag(
  process.env.STUDENT_IMPORT_REQUIRE_EXPLICIT_IDENTITY,
  true
)

let prismaClientPromise = null

function isStudentAdminStoreEnabled() {
  const hasDatabaseUrl = Boolean(normalizeText(getConfiguredDatabaseUrlSync() || process.env.DATABASE_URL))
  const envFlag = normalizeLower(process.env.STUDENT_ADMIN_STORE_ENABLED)
  if (!envFlag) return hasDatabaseUrl
  if (["false", "0", "no"].includes(envFlag)) return false
  if (["true", "1", "yes"].includes(envFlag)) return true
  return hasDatabaseUrl
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
  return canonicalizeCatalogLevel(value)
}

/**
 * @param {unknown} eaglesId
 * @returns {string}
 */
function buildExternalKey(eaglesId) {
  return `sid:${normalizeLower(eaglesId)}`
}

/**
 * @param {unknown} studentNumber
 * @returns {string}
 */
function buildEaglesIdFromNumber(studentNumber) {
  const normalized = normalizePositiveInteger(studentNumber)
  if (!normalized) return ""
  return `SIS-${String(normalized).padStart(6, "0")}`
}

/**
 * @param {unknown} baseEaglesId
 * @param {Set<string>} reservedEaglesIdKeys
 * @returns {string}
 */
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

/**
 * @param {ImportStudentPayload} [payload]
 * @returns {Record<string, unknown>}
 */
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
    familyId: normalizeNullableText(payload.familyId || payload.parentsId),
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
    maIsHomeworkProctor: normalizeNullableText(payload.maIsHomeworkProctor),
    motherPhone: normalizeNullableText(payload.motherPhone),
    motherEmergencyContact: normalizeNullableText(payload.motherEmergencyContact),
    motherMessenger: normalizeNullableText(payload.motherMessenger),
    fatherName: normalizeNullableText(payload.fatherName),
    fatherEmail: normalizeNullableEmail(payload.fatherEmail),
    baIsHomeworkProctor: normalizeNullableText(payload.baIsHomeworkProctor),
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

/**
 * @returns {Promise<unknown>}
 */
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

/**
 * @param {ImportStudentPayload} [payload]
 * @returns {number | null}
 */
function requestedStudentNumberFromPayload(payload = {}) {
  return normalizePositiveInteger(payload?.studentNumber)
}

/**
 * @param {Record<string, unknown>} row
 * @param {Array<string>} aliases
 * @returns {unknown}
 */
function getImportValue(row, aliases) {
  const aliasSet = new Set(aliases.map((entry) => normalizeLower(entry)))
  const entries = Object.entries(row || {})
  for (let i = 0; i < entries.length; i += 1) {
    const [key, value] = entries[i]
    if (aliasSet.has(normalizeLower(key))) return value
  }
  return ""
}

/**
 * @param {Record<string, unknown>} row
 * @returns {{
 *   eaglesId: string,
 *   studentNumber: number | null,
 *   email: string,
 *   profile: Record<string, unknown>,
 * }}
 */
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
    familyId: normalizeText(getImportValue(row, ["familyId", "parentsId"])),
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
    maIsHomeworkProctor: normalizeText(getImportValue(row, ["maIsHomeworkProctor"])),
    motherPhone: normalizeText(getImportValue(row, ["motherPhone", "mothersPhone"])),
    motherEmergencyContact: normalizeText(
      getImportValue(row, ["motherEmergencyContact", "emergencyContactMother"])
    ),
    motherMessenger: normalizeText(getImportValue(row, ["motherMessenger", "zaloImIdMother"])),
    fatherName: normalizeText(getImportValue(row, ["fatherName", "fullNameFather"])),
    fatherEmail: normalizeText(getImportValue(row, ["fatherEmail", "emailBa"])),
    baIsHomeworkProctor: normalizeText(getImportValue(row, ["baIsHomeworkProctor"])),
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

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function hasBackfillImportValue(value) {
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === "number") return Number.isFinite(value)
  if (typeof value === "boolean") return true
  if (value && typeof value === "object") return Object.keys(value).length > 0
  return Boolean(normalizeText(value))
}

/**
 * @param {ImportStudentPayload} [importPayload]
 * @param {Record<string, unknown>} [existingStudent]
 * @returns {ImportStudentPayload}
 */
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

/**
 * @param {unknown} leftValue
 * @param {unknown} rightValue
 * @returns {boolean}
 */
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

/**
 * @param {Record<string, unknown>} [beforeState]
 * @param {Record<string, unknown>} [afterState]
 * @returns {Array<string>}
 */
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

/**
 * @param {Record<string, unknown>} [row]
 * @returns {{
 *   eaglesId: string | null,
 *   studentNumber: number | null,
 *   fullName: string | null,
 *   englishName: string | null,
 *   email: string | null,
 * }}
 */
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

/**
 * @param {Array<Record<string, unknown>>} [mappedRows]
 * @param {ImportIdentityValidationOptions} [options]
 * @returns {{
 *   rows: Array<Record<string, unknown>>,
 *   autoFilledEaglesIds: number,
 *   autoFilledStudentNumbers: number,
 * }}
 */
export function applyImportIdentityDefaults(
  mappedRows = [],
  {
    existingRows = [],
    studentNumberStart = STUDENT_NUMBER_START,
  } = {}
) {
  const minimumStudentNumber = Math.max(100, normalizePositiveInteger(studentNumberStart) || STUDENT_NUMBER_START)
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

/**
 * @param {Array<Record<string, unknown>>} [mappedRows]
 * @param {ImportIdentityValidationOptions} [options]
 * @returns {{
 *   rows: Array<Record<string, unknown>>,
 *   autoFilledEaglesIds: number,
 *   autoFilledStudentNumbers: number,
 *   requireExplicitIdentity: boolean,
 *   errors: Array<{ rowNumber: number, message: string }>,
 * }}
 */
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

/**
 * @param {unknown} client
 * @param {unknown} studentNumber
 * @param {string} [excludedStudentId]
 * @returns {Promise<void>}
 */
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

/**
 * @param {unknown} client
 * @param {ImportStudentPayload} [payload]
 * @param {string} [studentRefId]
 * @returns {Promise<{ action: string, studentRefId: string }>}
 */
async function saveStudentWithClient(client, payload = {}, studentRefId = "") {
  const eaglesId = normalizeText(payload.eaglesId)
  assertWithStatus(Boolean(eaglesId), 400, "eaglesId is required")

  const studentEmail = normalizeNullableEmail(payload.email)
  const profilePayload = normalizeProfilePayload(payload.profile || {})
  const rawFormPayload =
    profilePayload.rawFormPayload && typeof profilePayload.rawFormPayload === "object" ?
      { ...profilePayload.rawFormPayload }
    : {}
  const normalizedFormPayload =
    profilePayload.normalizedFormPayload && typeof profilePayload.normalizedFormPayload === "object" ?
      { ...profilePayload.normalizedFormPayload }
    : {}
  const portalPassword = normalizeText(
    rawFormPayload.password || normalizedFormPayload.password || payload.password,
  )
  delete rawFormPayload.password
  delete normalizedFormPayload.password
  profilePayload.rawFormPayload = rawFormPayload
  profilePayload.normalizedFormPayload = normalizedFormPayload
  const portalPasswordHash = portalPassword ? hashScryptPassword(portalPassword) : ""
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
    if (portalPasswordHash) {
      await client.studentPortalAccount.upsert({
        where: { eaglesId: student.eaglesId },
        update: {
          passwordHash: portalPasswordHash,
          status: "active",
          studentRefId: student.id,
        },
        create: {
          eaglesId: student.eaglesId,
          passwordHash: portalPasswordHash,
          status: "active",
          studentRefId: student.id,
        },
      })
    }

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
  if (portalPasswordHash) {
    await client.studentPortalAccount.create({
      data: {
        eaglesId: student.eaglesId,
        passwordHash: portalPasswordHash,
        status: "active",
        studentRefId: student.id,
      },
    })
  }

  return {
    action: "created",
    studentRefId: student.id,
  }
}

/**
 * @param {unknown} client
 * @param {unknown} floor
 * @returns {Promise<number>}
 */
async function resolveNextStudentNumberForClient(client, floor = STUDENT_NUMBER_START) {
  const minimum = Math.max(100, normalizePositiveInteger(floor) || STUDENT_NUMBER_START)
  const rows = await client.student.findMany({
    select: {
      studentNumber: true,
    },
  })
  const highest = rows.reduce((value, row) => {
    const candidate = normalizePositiveInteger(row?.studentNumber) || 0
    return candidate > value ? candidate : value
  }, minimum - 1)
  return Math.max(minimum, highest + 1)
}

/**
 * @param {ImportStudentPayload} [payload]
 * @param {string} [studentRefId]
 * @param {SaveStudentOptions} [options]
 * @returns {Promise<{ action: string, student: unknown }>}
 */
export async function saveStudent(payload = {}, studentRefId = "", options = {}) {
  const prisma = await getPrismaClient()
  const skipFilterCacheInvalidation = options.skipFilterCacheInvalidation === true
  const requestedId = normalizeText(studentRefId)
  const existing = requestedId
    ? await prisma.student.findUnique({
        where: { id: requestedId },
        include: { profile: true, studentPortalAccount: true },
      })
    : null
  await writeStudentProfileBackupSnapshot({
    studentRefId: requestedId || normalizeText(payload.eaglesId) || "new-student",
    action: requestedId ? "updated" : "created",
    phase: "pre-save",
    actorUsername: options.updatedByUsername,
    actorRole: options.updatedByRole,
    data: existing || payload,
  })
  const result = await prisma.$transaction((tx) => saveStudentWithClient(tx, payload, studentRefId))

  if (!skipFilterCacheInvalidation) {
    await invalidateLevelAndSchoolFiltersCache()
  }

  const savedStudent = await getStudentRosterById(result.studentRefId)
  try {
    await writeStudentProfileBackupSnapshot({
      studentRefId: result.studentRefId,
      action: result.action,
      phase: "post-save",
      actorUsername: options.updatedByUsername,
      actorRole: options.updatedByRole,
      data: savedStudent,
    })
  } catch (error) {
    console.error("student profile post-save backup failed", {
      studentRefId: result.studentRefId,
      error: normalizeText(error?.message || error),
    })
  }

  return {
    action: result.action,
    student: savedStudent,
  }
}

/**
 * @param {string} studentRefId
 * @returns {Promise<{ deleted: true, studentRefId: string }>}
 */
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
    await tx.studentNewsReport.deleteMany({ where: { studentRefId: id } })
    await tx.studentPointsAdjustment.deleteMany({ where: { studentRefId: id } })
    await tx.parentPortalStudentLink.deleteMany({ where: { studentRefId: id } })
    await tx.parentProfileSubmissionQueue.deleteMany({ where: { studentRefId: id } })
    await tx.parentProfileFieldLock.deleteMany({ where: { studentRefId: id } })
    await tx.studentEnrollmentPeriod.deleteMany({ where: { studentRefId: id } })
    await tx.studentPortalAccount.deleteMany({ where: { studentRefId: id } })
    await tx.studentProfile.deleteMany({ where: { studentRefId: id } })
    await tx.student.delete({ where: { id } })
  })

  await invalidateLevelAndSchoolFiltersCache()

  return { deleted: true, studentRefId: id }
}

/**
 * @param {Array<Record<string, unknown>>} [rows]
 * @returns {Promise<{
 *   created: number,
 *   updated: number,
 *   errors: Array<Record<string, unknown>>,
 *   rowResults: Array<Record<string, unknown>>,
 *   rowLogs: Array<Record<string, unknown>>,
 *   autoFilledEaglesIds: number,
 *   autoFilledStudentNumbers: number,
 *   requireExplicitIdentity: boolean,
 * }>}
 */
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
    strictIdentity,
    autoFilledEaglesIds,
    autoFilledStudentNumbers,
    errors,
    rows: rowResults,
    logs: rowLogs,
  }
}
