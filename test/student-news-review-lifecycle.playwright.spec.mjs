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
const ORIGIN = resolvePortalTestOrigin({ overrideName: "STUDENT_NEWS_REVIEW_ORIGIN" })
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/google-chrome-stable"
const SUPPORTED_ENVIRONMENT = Boolean(RUNTIME)
const STUDENT = resolveStandardStudentCredentials(ENV_VALUES)
const ADMIN = {
  user: String(ENV_VALUES.STUDENT_ADMIN_USER || "").trim(),
  pass: String(ENV_VALUES.STUDENT_ADMIN_PASS || "").trim(),
}
const SKIP_REASON = !SUPPORTED_ENVIRONMENT
  ? "Authenticated Student News review E2E requires the explicit dev or test environment"
  : !fs.existsSync(CHROMIUM_PATH)
    ? `${CHROMIUM_PATH} is required`
    : !STUDENT.user || !STUDENT.pass
      ? `the exact mark001 student credentials are required from ${ENV_FILE}`
      : !ADMIN.user || !ADMIN.pass
        ? `the exact admin credentials are required from ${ENV_FILE}`
        : false

const VOCABULARY = [
  { partOfSpeech: "noun", english: "air-strike", vietnamese: "cuộc không kích", syllabication: "air-strike", definition: "An attack from aircraft.", esl: { countability: "countable", physicalQuality: "concrete", grammaticalNumber: "singular", primaryClassification: "compound" } },
  { partOfSpeech: "noun", english: "computer", vietnamese: "máy tính", syllabication: "com-PUT-er", definition: "An electronic device for processing data.", esl: { countability: "countable", physicalQuality: "concrete", grammaticalNumber: "singular", primaryClassification: "common" } },
  { partOfSpeech: "noun", english: "check-in", vietnamese: "thủ tục nhận phòng", syllabication: "check-in", definition: "The act of registering on arrival.", esl: { countability: "countable", physicalQuality: "abstract", grammaticalNumber: "singular", primaryClassification: "compound" } },
  { partOfSpeech: "adjective", english: "life-size", vietnamese: "kích thước thật", syllabication: "life-size", definition: "Having the same size as the real subject.", esl: { grammarClassification: { grammarSubtype: "attributive" } } },
  { partOfSpeech: "adverb", english: "step-by-step", vietnamese: "từng bước", syllabication: "step-by-step", definition: "Progressing one stage at a time.", esl: { grammarClassification: { grammarSubtype: "manner" } } },
]

function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

async function loginStudent(page) {
  const loginResponse = page.waitForResponse(
    (response) => /\/api\/student\/auth\/login(?:\?|$)/u.test(response.url()),
    { timeout: 30000 },
  )
  await page.goto(`${ORIGIN}/student?apiOrigin=${encodeURIComponent(ORIGIN)}`, { waitUntil: "domcontentloaded" })
  await page.locator("#loginEaglesId").fill(STUDENT.user)
  await page.locator("#loginPassword").fill(STUDENT.pass)
  await page.locator('#loginForm button[type="submit"]').click()
  assert.equal((await loginResponse).status(), 200, "visible student login succeeds")
  await page.locator("#appPanel").waitFor({ state: "visible", timeout: 30000 })
  const consentPanel = page.locator("#sisConsentPanel")
  await consentPanel.waitFor({ state: "visible", timeout: 5000 }).catch(() => {})
  if (await consentPanel.isVisible().catch(() => false)) {
    await consentPanel.locator('[data-sis-consent-action="acknowledge"]').click()
    await consentPanel.waitFor({ state: "hidden", timeout: 10000 })
  }
}

