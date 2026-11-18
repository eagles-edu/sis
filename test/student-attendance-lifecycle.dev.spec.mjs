import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import { parse as parseDotenv } from "dotenv"
import test from "node:test"
import "../tools/assert-prisma-environment.mjs"

const ENV_FILE = String(process.env.SIS_ENV_FILE || "").trim()
const IS_DEV_RUN = process.env.NODE_ENV === "development" && ENV_FILE === ".env.dev"
const ENV_VALUES = IS_DEV_RUN && fs.existsSync(ENV_FILE)
  ? parseDotenv(fs.readFileSync(ENV_FILE))
  : {}

function syntheticStudentNumber(stamp) {
  return 800000 + (Number.parseInt(stamp.replaceAll("-", "").slice(0, 8), 16) % 100000)
}

function mockTransporter() {
  return {
    verify(callback) {
      setImmediate(() => callback(null, true))
    },
    async sendMail() {
      throw new Error("Attendance regression must not send email")
    },
  }
}

test("dev attendance persists, repeats idempotently, matches roster detail, and enforces auth", { skip: !IS_DEV_RUN }, async (t) => {
  Object.assign(process.env, ENV_VALUES)
  process.env.SIS_ENV_FILE = ".env.dev"
  process.env.DOTENV_CONFIG_PATH = ".env.dev"
  process.env.NODE_ENV = "development"
  process.env.STUDENT_ADMIN_STORE_ENABLED = "true"

  const { getSharedPrismaClient } = await import("../src/infra/db/prisma-client.mjs")
  const { startExerciseMailer } = await import("../server/exercise-mailer.mjs")
  const { closeStudentAdminRuntimeResources } = await import("../server/student-admin-routes.mjs")
  const prisma = await getSharedPrismaClient()
  const database = await prisma.$queryRaw`SELECT current_database() AS name`
  assert.equal(database[0]?.name, "sis_dev", "synthetic attendance writes are restricted to the dev database")

  const stamp = randomUUID()
  const eaglesId = `KA087-${stamp}`
  const externalKey = `ka087-attendance-${stamp}`
  const sourceFormId = `ka087-attendance-${stamp}`
  const className = "A1 Movers"
  const attendanceDate = "2026-11-18"
  let studentRefId = ""
  let enrollmentPeriodId = ""
  let server = null

  const cleanup = async () => {
    if (studentRefId) {
      await prisma.studentAttendance.deleteMany({ where: { studentRefId } })
      await prisma.studentGradeRecord.deleteMany({ where: { studentRefId } })
      await prisma.parentClassReport.deleteMany({ where: { studentRefId } })
      await prisma.studentEnrollmentPeriod.deleteMany({ where: { studentRefId } })
      await prisma.studentProfile.deleteMany({ where: { studentRefId } })
      await prisma.student.deleteMany({ where: { id: studentRefId } })
    }
    if (server?.listening) {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
    await closeStudentAdminRuntimeResources()
    await prisma.$disconnect()
  }

  t.after(cleanup)

  const student = await prisma.student.create({
    data: {
      externalKey,
      studentNumber: syntheticStudentNumber(stamp),
      eaglesId,
      email: `ka087-${stamp}@example.invalid`,
    },
    select: { id: true },
  })
  studentRefId = student.id

  await prisma.studentProfile.create({
    data: {
      studentRefId,
      sourceFormId,
      fullName: `KA-087 Synthetic ${stamp}`,
      genderSelections: [],
      languagesAtHome: [],
      learningDisorders: [],
      covidShotHistory: [],
      feverMedicineAllowed: [],
    },
  })

  const enrollment = await prisma.studentEnrollmentPeriod.create({
    data: {
      studentRefId,
      schoolYear: "2026-2027",
      level: className,
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
  const attendancePath = `/api/admin/students/${encodeURIComponent(studentRefId)}/attendance`
  const initialPayload = {
    className,
    schoolYear: "2026-2027",
    quarter: "q4",
    attendanceDate,
    enrollmentPeriodId,
    status: "absent",
    comments: "KA-087 first save",
  }

  const unauthorized = await fetch(`${origin}${attendancePath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(initialPayload),
  })
  assert.equal(unauthorized.status, 401)

  const username = String(process.env.STUDENT_ADMIN_USER || "").trim()
  const password = String(process.env.STUDENT_ADMIN_PASS || "").trim()
  assert.ok(username && password, "the dev admin account must be configured for this authenticated regression")
  const login = await fetch(`${origin}/api/admin/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  })
  assert.equal(login.status, 200)
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0]
  assert.match(cookie, /student_admin_sid=/i)

  const rosterResponse = await fetch(
    `${origin}/api/admin/students?q=${encodeURIComponent(eaglesId)}&take=20`,
    { headers: { Cookie: cookie } },
  )
  assert.equal(rosterResponse.status, 200)
  const roster = await rosterResponse.json()
  assert.equal(roster.total, 1)
  assert.equal(roster.items[0]?.id, studentRefId)
  assert.equal(roster.items[0]?.eaglesId, eaglesId)
  assert.equal(roster.items[0]?.currentEnrollment?.level, className)

  const firstSave = await fetch(`${origin}${attendancePath}`, {
    method: "POST",
    headers: { Cookie: cookie, "content-type": "application/json" },
    body: JSON.stringify(initialPayload),
  })
  assert.equal(firstSave.status, 200)
  const firstBody = await firstSave.json()
  const firstRecordId = firstBody.record?.id
  assert.ok(firstRecordId)
  assert.equal(firstBody.record?.status, "absent")
  assert.equal(firstBody.record?.enrollmentPeriodId, enrollmentPeriodId)
  assert.equal(firstBody.student?.attendanceRecords?.length, 1)

  const repeatedSave = await fetch(`${origin}${attendancePath}`, {
    method: "POST",
    headers: { Cookie: cookie, "content-type": "application/json" },
    body: JSON.stringify(initialPayload),
  })
  assert.equal(repeatedSave.status, 200)
  const repeatedBody = await repeatedSave.json()
  assert.equal(repeatedBody.record?.id, firstRecordId)
  assert.equal(await prisma.studentAttendance.count({ where: { studentRefId } }), 1)

  const correctedPayload = {
    ...initialPayload,
    status: "late",
    comments: "tardy 10m",
  }
  const correctedSave = await fetch(`${origin}${attendancePath}`, {
    method: "POST",
    headers: { Cookie: cookie, "content-type": "application/json" },
    body: JSON.stringify(correctedPayload),
  })
  assert.equal(correctedSave.status, 200)
  const correctedBody = await correctedSave.json()
  assert.equal(correctedBody.record?.id, firstRecordId)
  assert.equal(correctedBody.record?.status, "late")
  assert.equal(correctedBody.record?.comments, "tardy 10m")
  assert.equal(await prisma.studentAttendance.count({ where: { studentRefId } }), 1)

  const persisted = await prisma.studentAttendance.findUnique({ where: { id: firstRecordId } })
  assert.equal(persisted?.status, "late")
  assert.equal(persisted?.comments, "tardy 10m")
  assert.equal(persisted?.schoolYear, "2026-2027")
  assert.equal(persisted?.quarter, "q4")

  const detailResponse = await fetch(`${origin}/api/admin/students/${encodeURIComponent(studentRefId)}`, {
    headers: { Cookie: cookie },
  })
  assert.equal(detailResponse.status, 200)
  const detail = await detailResponse.json()
  assert.equal(detail.attendanceRecords?.length, 1)
  assert.equal(detail.attendanceRecords?.[0]?.id, firstRecordId)
  assert.equal(detail.attendanceRecords?.[0]?.status, "late")
  assert.equal(detail.attendanceRecords?.[0]?.comments, "tardy 10m")
  assert.equal(detail.counts?.attendanceRecords, 1)
})
