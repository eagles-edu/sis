import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import test from "node:test"
import { parse as parseDotenv } from "dotenv"
import { chromium } from "playwright"
import { resolveStandardStudentCredentials } from "./helpers/standard-portal-credentials.mjs"
import "../tools/assert-prisma-environment.mjs"
import { resolvePortalTestOrigin } from "./helpers/portal-test-origin.mjs"
import { applyKeepaliveTestEnvironment, readKeepaliveTestEnvironment } from "../tools/keepalive-test-environment.mjs"

const ENV_FILE = String(process.env.SIS_ENV_FILE || "").trim()
const ENV_VALUES = fs.existsSync(ENV_FILE) ? parseDotenv(fs.readFileSync(ENV_FILE)) : {}
const RUNTIME = readKeepaliveTestEnvironment()
const ORIGIN = resolvePortalTestOrigin({ overrideName: "STUDENT_LIBRARY_APPROVAL_ORIGIN" })
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/google-chrome-stable"
const STUDENT = resolveStandardStudentCredentials(ENV_VALUES)
const ADMIN = {
  user: String(ENV_VALUES.STUDENT_ADMIN_USER || "").trim(),
  pass: String(ENV_VALUES.STUDENT_ADMIN_PASS || "").trim(),
}
const SKIP_REASON = !RUNTIME
  ? "Authenticated Student Library approval E2E requires the explicit dev or test environment"
  : !fs.existsSync(CHROMIUM_PATH)
    ? `${CHROMIUM_PATH} is required`
    : !STUDENT.user || !STUDENT.pass
      ? `the exact mark001 student credentials are required from ${ENV_FILE}`
      : !ADMIN.user || !ADMIN.pass
        ? `admin credentials are required from ${ENV_FILE}`
        : false

