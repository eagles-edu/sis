import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { parse as parseDotenv } from "dotenv"
import { chromium } from "playwright"
import test from "node:test"
import "../tools/assert-prisma-environment.mjs"

const ENV_FILE = String(process.env.SIS_ENV_FILE || "").trim()
const DEV_ONLY = process.env.NODE_ENV === "development" && ENV_FILE === ".env.dev"
const ENV_VALUES = DEV_ONLY && fs.existsSync(ENV_FILE) ? parseDotenv(fs.readFileSync(ENV_FILE)) : {}

test("new enrollment creates student access, links an existing family, and stays idempotent on retry", { skip: !DEV_ONLY }, async (t) => {
  const previousEnvironment = Object.fromEntries([
    "MOODLE_SIS_PROVISIONING_ENABLED",
    "STUDENT_ADMIN_STORE_ENABLED",
    "SIS_PROFILE_BACKUP_DIR",
  ].map((key) => [key, process.env[key]]))
  const profileBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), "sis-first-time-family-access-"))
  Object.assign(process.env, ENV_VALUES, {
    SIS_ENV_FILE: ".env.dev",
    DOTENV_CONFIG_PATH: ".env.dev",
    NODE_ENV: "development",
    MOODLE_SIS_PROVISIONING_ENABLED: "false",
    STUDENT_ADMIN_STORE_ENABLED: "true",
    SIS_PROFILE_BACKUP_DIR: profileBackupDir,
  })

  const { getSharedPrismaClient } = await import("../src/infra/db/prisma-client.mjs")
  const { hashScryptPassword } = await import("../src/modules/admin/users.mjs")
  const { startExerciseMailer } = await import("../server/exercise-mailer.mjs")
  const { closeStudentAdminRuntimeResources } = await import("../server/student-admin-routes.mjs")
  const prisma = await getSharedPrismaClient()
  const database = await prisma.$queryRaw`SELECT current_database() AS name`
  assert.equal(database[0]?.name, "sis_dev", "synthetic onboarding writes are restricted to the dev database")

  const stamp = randomUUID()
  const compactStamp = stamp.replaceAll("-", "")
  const familyId = `first-time-family-${compactStamp}`
  const parentsId = `FTF${compactStamp.slice(0, 12)}`
  const siblingEaglesId = `FTFS-${compactStamp.slice(0, 12)}`
  const newEaglesId = `FTFN-${compactStamp.slice(0, 12)}`
  const parentEmail = `parent-${compactStamp}@example.invalid`
  const studentPassword = `First-Time-${compactStamp.slice(0, 12)}!a`
  const parentPassword = `Family-Access-${compactStamp.slice(12, 24)}!a`
  const familySequence = await prisma.family.aggregate({ _max: { sequence: true } })
  const firstSequence = Number(familySequence._max.sequence || 0) + 1
  let parentAccountId = ""
  let siblingStudentRefId = ""
  let newStudentRefId = ""
  let server = null
  let browser = null
  let emailTransportCalls = 0
  const cleanupErrors = []
  const attempt = async (operation) => {
    try { await operation() } catch (error) { cleanupErrors.push(error) }
  }

  t.after(async () => {
    if (browser) await attempt(() => browser.close())
    if (newStudentRefId) {
      await attempt(() => prisma.parentPortalStudentLink.deleteMany({ where: { studentRefId: newStudentRefId } }))
      await attempt(() => prisma.studentPortalAccount.deleteMany({ where: { studentRefId: newStudentRefId } }))
      await attempt(() => prisma.studentEnrollmentPeriod.deleteMany({ where: { studentRefId: newStudentRefId } }))
      await attempt(() => prisma.studentProfile.deleteMany({ where: { studentRefId: newStudentRefId } }))
      await attempt(() => prisma.student.deleteMany({ where: { id: newStudentRefId } }))
    }
    if (siblingStudentRefId) {
      await attempt(() => prisma.parentPortalStudentLink.deleteMany({ where: { studentRefId: siblingStudentRefId } }))
      await attempt(() => prisma.studentEnrollmentPeriod.deleteMany({ where: { studentRefId: siblingStudentRefId } }))
      await attempt(() => prisma.studentProfile.deleteMany({ where: { studentRefId: siblingStudentRefId } }))
      await attempt(() => prisma.student.deleteMany({ where: { id: siblingStudentRefId } }))
    }
    if (parentAccountId) {
      await attempt(() => prisma.parentPortalStudentLink.deleteMany({ where: { parentAccountId: parentAccountId } }))
      await attempt(() => prisma.parentPortalAccount.deleteMany({ where: { id: parentAccountId } }))
    }
    await attempt(() => prisma.family.deleteMany({ where: { familyId } }))
    const remaining = await Promise.all([
      prisma.student.count({ where: { eaglesId: { in: [siblingEaglesId, newEaglesId] } } }),
      prisma.parentPortalAccount.count({ where: { parentsId } }),
      prisma.family.count({ where: { familyId } }),
      prisma.parentPortalStudentLink.count({ where: { studentRefId: { in: [siblingStudentRefId, newStudentRefId].filter(Boolean) } } }),
    ]).catch((error) => {
      cleanupErrors.push(error)
      return [1, 1, 1, 1]
    })
    if (server?.listening) {
      await attempt(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
    }
    await attempt(() => closeStudentAdminRuntimeResources())
    await attempt(() => prisma.$disconnect())
    fs.rmSync(profileBackupDir, { recursive: true, force: true })
    assert.equal(fs.existsSync(profileBackupDir), false, "synthetic profile backups must be removed")
    assert.equal(emailTransportCalls, 0, "enrollment and family setup must not send messages")
    assert.deepEqual(remaining, [0, 0, 0, 0], "all synthetic family/access records must be removed")
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "First-time family access cleanup failed")
  })

  await prisma.family.create({ data: { familyId, sequence: firstSequence } })
  const parent = await prisma.parentPortalAccount.create({ data: {
    parentsId,
    email: parentEmail,
    passwordHash: hashScryptPassword(parentPassword),
    status: "active",
  }, select: { id: true } })
  parentAccountId = parent.id

  const sibling = await prisma.student.create({ data: {
    externalKey: `first-time-family-sibling-${compactStamp}`,
    studentNumber: 1_100_000_000 + (Number.parseInt(compactStamp.slice(0, 8), 16) % 800_000_000),
    eaglesId: siblingEaglesId,
    email: `student-sibling-${compactStamp}@example.invalid`,
  }, select: { id: true } })
  siblingStudentRefId = sibling.id
  await prisma.studentProfile.create({ data: {
    studentRefId: sibling.id,
    sourceFormId: `first-time-family-sibling-${compactStamp}`,
    fullName: "Synthetic Existing Family Member",
    englishName: "Synthetic Existing Family Member",
    currentGrade: "A1 Movers",
    familyId,
    parentsId,
    motherName: "Synthetic Parent",
    motherEmail: parentEmail,
    motherPhone: "+84900000001",
    genderSelections: [],
    languagesAtHome: [],
    learningDisorders: [],
    covidShotHistory: [],
    feverMedicineAllowed: [],
  } })
  await prisma.studentEnrollmentPeriod.create({ data: {
    studentRefId: sibling.id,
    schoolYear: "2026-2027",
    level: "A1 Movers",
    status: "active",
    startedAt: new Date("2026-08-22T00:00:00.000Z"),
  } })
  await prisma.parentPortalStudentLink.create({ data: { parentAccountId, studentRefId: sibling.id } })

  server = await startExerciseMailer({
    transporter: {
      verify(callback) { setImmediate(() => callback(null, true)) },
      async sendMail() { emailTransportCalls += 1; throw new Error("Synthetic onboarding must not send email") },
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

  const anonymousCreate = await jsonRequest("/api/admin/students", "POST", { eaglesId: newEaglesId })
  assert.equal(anonymousCreate.status, 401, "anonymous enrollment/account creation must be rejected")
  const adminLogin = await jsonRequest("/api/admin/auth/login", "POST", {
    username: String(process.env.STUDENT_ADMIN_USER || "").trim(),
    password: String(process.env.STUDENT_ADMIN_PASS || "").trim(),
  })
  assert.equal(adminLogin.status, 200, "the exact dev admin must authenticate")
  const adminCookie = (adminLogin.headers.get("set-cookie") || "").split(";")[0]
  assert.match(adminCookie, /student_admin_sid=/u)

  const newStudentPayload = {
    eaglesId: newEaglesId,
    email: `student-${compactStamp}@example.invalid`,
    level: "A1 Movers",
    password: studentPassword,
    profile: {
      fullName: "Synthetic Newly Enrolled Student",
      englishName: "Synthetic Newly Enrolled Student",
      currentGrade: "A1 Movers",
      familyId,
      parentsId,
      motherName: "Synthetic Parent",
      motherEmail: parentEmail,
      motherPhone: "+84900000002",
      genderSelections: [],
      languagesAtHome: [],
      learningDisorders: [],
      covidShotHistory: [],
      feverMedicineAllowed: [],
    },
  }
  const createdResponse = await jsonRequest("/api/admin/students", "POST", newStudentPayload, adminCookie)
  const created = await createdResponse.json()
  assert.equal(createdResponse.status, 200, `first-time student save failed: ${String(created.error || "no error detail")}`)
  newStudentRefId = String(created.student?.id || "")
  assert.ok(newStudentRefId)
  assert.equal(created.action, "created")

  const [studentCount, accountCount, periods, familyLinks] = await Promise.all([
    prisma.student.count({ where: { eaglesId: newEaglesId } }),
    prisma.studentPortalAccount.count({ where: { studentRefId: newStudentRefId } }),
    prisma.studentEnrollmentPeriod.findMany({ where: { studentRefId: newStudentRefId } }),
    prisma.parentPortalStudentLink.findMany({ where: { studentRefId: newStudentRefId }, select: { parentAccountId: true } }),
  ])
  assert.equal(studentCount, 1)
  assert.equal(accountCount, 1, "first-time enrollment must create one student portal account")
  assert.equal(periods.length, 1, "first-time enrollment must create one active class period")
  assert.equal(periods[0]?.status, "active")
  assert.deepEqual(familyLinks.map((link) => link.parentAccountId), [parentAccountId], "newly enrolled family member must inherit the existing parent link")

  const studentLogin = await jsonRequest("/api/student/auth/login", "POST", { eaglesId: newEaglesId, password: studentPassword })
  assert.equal(studentLogin.status, 200, "new student credentials must work on first login")
  const studentCookie = (studentLogin.headers.get("set-cookie") || "").split(";")[0]
  const studentMe = await jsonRequest("/api/student/auth/me", "GET", undefined, studentCookie)
  assert.equal(studentMe.status, 200)
  assert.equal((await studentMe.json()).user?.eaglesId, newEaglesId)

  const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/google-chrome-stable"
  assert.ok(fs.existsSync(chromiumPath), `${chromiumPath} is required for the authenticated student login proof`)
  browser = await chromium.launch({ headless: true, executablePath: chromiumPath })
  const studentPage = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await studentPage.goto(`${origin}/student?apiOrigin=${encodeURIComponent(origin)}`, { waitUntil: "domcontentloaded" })
  await studentPage.locator("#loginEaglesId").fill(newEaglesId)
  await studentPage.locator("#loginPassword").fill(studentPassword)
  const studentLoginResponse = studentPage.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/student/auth/login",
    { timeout: 30000 },
  )
  await studentPage.locator("#loginBtn").click()
  assert.equal((await studentLoginResponse).status(), 200, "student's first visible login must succeed")
  await studentPage.locator("#studentEaglesIdValue").waitFor({ state: "visible", timeout: 30000 })
  await studentPage.waitForFunction((expected) => document.getElementById("studentEaglesIdValue")?.textContent?.trim() === expected, newEaglesId, { timeout: 30000 })
  assert.equal(await studentPage.evaluate(() => document.documentElement.scrollWidth === window.innerWidth), true, "new student login must fit a 390px viewport")

  const parentLogin = await jsonRequest("/api/parent/auth/login", "POST", { parentsId, password: parentPassword })
  assert.equal(parentLogin.status, 200, "the existing parent must retain access through new enrollment")
  const parentCookie = (parentLogin.headers.get("set-cookie") || "").split(";")[0]
  const childrenResponse = await jsonRequest("/api/parent/children", "GET", undefined, parentCookie)
  assert.equal(childrenResponse.status, 200)
  const children = await childrenResponse.json()
  assert.deepEqual((children.items || []).map((child) => child.eaglesId).sort(), [newEaglesId, siblingEaglesId].sort())

  const parentPage = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await parentPage.goto(`${origin}/parent?apiOrigin=${encodeURIComponent(origin)}`, { waitUntil: "domcontentloaded" })
  await parentPage.locator("#parentsId").fill(parentsId)
  await parentPage.locator("#parentPassword").fill(parentPassword)
  const parentBrowserLogin = parentPage.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/parent/auth/login",
    { timeout: 30000 },
  )
  await parentPage.locator("#loginBtn").click()
  assert.equal((await parentBrowserLogin).status(), 200, "the parent's first visible login must succeed")
  await parentPage.waitForFunction((expected) => {
    const select = document.getElementById("childSelect")
    return select?.options.length === expected
  }, 2, { timeout: 30000 })
  const parentChildOptions = await parentPage.locator("#childSelect option").evaluateAll((options) =>
    options.map((option) => ({ value: option.value, label: option.textContent.trim() })),
  )
  assert.deepEqual(parentChildOptions.map((option) => option.value).sort(), [newEaglesId, siblingEaglesId].sort())
  await parentPage.locator("#childSelect").selectOption(newEaglesId)
  assert.equal(await parentPage.locator("#childSelect").inputValue(), newEaglesId, "one parent account must switch between all linked child records")

  const duplicateSubmit = await jsonRequest("/api/admin/students", "POST", newStudentPayload, adminCookie)
  assert.equal(duplicateSubmit.status, 409, "retrying create cannot create a duplicate student")
  const studentNumber = created.student.studentNumber
  const repeatedSave = await jsonRequest(`/api/admin/students/${encodeURIComponent(newStudentRefId)}`, "PUT", {
    ...newStudentPayload,
    studentNumber,
  }, adminCookie)
  const repeatedBody = await repeatedSave.json()
  assert.equal(repeatedSave.status, 200, `repeating the same student save must succeed: ${String(repeatedBody.error || "no error detail")}`)
  const [studentsAfterRetry, accountsAfterRetry, periodsAfterRetry, linksAfterRetry] = await Promise.all([
    prisma.student.count({ where: { eaglesId: newEaglesId } }),
    prisma.studentPortalAccount.count({ where: { studentRefId: newStudentRefId } }),
    prisma.studentEnrollmentPeriod.count({ where: { studentRefId: newStudentRefId } }),
    prisma.parentPortalStudentLink.count({ where: { studentRefId: newStudentRefId, parentAccountId } }),
  ])
  assert.deepEqual([studentsAfterRetry, accountsAfterRetry, periodsAfterRetry, linksAfterRetry], [1, 1, 1, 1])
  const parentChildrenAfterRetry = await jsonRequest("/api/parent/children", "GET", undefined, parentCookie)
  assert.deepEqual((await parentChildrenAfterRetry.json()).items.map((child) => child.eaglesId).sort(), [newEaglesId, siblingEaglesId].sort())
})
