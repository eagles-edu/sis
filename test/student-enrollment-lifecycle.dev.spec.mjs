import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import test from "node:test"
import "../tools/assert-prisma-environment.mjs"
import { applyKeepaliveTestEnvironment, readKeepaliveTestEnvironment } from "../tools/keepalive-test-environment.mjs"

const RUNTIME = readKeepaliveTestEnvironment()

test("enrollment changes are idempotent, non-overlapping, recoverable, and reactivate cleanly", { skip: !RUNTIME }, async (t) => {
  const previousEnvironment = Object.fromEntries([
    "MOODLE_SIS_PROVISIONING_ENABLED",
    "STUDENT_ADMIN_STORE_ENABLED",
  ].map((key) => [key, process.env[key]]))
  applyKeepaliveTestEnvironment(RUNTIME, {
    SIS_ENV_FILE: RUNTIME.envFile,
    DOTENV_CONFIG_PATH: RUNTIME.envFile,
    NODE_ENV: RUNTIME.nodeEnv,
    STUDENT_ADMIN_STORE_ENABLED: "true",
    MOODLE_SIS_PROVISIONING_ENABLED: "false",
  })
  const { getSharedPrismaClient } = await import("../src/infra/db/prisma-client.mjs")
  const { startExerciseMailer } = await import("../server/exercise-mailer.mjs")
  const { closeStudentAdminRuntimeResources } = await import("../server/student-admin-routes.mjs")
  const prisma = await getSharedPrismaClient()
  const database = await prisma.$queryRaw`SELECT current_database() AS name`
  assert.equal(database[0]?.name, RUNTIME.databaseName, "synthetic enrollment writes must stay in the selected non-production database")
  if (RUNTIME.noExternalMessagesEnforced) {
    assert.equal(Boolean(process.env.BREVO_API_KEY), false, "test no-send isolation must not retain the Brevo credential")
    assert.equal(Boolean(process.env.SMTP_PASS), false, "test no-send isolation must not retain the SMTP credential")
  }

  const stamp = randomUUID()
  const compactStamp = stamp.replaceAll("-", "")
  const eaglesId = `KA105-${stamp}`
  const externalKey = `ka105-enrollment-${compactStamp}`
  const studentNumber = 1_000_000_000 + (Number.parseInt(compactStamp.slice(0, 8), 16) % 900_000_000)
  const schoolYear = "2026-2027"
  const baseDate = new Date("2026-08-22T00:00:00.000Z")
  const concurrentEffectiveAt = new Date("2026-11-20T00:00:00.000Z")
  const unenrollEffectiveAt = new Date("2026-11-21T00:00:00.000Z")
  const reactivateEffectiveAt = new Date("2026-11-22T00:00:00.000Z")
  let studentRefId = ""
  let server = null
  let emailTransportCalls = 0
  const cleanupErrors = []
  const attempt = async (operation) => {
    try { await operation() } catch (error) { cleanupErrors.push(error) }
  }

  t.after(async () => {
    if (!studentRefId) {
      const row = await prisma.student.findUnique({ where: { eaglesId }, select: { id: true } }).catch((error) => {
        cleanupErrors.push(error)
        return null
      })
      studentRefId = row?.id || ""
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
      await attempt(() => prisma.studentEnrollmentPeriod.deleteMany({ where: { studentRefId } }))
      await attempt(() => prisma.studentProfile.deleteMany({ where: { studentRefId } }))
      await attempt(() => prisma.student.deleteMany({ where: { id: studentRefId } }))
    }
    const remainingCounts = await Promise.all([
      prisma.student.count({ where: { eaglesId } }),
      studentRefId ? prisma.studentEnrollmentPeriod.count({ where: { studentRefId } }) : 0,
      studentRefId ? prisma.studentProfile.count({ where: { studentRefId } }) : 0,
      studentRefId ? prisma.moodleProvisioningCommand.count({ where: { studentRefId } }) : 0,
    ]).catch((error) => {
      cleanupErrors.push(error)
      return [1, 1, 1, 1]
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
    assert.deepEqual(remainingCounts, [0, 0, 0, 0], "all synthetic enrollment records and queued commands must be removed")
    assert.equal(emailTransportCalls, 0, "enrollment changes must not send email")
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Synthetic enrollment cleanup failed")
  })

  const student = await prisma.student.create({ data: {
    externalKey,
    studentNumber,
    eaglesId,
    email: `ka105-${compactStamp}@example.invalid`,
  }, select: { id: true } })
  studentRefId = student.id
  await prisma.studentProfile.create({ data: {
    studentRefId,
    sourceFormId: `ka105-${compactStamp}`,
    fullName: `Synthetic KA 105 ${compactStamp}`,
    englishName: `Synthetic KA 105 ${compactStamp}`,
    currentGrade: "A1 Movers",
    genderSelections: [],
    languagesAtHome: [],
    learningDisorders: [],
    covidShotHistory: [],
    feverMedicineAllowed: [],
  } })
  const initial = await prisma.studentEnrollmentPeriod.create({ data: {
    studentRefId,
    schoolYear,
    level: "A1 Movers",
    status: "active",
    startedAt: baseDate,
  }, select: { id: true } })

  server = await startExerciseMailer({
    transporter: {
      verify(callback) { setImmediate(() => callback(null, true)) },
      async sendMail() { emailTransportCalls += 1; throw new Error("Enrollment regression must not send email") },
    },
    port: 0,
  })
  await new Promise((resolve, reject) => {
    server.once("listening", resolve)
    server.once("error", reject)
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  const jsonRequest = (url, method = "GET", body, cookie = "") => fetch(`${origin}${url}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const enrollmentPath = `/api/admin/students/${encodeURIComponent(studentRefId)}/enrollment`
  const anonymousChange = await jsonRequest(enrollmentPath, "POST", {
    action: "promote", schoolYear, level: "A1 Movers", effectiveAt: concurrentEffectiveAt.toISOString(),
  })
  assert.equal(anonymousChange.status, 401)

  const adminLogin = await jsonRequest("/api/admin/auth/login", "POST", {
    username: String(process.env.STUDENT_ADMIN_USER || "").trim(),
    password: String(process.env.STUDENT_ADMIN_PASS || "").trim(),
  })
  assert.equal(adminLogin.status, 200, "the configured environment admin must authenticate")
  const adminCookie = (adminLogin.headers.get("set-cookie") || "").split(";")[0]
  assert.match(adminCookie, /student_admin_sid=/u)

  const noChange = await jsonRequest(enrollmentPath, "POST", {
    action: "promote", schoolYear, level: "Movers", effectiveAt: concurrentEffectiveAt.toISOString(),
  }, adminCookie)
  assert.equal(noChange.status, 200)
  assert.equal((await noChange.json()).action, "noop", "repeating the active level must be idempotent")
  assert.equal(await prisma.studentEnrollmentPeriod.count({ where: { studentRefId } }), 1)

  const concurrentPromotions = await Promise.all(["A2 Flyers", "B1 PET"].map((level) => jsonRequest(enrollmentPath, "POST", {
    action: "promote", schoolYear, level, effectiveAt: concurrentEffectiveAt.toISOString(), comment: "KA-105 concurrent period probe",
  }, adminCookie)))
  assert.deepEqual(concurrentPromotions.map((response) => response.status), [200, 200])
  const afterPromotions = await prisma.studentEnrollmentPeriod.findMany({ where: { studentRefId, schoolYear }, orderBy: [{ startedAt: "asc" }, { createdAt: "asc" }] })
  assert.equal(afterPromotions.length, 3)
  assert.equal(afterPromotions.filter((period) => period.status === "active" && period.endedAt === null).length, 1)
  assert.ok(afterPromotions.some((period) => period.id === initial.id && period.endedAt?.getTime() === concurrentEffectiveAt.getTime()))
  for (let index = 0; index < afterPromotions.length - 1; index += 1) {
    const current = afterPromotions[index]
    const next = afterPromotions[index + 1]
    assert.ok(current.endedAt, `period ${current.id} must end before the next period starts`)
    assert.ok(current.endedAt.getTime() <= next.startedAt.getTime(), "enrollment periods must not overlap")
  }

  const missingReason = await jsonRequest(enrollmentPath, "POST", {
    action: "unenroll", schoolYear, effectiveAt: unenrollEffectiveAt.toISOString(),
  }, adminCookie)
  assert.equal(missingReason.status, 400, "an invalid unenroll attempt must fail closed")
  assert.equal(await prisma.studentEnrollmentPeriod.count({ where: { studentRefId } }), 3)
  assert.equal((await prisma.studentProfile.findUnique({ where: { studentRefId }, select: { currentGrade: true } })).currentGrade,
    (await prisma.studentEnrollmentPeriod.findFirst({ where: { studentRefId, status: "active", endedAt: null }, select: { level: true } })).level)

  const unenroll = await jsonRequest(enrollmentPath, "POST", {
    action: "unenroll", schoolYear, unenrollmentReason: "unknown", effectiveAt: unenrollEffectiveAt.toISOString(),
  }, adminCookie)
  assert.equal(unenroll.status, 200)
  const unenrolledBody = await unenroll.json()
  assert.equal(unenrolledBody.currentEnrollment?.status, "unenrolled")
  assert.equal(await prisma.studentProfile.findUnique({ where: { studentRefId }, select: { currentGrade: true } }).then((row) => row.currentGrade), null)
  const duplicateUnenroll = await jsonRequest(enrollmentPath, "POST", {
    action: "unenroll", schoolYear, unenrollmentReason: "unknown", effectiveAt: "2026-11-23T00:00:00.000Z",
  }, adminCookie)
  assert.equal(duplicateUnenroll.status, 200)
  assert.equal((await duplicateUnenroll.json()).action, "noop")
  assert.equal(await prisma.studentEnrollmentPeriod.count({ where: { studentRefId } }), 4)

  const hiddenRoster = await jsonRequest(`/api/admin/enrollment/students?q=${encodeURIComponent(eaglesId)}`, "GET", undefined, adminCookie)
  assert.equal(hiddenRoster.status, 200)
  assert.equal((await hiddenRoster.json()).items.length, 0, "unenrolled students stay out of the active roster by default")
  const includedRoster = await jsonRequest(`/api/admin/enrollment/students?q=${encodeURIComponent(eaglesId)}&includeUnenrolled=true`, "GET", undefined, adminCookie)
  assert.equal(includedRoster.status, 200)
  assert.equal((await includedRoster.json()).items[0]?.currentEnrollment?.status, "unenrolled")

  const reactivation = await jsonRequest(enrollmentPath, "POST", {
    action: "promote", schoolYear, level: "A1 Movers", effectiveAt: reactivateEffectiveAt.toISOString(), comment: "KA-105 re-enrollment probe",
  }, adminCookie)
  assert.equal(reactivation.status, 200)
  const reactivatedBody = await reactivation.json()
  assert.equal(reactivatedBody.currentEnrollment?.status, "active")
  assert.equal(reactivatedBody.currentEnrollment?.promotedFromPeriodId, unenrolledBody.currentEnrollment.id)
  assert.equal((await prisma.studentProfile.findUnique({ where: { studentRefId }, select: { currentGrade: true } })).currentGrade, "A1 Movers")
  assert.equal(await prisma.studentEnrollmentPeriod.count({ where: { studentRefId } }), 5)
  const activeRoster = await jsonRequest(`/api/admin/enrollment/students?q=${encodeURIComponent(eaglesId)}`, "GET", undefined, adminCookie)
  assert.equal(activeRoster.status, 200)
  assert.equal((await activeRoster.json()).items[0]?.currentEnrollment?.status, "active")
  const finalHistory = await jsonRequest(enrollmentPath, "GET", undefined, adminCookie)
  assert.equal(finalHistory.status, 200)
  const finalPeriods = (await finalHistory.json()).enrollmentPeriods
  assert.equal(finalPeriods.length, 5)
  assert.equal(finalPeriods.filter((period) => period.status === "active" && !period.endedAt).length, 1)
  assert.equal(emailTransportCalls, 0)
})