test("authenticated Library admin approval is retry-safe and visible in the student's My Words", { skip: SKIP_REASON }, async (t) => {
  applyKeepaliveTestEnvironment(RUNTIME)
  const { getSharedPrismaClient } = await import("../src/infra/db/prisma-client.mjs")
  const prisma = await getSharedPrismaClient()
  const database = await prisma.$queryRawUnsafe("SELECT current_database() AS name")
  assert.equal(database[0]?.name, RUNTIME.databaseName, "the lifecycle proof must use only its selected non-production database")
  const student = await prisma.student.findUnique({ where: { eaglesId: STUDENT.user }, select: { id: true } })
  assert.ok(student?.id, "the exact configured mark001 account must map to a student record")

  const stamp = randomUUID().replaceAll("-", "")
  const english = `ka219${stamp}`
  const definition = `Temporary KA-219 approval result ${stamp}.`
  const contributionId = `ka219-${stamp}`
  let entryId = ""
  let browser
  let adminContext
  let studentContext
  const cleanupErrors = []
  const attemptCleanup = async (operation) => {
    try {
      await operation()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }

  t.after(async () => {
    if (adminContext) await attemptCleanup(() => adminContext.close())
    if (studentContext) await attemptCleanup(() => studentContext.close())
    if (browser) await attemptCleanup(() => browser.close())
    for (let pass = 0; pass < 2; pass += 1) {
      await attemptCleanup(() => prisma.libraryContributionRevision.deleteMany({ where: { contributionId } }))
      await attemptCleanup(() => prisma.libraryContribution.deleteMany({ where: { id: contributionId } }))
      if (entryId) {
        await attemptCleanup(() => prisma.libraryEntryRevision.deleteMany({ where: { entryId } }))
        await attemptCleanup(() => prisma.libraryEntry.deleteMany({ where: { id: entryId } }))
      }
    }
    await attemptCleanup(() => prisma.$disconnect())
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Synthetic KA-219 Library approval cleanup failed")
  })

  await prisma.libraryContribution.create({
    data: {
      id: contributionId,
      studentRefId: student.id,
      contributorName: STUDENT.user,
      sourceKind: "student_new_words",
      sourceId: contributionId,
      payloadJson: {
        english,
        partOfSpeech: "noun",
        vietnamese: "từ kiểm thử",
        syllabication: english,
        definition,
        countability: "countable",
        nounType: "common",
        nounNumber: "singular",
        physicalQuality: "concrete",
        grammaticalNumber: "singular",
        primaryClassification: "common",
      },
      status: "pending_review",
    },
  })

  browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true })
  adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const adminPage = await adminContext.newPage()
  const loginResponse = adminPage.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/login",
    { timeout: 30000 },
  )
  await adminPage.goto(`${ORIGIN}/admin?apiOrigin=${encodeURIComponent(ORIGIN)}`, { waitUntil: "domcontentloaded" })
  await adminPage.locator("#loginUser").fill(ADMIN.user)
  await adminPage.locator("#loginPass").fill(ADMIN.pass)
  await adminPage.locator('#loginForm button[type="submit"], #loginBtn').first().click()
  assert.equal((await loginResponse).status(), 200, "visible admin login succeeds")
  await adminPage.locator("#app").waitFor({ state: "visible", timeout: 30000 })
  await adminPage.goto(`${ORIGIN}/admin/library/manage?apiOrigin=${encodeURIComponent(ORIGIN)}`, { waitUntil: "domcontentloaded" })
  const queueItem = adminPage.locator(`[data-review-id="${contributionId}"]`)
  await queueItem.waitFor({ state: "visible", timeout: 30000 })
  await queueItem.click()
  await adminPage.locator("[data-review-approve]").waitFor({ state: "visible", timeout: 30000 })

  const approvalResponsePromise = adminPage.waitForResponse((response) => {
    const request = response.request()
    return request.method() === "POST" && new URL(response.url()).pathname === `/api/admin/library/contributions/${contributionId}/review`
  }, { timeout: 30000 })
  await adminPage.locator("[data-review-approve]").click()
  const approvalResponse = await approvalResponsePromise
  assert.equal(approvalResponse.status(), 200, "visible admin approval succeeds")
  const approvalRequest = approvalResponse.request().postDataJSON()
  const firstApproval = await approvalResponse.json()
  assert.equal(firstApproval.ok, true)
  entryId = firstApproval.entry?.id || ""
  assert.ok(entryId, "admin approval returns the canonical Library entry")
  await adminPage.locator('[data-saved-canonical="true"]').waitFor({ state: "visible", timeout: 30000 })

  const beforeRetryContribution = await prisma.libraryContribution.findUnique({ where: { id: contributionId } })
  const beforeRetryContributionRevisions = await prisma.libraryContributionRevision.count({ where: { contributionId } })
  const beforeRetryEntry = await prisma.libraryEntry.findUnique({ where: { id: entryId } })
  const beforeRetryEntryRevisions = await prisma.libraryEntryRevision.count({ where: { entryId } })
  assert.equal(beforeRetryContribution?.status, "approved")
  assert.equal(beforeRetryContribution?.entryId, entryId)

  const retries = await adminPage.evaluate(async ({ endpoint, body }) => Promise.all([1, 2].map(async () => {
    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  })), {
    endpoint: `/api/admin/library/contributions/${contributionId}/review`,
    body: approvalRequest,
  })
  assert.equal(retries.length, 2)
  for (const retry of retries) {
    assert.equal(retry.status, 200, "same-decision browser-session retry succeeds")
    assert.equal(retry.body.entry?.id, entryId, "retry returns the existing canonical entry")
  }

  const afterRetryContribution = await prisma.libraryContribution.findUnique({ where: { id: contributionId } })
  const afterRetryContributionRevisions = await prisma.libraryContributionRevision.count({ where: { contributionId } })
  const afterRetryEntry = await prisma.libraryEntry.findUnique({ where: { id: entryId } })
  const afterRetryEntryRevisions = await prisma.libraryEntryRevision.count({ where: { entryId } })
  assert.equal(afterRetryContribution?.reviewedAt?.getTime(), beforeRetryContribution?.reviewedAt?.getTime(), "retry leaves the original review time unchanged")
  assert.equal(afterRetryContribution?.updatedAt?.getTime(), beforeRetryContribution?.updatedAt?.getTime(), "retry does not update the contribution row")
  assert.equal(afterRetryContributionRevisions, beforeRetryContributionRevisions, "retry does not append a duplicate contribution revision")
  assert.equal(afterRetryEntry?.updatedAt?.getTime(), beforeRetryEntry?.updatedAt?.getTime(), "retry does not rewrite the canonical entry")
  assert.equal(afterRetryEntryRevisions, beforeRetryEntryRevisions, "retry does not append a duplicate entry revision")

  studentContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const studentPage = await studentContext.newPage()
  const studentLoginResponse = studentPage.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/student/auth/login",
    { timeout: 30000 },
  )
  await studentPage.goto(`${ORIGIN}/student?apiOrigin=${encodeURIComponent(ORIGIN)}`, { waitUntil: "domcontentloaded" })
  await studentPage.locator("#loginEaglesId").fill(STUDENT.user)
  await studentPage.locator("#loginPassword").fill(STUDENT.pass)
  await studentPage.locator('#loginForm button[type="submit"]').click()
  assert.equal((await studentLoginResponse).status(), 200, "visible exact mark001 student login succeeds")
  await studentPage.locator("#appPanel").waitFor({ state: "visible", timeout: 30000 })
  await studentPage.goto(`${ORIGIN}/student/library.html?myWords=true&apiOrigin=${encodeURIComponent(ORIGIN)}`, { waitUntil: "domcontentloaded" })
  assert.equal(await studentPage.locator("#libraryMyWords").isChecked(), true, "student Library opens with My Words selected")
  await studentPage.locator("#librarySearch").fill(english)
  const visibleEntry = studentPage.locator("[data-vocabulary-flat-entry]").filter({ hasText: english }).first()
  await visibleEntry.waitFor({ state: "visible", timeout: 30000 })
  await visibleEntry.locator("summary").click()
  await assert.doesNotReject(() => visibleEntry.getByText(definition, { exact: true }).waitFor({ state: "visible", timeout: 10000 }))
})
