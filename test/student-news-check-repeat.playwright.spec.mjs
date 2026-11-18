import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import test from "node:test"
import { parse as parseDotenv } from "dotenv"
import { chromium } from "playwright"
import { resolveStandardStudentCredentials } from "./helpers/standard-portal-credentials.mjs"
import "../tools/assert-prisma-environment.mjs"

const ENV_FILE = String(process.env.SIS_ENV_FILE || "").trim()
const ENV_VALUES = fs.existsSync(ENV_FILE) ? parseDotenv(fs.readFileSync(ENV_FILE)) : {}
const ORIGIN = (process.env.STUDENT_NEWS_CHECK_REPEAT_ORIGIN || "http://127.0.0.1:8788").replace(/\/$/u, "")
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/google-chrome-stable"
const DEV_ONLY = process.env.NODE_ENV === "development" && ENV_FILE === ".env.dev"
const STUDENT = resolveStandardStudentCredentials(ENV_VALUES)
const SKIP_REASON = !DEV_ONLY
  ? "Authenticated News Check repeat coverage is restricted to the explicit dev environment"
  : !fs.existsSync(CHROMIUM_PATH)
    ? `${CHROMIUM_PATH} is required`
    : !STUDENT.user || !STUDENT.pass
      ? `the exact mark001 student credentials are required from ${ENV_FILE}`
      : false

const VOCABULARY = [
  { partOfSpeech: "noun", english: "air-strike", vietnamese: "cuộc không kích", syllabication: "air-strike", definition: "An attack from aircraft.", esl: { countability: "countable", physicalQuality: "concrete", grammaticalNumber: "singular", primaryClassification: "compound" } },
  { partOfSpeech: "noun", english: "computer", vietnamese: "máy tính", syllabication: "com-PUT-er", definition: "An electronic device for processing data.", esl: { countability: "countable", physicalQuality: "concrete", grammaticalNumber: "singular", primaryClassification: "common" } },
  { partOfSpeech: "noun", english: "check-in", vietnamese: "thủ tục nhận phòng", syllabication: "check-in", definition: "The act of registering on arrival.", esl: { countability: "countable", physicalQuality: "abstract", grammaticalNumber: "singular", primaryClassification: "compound" } },
  { partOfSpeech: "adjective", english: "life-size", vietnamese: "kích thước thật", syllabication: "life-size", definition: "Having the same size as the real subject.", esl: { grammarClassification: { grammarSubtype: "attributive" } } },
  { partOfSpeech: "adverb", english: "step-by-step", vietnamese: "từng bước", syllabication: "step-by-step", definition: "Progressing one stage at a time.", esl: { grammarClassification: { grammarSubtype: "manner" } } },
]

