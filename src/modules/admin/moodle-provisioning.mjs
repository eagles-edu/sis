// @ts-check
import crypto from "node:crypto"
import { getSharedPrismaClient } from "../../infra/db/prisma-client.mjs"
import { canonicalizeLevel } from "./level-catalog.mjs"

const SECRET_ENV = "MOODLE_SIS_PROVISIONING_SECRET"
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000
const NONCE_TTL_MS = 10 * 60 * 1000
const MAX_BODY_BYTES = 256 * 1024
const PASSWORD_CONTEXT = "eagles-sis-moodle-password-v1"
const TERMINAL_OUTCOMES = new Set(["applied", "disabled", "rejected"])

export function isMoodleProvisioningEnabled() {
  const configured = text(process.env[SECRET_ENV])
  const enabled = text(process.env.MOODLE_SIS_PROVISIONING_ENABLED).toLowerCase()
  return Boolean(configured) && !["false", "0", "no", "off"].includes(enabled)
}

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim()
}

function idempotencyKey() {
  return crypto.randomUUID()
}

function derivePasswordKey(secret) {
  return Buffer.from(crypto.hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), Buffer.from(PASSWORD_CONTEXT), 32))
}

function encryptOneTimePassword(password, secret) {
  if (!secret) throw new Error("Moodle provisioning secret is not configured")
  const nonce = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", derivePasswordKey(secret), nonce)
  const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()])
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64")
}

/** @param {import("@prisma/client").Prisma.TransactionClient | import("@prisma/client").PrismaClient} tx */
export async function queueMoodleCommand(tx, { studentRefId = null, action, payload = null, password = "", key = idempotencyKey() }) {
  const normalizedAction = text(action)
  if (!normalizedAction) throw new Error("Moodle command action is required")
  const encryptedPayload = password ? encryptOneTimePassword(password, text(process.env[SECRET_ENV])) : null
  let commandPayload = payload
  const studentId = text(studentRefId)
  if (studentId && payload && typeof payload === "object" && !Array.isArray(payload)) {
    const identity = await tx.student.findUnique({ where: { id: studentId }, select: { eaglesId: true, studentNumber: true } })
    if (!identity) throw Object.assign(new Error("Student not found for Moodle command"), { statusCode: 404 })
    commandPayload = { ...payload, eaglesId: identity.eaglesId, studentNumber: identity.studentNumber }
  }
  return tx.moodleProvisioningCommand.create({
    data: {
      studentRefId: studentId || null,
      action: normalizedAction,
      idempotencyKey: key,
      payloadJson: commandPayload,
      encryptedPayload,
    },
  })
}

export async function queueStudentProvisioning(tx, { student, profile, password = "", previousLevel = "", isNew = false }) {
  const eaglesId = text(student?.eaglesId)
  const studentNumber = Number(student?.studentNumber)
  const englishName = text(profile?.englishName)
  const fullName = text(profile?.fullName)
  const email = text(student?.email || profile?.studentEmail)
  const level = canonicalizeLevel(profile?.currentGrade) || ""
  const oldLevel = canonicalizeLevel(previousLevel) || ""
  const initialPassword = isNew && !password ? text(process.env.MOODLE_SIS_INITIAL_PASSWORD) : ""
  const effectivePassword = password || initialPassword
  const existingLink = await tx.moodleUserLink.findUnique({ where: { studentRefId: student.id } })
  if (existingLink?.status === "disabled") return { queued: false, reason: "disabled", missing: [] }
  const missing = [
    !eaglesId && "eagles_id",
    !Number.isInteger(studentNumber) && "student_number",
    !englishName && "english_name",
    !fullName && "full_name",
    !email && "email",
    !level && "level",
    isNew && !effectivePassword && "initial_password",
  ].filter(Boolean)

  await tx.moodleUserLink.upsert({
    where: { studentRefId: student.id },
    update: { eaglesId, studentNumber, status: missing.length ? "blocked" : "pending", lastErrorCode: missing.length ? "missing_student_fields" : null },
    create: { studentRefId: student.id, eaglesId, studentNumber, status: missing.length ? "blocked" : "pending", lastErrorCode: missing.length ? "missing_student_fields" : null },
  })
  if (missing.length) return { queued: false, reason: "missing_student_fields", missing }

  await queueMoodleCommand(tx, {
    studentRefId: student.id,
    action: "upsert_user",
    payload: { eaglesId, studentNumber, englishName, fullName, email, level },
  })
  if (effectivePassword) {
    await queueMoodleCommand(tx, { studentRefId: student.id, action: "set_password", payload: { eaglesId }, password: effectivePassword })
  }
  await queueMoodleCommand(tx, { studentRefId: student.id, action: "add_cohort", payload: { cohortIdnumber: "eagles-club", cohortName: "Eagles Club" } })
  if ((oldLevel && oldLevel !== level) || isNew || !existingLink || existingLink.status !== "active") {
    await queueMoodleCommand(tx, {
      studentRefId: student.id,
      action: "promote_student",
      payload: { fromLevel: oldLevel === level ? "" : oldLevel, toLevel: level },
    })
  }
  return { queued: true }
}

