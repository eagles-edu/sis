// @ts-check
import crypto from "node:crypto"
import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import { getSisConfigSnapshotSync } from "../admin/sis-config-store.mjs"
import { saveGradeRecord } from "../admin/student-records.mjs"

const SECRET_ENV = "GOOGLE_FORMS_GRADES_SECRET"
const SOURCE_NAME = "google-forms-grades"
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000
const NONCE_TTL_MS = 10 * 60 * 1000
const MAX_BODY_BYTES = 64 * 1024
const ALLOWED_FIELDS = new Set([
  "eaglesId",
  "title",
  "score",
  "maxScore",
  "sourceAttemptId",
])

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim()
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let totalBytes = 0
    request.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      totalBytes += buffer.length
      if (totalBytes > MAX_BODY_BYTES) {
        const error = Object.assign(new Error("Request body too large"), { statusCode: 413 })
        reject(error)
        request.destroy()
        return
      }
      chunks.push(buffer)
    })
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8")
      let payload
      try {
        payload = JSON.parse(raw)
      } catch {
        reject(Object.assign(new Error("Invalid JSON body"), { statusCode: 400 }))
        return
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        reject(Object.assign(new Error("JSON object required"), { statusCode: 400 }))
        return
      }
      resolve({ raw, payload })
    })
    request.on("error", reject)
  })
}

