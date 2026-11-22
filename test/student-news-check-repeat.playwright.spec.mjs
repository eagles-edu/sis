import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import test from "node:test"
import { parse as parseDotenv } from "dotenv"
import { chromium } from "playwright"
import { resolveStandardStudentCredentials } from "./helpers/standard-portal-credentials.mjs"
import { resolveStudentNewsSubmissionWindow } from "../src/modules/admin/student-news-submissions.mjs"
import "../tools/assert-prisma-environment.mjs"
import { resolvePortalTestOrigin } from "./helpers/portal-test-origin.mjs"
import { applyKeepaliveTestEnvironment, readKeepaliveTestEnvironment } from "../tools/keepalive-test-environment.mjs"

const ENV_FILE = String(process.env.SIS_ENV_FILE || "").trim()
const ENV_VALUES = fs.existsSync(ENV_FILE) ? parseDotenv(fs.readFileSync(ENV_FILE)) : {}
const RUNTIME = readKeepaliveTestEnvironment()
const ORIGIN = resolvePortalTestOrigin({ overrideName: "STUDENT_NEWS_CHECK_REPEAT_ORIGIN" })
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/google-chrome-stable"
const ALLOWED_ENVIRONMENT = Boolean(RUNTIME)
const STUDENT = resolveStandardStudentCredentials(ENV_VALUES)
const ADMIN = {
  user: String(ENV_VALUES.STUDENT_ADMIN_USER || "").trim(),
  pass: String(ENV_VALUES.STUDENT_ADMIN_PASS || "").trim(),
}
const SKIP_REASON = !ALLOWED_ENVIRONMENT
  ? "Authenticated News Check repeat coverage requires the explicit dev or test environment"
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
  { partOfSpeech: "noun", english: "check-in", vietnamese: "thủ tục nhận phòng", syllabication: "check-in", definition: "The act of registering on arrival.", esl: { countability: "countable", physicalQuality: "abstract", grammaticalNumber: "singular", primaryClassification: "compound", etymologyType: "compound", etymology: "Formed from check + in." } },
  { partOfSpeech: "adjective", english: "life-size", vietnamese: "kích thước thật", syllabication: "life-size", definition: "Having the same size as the real subject.", esl: { grammarClassification: { grammarSubtype: "attributive" } } },
  { partOfSpeech: "adverb", english: "step-by-step", vietnamese: "từng bước", syllabication: "step-by-step", definition: "Progressing one stage at a time.", esl: { grammarClassification: { grammarSubtype: "manner" } } },
]
const STUDENT_NEWS_CHECK_RESPONSE_TIMEOUT_MS = 90000

function localDateKey(date = new Date()) {
  return resolveStudentNewsSubmissionWindow(date).reportDate
}