async function loginAdmin(page) {
  const loginResponse = page.waitForResponse(
    (response) => /\/api\/admin\/auth\/login(?:\?|$)/u.test(response.url()),
    { timeout: 30000 },
  )
  await page.goto(`${ORIGIN}/admin?apiOrigin=${encodeURIComponent(ORIGIN)}`, { waitUntil: "domcontentloaded" })
  await page.locator("#loginUser").fill(ADMIN.user)
  await page.locator("#loginPass").fill(ADMIN.pass)
  await page.locator('#loginForm button[type="submit"], #loginBtn').first().click()
  assert.equal((await loginResponse).status(), 200, "visible admin login succeeds")
  await page.locator("#app").waitFor({ state: "visible", timeout: 30000 })
  const settingsResponse = page.waitForResponse(
    (response) => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/admin/settings/ui",
    { timeout: 30000 },
  )
  const settingsResult = await settingsResponse
  assert.equal(settingsResult.status(), 200, "admin settings load during the authenticated boot")
  const settingsBody = await settingsResult.json()
  assert.equal(settingsBody?.meta?.schoolSetupState, "ok", "test mirror school setup is valid before opening News review")
  assert.equal(settingsBody?.uiSettings?.schoolSetup?.quarters?.length, 4, "all four school quarters are available")
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.locator("#app").waitFor({ state: "visible", timeout: 30000 })
  await page.locator("#schoolSetupWarningModal").waitFor({ state: "hidden", timeout: 10000 })
  await page.locator('#menuToggleBtn, #floatingMenuBtn').first().click().catch(() => {})
  await page.locator('[data-menu-toggle="tracking"]').click()
  await page.locator('[data-page-link="news-reports"]').click()
  await page.locator('[data-page="news-reports"]').waitFor({ state: "visible", timeout: 30000 })
}

async function openStudentNews(page) {
  await page.goto(`${ORIGIN}/student?apiOrigin=${encodeURIComponent(ORIGIN)}`, { waitUntil: "domcontentloaded" })
  await page.locator("#appPanel").waitFor({ state: "visible", timeout: 30000 })
  await page.locator("#openNewsPageBtn").click()
  await page.locator("#newsPageCard").waitFor({ state: "visible", timeout: 30000 })
}

async function openStudentNewsReport(page, articleTitle) {
  const weekSetButtons = page.locator("#newsPageQueueBody button[data-open-news-week-set]")
  await weekSetButtons.first().waitFor({ state: "visible", timeout: 30000 })
  const weekSetCount = await weekSetButtons.count()
  for (let weekSetIndex = 0; weekSetIndex < weekSetCount; weekSetIndex += 1) {
    await weekSetButtons.nth(weekSetIndex).click()
    await page.locator("#newsWeekSetModal").waitFor({ state: "visible", timeout: 10000 })
    const indexLabel = page.locator("#newsWeekSetModalIndex")
    const [, totalText] = (await indexLabel.innerText()).split("/")
    const total = Number.parseInt(totalText, 10)
    assert.ok(Number.isInteger(total) && total > 0, "week set viewer contains at least one report")
    for (let reportIndex = 0; reportIndex < total; reportIndex += 1) {
      if (await page.locator("#newsViewerArticleTitle").inputValue() === articleTitle) return
      if (reportIndex + 1 < total) {
        await page.locator("#newsWeekSetModalNextBtn").click()
        await page.waitForFunction(
          (expected) => document.getElementById("newsWeekSetModalIndex")?.textContent?.trim() === expected,
          `${reportIndex + 2} / ${total}`,
        )
      }
    }
    await page.locator("#newsWeekSetModalCloseActionBtn").click()
    await page.locator("#newsWeekSetModal").waitFor({ state: "hidden", timeout: 10000 })
  }
  throw new Error(`Student News week sets did not open the expected report: ${articleTitle}`)
}

