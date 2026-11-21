import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import "../tools/assert-prisma-environment.mjs"
import { applyKeepaliveTestEnvironment, readKeepaliveTestEnvironment } from "../tools/keepalive-test-environment.mjs"

const RUNTIME = readKeepaliveTestEnvironment()

test("authenticated profile edits persist family moves across student and parent portals", { skip: !RUNTIME }, async (t) => {
  applyKeepaliveTestEnvironment(RUNTIME, {
    SIS_ENV_FILE: RUNTIME.envFile,
    DOTENV_CONFIG_PATH: RUNTIME.envFile,
    NODE_ENV: RUNTIME.nodeEnv,
    STUDENT_ADMIN_STORE_ENABLED: "true",
  })
  const originalProfileBackupDir = process.env.SIS_PROFILE_BACKUP_DIR
  const profileBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), "sis-ka104-profile-backups-"))
  process.env.SIS_PROFILE_BACKUP_DIR = profileBackupDir
  const { getSharedPrismaClient } = await import("../src/infra/db/prisma-client.mjs")
  const { hashScryptPassword } = await import("../src/modules/admin/users.mjs")
  const { startExerciseMailer } = await import("../server/exercise-mailer.mjs")
  const { closeStudentAdminRuntimeResources } = await import("../server/student-admin-routes.mjs")
  const prisma = await getSharedPrismaClient()
  const database = await prisma.$queryRaw`SELECT current_database() AS name`
  assert.equal(database[0]?.name, RUNTIME.databaseName, "synthetic profile writes must stay in the selected non-production database")
  if (RUNTIME.noExternalMessagesEnforced) {
    assert.equal(Boolean(process.env.BREVO_API_KEY), false, "test no-send isolation must not retain the Brevo credential")
    assert.equal(Boolean(process.env.SMTP_PASS), false, "test no-send isolation must not retain the SMTP credential")
  }

  const stamp = randomUUID()
  const compactStamp = stamp.replaceAll("-", "")
  const parentOldId = `KA104O${compactStamp.slice(0, 12)}`
  const parentNewId = `KA104N${compactStamp.slice(0, 12)}`
  const targetEaglesId = `KA104T-${stamp}`
  const siblingEaglesId = `KA104S-${stamp}`
  const parentPassword = `Synthetic-${compactStamp.slice(0, 12)}!`
  const studentPassword = `Synthetic-${compactStamp.slice(12, 24)}!`
  const oldFamilyId = `ka104-old-${compactStamp}`
  const newFamilyId = `ka104-new-${compactStamp}`
  const familySequence = await prisma.family.aggregate({ _max: { sequence: true } })
  const firstSequence = Number(familySequence._max.sequence || 0) + 1
  let server = null
  let emailTransportCalls = 0
  const createdFamilyIds = []
  const createdParentAccountIds = []
  const createdStudentIds = []
  const cleanupErrors = []
  const attempt = async (operation) => {
    try { await operation() } catch (error) { cleanupErrors.push(error) }
  }

  t.after(async () => {
    for (const studentRefId of createdStudentIds) {
      await attempt(() => prisma.parentPortalStudentLink.deleteMany({ where: { studentRefId } }))
      await attempt(() => prisma.studentPortalAccount.deleteMany({ where: { studentRefId } }))
      await attempt(() => prisma.studentEnrollmentPeriod.deleteMany({ where: { studentRefId } }))
      await attempt(() => prisma.studentProfile.deleteMany({ where: { studentRefId } }))
      await attempt(() => prisma.student.deleteMany({ where: { id: studentRefId } }))
    }
    for (const parentAccountId of createdParentAccountIds) {
      await attempt(() => prisma.parentPortalStudentLink.deleteMany({ where: { parentAccountId } }))
      await attempt(() => prisma.parentProfileInvitation.deleteMany({ where: { parentAccountId } }))
      await attempt(() => prisma.parentPortalAccount.deleteMany({ where: { id: parentAccountId } }))
    }
    for (const familyId of createdFamilyIds) {
      await attempt(() => prisma.family.deleteMany({ where: { familyId } }))
    }
    const remainingCounts = await Promise.all([
      prisma.student.count({ where: { eaglesId: { in: [targetEaglesId, siblingEaglesId] } } }),
      prisma.studentProfile.count({ where: { studentRefId: { in: createdStudentIds } } }),
      prisma.studentPortalAccount.count({ where: { eaglesId: { in: [targetEaglesId, siblingEaglesId] } } }),
      prisma.parentPortalStudentLink.count({ where: { studentRefId: { in: createdStudentIds } } }),
      prisma.parentPortalAccount.count({ where: { parentsId: { in: [parentOldId, parentNewId] } } }),
      prisma.family.count({ where: { familyId: { in: createdFamilyIds } } }),
    ]).catch((error) => {
      cleanupErrors.push(error)
      return [1, 1, 1, 1, 1, 1]
    })
    if (server?.listening) {
      await attempt(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
    }
    await attempt(() => closeStudentAdminRuntimeResources())
    await attempt(() => prisma.$disconnect())
    if (originalProfileBackupDir === undefined) delete process.env.SIS_PROFILE_BACKUP_DIR
    else process.env.SIS_PROFILE_BACKUP_DIR = originalProfileBackupDir
    fs.rmSync(profileBackupDir, { recursive: true, force: true })
    assert.equal(fs.existsSync(profileBackupDir), false, "synthetic profile backup snapshots must be removed")
    assert.equal(emailTransportCalls, 0, "the profile and family workflow must not send email")
    assert.deepEqual(remainingCounts, [0, 0, 0, 0, 0, 0], "all synthetic profile/family records must be removed")
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Synthetic profile/family cleanup failed")
  })

  await prisma.family.createMany({ data: [
    { familyId: oldFamilyId, sequence: firstSequence },
    { familyId: newFamilyId, sequence: firstSequence + 1 },
  ] })
  createdFamilyIds.push(oldFamilyId, newFamilyId)
  const oldParent = await prisma.parentPortalAccount.create({ data: {
    parentsId: parentOldId,
    email: `ka104-old-${compactStamp}@example.invalid`,
    passwordHash: hashScryptPassword(parentPassword),
    status: "active",
  }, select: { id: true } })
  createdParentAccountIds.push(oldParent.id)
  const newParent = await prisma.parentPortalAccount.create({ data: {
    parentsId: parentNewId,
    email: `ka104-new-${compactStamp}@example.invalid`,
    passwordHash: hashScryptPassword(parentPassword),
    status: "active",
  }, select: { id: true } })
  createdParentAccountIds.push(newParent.id)

  const target = await prisma.student.create({ data: {
    externalKey: `ka104-target-${compactStamp}`,
    studentNumber: 850000 + (Number.parseInt(compactStamp.slice(0, 8), 16) % 100000),
    eaglesId: targetEaglesId,
    email: `ka104-student-${compactStamp}@example.invalid`,
  }, select: { id: true } })
  createdStudentIds.push(target.id)
  const sibling = await prisma.student.create({ data: {
    externalKey: `ka104-sibling-${compactStamp}`,
    studentNumber: 950000 + (Number.parseInt(compactStamp.slice(0, 8), 16) % 40000),
    eaglesId: siblingEaglesId,
    email: `ka104-sibling-${compactStamp}@example.invalid`,
  }, select: { id: true } })
  createdStudentIds.push(sibling.id)
  for (const [studentRefId, eaglesId, name, familyId, parentsId] of [
    [target.id, targetEaglesId, "Synthetic KA 104 Target", oldFamilyId, parentOldId],
    [sibling.id, siblingEaglesId, "Synthetic KA 104 Sibling", newFamilyId, parentNewId],
  ]) {
    await prisma.studentProfile.create({ data: {
      studentRefId,
      sourceFormId: `ka104-${compactStamp}`,
      fullName: name,
      englishName: name,
      familyId,
      parentsId,
      genderSelections: [],
      languagesAtHome: [],
      learningDisorders: [],
      covidShotHistory: [],
      feverMedicineAllowed: [],
    } })
    await prisma.studentPortalAccount.create({ data: {
      eaglesId,
      studentRefId,
      passwordHash: hashScryptPassword(studentPassword),
      status: "active",
    } })
  }
  await prisma.parentPortalStudentLink.create({ data: { parentAccountId: oldParent.id, studentRefId: target.id } })
  await prisma.parentPortalStudentLink.create({ data: { parentAccountId: newParent.id, studentRefId: sibling.id } })

  server = await startExerciseMailer({
    transporter: {
      verify(callback) { setImmediate(() => callback(null, true)) },
      async sendMail() { emailTransportCalls += 1; throw new Error("Profile regression must not send email") },
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
  const unauthenticated = await jsonRequest(`/api/admin/students/${encodeURIComponent(target.id)}`)
  assert.equal(unauthenticated.status, 401)
  const adminLogin = await jsonRequest("/api/admin/auth/login", "POST", {
    username: String(process.env.STUDENT_ADMIN_USER || "").trim(),
    password: String(process.env.STUDENT_ADMIN_PASS || "").trim(),
  })
  assert.equal(adminLogin.status, 200, "the configured environment admin must authenticate")
  const adminCookie = (adminLogin.headers.get("set-cookie") || "").split(";")[0]
  assert.match(adminCookie, /student_admin_sid=/u)

  const changedProfile = {
    fullName: "Synthetic KA 104 Target Updated",
    englishName: "Synthetic KA 104 Target Updated",
    familyId: newFamilyId,
    parentsId: parentNewId,
    motherName: "Synthetic Parent",
    motherEmail: `ka104-new-${compactStamp}@example.invalid`,
  }
  const update = await jsonRequest(`/api/admin/students/${encodeURIComponent(target.id)}`, "PUT", {
    eaglesId: targetEaglesId,
    studentNumber: Number((await prisma.student.findUnique({ where: { id: target.id }, select: { studentNumber: true } })).studentNumber),
    profile: changedProfile,
  }, adminCookie)
  const updateBody = await update.json()
  assert.equal(update.status, 200, `authenticated admin profile update must succeed: ${String(updateBody.error || "no error detail")}`)
  const detail = await jsonRequest(`/api/admin/students/${encodeURIComponent(target.id)}`, "GET", undefined, adminCookie)
  assert.equal(detail.status, 200)
  const detailBody = await detail.json()
  assert.equal(detailBody.profile?.fullName, changedProfile.fullName)
  assert.equal(detailBody.profile?.familyId, newFamilyId)
  assert.equal(detailBody.profile?.parentsId, parentNewId)
  const persisted = await prisma.studentProfile.findUnique({ where: { studentRefId: target.id } })
  assert.equal(persisted?.fullName, changedProfile.fullName)
  assert.equal(persisted?.familyId, newFamilyId)
  assert.equal(persisted?.parentsId, parentNewId)
  const parentLinks = await prisma.parentPortalStudentLink.findMany({
    where: { studentRefId: { in: [target.id, sibling.id] } },
    select: { parentAccountId: true, studentRefId: true },
  })
  assert.deepEqual(parentLinks.map((link) => `${link.parentAccountId}:${link.studentRefId}`).sort(), [
    `${newParent.id}:${sibling.id}`,
    `${newParent.id}:${target.id}`,
  ].sort())

  const parentLogin = await jsonRequest("/api/parent/auth/login", "POST", { parentsId: parentNewId, password: parentPassword })
  assert.equal(parentLogin.status, 200)
  const parentCookie = (parentLogin.headers.get("set-cookie") || "").split(";")[0]
  assert.match(parentCookie, /parent.*sid=/iu)
  const childrenResponse = await jsonRequest("/api/parent/children", "GET", undefined, parentCookie)
  assert.equal(childrenResponse.status, 200)
  const childrenBody = await childrenResponse.json()
  const childIds = (Array.isArray(childrenBody.items) ? childrenBody.items : []).map((child) => String(child.eaglesId || "")).sort()
  assert.deepEqual(childIds, [siblingEaglesId, targetEaglesId].sort())

  const studentLogin = await jsonRequest("/api/student/auth/login", "POST", { eaglesId: targetEaglesId, password: studentPassword })
  assert.equal(studentLogin.status, 200)
  const studentCookie = (studentLogin.headers.get("set-cookie") || "").split(";")[0]
  assert.match(studentCookie, /student.*sid=/iu)
  const studentMe = await jsonRequest("/api/student/auth/me", "GET", undefined, studentCookie)
  assert.equal(studentMe.status, 200)
  assert.equal((await studentMe.json()).user?.eaglesId, targetEaglesId)
  assert.equal(emailTransportCalls, 0)
})
