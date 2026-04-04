// server/student-intake-store.mjs

import fs from "node:fs"
import path from "node:path"
import { getSharedPrismaClient } from "./prisma-client-factory.mjs"

const DEFAULT_SCHEMA_PATH = path.resolve(process.cwd(), "schemas/member-intake-cf3.schema.json")
const SKIPPED_REQUIRED_FIELDS = new Set(["hcaptcha_84", "submit_1"])

function resolveBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value !== 0
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return fallback
    if (["true", "1", "yes"].includes(normalized)) return true
    if (["false", "0", "no"].includes(normalized)) return false
  }
  return fallback
}

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase()
}

function normalizeTextArray(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeText(entry)).filter(Boolean)
  }
  const single = normalizeText(value)
  return single ? [single] : []
}

function normalizeInt(value) {
  const text = normalizeText(value)
  if (!text) return null
  const parsed = Number.parseInt(text, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function slugify(value) {
  const raw = normalizeLower(value)
  if (!raw) return "student"
  return raw
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

function buildStudentExternalKey(studentEmail, fullName, dobText) {
  const email = normalizeLower(studentEmail)
  if (email) return `member-email:${email}`
  const composite = `${slugify(fullName)}:${normalizeLower(dobText) || "dob-unknown"}`
  return `member:${composite}`
}

function buildSourceMaps(payload) {
  const maps = []
  if (payload && typeof payload === "object") maps.push(payload)
  if (payload?.fields && typeof payload.fields === "object") maps.push(payload.fields)
  if (payload?.cf && typeof payload.cf === "object") maps.push(payload.cf)
  if (payload?.form && typeof payload.form === "object") maps.push(payload.form)
  if (payload?.data && typeof payload.data === "object") maps.push(payload.data)
  return maps
}

function readFieldValue(maps, dataName, name) {
  const candidates = new Set([
    dataName,
    name || "",
    `cf[${dataName}]`,
    `cf[${dataName}][]`,
  ])

  for (let i = 0; i < maps.length; i += 1) {
    const map = maps[i]
    for (const candidate of candidates) {
      if (!candidate) continue
      if (Object.prototype.hasOwnProperty.call(map, candidate)) {
        return map[candidate]
      }
    }
  }

  return undefined
}

function hasRequiredValue(field, value) {
  if (field.control === "checkbox" || field.control === "radio") {
    return normalizeTextArray(value).length > 0
  }
  return normalizeText(value).length > 0
}

let schemaCache = null

function loadIntakeSchema() {
  if (schemaCache) return schemaCache
  const raw = fs.readFileSync(DEFAULT_SCHEMA_PATH, "utf8")
  const parsed = JSON.parse(raw)
  schemaCache = Array.isArray(parsed?.fields)
    ? parsed.fields.filter((field) => field?.control && field.control !== "meta")
    : []
  return schemaCache
}

function mapToProfile(values, sourceFormId, sourceUrl, requiredValidationOk, rawPayload) {
  const scalar = (key) => {
    const value = values[key]
    if (Array.isArray(value)) return normalizeText(value[0] || "")
    return normalizeText(value)
  }
  const arr = (key) => normalizeTextArray(values[key])

  return {
    sourceFormId,
    sourceUrl: normalizeText(sourceUrl) || null,
    fullName: scalar("Full-Name-student") || null,
    englishName: scalar("English-Name") || null,
    genderSelections: arr("gender"),
    studentPhone: scalar("student-phone") || null,
    studentEmail: scalar("student-email") || null,
    hobbies: scalar("hobbies") || null,
    dobText: scalar("DOB") || null,
    birthOrder: normalizeInt(scalar("birth-order")),
    siblingBrothers: normalizeInt(scalar("number-of-siblings-male")),
    siblingSisters: normalizeInt(scalar("number-of-siblings-female")),
    ethnicity: scalar("Ethnicity") || null,
    languagesAtHome: arr("Which languages are spoken at home"),
    otherLanguage: scalar("describe-other-language") || null,
    schoolName: scalar("Student-school") || null,
    currentGrade: scalar("Student-current-grade") || null,
    motherName: scalar("Full-Name_mother") || null,
    motherEmail: scalar("email-ma") || null,
    motherPhone: scalar("Mothers-phone") || null,
    motherEmergencyContact: scalar("emergency-contact-mother") || null,
    motherMessenger: scalar("Zalo-IM-ID-mother") || null,
    fatherName: scalar("Full-Name_father") || null,
    fatherEmail: scalar("email-ba") || null,
    fatherPhone: scalar("Fathers-phone") || null,
    fatherEmergencyContact: scalar("emergency-contact-father") || null,
    fatherMessenger: scalar("Zalo-IM-ID-ba") || null,
    streetAddress: scalar("street-address") || null,
    wardDistrict: scalar("ward-district") || null,
    city: scalar("City") || null,
    hasGlasses: scalar("wear-glasses?") || null,
    hadEyeExam: scalar("eye-exam?") || null,
    lastEyeExamDateText: scalar("date-last-eye-exam") || null,
    prescriptionMedicine: scalar("prescription-medicine?") || null,
    prescriptionDetails: scalar("explain-list-rx-meds") || null,
    learningDisorders: arr("learning-disorders"),
    learningDisorderDetails: scalar("Explain-LD-BD") || null,
    drugAllergies: scalar("drug-allergies-list") || null,
    foodEnvironmentalAllergies: scalar("food-environmental-allergies-list") || null,
    vaccinesChildhoodUpToDate: scalar("childhood-vaccines-utd") || null,
    hadCovidPositive: scalar("COVID-19-positive-or-had-it") || null,
    covidNegativeDateText: scalar("date-negative-after-infections") || null,
    covidShotAlready: scalar("had-covid-SHOT-already") || null,
    covidVaccinesUpToDate: scalar("Are COVID-19 vaccines up-to-date?") || null,
    covidShotHistory: arr("check-each-covid-injection-student-has-had"),
    mostRecentCovidShotDate: scalar("most-recent-covid-shot") || null,
    feverMedicineAllowed: arr("fever-medicine"),
    whiteOilAllowed: scalar("dau-trang-duoc") || null,
    signatureFullName: scalar("Signature") || null,
    signatureEmail: scalar("email-form-sig") || null,
    extraComments: scalar("comments") || null,
    requiredValidationOk,
    rawFormPayload: rawPayload,
    normalizedFormPayload: values,
  }
}

function parseSubmittedAt(value) {
  const text = normalizeText(value)
  if (!text) return new Date()
  const parsed = new Date(text)
  if (Number.isNaN(parsed.valueOf())) return new Date()
  return parsed
}

let prismaClientPromise = null

function isStoreEnabled() {
  const hasDatabaseUrl = Boolean(normalizeText(process.env.DATABASE_URL))
  return resolveBoolean(process.env.STUDENT_INTAKE_STORE_ENABLED, hasDatabaseUrl)
}

async function getPrismaClient() {
  if (!isStoreEnabled()) return null
  if (prismaClientPromise) return prismaClientPromise

  prismaClientPromise = getSharedPrismaClient()

  try {
    return await prismaClientPromise
  } catch (error) {
    prismaClientPromise = null
    throw error
  }
}

export async function persistStudentIntakeSubmission(payload = {}) {
  if (!isStoreEnabled()) return { saved: false, reason: "disabled" }

  const prisma = await getPrismaClient()
  if (!prisma) return { saved: false, reason: "disabled" }

  const schema = loadIntakeSchema()
  const maps = buildSourceMaps(payload)
  const values = {}
  const missingRequired = []

  for (let i = 0; i < schema.length; i += 1) {
    const field = schema[i]
    const rawValue = readFieldValue(maps, field.dataName, field.name)
    const normalizedValue =
      field.control === "checkbox" || field.control === "radio"
        ? normalizeTextArray(rawValue)
        : normalizeText(rawValue)

    values[field.dataName] = normalizedValue

    if (field.required && !SKIPPED_REQUIRED_FIELDS.has(field.dataName)) {
      if (!hasRequiredValue(field, normalizedValue)) {
        missingRequired.push(field.dataName)
      }
    }
  }

  const sourceFormId = normalizeText(payload?.sourceFormId) || "cf3"
  const sourceUrl = normalizeText(payload?.sourceUrl)
  const submittedAt = parseSubmittedAt(payload?.submittedAt || payload?.completedAt)
  const studentEmail = normalizeText(values["student-email"] || values["email-ma"] || values["email-form-sig"])
  const fullName = normalizeText(values["Full-Name-student"] || values["Signature"])
  const dobText = normalizeText(values["DOB"])
  const externalKey = buildStudentExternalKey(studentEmail, fullName, dobText)
  const requiredValidationOk = missingRequired.length === 0

  const result = await prisma.$transaction(async (tx) => {
    const student = await tx.student.upsert({
      where: { externalKey },
      update: {
        email: studentEmail || null,
      },
      create: {
        externalKey,
        email: studentEmail || null,
      },
    })

    const profileData = mapToProfile(
      values,
      sourceFormId,
      sourceUrl || payload?.sourcePageUrl || "",
      requiredValidationOk,
      payload
    )

    const profile = await tx.studentProfile.upsert({
      where: { studentRefId: student.id },
      update: profileData,
      create: {
        ...profileData,
        studentRefId: student.id,
      },
    })

    const submission = await tx.studentIntakeSubmission.create({
      data: {
        studentRefId: student.id,
        sourceFormId,
        sourceUrl: sourceUrl || null,
        submittedAt,
        fieldsJson: values,
        missingRequiredJson: missingRequired.length ? missingRequired : null,
        requiredValidationOk,
      },
    })

    return { student, profile, submission }
  })

  return {
    saved: true,
    studentId: result.student.id,
    profileId: result.profile.id,
    intakeSubmissionId: result.submission.id,
    missingRequired,
    requiredValidationOk,
  }
}
