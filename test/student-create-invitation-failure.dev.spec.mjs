import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import test from "node:test"
import { parse as parseDotenv } from "dotenv"
import "../tools/assert-prisma-environment.mjs"

const ENV_FILE = String(process.env.SIS_ENV_FILE || "").trim()
const DEV_ONLY = process.env.NODE_ENV === "development" && ENV_FILE === ".env.dev"
const ENV_VALUES = DEV_ONLY && fs.existsSync(ENV_FILE) ? parseDotenv(fs.readFileSync(ENV_FILE)) : {}

test("authenticated student creation remains successful when invitation setup fails after commit", { skip: !DEV_ONLY }, async (t) => {
  Object.assign(process.env, ENV_VALUES, {
    SIS_ENV_FILE: ".env.dev",
    DOTENV_CONFIG_PATH: ".env.dev",
    NODE_ENV: "development",
    STUDENT_ADMIN_STORE_ENABLED: "true",
  })
  const { getSharedPrismaClient } = await import("../src/infra/db/prisma-client.mjs")
  const { startExerciseMailer } = await import("../server/exercise-mailer.mjs")
  const { closeStudentAdminRuntimeResources } = await import("../server/student-admin-routes.mjs")
  const prisma = await getSharedPrismaClient()
  const database = await prisma.$queryRaw`SELECT current_database() AS name`
  assert.equal(database[0]?.name, "sis_dev", "synthetic student writes are restricted to the dev database")

  const stamp = randomUUID()
  const compactStamp = stamp.replaceAll("-", "")
  const eaglesId = `KA103-${stamp}`
  const parentsId = `KAP${compactStamp.slice(0, 12)}`
  const recipientEmail = `ka103-${compactStamp}@example.invalid`
  const originKeys = ["STUDENT_ADMIN_PUBLIC_ORIGIN", "PUBLIC_APP_ORIGIN", "APP_ORIGIN", "EXERCISE_MAILER_ORIGIN"]
  const originalOrigins = Object.fromEntries(originKeys.map((key) => [key, process.env[key]]))
  let server = null
  let studentRefId = ""
  let familyId = ""
  let emailTransportCalls = 0
  const cleanupErrors = []
  const attempt = async (operation) => {
    try {
      await operation()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }

  t.after(async () => {
    for (const [key, value] of Object.entries(originalOrigins)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    if (!studentRefId) {
      const syntheticStudent = await prisma.student.findUnique({ where: { eaglesId }, select: { id: true, profile: { select: { familyId: true } } } }).catch((error) => {
        cleanupErrors.push(error)
        return null
      })
      studentRefId = syntheticStudent?.id || ""
      familyId = familyId || String(syntheticStudent?.profile?.familyId || "")
    }
    if (studentRefId) {
      await attempt(() => prisma.parentProfileSubmissionQueue.deleteMany({ where: { studentRefId } }))
      await attempt(() => prisma.parentProfileFieldLock.deleteMany({ where: { studentRefId } }))
      await attempt(() => prisma.parentPortalStudentLink.deleteMany({ where: { studentRefId } }))
      await attempt(() => prisma.parentProfileInvitation.deleteMany({ where: { studentRefId } }))
      await attempt(() => prisma.studentPortalAccount.deleteMany({ where: { studentRefId } }))
      await attempt(() => prisma.studentEnrollmentPeriod.deleteMany({ where: { studentRefId } }))
      await attempt(() => prisma.studentProfile.deleteMany({ where: { studentRefId } }))
      await attempt(() => prisma.student.deleteMany({ where: { id: studentRefId } }))
    }
    if (familyId) {
      const linkedProfiles = await prisma.studentProfile.count({ where: { familyId } }).catch((error) => {
        cleanupErrors.push(error)
        return 1
      })
      if (linkedProfiles === 0) await attempt(() => prisma.family.deleteMany({ where: { familyId } }))
    }
    const parent = await prisma.parentPortalAccount.findUnique({ where: { parentsId }, select: { id: true } }).catch((error) => {
      cleanupErrors.push(error)
      return null
    })
    if (parent?.id) {
      await attempt(() => prisma.parentPortalStudentLink.deleteMany({ where: { parentAccountId: parent.id } }))
      await attempt(() => prisma.parentProfileInvitation.deleteMany({ where: { parentAccountId: parent.id } }))
      await attempt(() => prisma.parentPortalAccount.deleteMany({ where: { id: parent.id } }))
    }
    if (server?.listening) {
      await attempt(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
    }
    await attempt(() => closeStudentAdminRuntimeResources())
    await attempt(() => prisma.$disconnect())
    assert.equal(emailTransportCalls, 0, "the failure path must not attempt email delivery")
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Synthetic student invitation cleanup failed")
  })

  for (const key of originKeys) process.env[key] = ""
  server = await startExerciseMailer({
    transporter: {
      verify(callback) { setImmediate(() => callback(null, true)) },
      async sendMail() { emailTransportCalls += 1; throw new Error("Synthetic regression must not send email") },
    },
    port: 0,
  })
  await new Promise((resolve, reject) => {
    server.once("listening", resolve)
    server.once("error", reject)
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  const login = await fetch(`${origin}/api/admin/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: String(process.env.STUDENT_ADMIN_USER || "").trim(),
      password: String(process.env.STUDENT_ADMIN_PASS || "").trim(),
    }),
  })
  assert.equal(login.status, 200, "the configured dev admin must authenticate")
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0]
  assert.match(cookie, /student_admin_sid=/u)

  const payload = {
    eaglesId,
    password: "SyntheticStudentPass123!",
    sendParentCompletionEmail: true,
    profile: {
      fullName: "Synthetic KA 103 Student",
      englishName: "Synthetic KA 103 Student",
      currentGrade: "A1 Movers",
      motherName: "Synthetic Parent",
      motherEmail: recipientEmail,
      motherPhone: "+84900000000",
      parentsId,
    },
  }
  const created = await fetch(`${origin}/api/admin/students`, {
    method: "POST",
    headers: { Cookie: cookie, "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
  const createdBody = await created.json()
  assert.equal(created.status, 200)
  assert.equal(createdBody.action, "created")
  assert.equal(createdBody.invitation, null)
  assert.equal(createdBody.invitationWarning, true)
  assert.ok(createdBody.student?.id)
  studentRefId = createdBody.student.id
  familyId = String(createdBody.student?.profile?.familyId || "")
  assert.equal(await prisma.student.count({ where: { id: studentRefId, eaglesId } }), 1)
  assert.equal(await prisma.parentProfileInvitation.count({ where: { studentRefId } }), 0)
  assert.equal(await prisma.parentPortalAccount.count({ where: { parentsId } }), 0)

  const savedAgain = await fetch(`${origin}/api/admin/students/${encodeURIComponent(studentRefId)}`, {
    method: "PUT",
    headers: { Cookie: cookie, "content-type": "application/json" },
    body: JSON.stringify({ ...payload, sendParentCompletionEmail: false }),
  })
  const savedAgainBody = await savedAgain.json()
  assert.equal(savedAgain.status, 200)
  assert.equal(savedAgainBody.action, "updated")
  assert.equal(savedAgainBody.student?.id, studentRefId)
  assert.equal(await prisma.student.count({ where: { eaglesId } }), 1)
  assert.equal(emailTransportCalls, 0)
})