test("authenticated Student News Check retries a transient 401, then Save -> Check enables Submit", { skip: SKIP_REASON }, async (t) => {
  applyKeepaliveTestEnvironment(RUNTIME)
  const { getSharedPrismaClient } = await import("../src/infra/db/prisma-client.mjs")
  const prisma = await getSharedPrismaClient()
  const stamp = randomUUID()
  const reportId = `news-check-repeat-${stamp}`
  let helpSubmissionKey = ""
  const reportDateKey = localDateKey()
  const reportDate = new Date(`${reportDateKey}T00:00:00+07:00`)
  let browser
  let context
  let page
  let adminContext
  let adminPage
  let helpRequestId = ""
  const cleanupErrors = []
  let overrideCreated = false
  const attempt = async (operation) => {
    try { await operation() } catch (error) { cleanupErrors.push(error) }
  }

  t.after(async () => {
    if (page) await attempt(() => page.close())
    if (context) await attempt(() => context.close())
    if (adminPage) await attempt(() => adminPage.close())
    if (adminContext) await attempt(() => adminContext.close())
    if (browser) await attempt(() => browser.close())
    await attempt(() => prisma.studentNewsReport.deleteMany({ where: { id: reportId } }))
    await attempt(() => prisma.studentNewsVocabularyHelpRequest.deleteMany({ where: { submissionKey: helpSubmissionKey } }))
    if (overrideCreated) await attempt(() => prisma.studentNewsVocabularyOverride.deleteMany({ where: { englishKey: "demolition" } }))
    const remaining = await prisma.studentNewsReport.findUnique({ where: { id: reportId }, select: { id: true } }).catch((error) => {
      cleanupErrors.push(error)
      return null
    })
    if (remaining) cleanupErrors.push(new Error("synthetic repeated-Check report remained after cleanup"))
    await attempt(() => prisma.$disconnect())
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Synthetic repeated-Check cleanup failed")
  })

  const student = await prisma.student.findUnique({ where: { eaglesId: STUDENT.user }, select: { id: true } })
  assert.ok(student?.id, "configured mark001 account is linked to a Student row")
  assert.equal(await prisma.studentNewsVocabularyOverride.findUnique({ where: { englishKey: "demolition" } }), null, "synthetic override test does not overwrite an existing school override")
  const existingReports = await prisma.studentNewsReport.findMany({
    where: { studentRefId: student.id, reportDate },
    select: { reportSequence: true },
  })
  const reportSequence = Math.max(9000, ...existingReports.map((row) => Number(row.reportSequence) || 0)) + 1
  await prisma.studentNewsReport.create({
    data: {
      id: reportId,
      studentRefId: student.id,
      reportDate,
      reportSequence,
      sourceLink: "https://news.example.invalid/articles/repeated-check-regression",
      articleTitle: `Synthetic repeated Check ${stamp}`,
      byline: "BBC News",
      articleDateline: "Published today at 9:00 AM ICT (GMT+7).",
      leadSynopsis: "Emergency teams opened a support center after severe weather affected several neighborhoods.",
      actionActor: "Emergency teams",
      actionAffected: "Residents",
      actionWhere: "Coast City",
      actionWhat: "Emergency teams opened a support center for residents after severe weather affected the area.",
      actionWhy: "The center opened because heavy rain damaged homes and interrupted essential services.",
      biasAssessment: "The report relies on officials, so it may omit some residents' experiences.",
      vocabularyJson: VOCABULARY.map((word, index) => ({ ...word, id: `${reportId}-word-${index + 1}` })),
      submissionState: "draft",
      reviewStatus: "draft",
    },
  })

  browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true })
  context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  page = await context.newPage()
  const loginResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/student/auth/login", { timeout: 30000 })
  await page.goto(`${ORIGIN}/student?apiOrigin=${encodeURIComponent(ORIGIN)}`, { waitUntil: "domcontentloaded" })
  await page.locator("#loginEaglesId").fill(STUDENT.user)
  await page.locator("#loginPassword").fill(STUDENT.pass)
  await page.locator('#loginForm button[type="submit"]').click()
  assert.equal((await loginResponse).status(), 200, "visible student login succeeds")
  await page.locator("#appPanel").waitFor({ state: "visible", timeout: 30000 })
  const consentAcknowledge = page.locator('#sisConsentPanel [data-sis-consent-action="acknowledge"]')
  if (await consentAcknowledge.isVisible().catch(() => false)) await consentAcknowledge.click()
  await page.locator("#openNewsPageBtn").click()
  await page.locator("#newsPageCard").waitFor({ state: "visible", timeout: 30000 })
  await page.locator('#newsVocabularyRows [data-vocabulary-field="english"]').first().waitFor({ state: "visible", timeout: 30000 })
  await page.waitForFunction((title) => document.querySelector("#articleTitle")?.value === title && document.querySelector('#newsVocabularyRows [data-vocabulary-field="english"]')?.value === "air-strike" && document.querySelector("#reportDate")?.value, `Synthetic repeated Check ${stamp}`, { timeout: 30000 })

  const studentApiRequests = []
  const studentApiResponses = []
  const studentApiRequestFailures = []
  let checkRouteState = { stage: "idle" }
  let transientUnauthorizedInjected = false
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname
    if (pathname.startsWith("/api/student/")) studentApiRequests.push({ method: request.method(), pathname })
  })
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname
    if (pathname.startsWith("/api/student/")) studentApiResponses.push({ method: response.request().method(), pathname, status: response.status() })
  })
  page.on("requestfailed", (request) => {
    const pathname = new URL(request.url()).pathname
    if (pathname.startsWith("/api/student/")) {
      studentApiRequestFailures.push({ method: request.method(), pathname, failure: request.failure()?.errorText || "unknown" })
    }
  })
  await page.route("**/api/student/news-reports/check", async (route) => {
    if (!transientUnauthorizedInjected) {
      transientUnauthorizedInjected = true
      checkRouteState = { stage: "transient-401-injected" }
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "News Check requires an active student session. Sign in again, then retry Check." }),
      })
      return
    }
    checkRouteState = { stage: "server-fetch-pending" }
    try {
      const response = await route.fetch()
      checkRouteState = { stage: "server-response-received", status: response.status() }
      const payload = await response.json()
      payload.warningFields = {
        ...(payload.warningFields || {}),
        vocabulary: {
          message: "Some vocabulary entries could not be verified right now.",
          rowWarnings: [{
            index: 0,
            english: "demolition",
            message: "Syllabication could not be verified right now. Research it using the provided dictionary links.",
            fields: ["syllabication"],
          }],
        },
      }
      payload.warningTasks = [
        ...(Array.isArray(payload.warningTasks) ? payload.warningTasks : []),
        { field: "vocabulary", steps: ["Retry the dictionary check later; this warning does not block Check or Submit."] },
      ]
      if (payload.item) {
        payload.item.warningFields = payload.warningFields
        payload.item.warningTasks = payload.warningTasks
      }
      await route.fulfill({ response, body: JSON.stringify(payload) })
      checkRouteState = { stage: "browser-response-fulfilled", status: response.status() }
    } catch (error) {
      checkRouteState = { stage: "interception-failed", errorName: error?.name || "Error" }
      throw error
    }
  })

  const vocabularyRows = page.locator("#newsVocabularyRows [data-news-vocabulary-row]")
  let finalPassingCheckState = null
  for (const row of await vocabularyRows.all()) {
    await row.locator('[data-vocabulary-field="partOfSpeech"]').selectOption("")
    await row.locator('[data-vocabulary-field="english"]').fill("")
    await row.locator('[data-vocabulary-field="vietnamese"]').fill("")
    await row.locator('[data-vocabulary-field="syllabication"]').fill("")
    await row.locator('[data-vocabulary-field="definition"]').fill("")
  }
  for (const [index, word] of VOCABULARY.entries()) {
    const row = vocabularyRows.nth(index)
    await row.locator('[data-vocabulary-field="partOfSpeech"]').selectOption(word.partOfSpeech)
    await row.locator('[data-vocabulary-field="english"]').fill(index === 0 ? "demolition" : word.english)
    await row.locator('[data-vocabulary-field="vietnamese"]').fill(index === 0 ? "sự phá hủy" : word.vietnamese)
    await row.locator('[data-vocabulary-field="syllabication"]').fill(index === 0 ? "de-MO-li-tion" : word.syllabication)
    await row.locator('[data-vocabulary-field="definition"]').fill(index === 0 ? "The act of destroying a structure." : word.definition)
  }
  const rejectedCheckResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/student/news-reports/check" && response.status() === 200, { timeout: STUDENT_NEWS_CHECK_RESPONSE_TIMEOUT_MS }).catch(async (error) => {
    const uiState = await page.evaluate(() => ({
      authState: document.documentElement.dataset.studentAuthState || "",
      appVisible: Boolean(document.querySelector("#appPanel")?.getClientRects().length),
      checkDisabled: Boolean(document.querySelector("#checkBtn")?.disabled),
      checkWaitVisible: !document.querySelector("#newsGrammarCheckWait")?.classList.contains("hidden"),
      complianceModalOpen: !document.querySelector("#newsComplianceModal")?.classList.contains("hidden"),
    }))
    throw new Error(`${error.message}; browser state=${JSON.stringify(uiState)}; route state=${JSON.stringify(checkRouteState)}; student requests=${JSON.stringify(studentApiRequests)}; student responses=${JSON.stringify(studentApiResponses)}; student request failures=${JSON.stringify(studentApiRequestFailures)}`)
  })
  await page.locator("#checkBtn").click()
  const rejectedCheck = await rejectedCheckResponse
  const rejectedPayload = await rejectedCheck.json()
  assert.equal(rejectedCheck.status(), 200)
  const transient401Index = studentApiResponses.findIndex((response) =>
    response.method === "POST" && response.pathname === "/api/student/news-reports/check" && response.status === 401)
  assert.ok(transient401Index >= 0, "the first Check receives the controlled transient 401")
  assert.deepEqual(
    studentApiResponses.slice(transient401Index, transient401Index + 3).map(({ method, pathname, status }) => ({ method, pathname, status })),
    [
      { method: "POST", pathname: "/api/student/news-reports/check", status: 401 },
      { method: "GET", pathname: "/api/student/auth/me", status: 200 },
      { method: "POST", pathname: "/api/student/news-reports/check", status: 200 },
    ],
    "a confirmed active session retries Check once without signing out",
  )
  assert.equal(await page.locator("#appPanel").isVisible(), true)
  assert.equal(await page.locator("#loginPanel").isVisible(), false)
  assert.equal(rejectedPayload.mmrPassed, false)
  assert.equal(rejectedPayload.failedFields.vocabulary.score, VOCABULARY.length, JSON.stringify(rejectedPayload.failedFields.vocabulary))
  assert.equal(rejectedPayload.failedFields.vocabulary.threshold, 5)
  assert.match(rejectedPayload.failedFields.vocabulary.rowErrors[0].message, /Syllabication or primary stress is incorrect/u)
  assert.equal(rejectedPayload.warningTasks.some((task) => task.label === "Etymology extra points"), false, "completed optional etymology does not receive an improvement warning")
  await page.locator("#newsComplianceModal").waitFor({ state: "visible", timeout: 30000 })
  await page.waitForFunction(() => document.querySelector("#newsGrammarCheckWait")?.classList.contains("hidden"))
  await page.waitForFunction(() => !document.querySelector("#checkBtn")?.disabled)
  await page.setViewportSize({ width: 390, height: 844 })
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: width === 320 ? 740 : 844 })
    const mobileModalGeometry = await page.evaluate(() => {
      const dialog = document.querySelector("#newsComplianceModal .portal-modal-dialog")?.getBoundingClientRect()
      const actions = [...document.querySelectorAll("#newsComplianceModal .portal-modal-actions > *")]
        .filter((element) => element.getBoundingClientRect().width > 0)
        .map((element) => {
          const rect = element.getBoundingClientRect()
          return { label: element.textContent.trim(), left: rect.left, right: rect.right }
        })
      return {
        viewport: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        dialog: dialog ? { left: dialog.left, right: dialog.right, bottom: dialog.bottom } : null,
        actions,
      }
    })
    assert.equal(mobileModalGeometry.viewport, width, JSON.stringify(mobileModalGeometry))
    assert.ok(mobileModalGeometry.dialog?.left >= 0 && mobileModalGeometry.dialog?.right <= width, JSON.stringify(mobileModalGeometry))
    assert.ok(mobileModalGeometry.documentWidth <= mobileModalGeometry.viewport, JSON.stringify(mobileModalGeometry))
    assert.ok(mobileModalGeometry.actions.length >= 2, JSON.stringify(mobileModalGeometry))
    assert.ok(mobileModalGeometry.actions.every((action) => action.left >= 0 && action.right <= width), JSON.stringify(mobileModalGeometry))
  }
  await page.setViewportSize({ width: 1440, height: 1100 })
  const vocabularyFeedback = await page.locator("#newsComplianceRequiredBody").innerText()
  assert.match(vocabularyFeedback, /Entry 1 \("demolition"\): Syllabication or primary stress is incorrect\./u)
  assert.match(vocabularyFeedback, new RegExp(`Score ${VOCABULARY.length}\\.00`))
  assert.match(vocabularyFeedback, /Step 1: Complete every vocabulary row with part of speech, English, Vietnamese, syllabication, and definition\./u)
  assert.match(vocabularyFeedback, /Step 2: Use the provided dictionary links to verify syllable boundaries and primary stress; temporary dictionary outages are reported as warnings\./u)
  assert.match(vocabularyFeedback, /Step 3: Save again after correcting the named entry and its highlighted field\./u)
  assert.equal(await page.locator("#newsComplianceWarningsSection").isVisible(), true)
  assert.match(await page.locator("#newsComplianceWarningBody").innerText(), /Syllabication could not be verified right now/u)
  assert.doesNotMatch(await page.locator("#newsComplianceWarningBody").innerText(), /Choose an origin type when you know the word history|Add a brief word-origin note/u)
  assert.equal(await page.locator("#newsGrammarCheckWait").isVisible(), false, "the result modal appears after the animated check overlay closes")
  assert.equal(await page.locator("#newsComplianceHelpSubmit").isDisabled(), true)
  await page.locator("#newsComplianceHelpConsent").check()
  const helpResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/student/news-reports/vocabulary-help", { timeout: 30000 })
  await page.locator("#newsComplianceHelpSubmit").click()
  const submittedHelpResponse = await helpResponse
  assert.equal(submittedHelpResponse.status(), 201)
  helpSubmissionKey = submittedHelpResponse.request().postDataJSON().submissionKey
  const helpRequest = await prisma.studentNewsVocabularyHelpRequest.findUnique({ where: { submissionKey: helpSubmissionKey } })
  assert.ok(helpRequest?.id, "the submitted synthetic help request is persisted")
  helpRequestId = helpRequest.id
  assert.equal(helpRequest?.studentRefId, student.id)
  assert.equal(helpRequest?.word, "demolition")
  assert.equal(helpRequest?.syllabication, "de-mó-li-tion")
  await page.waitForFunction(() => document.querySelector("#newsComplianceHelpStatus")?.textContent.includes("Submitted to the staff review queue"), { timeout: 10000 })
  assert.doesNotMatch(await page.locator("#newsComplianceModal").innerText(), /mark001/u)

  adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  adminPage = await adminContext.newPage()
  const adminApiResponses = []
  adminPage.on("response", (response) => {
    const pathname = new URL(response.url()).pathname
    if (pathname.startsWith("/api/admin/")) adminApiResponses.push({ method: response.request().method(), pathname, status: response.status() })
  })
  const adminLoginResponse = adminPage.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/login", { timeout: 30000 })
  await adminPage.goto(`${ORIGIN}/admin?apiOrigin=${encodeURIComponent(ORIGIN)}`, { waitUntil: "domcontentloaded" })
  await adminPage.locator("#loginUser").fill(ADMIN.user)
  await adminPage.locator("#loginPass").fill(ADMIN.pass)
  await adminPage.locator('#loginForm button[type="submit"], #loginBtn').first().click()
  assert.equal((await adminLoginResponse).status(), 200)
  await adminPage.reload({ waitUntil: "domcontentloaded" })
  await adminPage.locator("#app").waitFor({ state: "visible", timeout: 30000 })
  await adminPage.locator('#menuToggleBtn, #floatingMenuBtn').first().click().catch(() => {})
  await adminPage.locator('[data-page-link="queue-hub"]').click()
  const helpQueuePanel = adminPage.locator('[data-queue-hub-panel-id="student-news-vocabulary-help"]')
  try {
    await helpQueuePanel.waitFor({ state: "visible", timeout: 12000 })
  } catch (error) {
    const queueDebug = await adminPage.evaluate(() => ({
      url: location.pathname,
      authState: document.documentElement.dataset.adminAuthState || "",
      queuePanelIds: [...document.querySelectorAll("[data-queue-hub-panel-id]")].map((panel) => panel.getAttribute("data-queue-hub-panel-id")),
      pageErrors: [...document.querySelectorAll(".status.bad, [role=alert]")].map((node) => node.textContent.trim().slice(0, 160)),
    }))
    throw new Error(`${error.message}; queue state=${JSON.stringify(queueDebug)}; api=${JSON.stringify(adminApiResponses)}`, { cause: error })
  }
  await helpQueuePanel.getByText("demolition", { exact: true }).waitFor({ state: "visible", timeout: 30000 })
  const panelOrder = await adminPage.locator(".queue-hub-panel").evaluateAll((panels) => panels.map((panel) => panel.getAttribute("data-queue-hub-panel-id")))
  assert.equal(panelOrder.indexOf("student-news-vocabulary-help") + 1, panelOrder.indexOf("news-report-review"), "vocabulary help is immediately above News Week Sets")
  const overrideInput = helpQueuePanel.locator(`[data-vocabulary-override-for="${helpRequestId}"]`)
  await overrideInput.waitFor({ state: "visible", timeout: 30000 })
  for (const width of [320, 390]) {
    await adminPage.setViewportSize({ width, height: width === 320 ? 740 : 844 })
    await overrideInput.evaluate((input) => {
      const tableWrap = input.closest(".table-scroll-wrap")
      if (tableWrap) tableWrap.scrollLeft = tableWrap.scrollWidth - tableWrap.clientWidth
      input.scrollIntoView({ block: "nearest", inline: "nearest" })
    })
    const mobileQueueGeometry = await adminPage.evaluate((target) => ({
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      input: (() => { const box = target.getBoundingClientRect(); return { left: box.left, right: box.right } })(),
    }), await overrideInput.elementHandle())
    assert.equal(mobileQueueGeometry.viewport, width, JSON.stringify(mobileQueueGeometry))
    assert.ok(mobileQueueGeometry.documentWidth <= mobileQueueGeometry.viewport, JSON.stringify(mobileQueueGeometry))
    assert.ok(mobileQueueGeometry.input?.left >= 0 && mobileQueueGeometry.input?.right <= width, JSON.stringify(mobileQueueGeometry))
  }
  await adminPage.setViewportSize({ width: 1440, height: 1000 })
  const queuedHelpRequest = await prisma.studentNewsVocabularyHelpRequest.findUnique({ where: { submissionKey: helpSubmissionKey } })
  assert.ok(queuedHelpRequest?.id)
  await overrideInput.fill("dem-o-LI-tion")
  assert.equal(await overrideInput.inputValue(), "dem-o-LI-tion")
  const overrideResponse = adminPage.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/admin/news-vocabulary-help/${queuedHelpRequest.id}/approve-override`, { timeout: 30000 })
  await helpQueuePanel.locator(`[data-vocabulary-override-approve="${queuedHelpRequest.id}"]`).click()
  const approvedResponse = await overrideResponse
  assert.equal(approvedResponse.status(), 200)
  assert.equal(approvedResponse.request().postDataJSON().syllabication, "dem-o-LI-tion")
  overrideCreated = true
  const approvedOverride = await prisma.studentNewsVocabularyOverride.findUnique({ where: { englishKey: "demolition" } })
  assert.equal(approvedOverride?.syllabication, "dem-o-lí-tion")
  assert.equal((await prisma.studentNewsVocabularyHelpRequest.findUnique({ where: { id: queuedHelpRequest.id } }))?.status, "resolved")
  await page.locator("#newsComplianceModalCloseActionBtn").click()

  for (const [index, word] of VOCABULARY.entries()) {
    const row = vocabularyRows.nth(index)
    await row.locator('[data-vocabulary-field="partOfSpeech"]').selectOption(word.partOfSpeech)
    await row.locator('[data-vocabulary-field="english"]').fill(index === 0 ? "demolition" : word.english)
    await row.locator('[data-vocabulary-field="vietnamese"]').fill(word.vietnamese)
    await row.locator('[data-vocabulary-field="syllabication"]').fill(index === 0 ? "dem-o-LI-tion" : word.syllabication)
    await row.locator('[data-vocabulary-field="definition"]').fill(index === 0 ? "The act of destroying a structure." : word.definition)
  }

  const restoredFormState = await page.evaluate(() => ({
    newsPageHidden: document.querySelector("#newsPageCard")?.classList.contains("hidden"),
    checkDisabled: document.querySelector("#checkBtn")?.disabled,
    formStatus: document.querySelector("#formStatus")?.textContent || "",
    checkWaitVisible: !document.querySelector("#newsGrammarCheckWait")?.classList.contains("hidden"),
    vocabulary: [...document.querySelectorAll("#newsVocabularyRows [data-news-vocabulary-row]")].map((row) => ({
      english: row.querySelector('[data-vocabulary-field="english"]')?.value,
      syllabication: row.querySelector('[data-vocabulary-field="syllabication"]')?.value,
    })),
    validation: [...document.querySelectorAll(".news-vocabulary-row-validation-message")].map((entry) => entry.textContent),
  }))
  assert.equal(restoredFormState.newsPageHidden, false, JSON.stringify(restoredFormState))
  assert.equal(restoredFormState.checkDisabled, false, JSON.stringify(restoredFormState))

  for (const step of ["first Check", "Save", "second Check"]) {
    const pathname = step === "Save" ? "/api/student/news-reports/draft" : "/api/student/news-reports/check"
    const responsePromise = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === pathname, { timeout: pathname.endsWith("/check") ? STUDENT_NEWS_CHECK_RESPONSE_TIMEOUT_MS : 30000 }).catch(async (error) => {
      const state = await page.evaluate(() => ({
        checkDisabled: document.querySelector("#checkBtn")?.disabled,
        saveDisabled: document.querySelector("#saveDraftBtn")?.disabled,
        reportDate: document.querySelector("#reportDate")?.value,
        complianceModalOpen: !document.querySelector("#newsComplianceModal")?.classList.contains("hidden"),
        activeElement: document.activeElement?.id || document.activeElement?.tagName || "",
        modalDisplay: getComputedStyle(document.querySelector("#newsComplianceModal")).display,
        modalZIndex: getComputedStyle(document.querySelector("#newsComplianceModal")).zIndex,
        saveRect: (() => { const rect = document.querySelector("#saveDraftBtn")?.getBoundingClientRect(); return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null })(),
        saveHitTarget: (() => { const rect = document.querySelector("#saveDraftBtn")?.getBoundingClientRect(); const target = rect ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) : null; return target?.id || target?.tagName || "" })(),
        formStatus: document.querySelector("#formStatus")?.textContent || "",
        validation: [...document.querySelectorAll(".field-validation-message")].map((entry) => entry.textContent),
      }))
      throw new Error(`${step}: ${error.message}; page state: ${JSON.stringify(state)}; API responses: ${JSON.stringify(studentApiResponses)}`)
    })
    await page.locator(step === "Save" ? "#saveDraftBtn" : "#checkBtn").click()
    const response = await responsePromise
    const payload = await response.json()
    if (step === "second Check") {
      finalPassingCheckState = {
        mmrPassed: payload?.mmrPassed,
        complianceFailed: payload?.complianceFailed,
        item: payload?.item ? {
          currentMmrPassed: payload.item.currentMmrPassed,
          dateSatisfied: payload.item.dateSatisfied,
          dateSatisfiedAt: Boolean(payload.item.dateSatisfiedAt),
          mmrPassedAt: Boolean(payload.item.mmrPassedAt),
        } : null,
      }
    }
    assert.equal(response.status(), 200, `${step} returns HTTP 200: ${JSON.stringify(payload)}`)
    if (step !== "Save") {
      assert.equal(payload.mmrPassed, true, `${step} passes grammar, vocabulary, and minimum requirements`)
      await page.locator("#newsGrammarCheckWait").waitFor({ state: "hidden", timeout: 30000 })
      const closeButton = page.locator("#newsComplianceModalCloseActionBtn")
      if (await closeButton.isVisible().catch(() => false)) await closeButton.click()
      await page.locator("#newsComplianceModal").waitFor({ state: "hidden", timeout: 30000 })
      await page.waitForFunction(() => !document.querySelector("#checkBtn")?.disabled, null, { timeout: 30000 })
    } else {
      await page.waitForFunction(() => /Draft saved/i.test(document.getElementById("formStatus")?.textContent || ""), null, { timeout: 10000 })
    }
  }

  assert.equal(studentApiResponses.filter((response) => response.status === 401).length, 1, `the only 401 is the injected transient Check response: ${JSON.stringify(studentApiResponses)}`)
  const reportAfterSecondCheck = await prisma.studentNewsReport.findUnique({ where: { id: reportId }, select: { submissionState: true, mmrPassedAt: true, dateSatisfiedAt: true, firstSubmittedAt: true } })
  assert.equal(await page.locator("#submitBtn").isDisabled(), false, `Submit becomes active after the second passing Check: ${JSON.stringify(await page.evaluate(() => ({
    disabled: document.querySelector("#submitBtn")?.disabled,
    status: document.querySelector("#formStatus")?.textContent,
    submitState: document.querySelector("#newsSubmitStatus")?.textContent,
    apiResponses: [...document.querySelectorAll("#formStatus")].map((node) => node.textContent),
  })))}; check=${JSON.stringify(finalPassingCheckState)}; persisted=${JSON.stringify(reportAfterSecondCheck)}; ${JSON.stringify(studentApiResponses)}`)
  assert.equal(reportAfterSecondCheck?.submissionState, "ready", "the same persisted report is ready after the second Check")
  assert.ok(reportAfterSecondCheck?.mmrPassedAt)
  assert.ok(reportAfterSecondCheck?.dateSatisfiedAt)
  assert.equal(reportAfterSecondCheck?.firstSubmittedAt, null, "Check does not submit the synthetic report")

  const submitResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/student/news-reports", { timeout: 30000 })
  await page.locator("#submitBtn").click()
  assert.equal((await submitResponse).status(), 200, "the active Submit action succeeds")
  await page.locator("#submitSuccessModal").waitFor({ state: "visible", timeout: 30000 })
  const submitted = await prisma.studentNewsReport.findUnique({ where: { id: reportId }, select: { submissionState: true, firstSubmittedAt: true, lastSubmittedAt: true } })
  assert.equal(submitted?.submissionState, "submitted")
  assert.ok(submitted?.firstSubmittedAt)
  assert.equal(submitted?.firstSubmittedAt?.toISOString(), submitted?.lastSubmittedAt?.toISOString())
})
