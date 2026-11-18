import assert from "node:assert/strict"
import crypto from "node:crypto"
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import { parse as parseDotenv } from "dotenv"
import test from "node:test"
import "../tools/assert-prisma-environment.mjs"

const ENV_FILE = String(process.env.SIS_ENV_FILE || "").trim()
const DEV_ONLY = process.env.NODE_ENV === "development" && ENV_FILE === ".env.dev"
const ENV_VALUES = DEV_ONLY && fs.existsSync(ENV_FILE) ? parseDotenv(fs.readFileSync(ENV_FILE)) : {}
const TEST_SECRET = "KA106-local-signed-outbox-test-secret"
const TEST_PASSWORD = "KA106-Synthetic-Portal-Password!"

test("dev Moodle outbox is student-scoped and accepts only signed, replay-protected commands and receipts", { skip: !DEV_ONLY }, async (t) => {
  const previousEnvironment = Object.fromEntries([
    "MOODLE_SIS_PROVISIONING_ENABLED",
    "MOODLE_SIS_PROVISIONING_SECRET",
  ].map((key) => [key, process.env[key]]))
  Object.assign(process.env, ENV_VALUES, {
    SIS_ENV_FILE: ".env.dev",
    DOTENV_CONFIG_PATH: ".env.dev",
    NODE_ENV: "development",
    MOODLE_SIS_PROVISIONING_ENABLED: "true",
    MOODLE_SIS_PROVISIONING_SECRET: TEST_SECRET,
  })
  const { getSharedPrismaClient } = await import("../src/infra/db/prisma-client.mjs")
  const { hashScryptPassword } = await import("../src/modules/admin/users.mjs")
  const { queueMoodleEnrollmentChange, queueStudentProvisioning } = await import("../src/modules/admin/moodle-provisioning.mjs")
  const { startExerciseMailer } = await import("../server/exercise-mailer.mjs")
  const { closeStudentAdminRuntimeResources } = await import("../server/student-admin-routes.mjs")
  const prisma = await getSharedPrismaClient()
  const database = await prisma.$queryRaw`SELECT current_database() AS name`
  assert.equal(database[0]?.name, "sis_dev", "synthetic Moodle provisioning is restricted to the dev database")
  const outstandingBefore = await prisma.moodleProvisioningCommand.count({ where: { status: { in: ["pending", "retry", "processing"] } } })
  assert.equal(outstandingBefore, 0, "the test poll must not encounter unrelated Moodle outbox commands")

  const stamp = randomUUID()
  const compactStamp = stamp.replaceAll("-", "")
  const eaglesId = `ka106-${compactStamp.slice(0, 20)}`
  const studentNumber = 500000 + (Number.parseInt(compactStamp.slice(0, 8), 16) % 400000)
  const externalKey = `ka106-moodle-${compactStamp}`
  const studentEmail = `ka106-${compactStamp}@example.invalid`
  const moodleUserId = 910000 + (Number.parseInt(compactStamp.slice(8, 14), 16) % 80000)
  const usedNonces = []
  let studentRefId = ""
  let server = null
  let emailTransportCalls = 0
  const cleanupErrors = []
  const attempt = async (operation) => {
    try { await operation() } catch (error) { cleanupErrors.push(error) }
  }

  t.after(async () => {
    if (!studentRefId) {
      const studentRow = await prisma.student.findUnique({ where: { eaglesId }, select: { id: true } }).catch((error) => {
        cleanupErrors.push(error)
        return null
      })
      studentRefId = studentRow?.id || ""
    }
    if (studentRefId) {
      const commands = await prisma.moodleProvisioningCommand.findMany({ where: { studentRefId }, select: { id: true } }).catch((error) => {
        cleanupErrors.push(error)
        return []
      })
      const commandIds = commands.map((command) => command.id)
      if (commandIds.length) {
        await attempt(() => prisma.moodleProvisioningReceipt.deleteMany({ where: { commandId: { in: commandIds } } }))
        await attempt(() => prisma.moodleProvisioningCommand.deleteMany({ where: { id: { in: commandIds } } }))
      }
      await attempt(() => prisma.moodleUserLink.deleteMany({ where: { studentRefId } }))
      await attempt(() => prisma.studentEnrollmentPeriod.deleteMany({ where: { studentRefId } }))
      await attempt(() => prisma.studentProfile.deleteMany({ where: { studentRefId } }))
      await attempt(() => prisma.student.deleteMany({ where: { id: studentRefId } }))
    }
    if (usedNonces.length) {
      await attempt(() => prisma.moodleProvisioningNonce.deleteMany({ where: { source: "moodle", nonce: { in: usedNonces } } }))
    }
    const remaining = await Promise.all([
      prisma.student.count({ where: { eaglesId } }),
      studentRefId ? prisma.studentProfile.count({ where: { studentRefId } }) : 0,
      studentRefId ? prisma.studentEnrollmentPeriod.count({ where: { studentRefId } }) : 0,
      studentRefId ? prisma.moodleUserLink.count({ where: { studentRefId } }) : 0,
      studentRefId ? prisma.moodleProvisioningCommand.count({ where: { studentRefId } }) : 0,
      usedNonces.length ? prisma.moodleProvisioningNonce.count({ where: { source: "moodle", nonce: { in: usedNonces } } }) : 0,
    ]).catch((error) => {
      cleanupErrors.push(error)
      return [1, 1, 1, 1, 1, 1]
    })
    if (server?.listening) {
      await attempt(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
    }
    await attempt(() => closeStudentAdminRuntimeResources())
    await attempt(() => prisma.$disconnect())
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    assert.deepEqual(remaining, [0, 0, 0, 0, 0, 0], "all synthetic Moodle outbox, link, and nonce records must be removed")
    assert.equal(emailTransportCalls, 0, "Moodle provisioning must not send email")
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Synthetic Moodle provisioning cleanup failed")
  })

  const student = await prisma.student.create({ data: {
    externalKey,
    studentNumber,
    eaglesId,
    email: studentEmail,
  }, select: { id: true, studentNumber: true, eaglesId: true, email: true } })
  studentRefId = student.id
  const profile = {
    englishName: `Synthetic ${compactStamp.slice(0, 6)}`,
    fullName: `Synthetic KA 106 ${compactStamp.slice(0, 10)}`,
    studentEmail,
    currentGrade: "A1 Movers",
  }
  await prisma.studentProfile.create({ data: {
    studentRefId,
    sourceFormId: externalKey,
    ...profile,
    genderSelections: [],
    languagesAtHome: [],
    learningDisorders: [],
    covidShotHistory: [],
    feverMedicineAllowed: [],
  } })
  await prisma.studentEnrollmentPeriod.create({ data: {
    studentRefId,
    schoolYear: "2026-2027",
    level: "A1 Movers",
    status: "active",
    startedAt: new Date("2026-08-22T00:00:00.000Z"),
  } })

  await prisma.$transaction((tx) => queueStudentProvisioning(tx, {
    student,
    profile,
    password: TEST_PASSWORD,
    isNew: true,
  }))
  const initialCommands = await prisma.moodleProvisioningCommand.findMany({ where: { studentRefId }, orderBy: { sequence: "asc" } })
  assert.deepEqual(initialCommands.map((command) => command.action), ["upsert_user", "set_password", "add_cohort", "promote_student"])
  assert.ok(initialCommands.every((command) => command.studentRefId === studentRefId))
  const passwordCommand = initialCommands.find((command) => command.action === "set_password")
  assert.ok(passwordCommand?.encryptedPayload)
  assert.equal(passwordCommand?.encryptedPayload.includes(TEST_PASSWORD), false)
  assert.equal(JSON.stringify({ payloadJson: passwordCommand?.payloadJson, encryptedPayload: passwordCommand?.encryptedPayload }).includes(TEST_PASSWORD), false)
  assert.equal((await prisma.moodleUserLink.findUnique({ where: { studentRefId } }))?.status, "pending")

  server = await startExerciseMailer({
    transporter: {
      verify(callback) { setImmediate(() => callback(null, true)) },
      async sendMail() { emailTransportCalls += 1; throw new Error("Moodle provisioning test must not send email") },
    },
    port: 0,
  })
  await new Promise((resolve, reject) => {
    server.once("listening", resolve)
    server.once("error", reject)
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  const signedHeaders = (body) => {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const nonce = crypto.randomBytes(18).toString("base64url")
    usedNonces.push(nonce)
    const signature = crypto.createHmac("sha256", TEST_SECRET).update(`${timestamp}\n${nonce}\n${body}`, "utf8").digest("hex")
    return {
      "content-type": "application/json",
      "x-sis-source": "moodle",
      "x-sis-timestamp": timestamp,
      "x-sis-nonce": nonce,
      "x-sis-signature": signature,
    }
  }
  const verifySignedResponse = async (response) => {
    const body = await response.text()
    const timestamp = response.headers.get("x-sis-timestamp") || ""
    const nonce = response.headers.get("x-sis-nonce") || ""
    const supplied = response.headers.get("x-sis-signature") || ""
    const expected = crypto.createHmac("sha256", TEST_SECRET).update(`${timestamp}\n${nonce}\n${body}`, "utf8").digest("hex")
    assert.equal(supplied, expected, "SIS must sign every response body")
    assert.ok(nonce)
    return JSON.parse(body)
  }
  const postSigned = async (pathname, payload, headers = null) => {
    const body = JSON.stringify(payload)
    return fetch(`${origin}${pathname}`, { method: "POST", headers: headers || signedHeaders(body), body })
  }

  const linkPayload = { links: [{ eaglesId, studentNumber, moodleUserId }] }
  const linkResponse = await postSigned("/api/moodle/provisioning/link", linkPayload)
  assert.equal(linkResponse.status, 200)
  assert.deepEqual(await verifySignedResponse(linkResponse), { linked: 1 })
  const link = await prisma.moodleUserLink.findUnique({ where: { studentRefId } })
  assert.equal(link?.moodleUserId, moodleUserId)
  assert.equal(link?.status, "active")

  const levelChange = await prisma.$transaction((tx) => queueMoodleEnrollmentChange(tx, {
    student,
    action: "promote",
    fromLevel: "Movers",
    toLevel: "A2 Flyers",
  }))
  assert.deepEqual(levelChange, { queued: true, actions: ["promote_student"] })
  const enrollmentCommand = await prisma.moodleProvisioningCommand.findFirst({
    where: { studentRefId, action: "promote_student" },
    orderBy: { sequence: "desc" },
  })
  assert.equal(enrollmentCommand?.payloadJson?.fromLevel, "A1 Movers")
  assert.equal(enrollmentCommand?.payloadJson?.toLevel, "A2 Flyers")

  const pollBody = JSON.stringify({ limit: 20 })
  const pollHeaders = signedHeaders(pollBody)
  const pollResponse = await fetch(`${origin}/api/moodle/provisioning/poll`, { method: "POST", headers: pollHeaders, body: pollBody })
  assert.equal(pollResponse.status, 200)
  const pollResult = await verifySignedResponse(pollResponse)
  assert.deepEqual(pollResult.commands.map((command) => command.action), [
    "upsert_user", "set_password", "add_cohort", "promote_student", "promote_student",
  ])
  assert.ok(pollResult.commands.every((command) => command.payload.eaglesId === eaglesId && command.payload.studentNumber === studentNumber))
  assert.equal(JSON.stringify(pollResult).includes(TEST_PASSWORD), false)
  const replayResponse = await fetch(`${origin}/api/moodle/provisioning/poll`, { method: "POST", headers: pollHeaders, body: pollBody })
  assert.equal(replayResponse.status, 409, "a signed poll nonce must be one-use")
  assert.deepEqual(await verifySignedResponse(replayResponse), { errorCode: "request_rejected" })

  const userCommand = pollResult.commands.find((command) => command.action === "upsert_user")
  const receiptResponse = await postSigned("/api/moodle/provisioning/receipt", {
    commandId: userCommand.id,
    outcome: "applied",
    result: { moodleUserId },
  })
  assert.equal(receiptResponse.status, 200)
  assert.equal((await verifySignedResponse(receiptResponse)).outcome, "applied")
  const passwordReceipt = await postSigned("/api/moodle/provisioning/receipt", {
    commandId: passwordCommand.id,
    outcome: "applied",
    result: { moodleUserId },
  })
  assert.equal(passwordReceipt.status, 200)
  await verifySignedResponse(passwordReceipt)
  const disposedPassword = await prisma.moodleProvisioningCommand.findUnique({ where: { id: passwordCommand.id } })
  assert.equal(disposedPassword?.encryptedPayload, null)
  assert.equal(disposedPassword?.payloadJson, null)
  assert.equal(disposedPassword?.status, "applied")
  assert.equal(await prisma.parentPortalAccount.count({ where: { parentsId: { startsWith: "KA106" } } }), 0)
  assert.equal(await prisma.adminUser.count({ where: { username: { startsWith: "KA106" } } }), 0)
  assert.equal(emailTransportCalls, 0)
})
