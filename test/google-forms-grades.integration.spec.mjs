import assert from "node:assert/strict"
import { createHmac, randomUUID } from "node:crypto"
import test from "node:test"
import { applyKeepaliveTestEnvironment, readKeepaliveTestEnvironment } from "../tools/keepalive-test-environment.mjs"

process.env.SIS_ENV_FILE = ".env.test"
process.env.DOTENV_CONFIG_PATH = ".env.test"
process.env.NODE_ENV = "test"
const RUNTIME = readKeepaliveTestEnvironment()
applyKeepaliveTestEnvironment(RUNTIME)
process.env.STUDENT_ADMIN_STORE_ENABLED = "true"

function syntheticStudentNumber(stamp) {
  return 800000 + (Number.parseInt(stamp.replaceAll("-", "").slice(0, 8), 16) % 100000)
}

function signedRequest(payloadOrRaw, secret, nonce = randomUUID().replaceAll("-", "")) {
  const raw = typeof payloadOrRaw === "string" ? payloadOrRaw : JSON.stringify(payloadOrRaw)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const source = "google-forms-grades"
  const signature = createHmac("sha256", secret)
    .update(`${source}\n${timestamp}\n${nonce}\n${raw}`, "utf8")
    .digest("hex")
  return {
    nonce,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sis-source": source,
        "x-sis-timestamp": timestamp,
        "x-sis-nonce": nonce,
        "x-sis-signature": signature,
      },
      body: raw,
    },
  }
}

function mockTransporter() {
  return {
    verify(callback) {
      setImmediate(() => callback(null, true))
    },
    async sendMail() {
      throw new Error("Google Forms grade checks must not send email")
    },
  }
}