function requestSignature(secret, source, timestamp, nonce, raw) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${source}\n${timestamp}\n${nonce}\n${raw}`, "utf8")
    .digest("hex")
}

function safeEqualHex(left, right) {
  if (!/^[a-f0-9]{64}$/iu.test(left) || !/^[a-f0-9]{64}$/iu.test(right)) return false
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"))
}

function fail(statusCode, message) {
  throw Object.assign(new Error(message), { statusCode })
}

function parseIsoDate(value) {
  const textValue = text(value)
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(textValue)) return null
  const date = new Date(`${textValue}T00:00:00.000Z`)
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== textValue ? null : date
}

function nextIsoDate(value) {
  const date = parseIsoDate(value)
  if (!date) return ""
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

function resolveSchoolQuarter(submittedAt, schoolSetup) {
  const schoolYear = text(schoolSetup?.schoolYear)
  const startDate = text(schoolSetup?.startDate).slice(0, 10)
  const endDate = text(schoolSetup?.endDate).slice(0, 10)
  const quarters = Array.isArray(schoolSetup?.quarters) ? schoolSetup.quarters : []
  const start = parseIsoDate(startDate)
  const end = parseIsoDate(endDate)
  if (!/^\d{4}-\d{4}$/u.test(schoolYear) || !start || !end || start > end || quarters.length !== 4) {
    fail(422, "SIS school setup is missing valid school-year and quarter dates")
  }

  const derivedSchoolYear = `${start.getUTCFullYear()}-${end.getUTCFullYear()}`
  if (schoolYear !== derivedSchoolYear) {
    fail(422, "SIS school-year dates do not match the configured school year")
  }

  const normalizedQuarters = quarters.map((quarter, index) => {
    const quarterName = text(quarter?.quarter || quarter?.key).toLowerCase()
    const quarterStart = text(quarter?.startDate).slice(0, 10)
    const quarterEnd = text(quarter?.endDate).slice(0, 10)
    if (quarterName !== `q${index + 1}` || !parseIsoDate(quarterStart) || !parseIsoDate(quarterEnd) || quarterStart > quarterEnd) {
      fail(422, "SIS school setup has invalid quarter boundaries")
    }
    if (index === 0 && quarterStart !== startDate) fail(422, "SIS Q1 does not match the school-year start date")
    if (index > 0 && quarterStart !== nextIsoDate(text(quarters[index - 1]?.endDate).slice(0, 10))) {
      fail(422, "SIS quarter dates are not sequential")
    }
    if (index === 3 && quarterEnd !== endDate) fail(422, "SIS Q4 does not match the school-year end date")
    return { quarter: quarterName, startDate: quarterStart, endDate: quarterEnd }
  })

  const submittedDate = new Date(submittedAt)
  if (Number.isNaN(submittedDate.valueOf())) fail(400, "submittedAt is invalid")
  const submittedDay = submittedDate.toISOString().slice(0, 10)
  const matches = normalizedQuarters.filter((quarter) => submittedDay >= quarter.startDate && submittedDay <= quarter.endDate)
  if (matches.length !== 1) fail(422, "submittedAt does not fall within exactly one configured SIS quarter")
  return { schoolYear, quarter: matches[0].quarter }
}

function assertValidPayload(payload) {
  const unexpectedFields = Object.keys(payload).filter((key) => !ALLOWED_FIELDS.has(key))
  if (unexpectedFields.length) {
    fail(400, "Unexpected grade submission fields")
  }
  for (const key of ["eaglesId", "title"]) {
    if (!text(payload[key])) {
      fail(400, `${key} is required`)
    }
  }
  if (text(payload.title).length > 255) {
    fail(400, "title is too long")
  }
  if (payload.score === undefined || payload.score === null || payload.score === "" || !Number.isFinite(Number(payload.score))) {
    fail(400, "score must be numeric")
  }
  if (payload.maxScore === undefined || payload.maxScore === null || payload.maxScore === "") {
    fail(400, "maxScore is required for percentage calculation")
  }
  if (!Number.isFinite(Number(payload.maxScore)) || Number(payload.maxScore) <= 0) {
    fail(400, "maxScore must be a positive number")
  }
  if (payload.sourceAttemptId !== undefined && text(payload.sourceAttemptId).length > 255) {
    fail(400, "sourceAttemptId is too long")
  }
}

async function authenticateRequest(request, raw) {
  const secret = text(process.env[SECRET_ENV])
  if (!secret) {
    throw Object.assign(new Error(`${SECRET_ENV} is not configured`), { statusCode: 503 })
  }

  const source = text(request.headers["x-sis-source"])
  const timestamp = text(request.headers["x-sis-timestamp"])
  const nonce = text(request.headers["x-sis-nonce"])
  const suppliedSignature = text(request.headers["x-sis-signature"]).toLowerCase()
  const seconds = Number(timestamp)
  if (
    source !== SOURCE_NAME
    || !Number.isInteger(seconds)
    || Math.abs(Date.now() - seconds * 1000) > MAX_CLOCK_SKEW_MS
    || !/^[A-Za-z0-9_-]{20,100}$/u.test(nonce)
    || !safeEqualHex(requestSignature(secret, source, timestamp, nonce, raw), suppliedSignature)
  ) {
    throw Object.assign(new Error("Invalid signed request"), { statusCode: 401 })
  }

  const prisma = await getSharedPrismaClient()
  try {
    await prisma.moodleProvisioningNonce.create({
      data: {
        source: SOURCE_NAME,
        nonce,
        expiresAt: new Date(Date.now() + NONCE_TTL_MS),
      },
    })
  } catch (error) {
    if (/** @type {{ code?: string }} */ (error)?.code === "P2002") {
      throw Object.assign(new Error("Replayed request"), { statusCode: 409 })
    }
    throw error
  }
  await prisma.moodleProvisioningNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } })
}

export async function processGoogleFormsGradeSubmission(request) {
  const { raw, payload } = await readBody(request)
  await authenticateRequest(request, raw)
  assertValidPayload(payload)

  const prisma = await getSharedPrismaClient()
  const submittedAt = new Date().toISOString()
  const schoolSetup = getSisConfigSnapshotSync()?.uiSettings?.schoolSetup || null
  const { schoolYear, quarter } = resolveSchoolQuarter(submittedAt, schoolSetup)
  const student = await prisma.student.findUnique({
    where: { eaglesId: text(payload.eaglesId) },
    select: {
      id: true,
      enrollmentPeriods: {
        where: {
          schoolYear,
          status: "active",
          endedAt: null,
        },
        orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
        take: 2,
        select: { id: true, level: true },
      },
    },
  })
  if (!student) {
    fail(404, "Student not found")
  }

  const enrollmentPeriods = Array.isArray(student.enrollmentPeriods) ? student.enrollmentPeriods : []
  if (enrollmentPeriods.length !== 1 || !text(enrollmentPeriods[0]?.level)) {
    fail(422, "Student must have exactly one active, leveled enrollment in the configured school year")
  }
  const sourceAttemptId = text(payload.sourceAttemptId) || crypto
    .createHash("sha256")
    .update(JSON.stringify([
      text(payload.eaglesId),
      text(payload.title),
      submittedAt,
      Number(payload.score),
      payload.maxScore === undefined || payload.maxScore === null || payload.maxScore === "" ? null : Number(payload.maxScore),
    ]))
    .digest("hex")

  const record = await saveGradeRecord(student.id, {
    className: enrollmentPeriods[0].level,
    level: enrollmentPeriods[0].level,
    schoolYear,
    quarter,
    enrollmentPeriodId: enrollmentPeriods[0].id,
    assignmentName: text(payload.title),
    submittedAt,
    score: Number(payload.score),
    maxScore: payload.maxScore === undefined || payload.maxScore === null || payload.maxScore === "" ? null : Number(payload.maxScore),
    sourceAttemptId,
    sourceSystem: "google-forms",
    sourceOriginLabel: "Google Forms",
    sourceOriginHost: null,
  })
  return { ok: true, recordId: record.id }
}
