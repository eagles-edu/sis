import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import test from "node:test"
import { parse as parseDotenv } from "dotenv"
import { chromium } from "playwright"
import "../tools/assert-prisma-environment.mjs"
import { resolvePortalTestOrigin } from "./helpers/portal-test-origin.mjs"
import { applyKeepaliveTestEnvironment, readKeepaliveTestEnvironment } from "../tools/keepalive-test-environment.mjs"

const ENV_FILE = String(process.env.SIS_ENV_FILE || "").trim()
const ENV_VALUES = fs.existsSync(ENV_FILE) ? parseDotenv(fs.readFileSync(ENV_FILE)) : {}
const RUNTIME = readKeepaliveTestEnvironment()
const ORIGIN = resolvePortalTestOrigin({ overrideName: "PARENT_PROFILE_E2E_ORIGIN" })
const ALLOWED_ENVIRONMENT = Boolean(RUNTIME)
const ADMIN = {
  user: String(process.env.STUDENT_ADMIN_USER || ENV_VALUES.STUDENT_ADMIN_USER || "").trim(),
  pass: String(process.env.STUDENT_ADMIN_PASS || ENV_VALUES.STUDENT_ADMIN_PASS || "").trim(),
}
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/google-chrome-stable"
const SKIP_REASON = !ALLOWED_ENVIRONMENT
  ? "Parent profile invitation E2E requires the explicit dev or test environment"
  : !fs.existsSync(CHROMIUM_PATH)
    ? `${CHROMIUM_PATH} is required`
    : !ADMIN.user || !ADMIN.pass
      ? `Admin credentials are required from ${ENV_FILE}`
      : false

function syntheticStudentNumber(stamp) {
  return 900000 + (Number.parseInt(stamp.replaceAll("-", "").slice(0, 8), 16) % 100000)
}