test("Google Forms grade feed rejects malformed or unmatched submissions and retries one stable row idempotently", async () => {
  const { getSharedPrismaClient } = await import("../src/infra/db/prisma-client.mjs")
  const { startExerciseMailer } = await import("../server/exercise-mailer.mjs")
  const { closeStudentAdminRuntimeResources } = await import("../server/student-admin-routes.mjs")
  const prisma = await getSharedPrismaClient()
  const database = await prisma.$queryRaw`SELECT current_database() AS db`
  assert.equal(database[0]?.db, "sis-test", "synthetic grade writes are restricted to the test mirror")

  const stamp = randomUUID()
  const secret = `ka080-google-forms-${stamp}`
  const eaglesId = `KA080-GF-${stamp}`
  const assignmentName = `KA080 Google Forms retry ${stamp}`
  const sourceAttemptId = `google_forms_${stamp.replaceAll("-", "")}`
  const startedAt = "2026-11-26T03:59:00.000Z"
  const submittedAt = "2026-11-26T04:00:00.000Z"
  const sourceEmail = `ka080-google-forms-${stamp}@example.invalid`
  const nonceValues = new Set()
  let studentId = ""
  let enrollmentPeriodId = ""
  let server = null
  process.env.GOOGLE_FORMS_GRADES_SECRET = secret

  try {
    const student = await prisma.student.create({
      data: {
        externalKey: `ka080-google-forms-${stamp}`,
        studentNumber: syntheticStudentNumber(stamp),
        eaglesId,
        email: `ka080-google-forms-${stamp}@example.invalid`,
      },
      select: { id: true },
    })
    studentId = student.id
    const enrollment = await prisma.studentEnrollmentPeriod.create({
      data: {
        studentRefId: studentId,
        schoolYear: "2026-2027",
        level: "A1 Movers",
        status: "active",
        startedAt: new Date("2026-02-21T00:00:00.000Z"),
      },
      select: { id: true },
    })
    enrollmentPeriodId = enrollment.id

    server = await startExerciseMailer({ transporter: mockTransporter(), port: 0 })
    await new Promise((resolve, reject) => {
      server.once("listening", resolve)
      server.once("error", reject)
    })
    const address = server.address()
    assert.equal(typeof address, "object")
    const origin = `http://127.0.0.1:${address.port}`
    const endpoint = `${origin}/api/integrations/google-forms/grades`
    const send = async (payloadOrRaw, nonce) => {
      const request = signedRequest(payloadOrRaw, secret, nonce)
      nonceValues.add(request.nonce)
      return fetch(endpoint, request.init)
    }

    const anonymous = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eaglesId, title: assignmentName, score: 8, maxScore: 10, correctCount: 8, totalQuestions: 10, submittedAt, sourceEmail, sourceAttemptId }),
    })
    assert.equal(anonymous.status, 401)

    const firstPayload = { eaglesId, title: assignmentName, score: 8, maxScore: 10, correctCount: 8, totalQuestions: 10, startedAt, submittedAt, sourceEmail, sourceAttemptId }
    const invalidSignatureRequest = signedRequest(firstPayload, secret)
    nonceValues.add(invalidSignatureRequest.nonce)
    const validSignature = invalidSignatureRequest.init.headers["x-sis-signature"]
    invalidSignatureRequest.init.headers["x-sis-signature"] = `${validSignature[0] === "0" ? "1" : "0"}${validSignature.slice(1)}`
    const invalidSignature = await fetch(endpoint, invalidSignatureRequest.init)
    assert.equal(invalidSignature.status, 401, "a request with a valid-shaped but incorrect HMAC is rejected")
    assert.equal(
      await prisma.studentGradeRecord.count({ where: { sourceSystem: "google-forms", sourceAttemptId } }),
      0,
      "invalid signatures cannot create a grade record",
    )
    assert.equal(
      await prisma.moodleProvisioningNonce.count({ where: { source: "google-forms-grades", nonce: invalidSignatureRequest.nonce } }),
      0,
      "invalid signatures do not consume a valid nonce",
    )

    const firstRequest = signedRequest(firstPayload, secret)
    nonceValues.add(firstRequest.nonce)
    const first = await fetch(endpoint, firstRequest.init)
    assert.equal(first.status, 200)
    const firstResult = await first.json()
    assert.equal(firstResult.ok, true)

    const replay = await fetch(endpoint, firstRequest.init)
    assert.equal(replay.status, 409, "a consumed nonce cannot be replayed")

    const retry = await send({ ...firstPayload, score: 10, correctCount: 10 }, randomUUID().replaceAll("-", ""))
    assert.equal(retry.status, 200)
    const retryResult = await retry.json()
    assert.equal(retryResult.recordId, firstResult.recordId, "the same response-sheet row updates its original grade")

    const savedRows = await prisma.studentGradeRecord.findMany({
      where: { studentRefId: studentId, sourceSystem: "google-forms", sourceAttemptId },
      select: { id: true, score: true, maxScore: true, correctCount: true, totalQuestions: true, startedAt: true, submittedAt: true, sourceEmail: true, assignmentName: true, className: true, schoolYear: true, quarter: true },
    })
    assert.equal(savedRows.length, 1)
    assert.equal(savedRows[0]?.id, firstResult.recordId)
    assert.equal(savedRows[0]?.score, 10)
    assert.equal(savedRows[0]?.maxScore, 10)
    assert.equal(savedRows[0]?.correctCount, 10)
    assert.equal(savedRows[0]?.totalQuestions, 10)
    assert.equal(savedRows[0]?.startedAt?.toISOString(), startedAt)
    assert.equal(savedRows[0]?.submittedAt?.toISOString(), submittedAt)
    assert.equal(savedRows[0]?.sourceEmail, sourceEmail)
    const { mapGradeRecordForApi } = await import("../src/modules/admin/student-records.mjs")
    assert.equal(mapGradeRecordForApi(savedRows[0])?.sourceEmail, undefined, "source email remains private from grade API responses")
    const { saveGradeRecord } = await import("../src/modules/admin/student-records.mjs")
    await saveGradeRecord(studentId, {
      id: savedRows[0].id,
      className: savedRows[0].className,
      schoolYear: savedRows[0].schoolYear,
      quarter: savedRows[0].quarter,
      assignmentName,
      submittedAt,
      score: 10,
      maxScore: 10,
      sourceSystem: "google-forms",
      sourceAttemptId,
    })
    const afterManualEdit = await prisma.studentGradeRecord.findUnique({
      where: { id: savedRows[0].id },
      select: { correctCount: true, totalQuestions: true, startedAt: true, sourceEmail: true },
    })
    assert.equal(afterManualEdit?.correctCount, 10)
    assert.equal(afterManualEdit?.totalQuestions, 10)
    assert.equal(afterManualEdit?.startedAt?.toISOString(), startedAt, "grade edits that omit source timestamps preserve them")
    assert.equal(afterManualEdit?.sourceEmail, sourceEmail, "grade edits that omit source metadata preserve it")

    const invalidStartedAt = await send(
      { ...firstPayload, startedAt: "not-a-date", sourceAttemptId: `invalid-start-${stamp}` },
      randomUUID().replaceAll("-", ""),
    )
    assert.equal(invalidStartedAt.status, 400, "a provided start timestamp must be valid")

    const incorrectQuestionCount = await send(
      { ...firstPayload, correctCount: 7, sourceAttemptId: `wrong-count-${stamp}` },
      randomUUID().replaceAll("-", ""),
    )
    assert.equal(incorrectQuestionCount.status, 400, "a points/count mismatch cannot be presented as a correct-answer count")

    const missingSourceEmail = await send(
      { ...firstPayload, sourceEmail: "", sourceAttemptId: `missing-email-${stamp}` },
      randomUUID().replaceAll("-", ""),
    )
    assert.equal(missingSourceEmail.status, 400, "missing source email is rejected visibly")

    const missingSubmittedAt = await send(
      { ...firstPayload, submittedAt: "", sourceAttemptId: `missing-time-${stamp}` },
      randomUUID().replaceAll("-", ""),
    )
    assert.equal(missingSubmittedAt.status, 400, "missing source submission time is rejected visibly")

    const missingAttemptId = await send(
      { eaglesId, title: `${assignmentName} missing id`, score: 8, maxScore: 10, correctCount: 8, totalQuestions: 10, submittedAt, sourceEmail },
      randomUUID().replaceAll("-", ""),
    )
    assert.equal(missingAttemptId.status, 400)

    const emptyAttemptId = await send(
      { eaglesId, title: `${assignmentName} empty id`, score: 8, maxScore: 10, correctCount: 8, totalQuestions: 10, submittedAt, sourceEmail, sourceAttemptId: " " },
      randomUUID().replaceAll("-", ""),
    )
    assert.equal(emptyAttemptId.status, 400)

    const nonStringAttemptId = await send(
      { eaglesId, title: `${assignmentName} non-string id`, score: 8, maxScore: 10, correctCount: 8, totalQuestions: 10, submittedAt, sourceEmail, sourceAttemptId: 42 },
      randomUUID().replaceAll("-", ""),
    )
    assert.equal(nonStringAttemptId.status, 400)

    const oversizedAttemptId = await send(
      { eaglesId, title: `${assignmentName} oversized id`, score: 8, maxScore: 10, correctCount: 8, totalQuestions: 10, submittedAt, sourceEmail, sourceAttemptId: "a".repeat(256) },
      randomUUID().replaceAll("-", ""),
    )
    assert.equal(oversizedAttemptId.status, 400)

    const malformedJson = await send("{", randomUUID().replaceAll("-", ""))
    assert.equal(malformedJson.status, 400)

    const unsupportedField = await send(
      { eaglesId, title: `${assignmentName} extra field`, score: 8, maxScore: 10, correctCount: 8, totalQuestions: 10, submittedAt, sourceEmail, sourceAttemptId: `extra-${stamp}`, studentId: "unexpected" },
      randomUUID().replaceAll("-", ""),
    )
    assert.equal(unsupportedField.status, 400)

    const invalidScore = await send(
      { eaglesId, title: `${assignmentName} invalid score`, score: "eight", maxScore: 10, correctCount: 8, totalQuestions: 10, submittedAt, sourceEmail, sourceAttemptId: `invalid-${stamp}` },
      randomUUID().replaceAll("-", ""),
    )
    assert.equal(invalidScore.status, 400)

    const unmatchedId = `KA080-MISSING-${stamp}`
    const unmatched = await send(
      { eaglesId: unmatchedId, title: `${assignmentName} unmatched`, score: 8, maxScore: 10, correctCount: 8, totalQuestions: 10, submittedAt, sourceEmail, sourceAttemptId: `unmatched-${stamp}` },
      randomUUID().replaceAll("-", ""),
    )
    assert.equal(unmatched.status, 404)
    assert.equal(
      await prisma.studentGradeRecord.count({ where: { sourceSystem: "google-forms", sourceAttemptId: `unmatched-${stamp}` } }),
      0,
      "unmatched students cannot create grade rows",
    )

    const rejectedRows = await prisma.studentGradeRecord.count({
      where: { studentRefId: studentId, assignmentName: { startsWith: assignmentName }, sourceAttemptId: { not: sourceAttemptId } },
    })
    assert.equal(rejectedRows, 0, "malformed submissions cannot create grade rows")
  } finally {
    const cleanupErrors = []
    const attempt = async (operation) => {
      try {
        await operation()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    if (server) await attempt(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
    await attempt(() => closeStudentAdminRuntimeResources())
    if (studentId) await attempt(() => prisma.studentGradeRecord.deleteMany({ where: { studentRefId: studentId } }))
    if (nonceValues.size) {
      await attempt(() => prisma.moodleProvisioningNonce.deleteMany({
        where: { source: "google-forms-grades", nonce: { in: [...nonceValues] } },
      }))
    }
    if (enrollmentPeriodId) {
      await attempt(() => prisma.studentEnrollmentPeriod.deleteMany({ where: { id: enrollmentPeriodId } }))
    }
    if (studentId) await attempt(() => prisma.student.deleteMany({ where: { id: studentId } }))
    await attempt(async () => {
      const remaining = await Promise.all([
        studentId ? prisma.student.count({ where: { id: studentId } }) : 0,
        studentId ? prisma.studentGradeRecord.count({ where: { studentRefId: studentId } }) : 0,
        enrollmentPeriodId ? prisma.studentEnrollmentPeriod.count({ where: { id: enrollmentPeriodId } }) : 0,
        nonceValues.size ? prisma.moodleProvisioningNonce.count({ where: { source: "google-forms-grades", nonce: { in: [...nonceValues] } } }) : 0,
      ])
      if (remaining.reduce((sum, count) => sum + count, 0)) {
        throw new Error("Google Forms synthetic cleanup left test database rows")
      }
    })
    await attempt(() => prisma.$disconnect())
    assert.equal(
      cleanupErrors.length,
      0,
      cleanupErrors.map((error) => error instanceof Error ? error.message : String(error)).join("; "),
    )
  }
})