export async function queueMoodleEnrollmentChange(tx, { student, action, fromLevel = "", toLevel = "" }) {
  if (!isMoodleProvisioningEnabled()) return { queued: false, reason: "disabled" }

  const studentRefId = text(student?.id)
  if (!studentRefId) throw Object.assign(new Error("studentRefId is required for Moodle enrollment changes"), { statusCode: 400 })

  const link = await tx.moodleUserLink.findUnique({
    where: { studentRefId },
    select: { status: true, moodleUserId: true },
  })
  const linkCanReceiveCommands = link?.status === "active" || link?.status === "pending" ||
    (link?.status === "blocked" && Boolean(link.moodleUserId))
  if (!linkCanReceiveCommands) return { queued: false, reason: "not_linked" }

  const previousLevel = canonicalizeLevel(fromLevel) || ""
  if (action === "promote") {
    const nextLevel = canonicalizeLevel(toLevel) || ""
    if (!nextLevel) throw Object.assign(new Error("toLevel is required for Moodle promotion"), { statusCode: 400 })
    if (previousLevel === nextLevel) return { queued: false, reason: "unchanged_level" }
    await queueMoodleCommand(tx, {
      studentRefId,
      action: "promote_student",
      payload: { fromLevel: previousLevel, toLevel: nextLevel },
    })
    return { queued: true, actions: ["promote_student"] }
  }

  if (action === "unenroll") {
    if (!previousLevel) return { queued: false, reason: "missing_level" }
    await queueMoodleCommand(tx, {
      studentRefId,
      action: "unenrol",
      payload: { level: previousLevel },
    })
    await queueMoodleCommand(tx, {
      studentRefId,
      action: "remove_cohort",
      payload: { cohortIdnumber: previousLevel, cohortName: previousLevel },
    })
    return { queued: true, actions: ["unenrol", "remove_cohort"] }
  }

  throw Object.assign(new Error("Unsupported Moodle enrollment change"), { statusCode: 400 })
}

export async function disableMoodleStudent(studentRefId) {
  if (!isMoodleProvisioningEnabled()) throw Object.assign(new Error("Moodle provisioning is not configured"), { statusCode: 503 })
  const prisma = await getSharedPrismaClient()
  const id = text(studentRefId)
  if (!id) throw Object.assign(new Error("studentRefId is required"), { statusCode: 400 })
  return prisma.$transaction(async (tx) => {
    const student = await tx.student.findUnique({ where: { id }, select: { id: true, eaglesId: true, studentNumber: true } })
    if (!student) throw Object.assign(new Error("Student not found"), { statusCode: 404 })
    await tx.moodleUserLink.upsert({
      where: { studentRefId: id },
      update: { status: "disabling", lastErrorCode: null },
      create: { studentRefId: id, eaglesId: student.eaglesId, studentNumber: student.studentNumber, status: "disabling" },
    })
    await tx.studentPortalAccount.updateMany({ where: { studentRefId: id }, data: { status: "disabled" } })
    const command = await queueMoodleCommand(tx, {
      studentRefId: id,
      action: "disable_user",
      payload: { eaglesId: student.eaglesId, studentNumber: student.studentNumber },
    })
    return { ok: true, pending: true, commandId: command.id }
  })
}