function localDateKey(date = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

test("authenticated Student News Check -> Save -> Check keeps the session and enables Submit", { skip: SKIP_REASON }, async (t) => {
  Object.assign(process.env, ENV_VALUES)
  const { getSharedPrismaClient } = await import("../src/infra/db/prisma-client.mjs")
  const prisma = await getSharedPrismaClient()
  const stamp = randomUUID()
  const reportId = `news-check-repeat-${stamp}`
  const reportDateKey = localDateKey()
  const reportDate = new Date(`${reportDateKey}T00:00:00+07:00`)
  let browser
  let context
  let page
  const cleanupErrors = []
  const attempt = async (operation) => {
    try { await operation() } catch (error) { cleanupErrors.push(error) }
  }

  t.after(async () => {
    if (page) await attempt(() => page.close())
    if (context) await attempt(() => context.close())
    if (browser) await attempt(() => browser.close())
    await attempt(() => prisma.studentNewsReport.deleteMany({ where: { id: reportId } }))
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

  const studentApiResponses = []
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname
    if (pathname.startsWith("/api/student/")) studentApiResponses.push({ method: response.request().method(), pathname, status: response.status() })
  })
  await page.route("**/api/student/news-reports/check", async (route) => {
    const response = await route.fetch()
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
  })

  const vocabularyRows = page.locator("#newsVocabularyRows [data-news-vocabulary-row]")
  for (const row of await vocabularyRows.all()) {
    await row.locator('[data-vocabulary-field="partOfSpeech"]').selectOption("")
    await row.locator('[data-vocabulary-field="english"]').fill("")
    await row.locator('[data-vocabulary-field="vietnamese"]').fill("")
    await row.locator('[data-vocabulary-field="syllabication"]').fill("")
    await row.locator('[data-vocabulary-field="definition"]').fill("")
  }
  await vocabularyRows.first().locator('[data-vocabulary-field="partOfSpeech"]').selectOption("noun")
  await vocabularyRows.first().locator('[data-vocabulary-field="english"]').fill("demolition")
  await vocabularyRows.first().locator('[data-vocabulary-field="vietnamese"]').fill("sự phá hủy")
  await vocabularyRows.first().locator('[data-vocabulary-field="syllabication"]').fill("de-MO-li-tion")
  await vocabularyRows.first().locator('[data-vocabulary-field="definition"]').fill("The act of destroying a structure.")
  const rejectedCheckResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/student/news-reports/check", { timeout: 30000 })
  await page.locator("#checkBtn").click()
  const rejectedCheck = await rejectedCheckResponse
  const rejectedPayload = await rejectedCheck.json()
  assert.equal(rejectedCheck.status(), 200)
  assert.equal(rejectedPayload.mmrPassed, false)
  assert.equal(rejectedPayload.failedFields.vocabulary.score, 1)
  assert.equal(rejectedPayload.failedFields.vocabulary.threshold, 5)
  assert.match(rejectedPayload.failedFields.vocabulary.rowErrors[0].message, /Syllabication or primary stress is incorrect/u)
  await page.locator("#newsComplianceModal").waitFor({ state: "visible", timeout: 30000 })
  await page.waitForFunction(() => document.querySelector("#newsGrammarCheckWait")?.classList.contains("hidden"))
  await page.waitForFunction(() => !document.querySelector("#checkBtn")?.disabled)
  await page.setViewportSize({ width: 390, height: 844 })
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
  assert.ok(mobileModalGeometry.dialog?.left >= 0 && mobileModalGeometry.dialog?.right <= 390, JSON.stringify(mobileModalGeometry))
  assert.ok(mobileModalGeometry.documentWidth <= mobileModalGeometry.viewport, JSON.stringify(mobileModalGeometry))
  assert.ok(mobileModalGeometry.actions.length >= 2, JSON.stringify(mobileModalGeometry))
  assert.ok(mobileModalGeometry.actions.every((action) => action.left >= 0 && action.right <= 390), JSON.stringify(mobileModalGeometry))
  await page.setViewportSize({ width: 1440, height: 1100 })
  const vocabularyFeedback = await page.locator("#newsComplianceRequiredBody").innerText()
  assert.match(vocabularyFeedback, /Entry 1 \("demolition"\): Syllabication or primary stress is incorrect\./u)
  assert.match(vocabularyFeedback, /Score 1\.00 < 5\.00/u)
  assert.match(vocabularyFeedback, /Step 1: Complete every vocabulary row with part of speech, English, Vietnamese, syllabication, and definition\./u)
  assert.match(vocabularyFeedback, /Step 2: Use the provided dictionary links to verify syllable boundaries and primary stress; temporary dictionary outages are reported as warnings\./u)
  assert.match(vocabularyFeedback, /Step 3: Save again after correcting the named entry and its highlighted field\./u)
  assert.equal(await page.locator("#newsComplianceWarningsSection").isVisible(), true)
  assert.match(await page.locator("#newsComplianceWarningBody").innerText(), /Syllabication could not be verified right now/u)
  assert.equal(await page.locator("#newsGrammarCheckWait").isVisible(), false, "the result modal appears after the animated check overlay closes")
  const helpHref = await page.locator("#newsComplianceHelpLink").getAttribute("href")
  assert.match(helpHref, /^mailto:support@eagles\.edu\.vn\?/u)
  const helpUrl = new URL(helpHref)
  const helpBody = new URLSearchParams(helpUrl.search).get("body") || ""
  assert.match(helpBody, /Word: demolition/u)
  assert.match(helpBody, /Syllabication entered: de-MO-li-tion/u)
  assert.doesNotMatch(helpBody, /mark001|Synthetic repeated Check/u)
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
    const responsePromise = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === pathname, { timeout: 10000 }).catch(async (error) => {
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
    assert.equal(response.status(), 200, `${step} returns HTTP 200: ${JSON.stringify(payload)}`)
    if (step !== "Save") {
      assert.equal(payload.mmrPassed, true, `${step} passes grammar, vocabulary, and minimum requirements`)
      await page.locator("#newsGrammarCheckWait").waitFor({ state: "hidden", timeout: 30000 })
      const closeButton = page.locator("#newsComplianceModalCloseActionBtn")
      if (await closeButton.isVisible().catch(() => false)) await closeButton.click()
      await page.locator("#newsComplianceModal").waitFor({ state: "hidden", timeout: 30000 })
    } else {
      await page.waitForFunction(() => /Draft saved/i.test(document.getElementById("formStatus")?.textContent || ""), null, { timeout: 10000 })
    }
  }

  assert.deepEqual(studentApiResponses.filter((response) => response.status === 401), [], `Check -> Save -> Check has no 401 response: ${JSON.stringify(studentApiResponses)}`)
  assert.equal(await page.locator("#submitBtn").isDisabled(), false, "Submit becomes active after the second passing Check")
  const reportAfterSecondCheck = await prisma.studentNewsReport.findUnique({ where: { id: reportId }, select: { submissionState: true, mmrPassedAt: true, dateSatisfiedAt: true, firstSubmittedAt: true } })
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