test("authenticated manual parent invitation preserves an editable draft across reload and approval", { skip: SKIP_REASON }, async (t) => {
  applyKeepaliveTestEnvironment(RUNTIME)
  const { getSharedPrismaClient } = await import("../src/infra/db/prisma-client.mjs")
  const prisma = await getSharedPrismaClient()
  const expectedDatabase = RUNTIME.databaseName
  const databaseRows = await prisma.$queryRawUnsafe("SELECT current_database() AS name")
  assert.equal(String(databaseRows?.[0]?.name || ""), expectedDatabase, "parent profile E2E must stay in its owned database")
  const stamp = randomUUID()
  const compactStamp = stamp.replaceAll("-", "")
  const eaglesId = `KA029${compactStamp.slice(0, 8)}`
  const siblingEaglesId = `KA030${compactStamp.slice(0, 8)}`
  const parentsId = `KAP${compactStamp.slice(0, 12)}`
  const familyId = `KAF${compactStamp.slice(0, 12)}`
  const sisConfig = await prisma.sisConfigMirror.findUnique({
    where: { id: "sis-config" },
    select: { payloadJson: true },
  })
  const schoolYear = String(sisConfig?.payloadJson?.uiSettings?.schoolSetup?.schoolYear || "").trim()
  assert.ok(schoolYear, "parent invitation E2E requires the active school year from the owned SIS config")
  const email = `parent-${compactStamp}@example.invalid`
  const phone = `+849${compactStamp.slice(0, 8)}`
  const editedPhone = `+848${compactStamp.slice(0, 8)}`
  let studentId = ""
  let siblingStudentId = ""
  let invitationId = ""
  let parentAccountId = ""
  let browser
  const cleanupErrors = []
  const attempt = async (operation) => {
    try {
      await operation()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }

  t.after(async () => {
    if (browser) await attempt(() => browser.close())
    if (!studentId) {
      const syntheticStudent = await prisma.student.findUnique({ where: { externalKey: `keep-alive-parent-profile-${stamp}` }, select: { id: true } }).catch((error) => {
        cleanupErrors.push(error)
        return null
      })
      if (syntheticStudent?.id) studentId = syntheticStudent.id
    }
    if (!siblingStudentId) {
      const syntheticSibling = await prisma.student.findUnique({ where: { eaglesId: siblingEaglesId }, select: { id: true } }).catch((error) => {
        cleanupErrors.push(error)
        return null
      })
      if (syntheticSibling?.id) siblingStudentId = syntheticSibling.id
    }
    const syntheticAccount = await prisma.parentPortalAccount.findUnique({ where: { parentsId }, select: { id: true } }).catch((error) => {
      cleanupErrors.push(error)
      return null
    })
    if (syntheticAccount?.id) parentAccountId = syntheticAccount.id
    const invitationRows = studentId
      ? await prisma.parentProfileInvitation.findMany({ where: { studentRefId: studentId }, select: { id: true } }).catch((error) => {
        cleanupErrors.push(error)
        return []
      })
      : []
    const invitationIds = [...new Set([invitationId, ...invitationRows.map((invitation) => invitation.id)].filter(Boolean))]
    if (invitationIds.length) {
      await attempt(() => prisma.asyncSideEffectJob.deleteMany({
        where: { jobType: "parent-profile-invitation", dedupeKey: { in: invitationIds } },
      }))
    }
    for (let pass = 0; pass < 2; pass += 1) {
      if (studentId) {
        await attempt(() => prisma.parentProfileSubmissionQueue.deleteMany({ where: { studentRefId: studentId } }))
        await attempt(() => prisma.parentProfileFieldLock.deleteMany({ where: { studentRefId: studentId } }))
        await attempt(() => prisma.parentPortalStudentLink.deleteMany({ where: { studentRefId: studentId } }))
        await attempt(() => prisma.parentProfileInvitation.deleteMany({ where: { studentRefId: studentId } }))
      }
      if (siblingStudentId) {
        await attempt(() => prisma.parentPortalStudentLink.deleteMany({ where: { studentRefId: siblingStudentId } }))
        await attempt(() => prisma.studentPortalAccount.deleteMany({ where: { studentRefId: siblingStudentId } }))
        await attempt(() => prisma.studentEnrollmentPeriod.deleteMany({ where: { studentRefId: siblingStudentId } }))
        await attempt(() => prisma.studentProfile.deleteMany({ where: { studentRefId: siblingStudentId } }))
        await attempt(() => prisma.student.deleteMany({ where: { id: siblingStudentId } }))
      }
      if (parentAccountId) {
        await attempt(() => prisma.parentPortalStudentLink.deleteMany({ where: { parentAccountId: parentAccountId } }))
        await attempt(() => prisma.parentProfileSubmissionQueue.deleteMany({ where: { parentAccountId: parentAccountId } }))
        await attempt(() => prisma.parentProfileInvitation.deleteMany({ where: { parentAccountId: parentAccountId } }))
        await attempt(() => prisma.parentPortalAccount.deleteMany({ where: { id: parentAccountId } }))
      }
      if (studentId) {
        await attempt(() => prisma.studentEnrollmentPeriod.deleteMany({ where: { studentRefId: studentId } }))
        await attempt(() => prisma.studentProfile.deleteMany({ where: { studentRefId: studentId } }))
        await attempt(() => prisma.student.deleteMany({ where: { id: studentId } }))
      }
    }
    const remaining = await Promise.all([
      prisma.student.count({ where: { externalKey: `keep-alive-parent-profile-${stamp}` } }),
      prisma.student.count({ where: { eaglesId: siblingEaglesId } }),
      studentId ? prisma.studentProfile.count({ where: { studentRefId: studentId } }) : 0,
      siblingStudentId ? prisma.studentProfile.count({ where: { studentRefId: siblingStudentId } }) : 0,
      studentId ? prisma.studentEnrollmentPeriod.count({ where: { studentRefId: studentId } }) : 0,
      siblingStudentId ? prisma.studentEnrollmentPeriod.count({ where: { studentRefId: siblingStudentId } }) : 0,
      studentId ? prisma.parentProfileSubmissionQueue.count({ where: { studentRefId: studentId } }) : 0,
      studentId ? prisma.parentProfileFieldLock.count({ where: { studentRefId: studentId } }) : 0,
      studentId ? prisma.parentPortalStudentLink.count({ where: { studentRefId: studentId } }) : 0,
      siblingStudentId ? prisma.parentPortalStudentLink.count({ where: { studentRefId: siblingStudentId } }) : 0,
      siblingStudentId ? prisma.studentPortalAccount.count({ where: { studentRefId: siblingStudentId } }) : 0,
      studentId ? prisma.parentProfileInvitation.count({ where: { studentRefId: studentId } }) : 0,
      parentAccountId ? prisma.parentPortalAccount.count({ where: { id: parentAccountId } }) : 0,
      invitationIds.length ? prisma.asyncSideEffectJob.count({ where: { jobType: "parent-profile-invitation", dedupeKey: { in: invitationIds } } }) : 0,
    ]).catch((error) => {
      cleanupErrors.push(error)
      return [1]
    })
    if (remaining.some((count) => count !== 0)) cleanupErrors.push(new Error("Synthetic parent profile records or invitation jobs remain after cleanup"))
    await attempt(() => prisma.$disconnect())
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Synthetic parent profile E2E cleanup failed")
  })

  const student = await prisma.student.create({
    data: {
      externalKey: `keep-alive-parent-profile-${stamp}`,
      studentNumber: syntheticStudentNumber(stamp),
      eaglesId,
      profile: {
        create: {
          sourceFormId: "keep-alive-parent-profile-e2e",
          fullName: "Synthetic Keep Alive Student",
          englishName: "Synthetic Keep Alive Student",
          parentsId,
          familyId,
          motherEmail: email,
          motherName: "Synthetic Parent",
          studentPhone: "+84900000000",
          genderSelections: [],
          languagesAtHome: [],
          learningDisorders: [],
          covidShotHistory: [],
          feverMedicineAllowed: [],
          rawFormPayload: {},
          normalizedFormPayload: {},
        },
      },
      enrollmentPeriods: {
        create: {
          schoolYear,
          status: "active",
          startedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      },
    },
    select: { id: true },
  })
  studentId = student.id

  browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_PATH })
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const adminPage = await adminContext.newPage()
  await adminPage.goto(`${ORIGIN}/admin?apiOrigin=${encodeURIComponent(ORIGIN)}`, { waitUntil: "domcontentloaded" })
  if (await adminPage.locator("#loginUser").count()) {
    await adminPage.locator("#loginUser").fill(ADMIN.user)
    await adminPage.locator("#loginPass").fill(ADMIN.pass)
    const loginResponse = adminPage.waitForResponse(
      (response) => /\/api\/admin\/auth\/login(?:\?|$)/u.test(response.url()),
      { timeout: 30000 },
    )
    await adminPage.locator("#loginForm button[type=submit], #loginBtn").first().click()
    assert.equal((await loginResponse).status(), 200, "admin login must succeed")
    await adminPage.reload({ waitUntil: "domcontentloaded" })
  }
  await adminPage.locator("#app").waitFor({ state: "visible", timeout: 30000 })
  await adminPage.goto(`${ORIGIN}/admin/family?apiOrigin=${encodeURIComponent(ORIGIN)}`, { waitUntil: "domcontentloaded" })
  await adminPage.locator("#searchQ").fill(eaglesId)
  await adminPage.locator("#searchBtn").click()
  const studentRow = adminPage.locator("#topSearchRows tr").filter({ hasText: eaglesId })
  await studentRow.waitFor({ state: "visible", timeout: 30000 })
  await studentRow.getByRole("button", { name: "Open Profile" }).click()
  await adminPage.locator("#profileCopyParentLinkBtn").waitFor({ state: "visible", timeout: 30000 })
  const invitationResponse = adminPage.waitForResponse(
    (response) => response.request().method() === "POST" && /\/api\/admin\/parent-profile-invitations(?:\?|$)/u.test(response.url()),
    { timeout: 30000 },
  )
  await adminPage.locator("#profileCopyParentLinkBtn").click()
  const response = await invitationResponse
  const invitationPayload = { status: response.status(), ...(await response.json()) }
  assert.equal(invitationPayload.status, 200, "authenticated manual invitation action must succeed")
  const invitationHref = String(invitationPayload?.invitation?.url || "")
  invitationId = String(invitationPayload?.invitation?.id || "")
  assert.ok(invitationId, "manual invitation action must persist an invitation")
  assert.ok(invitationHref, "manual invitation action must return a shareable one-time link")
  const invitationUrl = new URL(invitationHref)
  invitationUrl.protocol = new URL(ORIGIN).protocol
  invitationUrl.host = new URL(ORIGIN).host
  const invitation = await prisma.parentProfileInvitation.findUnique({ where: { id: invitationId }, select: { parentAccountId: true, status: true } })
  assert.equal(invitation?.status, "queued")
  parentAccountId = invitation?.parentAccountId || ""
  assert.ok(parentAccountId, "manual invitation must link the synthetic parent account")
  if (process.env.SIS_TEST_INTERRUPT_PARENT_PROFILE_AFTER_INVITATION === "1") {
    throw new Error("Injected parent profile workflow interruption after invitation creation")
  }

  const parentContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const parentPage = await parentContext.newPage()
  const parentApiResponses = []
  parentPage.on("response", (response) => {
    const responseUrl = new URL(response.url())
    if (responseUrl.pathname.startsWith("/api/parent/")) {
      parentApiResponses.push({ path: responseUrl.pathname, status: response.status() })
    }
  })
  await parentPage.goto(invitationUrl.toString(), { waitUntil: "domcontentloaded" })
  try {
    await parentPage.locator("#passwordSetupCard").waitFor({ state: "visible", timeout: 30000 })
  } catch (error) {
    const pageState = await parentPage.evaluate(() => ({
      path: location.pathname,
      title: document.title,
      passwordSetupVisible: !document.getElementById("passwordSetupCard")?.classList.contains("hidden"),
      parentLoginVisible: !document.getElementById("parentLoginCard")?.classList.contains("hidden"),
      profileFieldsVisible: !document.getElementById("profileFields")?.classList.contains("hidden"),
      status: String(document.getElementById("parentPortalStatus")?.textContent || "").slice(0, 160),
    }))
    throw new Error(
      `Parent invitation setup did not load; api=${JSON.stringify(parentApiResponses)}; page=${JSON.stringify(pageState)}`,
      { cause: error },
    )
  }
  await parentPage.locator("#newParentPassword").fill("KeepAlive-Parent-27!")
  await parentPage.locator("#confirmParentPassword").fill("KeepAlive-Parent-27!")
  await parentPage.locator("#saveParentPasswordBtn").click()
  await parentPage.locator("#profileFields").waitFor({ state: "visible", timeout: 30000 })

  const siblingPayload = {
    eaglesId: siblingEaglesId,
    email: `sibling-${compactStamp}@example.invalid`,
    level: "A1 Movers",
    password: `Sibling-${compactStamp.slice(0, 12)}!a`,
    profile: {
      fullName: "Synthetic Family Sibling",
      englishName: "Synthetic Family Sibling",
      currentGrade: "A1 Movers",
      familyId,
      parentsId,
      motherName: "Synthetic Parent",
      motherEmail: email,
      motherPhone: "+84900000002",
      genderSelections: [],
      languagesAtHome: [],
      learningDisorders: [],
      covidShotHistory: [],
      feverMedicineAllowed: [],
    },
  }
  const siblingCreate = await adminPage.evaluate(async (payload) => {
    const response = await fetch("/api/admin/students", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    return { status: response.status, body: await response.json() }
  }, siblingPayload)
  assert.equal(siblingCreate.status, 200, "authenticated enrollment adds the second child to the existing family")
  assert.equal(siblingCreate.body.action, "created")
  siblingStudentId = String(siblingCreate.body.student?.id || "")
  assert.ok(siblingStudentId, "second child has a persisted student identity")
  const [siblingCount, siblingAccounts, siblingPeriods, siblingLinks] = await Promise.all([
    prisma.student.count({ where: { id: siblingStudentId, eaglesId: siblingEaglesId } }),
    prisma.studentPortalAccount.count({ where: { studentRefId: siblingStudentId } }),
    prisma.studentEnrollmentPeriod.count({ where: { studentRefId: siblingStudentId, status: "active" } }),
    prisma.parentPortalStudentLink.count({ where: { studentRefId: siblingStudentId, parentAccountId } }),
  ])
  assert.deepEqual([siblingCount, siblingAccounts, siblingPeriods, siblingLinks], [1, 1, 1, 1], "second enrollment creates one access account, active period, and link to the existing parent")

  const duplicateSibling = await adminPage.evaluate(async (payload) => {
    const response = await fetch("/api/admin/students", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    return { status: response.status, body: await response.json() }
  }, siblingPayload)
  assert.equal(duplicateSibling.status, 409, "retrying sibling creation cannot create another student")
  const siblingRetry = await adminPage.evaluate(async ({ studentId, payload, studentNumber }) => {
    const response = await fetch(`/api/admin/students/${encodeURIComponent(studentId)}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, studentNumber }),
    })
    return { status: response.status, body: await response.json() }
  }, { studentId: siblingStudentId, payload: siblingPayload, studentNumber: siblingCreate.body.student.studentNumber })
  assert.equal(siblingRetry.status, 200, "repeating the same family enrollment update succeeds")
  const [siblingsAfterRetry, siblingAccountsAfterRetry, siblingPeriodsAfterRetry, siblingLinksAfterRetry] = await Promise.all([
    prisma.student.count({ where: { id: siblingStudentId, eaglesId: siblingEaglesId } }),
    prisma.studentPortalAccount.count({ where: { studentRefId: siblingStudentId } }),
    prisma.studentEnrollmentPeriod.count({ where: { studentRefId: siblingStudentId } }),
    prisma.parentPortalStudentLink.count({ where: { studentRefId: siblingStudentId, parentAccountId } }),
  ])
  assert.deepEqual([siblingsAfterRetry, siblingAccountsAfterRetry, siblingPeriodsAfterRetry, siblingLinksAfterRetry], [1, 1, 1, 1], "retry preserves exactly one family membership and access record")

  await parentPage.reload({ waitUntil: "domcontentloaded" })
  await parentPage.locator("#openChildPageBtn").waitFor({ state: "visible", timeout: 30000 })
  await parentPage.waitForFunction(() => document.querySelectorAll("#childSelect option").length === 2, null, { timeout: 30000 })
  const familyOptions = await parentPage.locator("#childSelect option").evaluateAll((options) => options.map((option) => ({ value: option.value, label: option.textContent.trim() })))
  assert.deepEqual(new Set(familyOptions.map((option) => option.value)), new Set([eaglesId, siblingEaglesId]), "one parent account sees both child records")
  assert.ok(familyOptions.every((option) => option.label.includes(option.value)), "each selectable child label identifies its Eagles ID")
  await parentPage.locator("#childSelect").selectOption(siblingEaglesId)
  await parentPage.locator("#openChildPageBtn").click()
  await parentPage.waitForFunction((expected) => document.getElementById("studentEaglesIdValue")?.textContent?.trim() === expected, siblingEaglesId, { timeout: 30000 })
  await parentPage.waitForFunction(() => document.getElementById("studentNameValue")?.textContent?.trim() === "Synthetic Family Sibling", null, { timeout: 30000 })
  await parentPage.locator("#childSelect").selectOption(eaglesId)
  await parentPage.waitForFunction((expected) => document.getElementById("studentEaglesIdValue")?.textContent?.trim() === expected, eaglesId, { timeout: 30000 })

  await parentPage.locator("#pf_studentPhone").fill(phone)
  await parentPage.locator("#pf_signatureFullName").fill("Synthetic Parent")
  await parentPage.locator("#pf_signatureEmail").fill(email)
  await parentPage.locator("#pf_signatureAgreed").check()
  await parentPage.locator("#saveDraftBtn").click()
  await parentPage.waitForFunction(() => /nháp|lưu/i.test(document.getElementById("childPageStatus")?.textContent || ""), null, { timeout: 30000 })
  const savedDraft = await prisma.parentProfileSubmissionQueue.findFirst({
    where: { studentRefId: studentId, parentAccountId, status: "draft" },
    orderBy: { updatedAt: "desc" },
    select: { id: true, draftPayloadJson: true },
  })
  assert.ok(savedDraft?.id, "the authenticated parent draft must persist before reload")
  assert.equal(savedDraft.draftPayloadJson?.studentPhone, phone)
  const officialProfileBeforeReload = await prisma.studentProfile.findUnique({ where: { studentRefId: studentId }, select: { studentPhone: true } })
  assert.equal(officialProfileBeforeReload?.studentPhone, "+84900000000", "saving a draft must not change the official profile")

  await parentPage.reload({ waitUntil: "domcontentloaded" })
  await parentPage.locator("#openChildPageBtn").waitFor({ state: "visible", timeout: 30000 })
  await parentPage.locator("#childSelect").selectOption(eaglesId)
  await parentPage.waitForFunction((expected) => document.getElementById("studentEaglesIdValue")?.textContent?.trim() === expected, eaglesId, { timeout: 30000 })
  await parentPage.locator("#openChildPageBtn").click()
  await parentPage.locator("#pf_studentPhone").waitFor({ state: "visible", timeout: 30000 })
  await parentPage.waitForFunction((expected) => document.getElementById("pf_studentPhone")?.value === expected, phone, { timeout: 30000 })
  assert.equal(await parentPage.locator("#pf_signatureFullName").inputValue(), "Synthetic Parent")
  assert.equal(await parentPage.locator("#pf_signatureEmail").inputValue(), email)
  assert.equal(await parentPage.locator("#pf_signatureAgreed").isChecked(), true)

  await parentPage.locator("#pf_studentPhone").fill(editedPhone)
  await parentPage.locator("#saveDraftBtn").click()
  await parentPage.waitForFunction(() => /nháp|lưu/i.test(document.getElementById("childPageStatus")?.textContent || ""), null, { timeout: 30000 })
  const resavedDraft = await prisma.parentProfileSubmissionQueue.findUnique({
    where: { id: savedDraft.id },
    select: { status: true, draftPayloadJson: true },
  })
  assert.equal(resavedDraft?.status, "draft")
  assert.equal(resavedDraft?.draftPayloadJson?.studentPhone, editedPhone)
  assert.equal(resavedDraft?.draftPayloadJson?.signatureFullName, "Synthetic Parent")
  assert.equal(resavedDraft?.draftPayloadJson?.signatureEmail, email)
  assert.deepEqual(resavedDraft?.draftPayloadJson?.signatureAgreed, ["yes"])

  await parentPage.locator("#submitReviewBtn").click()
  await parentPage.locator("#childPageStatus").waitFor({ state: "visible", timeout: 30000 })
  await parentPage.waitForFunction(() => /gửi duyệt/i.test(document.getElementById("childPageStatus")?.textContent || ""), null, { timeout: 30000 })
  const submitted = await prisma.parentProfileSubmissionQueue.findFirst({ where: { studentRefId: studentId, parentAccountId, status: "submitted" }, select: { id: true } })
  assert.ok(submitted?.id, "parent submission must enter the authenticated review queue")
  const beforeApproval = await prisma.studentProfile.findUnique({ where: { studentRefId: studentId }, select: { studentPhone: true } })
  assert.equal(beforeApproval?.studentPhone, "+84900000000", "submission must not change the official profile before review")

  await adminPage.goto(`${ORIGIN}/admin/family?apiOrigin=${encodeURIComponent(ORIGIN)}`, { waitUntil: "domcontentloaded" })
  const profileSubmissionsResponse = adminPage.waitForResponse(
    (response) => response.request().method() === "GET" && /\/api\/admin\/profile-submissions(?:\?|$)/u.test(response.url()),
    { timeout: 30000 },
  )
  await adminPage.locator("#profileSubmissionRefreshBtn").click()
  const submissionsResponse = await profileSubmissionsResponse
  const submissionsPayload = await submissionsResponse.json()
  const submissionsError = String(submissionsPayload?.error || "no error detail")
    .replace(/postgres(?:ql)?:\/\/\S+/giu, "[redacted database URL]")
    .replace(/(password|secret|token)\s*[=:]\s*\S+/giu, "$1=[redacted]")
    .slice(0, 180)
  assert.equal(
    submissionsResponse.status(),
    200,
    `authenticated admin must load the parent profile review queue (${submissionsError})`,
  )
  assert.ok(
    Array.isArray(submissionsPayload?.items) && submissionsPayload.items.some((item) => item?.id === submitted.id),
    "the submitted parent profile must be returned by the authenticated review queue API",
  )
  const reviewCard = adminPage.locator("#profileSubmissionRows article").filter({ hasText: studentId })
  await reviewCard.waitFor({ state: "visible", timeout: 30000 })
  adminPage.on("dialog", (dialog) => dialog.accept())
  await reviewCard.locator('[data-profile-review="approve"]').click()
  await parentPage.reload({ waitUntil: "domcontentloaded" })
  await parentPage.locator("#openChildPageBtn").waitFor({ state: "visible", timeout: 30000 })
  await parentPage.locator("#childSelect").selectOption(eaglesId)
  await parentPage.waitForFunction((expected) => document.getElementById("studentEaglesIdValue")?.textContent?.trim() === expected, eaglesId, { timeout: 30000 })
  await parentPage.locator("#openChildPageBtn").click()
  await parentPage.locator("#pf_studentPhone").waitFor({ state: "visible", timeout: 30000 })
  await parentPage.waitForFunction((expected) => document.getElementById("pf_studentPhone")?.value === expected, editedPhone, { timeout: 30000 })

  const [approvedProfile, approvedQueue, completedInvitation] = await Promise.all([
    prisma.studentProfile.findUnique({ where: { studentRefId: studentId }, select: { studentPhone: true, signatureFullName: true, signatureEmail: true, normalizedFormPayload: true, rawFormPayload: true } }),
    prisma.parentProfileSubmissionQueue.findUnique({ where: { id: submitted.id }, select: { status: true, reviewedAt: true, reviewedByUsername: true } }),
    prisma.parentProfileInvitation.findUnique({ where: { id: invitationId }, select: { status: true, completedAt: true } }),
  ])
  assert.equal(approvedProfile?.studentPhone, editedPhone)
  assert.equal(approvedProfile?.signatureFullName, "Synthetic Parent")
  assert.equal(approvedProfile?.signatureEmail, email)
  for (const payload of [approvedProfile?.normalizedFormPayload, approvedProfile?.rawFormPayload]) {
    assert.equal(payload?.signatureFullName, "Synthetic Parent")
    assert.equal(payload?.signatureEmail, email)
    assert.deepEqual(payload?.signatureAgreed, ["yes"])
  }
  assert.equal(approvedQueue?.status, "approved")
  assert.ok(approvedQueue?.reviewedAt)
  assert.equal(approvedQueue?.reviewedByUsername, ADMIN.user)
  assert.equal(completedInvitation?.status, "completed")
  assert.ok(completedInvitation?.completedAt)

  const profileEngagementResponse = await adminPage.evaluate(async (expectedParentsId) => {
    const response = await fetch("/api/admin/profile-engagement?take=2000")
    const payload = await response.json()
    return {
      status: response.status,
      family: payload.rows?.find((row) => row.parentsId === expectedParentsId) || null,
    }
  }, parentsId)
  assert.equal(profileEngagementResponse.status, 200, "authenticated admin must load customer profile engagement")
  const familyEngagement = profileEngagementResponse.family
  assert.ok(familyEngagement, "completed first-time family must appear in Profile Engagement")
  assert.equal(familyEngagement.invitationStatus, "completed")
  assert.ok(familyEngagement.invitationCompletedAt)
  assert.equal(familyEngagement.learnerCount, 1)
  assert.equal(familyEngagement.eaglesIds, eaglesId)

  await parentContext.close()
  await adminContext.close()
  await browser.close()
  browser = null
})