async function readBody(request) {
  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > MAX_BODY_BYTES) throw Object.assign(new Error("Request body too large"), { statusCode: 413 })
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks).toString("utf8")
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    throw Object.assign(new Error("Invalid JSON body"), { statusCode: 400 })
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw Object.assign(new Error("JSON object required"), { statusCode: 400 })
  return { raw, payload }
}

function signature(secret, timestamp, nonce, raw) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}\n${nonce}\n${raw}`, "utf8").digest("hex")
}

function safeEqualHex(left, right) {
  if (!/^[a-f0-9]{64}$/iu.test(left) || !/^[a-f0-9]{64}$/iu.test(right)) return false
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"))
}

function sendSigned(response, status, secret, payload) {
  const raw = JSON.stringify(payload)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = crypto.randomBytes(18).toString("base64url")
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-SIS-Timestamp": timestamp,
    "X-SIS-Nonce": nonce,
    "X-SIS-Signature": signature(secret, timestamp, nonce, raw),
  })
  response.end(raw)
}

async function authenticate(request, raw, payload, secret) {
  const headers = request.headers
  const source = text(headers["x-sis-source"]).toLowerCase()
  const timestamp = text(headers["x-sis-timestamp"])
  const nonce = text(headers["x-sis-nonce"])
  const supplied = text(headers["x-sis-signature"]).toLowerCase()
  const seconds = Number(timestamp)
  if (source !== "moodle" || !Number.isInteger(seconds) || Math.abs(Date.now() - seconds * 1000) > MAX_CLOCK_SKEW_MS || !/^[A-Za-z0-9_-]{20,100}$/u.test(nonce)) {
    throw Object.assign(new Error("Invalid signed request"), { statusCode: 401 })
  }
  if (!safeEqualHex(signature(secret, timestamp, nonce, raw), supplied)) throw Object.assign(new Error("Invalid signed request"), { statusCode: 401 })
  const prisma = await getSharedPrismaClient()
  try {
    await prisma.moodleProvisioningNonce.create({ data: { source, nonce, expiresAt: new Date(Date.now() + NONCE_TTL_MS) } })
  } catch (error) {
    if (/** @type {{ code?: string }} */ (error)?.code === "P2002") throw Object.assign(new Error("Replayed request"), { statusCode: 409 })
    throw error
  }
  await prisma.moodleProvisioningNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  return { prisma, payload }
}

async function pollCommands(prisma, payload) {
  if (Object.keys(payload).some((key) => key !== "limit")) throw Object.assign(new Error("Unexpected poll fields"), { statusCode: 400 })
  const limit = Math.max(1, Math.min(100, Number(payload.limit) || 50))
  const commands = await prisma.moodleProvisioningCommand.findMany({
    where: {
      status: { in: ["pending", "retry", "processing"] },
    },
    orderBy: { sequence: "asc" },
    take: limit,
  })
  const rejection = await prisma.moodleProvisioningCommand.findFirst({
    where: { status: "rejected" },
    orderBy: { sequence: "asc" },
    select: { sequence: true },
  })
  const beforeRejected = rejection ? commands.filter((command) => command.sequence < rejection.sequence) : commands
  const eligible = []
  const now = Date.now()
  for (const command of beforeRejected) {
    if (command.nextAttemptAt.valueOf() > now) break
    eligible.push(command)
  }
  for (const command of eligible) {
    await prisma.moodleProvisioningCommand.update({ where: { id: command.id }, data: { status: "processing", attemptCount: { increment: 1 } } })
  }
  return eligible.map((command) => ({
    id: command.id,
    sequence: command.sequence.toString(),
    action: command.action,
    idempotencyKey: command.idempotencyKey,
    payload: command.payloadJson,
    encryptedPayload: command.encryptedPayload,
  }))
}

async function receiveReceipt(prisma, payload) {
  if (Object.keys(payload).some((key) => !["commandId", "outcome", "result", "errorCode", "retryAfterSeconds"].includes(key))) throw Object.assign(new Error("Unexpected receipt fields"), { statusCode: 400 })
  const commandId = text(payload.commandId)
  const outcome = text(payload.outcome)
  if (!commandId || ![...TERMINAL_OUTCOMES, "retry"].includes(outcome)) throw Object.assign(new Error("Invalid receipt"), { statusCode: 400 })
  const command = await prisma.moodleProvisioningCommand.findUnique({ where: { id: commandId } })
  if (!command) throw Object.assign(new Error("Unknown command"), { statusCode: 404 })
  if (outcome === "disabled" && command.action !== "disable_user") throw Object.assign(new Error("Receipt outcome does not match command"), { statusCode: 400 })
  if (outcome === "applied" && command.action === "disable_user") throw Object.assign(new Error("Receipt outcome does not match command"), { statusCode: 400 })
  if (command.terminalAt) return { accepted: true, duplicate: true, status: command.status }
  if (outcome === "retry") {
    const delay = Math.max(30, Math.min(3600, Number(payload.retryAfterSeconds) || 60))
    await prisma.moodleProvisioningCommand.update({ where: { id: commandId }, data: { status: "retry", nextAttemptAt: new Date(Date.now() + delay * 1000), lastErrorCode: text(payload.errorCode).slice(0, 80) || "transient_error" } })
    return { accepted: true, retry: true }
  }
  const resultJson = payload.result && typeof payload.result === "object" && !Array.isArray(payload.result) ? payload.result : null
  await prisma.$transaction(async (tx) => {
    await tx.moodleProvisioningReceipt.create({ data: { commandId, outcome, resultJson } })
    await tx.moodleProvisioningCommand.update({ where: { id: commandId }, data: { status: outcome, terminalAt: new Date(), encryptedPayload: null, payloadJson: command.action === "set_password" ? null : command.payloadJson, lastErrorCode: outcome === "rejected" ? text(payload.errorCode).slice(0, 80) || "rejected" : null } })
    if (command.studentRefId && command.action === "upsert_user" && outcome === "applied") {
      await tx.moodleUserLink.update({ where: { studentRefId: command.studentRefId }, data: { status: "active", lastSyncedAt: new Date(), lastErrorCode: null, moodleUserId: Number(resultJson?.moodleUserId) || undefined } })
    }
    if (command.studentRefId && command.action === "disable_user" && outcome === "disabled") {
      await tx.moodleUserLink.updateMany({ where: { studentRefId: command.studentRefId }, data: { status: "disabled", lastSyncedAt: new Date(), lastErrorCode: null } })
    }
    if (command.studentRefId && outcome === "rejected") {
      await tx.moodleUserLink.updateMany({ where: { studentRefId: command.studentRefId }, data: { status: "blocked", lastErrorCode: text(payload.errorCode).slice(0, 80) || "command_rejected" } })
    }
  })
  return { accepted: true, terminal: true, outcome }
}

export async function linkMoodleUsersWithClient(client, links) {
  if (!Array.isArray(links) || links.length < 1 || links.length > 500) {
    throw Object.assign(new Error("links must contain between 1 and 500 accounts"), { statusCode: 400 })
  }
  const normalized = []
  const seenEaglesIds = new Set()
  const seenStudentNumbers = new Set()
  const seenMoodleIds = new Set()
  for (const value of links) {
    const eaglesId = text(value?.eaglesId)
    const studentNumber = Number(value?.studentNumber)
    const moodleUserId = Number(value?.moodleUserId)
    if (!eaglesId || eaglesId !== eaglesId.toLowerCase() || !Number.isSafeInteger(studentNumber) || studentNumber < 1 || !Number.isSafeInteger(moodleUserId) || moodleUserId < 1) {
      throw Object.assign(new Error("Invalid Moodle roster identity"), { statusCode: 400 })
    }
    if (seenEaglesIds.has(eaglesId) || seenStudentNumbers.has(studentNumber) || seenMoodleIds.has(moodleUserId)) {
      throw Object.assign(new Error("Duplicate Moodle roster identity"), { statusCode: 409 })
    }
    seenEaglesIds.add(eaglesId)
    seenStudentNumbers.add(studentNumber)
    seenMoodleIds.add(moodleUserId)
    normalized.push({ eaglesId, studentNumber, moodleUserId })
  }

  return client.$transaction(async (tx) => {
    const resolved = []
    for (const link of normalized) {
      const student = await tx.student.findUnique({
        where: { eaglesId: link.eaglesId },
        select: { id: true, eaglesId: true, studentNumber: true },
      })
      if (!student || Number(student.studentNumber) !== link.studentNumber) {
        throw Object.assign(new Error("Moodle roster identity does not match SIS"), { statusCode: 409 })
      }
      const existing = await tx.moodleUserLink.findUnique({ where: { studentRefId: student.id } })
      if (existing?.moodleUserId && Number(existing.moodleUserId) !== link.moodleUserId) {
        throw Object.assign(new Error("SIS student is already linked to another Moodle user"), { statusCode: 409 })
      }
      const conflicting = await tx.moodleUserLink.findFirst({
        where: { moodleUserId: link.moodleUserId, studentRefId: { not: student.id } },
        select: { studentRefId: true },
      })
      if (conflicting) {
        throw Object.assign(new Error("Moodle user is already linked to another SIS student"), { statusCode: 409 })
      }
      resolved.push({ ...link, studentRefId: student.id })
    }

    for (const link of resolved) {
      await tx.moodleUserLink.upsert({
        where: { studentRefId: link.studentRefId },
        update: {
          eaglesId: link.eaglesId,
          studentNumber: link.studentNumber,
          moodleUserId: link.moodleUserId,
          status: "active",
          lastSyncedAt: new Date(),
          lastErrorCode: null,
        },
        create: {
          studentRefId: link.studentRefId,
          eaglesId: link.eaglesId,
          studentNumber: link.studentNumber,
          moodleUserId: link.moodleUserId,
          status: "active",
          lastSyncedAt: new Date(),
        },
      })
    }
    return { linked: resolved.length }
  })
}

export async function handleMoodleProvisioningRequest(request, response) {
  const url = new URL(request.url || "", `http://${request.headers.host || "localhost"}`)
  if (!url.pathname.startsWith("/api/moodle/provisioning/")) return false
  const secret = text(process.env[SECRET_ENV])
  if (!secret) {
    response.writeHead(503, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" })
    response.end(JSON.stringify({ error: "Moodle provisioning is not configured" }))
    return true
  }
  try {
    if (request.method !== "POST" || !["/api/moodle/provisioning/poll", "/api/moodle/provisioning/receipt", "/api/moodle/provisioning/link"].includes(url.pathname)) throw Object.assign(new Error("Not found"), { statusCode: 404 })
    const { raw, payload } = await readBody(request)
    const { prisma } = await authenticate(request, raw, payload, secret)
    let result
    if (url.pathname.endsWith("/poll")) {
      result = { commands: await pollCommands(prisma, payload) }
    } else if (url.pathname.endsWith("/receipt")) {
      result = await receiveReceipt(prisma, payload)
    } else {
      if (Object.keys(payload).some((key) => key !== "links")) throw Object.assign(new Error("Unexpected link fields"), { statusCode: 400 })
      result = await linkMoodleUsersWithClient(prisma, payload.links)
    }
    sendSigned(response, 200, secret, result)
  } catch (error) {
    const status = Number(/** @type {{ statusCode?: number }} */ (error)?.statusCode) || 500
    const errorCode = status < 500 ? "request_rejected" : "provisioning_error"
    sendSigned(response, status, secret, { errorCode })
  }
  return true
}

export { encryptOneTimePassword }