test("authenticated News review, revision feedback, repeat submission, failure recovery, and cleanup", { skip: SKIP_REASON }, async (t) => {
  applyKeepaliveTestEnvironment(RUNTIME)
  const { getSharedPrismaClient } = await import("../src/infra/db/prisma-client.mjs")
  const prisma = await getSharedPrismaClient()
  const stamp = randomUUID()
  const reportId = `news-review-lifecycle-${stamp}`
  const reviewNote = `Please clarify the lead and correct the article title. ${stamp}`
  const now = new Date()
  const reportDateKey = localDateKey(now)
  const reportDate = new Date(`${reportDateKey}T00:00:00+07:00`)
  const submittedAt = new Date(now.getTime() - 60000)
  let browser
  let studentContext
  let adminContext
  let studentPage
  let adminPage
  const cleanupErrors = []
  const attempt = async (operation) => {
    try {
      await operation()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }

  t.after(async () => {
    if (studentPage) await attempt(() => studentPage.close())
    if (adminPage) await attempt(() => adminPage.close())
    if (studentContext) await attempt(() => studentContext.close())
    if (adminContext) await attempt(() => adminContext.close())
    if (browser) await attempt(() => browser.close())
    for (let pass = 0; pass < 2; pass += 1) {
      await attempt(() => prisma.studentNewsReport.deleteMany({ where: { id: reportId } }))
    }
    const remaining = await prisma.studentNewsReport.findUnique({ where: { id: reportId }, select: { id: true } }).catch((error) => {
      cleanupErrors.push(error)
      return null
    })
    if (remaining) cleanupErrors.push(new Error("synthetic News report remained after repeated cleanup"))
    await attempt(() => prisma.$disconnect())
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Synthetic Student News review cleanup failed")
  })

  const student = await prisma.student.findUnique({ where: { eaglesId: STUDENT.user }, select: { id: true } })
  assert.ok(student?.id, "configured mark001 account is linked to a Student row")
  const existingReportForDate = await prisma.studentNewsReport.findFirst({
    where: { studentRefId: student.id, reportDate },
    orderBy: { reportSequence: "desc" },
    select: { reportSequence: true },
  })
  const reportSequence = Math.max(9900, Number(existingReportForDate?.reportSequence || 0) + 1)
  await prisma.studentNewsReport.create({
    data: {
      id: reportId,
      studentRefId: student.id,
      reportDate,
      reportSequence,
      sourceLink: "https://news.example.invalid/articles/synthetic-review-lifecycle",
      articleTitle: `Synthetic news review lifecycle ${stamp}`,
      byline: "BBC News",
      articleDateline: "Published today at 9:00 AM ICT (GMT+7).",
      leadSynopsis: "Emergency teams opened a new support center after severe weather affected several neighborhoods.",
      actionActor: "Emergency teams",
      actionAffected: "Residents",
      actionWhere: "Coast City",
      actionWhat: "Emergency teams opened a support center for residents after severe weather affected the area.",
      actionWhy: "The center opened because heavy rain damaged homes and interrupted essential services.",
      biasAssessment: "The report relies on officials, so it may omit some residents' experiences.",
      vocabularyJson: VOCABULARY,
      submissionState: "submitted",
      draftCheckedAt: submittedAt,
      mmrPassedAt: submittedAt,
      dateSatisfiedAt: submittedAt,
      reportDateLockedAt: submittedAt,
      firstSubmittedAt: submittedAt,
      lastSubmittedAt: submittedAt,
      submittedAt,
      editableUntil: new Date(now.getTime() + 30 * 86400000),
      reviewStatus: "submitted",
    },
  })

  browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true })
  studentContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  studentPage = await studentContext.newPage()
  adminPage = await adminContext.newPage()

  await loginStudent(studentPage)
  await openStudentNews(studentPage)
  await openStudentNewsReport(studentPage, `Synthetic news review lifecycle ${stamp}`)
  await studentPage.locator("#newsWeekSetModal").waitFor({ state: "visible", timeout: 10000 })
  assert.equal(await studentPage.locator("#newsViewerReviewStatusChip").innerText(), "Submitted")
  await studentPage.locator("#newsWeekSetModalCloseActionBtn").click()

  await loginAdmin(adminPage)
  const adminOpenButton = adminPage.locator(`#newsReviewRows button[data-news-review-open-report="${reportId}"]`)
  await adminOpenButton.waitFor({ state: "visible", timeout: 30000 })
  await adminOpenButton.click()
  await adminPage.locator("#newsReviewViewerModal").waitFor({ state: "visible", timeout: 10000 })
  assert.equal(await adminPage.locator("#newsReviewViewerBody").getByText(reportId, { exact: true }).count(), 1)
  await adminPage.locator("#newsReviewViewerNote").fill(reviewNote)
  const revisionResponse = adminPage.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/admin/news-reports/${reportId}`,
    { timeout: 30000 },
  )
  await adminPage.locator("#newsReviewViewerRevisionBtn").click()
  assert.equal((await revisionResponse).status(), 200, "admin Request Revision returns HTTP 200")
  const revisionState = await prisma.studentNewsReport.findUnique({
    where: { id: reportId },
    select: { reviewStatus: true, reviewNote: true, reviewedAt: true, editableUntil: true, firstSubmittedAt: true, lastSubmittedAt: true },
  })
  assert.equal(revisionState?.reviewStatus, "revision-requested")
  assert.equal(revisionState?.reviewNote, reviewNote)
  assert.ok(revisionState?.reviewedAt)
  assert.ok(revisionState?.editableUntil > now)
  assert.equal(revisionState?.firstSubmittedAt?.toISOString(), submittedAt.toISOString())
  assert.equal(revisionState?.lastSubmittedAt?.toISOString(), submittedAt.toISOString())

  await openStudentNews(studentPage)
  await openStudentNewsReport(studentPage, `Synthetic news review lifecycle ${stamp}`)
  await studentPage.locator("#newsWeekSetModal").waitFor({ state: "visible", timeout: 10000 })
  assert.equal(await studentPage.locator("#newsViewerReviewStatusChip").innerText(), "Revise")
  assert.equal(await studentPage.locator("#newsWeekSetModalTeacherNote").innerText(), reviewNote)
  const studentReportPayload = await studentPage.evaluate(async (id) => {
    const response = await fetch("/api/student/news-reports?days=30", { credentials: "include" })
    const body = await response.json()
    const item = (Array.isArray(body.items) ? body.items : []).find((entry) => entry.id === id)
    return { status: response.status, id: item?.id || "", vocabularyCount: Array.isArray(item?.vocabulary) ? item.vocabulary.length : -1 }
  }, reportId)
  assert.equal(studentReportPayload.status, 200)
  assert.equal(studentReportPayload.id, reportId, "student report API resolves the exact synthetic report")
  assert.equal(studentReportPayload.vocabularyCount, VOCABULARY.length, "student report API retains all saved vocabulary during revision")
  const renderedVocabulary = await studentPage.locator("#newsWeekSetModalVocabularyRows [data-news-vocabulary-row]").evaluateAll((rows) => rows.map((row) => row.querySelector('[data-vocabulary-field="english"]')?.value || ""))
  assert.deepEqual(renderedVocabulary, VOCABULARY.map((row) => row.english), "revision viewer renders the saved vocabulary rows for resubmission")
  const viewerBeforeEdit = await studentPage.evaluate(() => ({
    checkDisabled: document.getElementById("newsWeekSetModalCheckBtn")?.disabled,
    submitDisabled: document.getElementById("newsWeekSetModalSubmitBtn")?.disabled,
    title: document.getElementById("newsViewerArticleTitle")?.value,
    reportDate: document.getElementById("newsViewerReportDate")?.value,
  }))
  assert.equal(viewerBeforeEdit.submitDisabled, false, "a previously checked report returned for revision is eligible for repeat submission")
  const revisionCheckResponse = studentPage.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/student/news-reports/check",
    { timeout: 30000 },
  )
  await studentPage.locator("#newsWeekSetModalCheckBtn").click()
  const revisionCheck = await revisionCheckResponse
  const revisionCheckBody = await revisionCheck.json()
  assert.equal(revisionCheck.status(), 200, "student Check returns HTTP 200 after revision")
  assert.equal(revisionCheckBody.mmrPassed, true, `revised report must pass Check before resubmission: ${JSON.stringify(revisionCheckBody.mmrFailedFields || {})}`)
  await studentPage.waitForFunction(() => document.getElementById("newsWeekSetModalSubmitBtn")?.disabled === false, null, { timeout: 30000 })
  assert.equal(await studentPage.locator("#newsWeekSetModalTeacherNote").innerText(), reviewNote, "teacher feedback remains visible after revision Check")

  const beforeFailedSubmit = await prisma.studentNewsReport.findUnique({
    where: { id: reportId },
    select: { reviewStatus: true, reviewNote: true, lastSubmittedAt: true, articleTitle: true },
  })
  assert.equal(beforeFailedSubmit?.reviewStatus, "revision-requested")
  assert.equal(beforeFailedSubmit?.articleTitle, `Synthetic news review lifecycle ${stamp}`)
  let injectFailure = true
  await studentPage.route(`${ORIGIN}/api/student/news-reports`, async (route) => {
    if (route.request().method() === "POST" && injectFailure) {
      injectFailure = false
      await route.abort("failed")
      return
    }
    await route.continue()
  })
  const failedSubmitRequest = studentPage.waitForEvent(
    "requestfailed",
    (request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/student/news-reports",
    { timeout: 30000 },
  )
  await studentPage.locator("#newsWeekSetModalSubmitBtn").click()
  assert.match((await failedSubmitRequest).failure()?.errorText || "", /failed/iu, "simulated transport failure reaches the student UI")
  const afterFailedSubmit = await prisma.studentNewsReport.findUnique({
    where: { id: reportId },
    select: { reviewStatus: true, reviewNote: true, lastSubmittedAt: true, articleTitle: true },
  })
  assert.equal(afterFailedSubmit?.reviewStatus, "revision-requested", "failed submission does not change the review state")
  assert.equal(afterFailedSubmit?.lastSubmittedAt?.toISOString(), beforeFailedSubmit?.lastSubmittedAt?.toISOString(), "failed submission does not advance the submission timestamp")
  assert.equal(afterFailedSubmit?.articleTitle, beforeFailedSubmit?.articleTitle, "failed submission does not alter report content")
  assert.equal(await studentPage.locator("#submitSuccessModal").evaluate((element) => element.classList.contains("hidden")), true, "failed submission does not show a success modal")
  assert.equal(await studentPage.locator("#newsWeekSetModal").evaluate((element) => element.classList.contains("hidden")), false, "failed submission leaves the report viewer available for retry")
  assert.match(await studentPage.locator("#globalStatus").innerText(), /failed|fetch|network/iu, "student sees the failed submission status")
  await studentPage.unroute(`${ORIGIN}/api/student/news-reports`)
  await openStudentNews(studentPage)
  const retryWeekSetButton = studentPage.locator("#newsPageQueueBody button[data-open-news-week-set]").first()
  await retryWeekSetButton.waitFor({ state: "visible", timeout: 30000 })
  await retryWeekSetButton.click()
  await studentPage.locator("#newsWeekSetModal").waitFor({ state: "visible", timeout: 10000 })
  assert.equal(await studentPage.locator("#newsWeekSetModalTeacherNote").innerText(), reviewNote, "revision feedback remains visible after reload recovery")
  await studentPage.waitForFunction(() => document.getElementById("newsWeekSetModalSubmitBtn")?.disabled === false, null, { timeout: 10000 })

  const retryRequests = []
  studentPage.on("request", (request) => {
    if (request.method() === "POST") retryRequests.push(new URL(request.url()).pathname)
  })
  const repeatSubmitResponse = studentPage.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/student/news-reports",
    { timeout: 30000 },
  ).catch(async (error) => {
    const state = await studentPage.evaluate(() => ({
      submitDisabled: document.getElementById("newsWeekSetModalSubmitBtn")?.disabled,
      submitText: document.getElementById("newsWeekSetModalSubmitBtn")?.textContent,
      modalStatus: document.getElementById("newsWeekSetModalStatus")?.textContent,
      globalStatus: document.getElementById("globalStatus")?.textContent,
      vocabulary: [...document.querySelectorAll("#newsWeekSetModalVocabularyRows [data-news-vocabulary-row]")].map((row) => ({
        english: row.querySelector('[data-vocabulary-field="english"]')?.value,
        syllabication: row.querySelector('[data-vocabulary-field="syllabication"]')?.value,
      })),
    }))
    throw new Error(`${error.message}; retry state=${JSON.stringify(state)}; POST paths=${retryRequests.join(",")}`)
  })
  await studentPage.locator("#newsWeekSetModalSubmitBtn").click()
  const successfulRetryResponse = await repeatSubmitResponse
  const successfulRetryBody = await successfulRetryResponse.json()
  assert.equal(successfulRetryResponse.status(), 200, `retry after the failed submission returns HTTP 200: ${JSON.stringify({ error: successfulRetryBody.error, mmrFailedFields: successfulRetryBody.mmrFailedFields })}`)
  await studentPage.locator("#submitSuccessModal").waitFor({ state: "visible", timeout: 30000 })
  const resubmitted = await prisma.studentNewsReport.findUnique({
    where: { id: reportId },
    select: { id: true, reviewStatus: true, reviewNote: true, lastSubmittedAt: true, firstSubmittedAt: true, submittedAt: true, articleTitle: true },
  })
  assert.equal(resubmitted?.id, reportId, "repeat submission retains the original report row")
  assert.equal(resubmitted?.reviewStatus, "revision-requested", "resubmission leaves review disposition for admin re-review")
  assert.match(resubmitted?.reviewNote || "", /Please clarify the lead and correct the article title\./u, "resubmission preserves revision feedback")
  assert.ok(resubmitted?.lastSubmittedAt > beforeFailedSubmit?.lastSubmittedAt, "successful retry advances lastSubmittedAt")
  assert.equal(resubmitted?.firstSubmittedAt?.toISOString(), submittedAt.toISOString(), "repeat submission preserves firstSubmittedAt")
  assert.equal(resubmitted?.submittedAt?.toISOString(), resubmitted?.lastSubmittedAt?.toISOString(), "submittedAt reflects the successful repeat submission")
  assert.equal(resubmitted?.articleTitle, `Synthetic news review lifecycle ${stamp}`)

  await adminPage.locator("#newsReviewViewerCloseBtn").click()
  await adminPage.locator("#newsReviewViewerModal").waitFor({ state: "hidden", timeout: 10000 })
  await adminPage.locator("#newsReviewRefreshBtn").click()
  await adminPage.locator("#newsReviewRows").getByText(reportId, { exact: false }).waitFor({ state: "visible", timeout: 30000 }).catch(() => {})
  const reviewQueueRecord = await adminPage.evaluate(async (id) => {
    const response = await fetch("/api/admin/news-reports?status=all&take=500")
    const payload = await response.json()
    const item = Array.isArray(payload?.items) ? payload.items.find((entry) => entry?.id === id) : null
    return {
      status: response.status,
      articleTitle: item?.articleTitle || "",
      sourceLink: item?.sourceLink || "",
      reviewNote: item?.reviewNote || "",
    }
  }, reportId)
  assert.equal(reviewQueueRecord.status, 200, "admin review queue API refresh succeeds")
  assert.equal(reviewQueueRecord.articleTitle, `Synthetic news review lifecycle ${stamp}`, "admin review queue API contains the resubmitted report title")
  assert.match(reviewQueueRecord.sourceLink, /news\.example\.invalid/u, "admin review queue API contains the synthetic source link")
  assert.match(reviewQueueRecord.reviewNote, /Please clarify the lead and correct the article title\./u, "admin review queue API preserves revision feedback")
  await adminPage.waitForFunction((id) => {
    const rowButton = [...document.querySelectorAll("#newsReviewRows button[data-news-review-open-report]")]
      .find((button) => button.getAttribute("data-news-review-open-report") === id)
    return Boolean(rowButton)
  }, reportId, { timeout: 30000 })
  await adminPage.locator(`#newsReviewRows button[data-news-review-open-report="${reportId}"]`).click()
  await adminPage.locator("#newsReviewViewerModal").waitFor({ state: "visible", timeout: 10000 })
  assert.equal(await adminPage.locator("#newsReviewViewerArticleTitle").inputValue(), `Synthetic news review lifecycle ${stamp}`, "admin viewer renders the resubmitted title in its report field")
  assert.match(await adminPage.locator("#newsReviewViewerSourceLink").inputValue(), /news\.example\.invalid/u, "admin viewer renders the resubmitted source link")
  assert.equal(await adminPage.locator("#newsReviewViewerNote").inputValue().then((value) => value.includes("Please clarify the lead and correct the article title.")), true, "admin review queue shows the resubmission and preserved feedback")
  await adminPage.locator("#newsReviewViewerCloseBtn").click()
  await adminPage.locator("#newsReviewViewerModal").waitFor({ state: "hidden", timeout: 10000 })
})
