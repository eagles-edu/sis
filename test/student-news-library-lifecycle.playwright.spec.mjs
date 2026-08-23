import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"
import { parse as parseDotenv } from "dotenv"
import { chromium } from "playwright"

const ENV_FILE = process.env.SIS_ENV_FILE || ".env.dev"
const ENV_VALUES = fs.existsSync(ENV_FILE) ? parseDotenv(fs.readFileSync(ENV_FILE)) : {}
const ORIGIN = (process.env.STUDENT_NEWS_LIBRARY_ORIGIN || "http://127.0.0.1:8788").replace(/\/$/u, "")
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/google-chrome-stable"
const IS_DEV_RUN = (process.env.NODE_ENV || "development") === "development" && ENV_FILE === ".env.dev"

function studentCredentials() {
  let accounts = []
  try {
    accounts = JSON.parse(ENV_VALUES.STUDENT_STUDENT_PORTAL_ACCOUNTS_JSON || "[]")
  } catch (error) {
    throw new Error(`Unable to parse student accounts from ${ENV_FILE}: ${error.message}`, { cause: error })
  }
  const account = accounts.find((entry) => entry?.eaglesId && entry?.password && entry.status !== "inactive") || {}
  return {
    user: ENV_VALUES.STUDENT_STUDENT_USER || account.eaglesId || "",
    pass: ENV_VALUES.STUDENT_STUDENT_PASS || account.password || "",
  }
}

const STUDENT = studentCredentials()
const SKIP_REASON = !IS_DEV_RUN
  ? "Authenticated News/Library lifecycle proof is restricted to the explicit dev environment"
  : !fs.existsSync(EXECUTABLE_PATH)
    ? `${EXECUTABLE_PATH} is required`
    : !STUDENT.user || !STUDENT.pass
      ? `student credentials are required from ${ENV_FILE}`
      : false

const NEWS_WORDS = [
  { partOfSpeech: "noun", english: "air-strike", vietnamese: "cuộc không kích", syllabication: "air-strike", definition: "An attack from aircraft.", esl: { countability: "countable", physicalQuality: "concrete", grammaticalNumber: "singular", primaryClassification: "compound" } },
  { partOfSpeech: "noun", english: "check-in", vietnamese: "thủ tục nhận phòng", syllabication: "check-in", definition: "The act of registering on arrival.", esl: { countability: "countable", physicalQuality: "abstract", grammaticalNumber: "singular", primaryClassification: "compound" } },
  { partOfSpeech: "adjective", english: "life-size", vietnamese: "kích thước thật", syllabication: "life-size", definition: "Having the same size as the real subject.", esl: { grammarClassification: { grammarSubtype: "attributive" } } },
  { partOfSpeech: "adjective", english: "long-term", vietnamese: "dài hạn", syllabication: "long-term", definition: "Continuing for a long period of time.", esl: { grammarClassification: { grammarSubtype: "attributive" } } },
  { partOfSpeech: "adverb", english: "step-by-step", vietnamese: "từng bước", syllabication: "step-by-step", definition: "Progressing one stage at a time.", esl: { grammarClassification: { grammarSubtype: "manner" } } },
]

function libraryPayload(english, definition) {
  return {
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
  }
}

async function loginStudent(page) {
  const loginResponse = page.waitForResponse((response) => /\/api\/student\/auth\/login(?:\?|$)/u.test(response.url()), { timeout: 30000 })
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

async function createNewsFixture(prisma, studentRefId, stamp) {
  const reportDate = new Date()
  const vocabulary = NEWS_WORDS.map((word) => ({ ...word, id: `news-library-word-${stamp}-${word.english}` }))
  return prisma.studentNewsReport.create({
    data: {
      studentRefId,
      reportDate,
      reportSequence: 9000,
      sourceLink: "https://example.com/news/authenticated-library-regression",
      articleTitle: "Storms hit coast city",
      byline: "bbc",
      articleDateline: "Published March 1, 2026 at 9:00 AM ICT (Indochina Time GMT+7).",
      leadSynopsis: "Officials said emergency teams evacuated hundreds of families after rising waters flooded multiple districts near the river.",
      actionActor: "Emergency teams",
      actionAffected: "Hundreds of families",
      actionWhere: "Riverside districts in Coast City",
      actionWhat: "Emergency teams evacuated residents after flood levels surged quickly.",
      actionWhy: "Floodwaters rose because heavy overnight rain and emergency dam releases increased river levels.",
      biasAssessment: "The report emphasizes official sources but also includes resident perspectives.",
      vocabularyJson: vocabulary,
      submissionState: "draft",
      reviewStatus: "submitted",
    },
    select: { id: true, reportDate: true },
  })
}

async function createLibraryLifecycleFixtures(prisma, studentRefId, stamp) {
  const now = Date.now()
  const definitions = {
    pending: "Pending owned contribution.",
    legacy: "Legacy owned contribution.",
    awaiting: "Awaiting legacy canonical contribution.",
    active: "Canonicalized contribution inside its fifteen-day edit window.",
    expired: "Canonicalized contribution beyond its fifteen-day edit window.",
  }
  const cases = [
    ["pending", "pending_review", "approved", null],
    ["legacy", "legacy_pending_review", "legacy_pending_review", null],
    ["awaiting", "awaiting_legacy_canonical", "legacy_pending_review", null],
    ["active", "canonicalized", "approved", new Date(now + 14 * 86400000)],
    ["expired", "canonicalized", "approved", new Date(now - 86400000)],
  ]
  const fixtures = []
  for (const [label, status, reviewStatus, dueAt] of cases) {
    const english = `lifecycle${label}${stamp}`
    const payload = libraryPayload(english, definitions[label])
    const entry = await prisma.libraryEntry.create({
      data: {
        normalizedKey: english,
        english,
        partOfSpeech: "noun",
        vietnamese: payload.vietnamese,
        syllabication: payload.syllabication,
        syllableCount: 1,
        definition: payload.definition,
        countability: "countable",
        nounType: "common",
        nounNumber: "singular",
        physicalQuality: "concrete",
        grammaticalNumber: "singular",
        primaryClassification: "common",
        reviewStatus,
        createdByName: "student-news-library-regression",
        lastEditedByName: "student-news-library-regression",
      },
      select: { id: true },
    })
    const contribution = await prisma.libraryContribution.create({
      data: {
        entryId: entry.id,
        studentRefId,
        contributorName: STUDENT.user,
        sourceKind: "student_new_words",
        sourceId: `student-news-library-lifecycle-${stamp}-${label}`,
        payloadJson: payload,
        status,
        submittedAt: new Date(now - 3600000),
        dueAt,
        canonicalizedAt: dueAt ? new Date(now - 86400000) : null,
      },
      select: { id: true },
    })
    fixtures.push({ label, english, entryId: entry.id, contributionId: contribution.id, payload })
  }
  return fixtures
}

test("authenticated student News five-word save, Library visibility, week-set modal, and contribution lifecycle", { skip: SKIP_REASON }, async () => {
  Object.assign(process.env, ENV_VALUES)
  const { getSharedPrismaClient } = await import("../src/infra/db/prisma-client.mjs")
  const prisma = await getSharedPrismaClient()
  const stamp = String(Date.now())
  let reportId = ""
  let studentRefId = ""
  const newsContributionIds = []
  const lifecycleFixtures = []
  let browser
  let context
  let page
  const consoleErrors = []
  const requestFailures = []
  let expectedForbiddenConsoleErrors = 0
  try {
    const student = await prisma.student.findUnique({ where: { eaglesId: STUDENT.user }, select: { id: true } })
    assert.ok(student?.id, "configured student must be linked to a Student row")
    studentRefId = student.id
    const report = await createNewsFixture(prisma, studentRefId, stamp)
    reportId = report.id
    lifecycleFixtures.push(...await createLibraryLifecycleFixtures(prisma, studentRefId, stamp))

    browser = await chromium.launch({ executablePath: EXECUTABLE_PATH, headless: true })
    context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
    page = await context.newPage()
    page.on("console", (message) => {
      if (message.type() !== "error") return
      if (expectedForbiddenConsoleErrors > 0 && /403 \(Forbidden\)/u.test(message.text())) {
        expectedForbiddenConsoleErrors -= 1
        return
      }
      consoleErrors.push(message.text())
    })
    page.on("requestfailed", (request) => requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || "failed"}`))
    await loginStudent(page)
    await page.click("#openNewsPageBtn")
    await page.locator("#newsPageCard").waitFor({ state: "visible", timeout: 30000 })
    await page.locator('#newsVocabularyRows [data-vocabulary-field="english"]').nth(0).waitFor({ state: "visible", timeout: 30000 })
    assert.equal(await page.locator('#newsVocabularyRows [data-vocabulary-field="english"]').count(), 5, "the real News fixture has exactly five vocabulary editors")

    await page.evaluate(() => {
      const textarea = document.querySelector('#newsVocabularyRows [data-vocabulary-field="definition"]')
      textarea.focus()
      textarea.selectionStart = textarea.selectionEnd = textarea.value.length
      const paste = typeof ClipboardEvent === "function"
        ? new ClipboardEvent("paste", { bubbles: true, cancelable: true })
        : new Event("paste", { bubbles: true, cancelable: true })
      Object.defineProperty(paste, "clipboardData", {
        value: {
          getData(type) {
            if (type === "text/html") return "<p>A <strong>bold</strong> point.</p><ul><li>first<ul><li><em>nested</em></li></ul></li></ul>"
            if (type === "text/plain") return "A bold point.\n- first\n  nested"
            return ""
          },
        },
      })
      textarea.dispatchEvent(paste)
      if (!/\*\*bold\*\*/u.test(textarea.value)) throw new Error(`structured paste handler did not run: ${textarea.value}`)
    })
    const draftResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/student/news-reports/draft", { timeout: 30000 })
    await page.click("#saveDraftBtn")
    assert.equal((await draftResponse).status(), 200, "News Save returns HTTP 200")
    await page.waitForFunction(() => /Draft saved/i.test(document.getElementById("formStatus")?.textContent || ""))
    const savedDraft = await prisma.studentNewsReport.findUnique({ where: { id: reportId }, select: { vocabularyJson: true, submissionState: true } })
    assert.equal(savedDraft?.submissionState, "draft")
    assert.equal(savedDraft?.vocabularyJson?.length, 5)
    assert.match(savedDraft?.vocabularyJson?.[0]?.definition || "", /\*\*bold\*\*[\s\S]*- first[\s\S]*\n[ ]{4}- \*nested\*/u)

    const checkResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/student/news-reports/check", { timeout: 30000 })
    await page.click("#checkBtn")
    const checkResult = await checkResponse
    const checkBody = await checkResult.json()
    assert.equal(checkResult.status(), 200, "News Check returns HTTP 200")
    assert.equal(checkBody.mmrPassed, true, `five-word News Check must pass MMR: ${JSON.stringify(checkBody)}`)
    await page.waitForFunction(() => /CHECKS PASSED|Minimum requirements met|Saved\./iu.test(document.getElementById("formStatus")?.textContent || ""), null, { timeout: 30000 })
    await page.locator("#newsGrammarCheckWait").waitFor({ state: "hidden", timeout: 30000 })
    const complianceClose = page.locator("#newsComplianceModalCloseActionBtn")
    if (await complianceClose.isVisible().catch(() => false)) await complianceClose.click()
    await page.locator("#newsComplianceModal").waitFor({ state: "hidden", timeout: 30000 })
    const checkedReport = await prisma.studentNewsReport.findUnique({ where: { id: reportId }, select: { vocabularyJson: true, submissionState: true, mmrPassedAt: true, dateSatisfiedAt: true } })
    assert.equal(checkedReport?.submissionState, "ready")
    assert.ok(checkedReport?.mmrPassedAt)
    assert.ok(checkedReport?.dateSatisfiedAt)
    assert.equal(checkedReport?.vocabularyJson?.length, 5)

    const wordData = await page.evaluate(async () => {
      const response = await fetch("/api/student/new-words", { credentials: "include" })
      return { status: response.status, body: await response.json() }
    })
    assert.equal(wordData.status, 200, "authenticated New Words list returns HTTP 200")
    const words = (wordData.body.items || []).filter((word) => word.sourceReportId === reportId)
    assert.deepEqual(words.map((word) => word.english).sort(), NEWS_WORDS.map((word) => word.english).sort(), "all five real words are seeded from the checked News report")
    for (const word of words) {
      const submitted = await page.evaluate(async (entry) => {
        const response = await fetch("/api/student/library/submissions", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId: entry.id, entry }) })
        return { status: response.status, body: await response.json() }
      }, word)
      assert.equal(submitted.status, 201, `Library submission succeeds for ${word.english}`)
      assert.equal(submitted.body.ok, true)
      newsContributionIds.push(submitted.body.contribution.id)
    }

    const weekSetButtons = page.locator('#newsPageQueueBody button[data-open-news-week-set]')
    const weekSetCount = await weekSetButtons.count()
    let weekWords = []
    for (let index = 0; index < weekSetCount; index += 1) {
      await weekSetButtons.nth(index).click()
      await page.locator("#newsWeekSetModal").waitFor({ state: "visible", timeout: 10000 })
      weekWords = await page.locator('#newsWeekSetModalVocabularyRows [data-vocabulary-field="english"]').evaluateAll((inputs) => inputs.map((input) => input.value).filter(Boolean))
      if (NEWS_WORDS.every((word) => weekWords.includes(word.english))) break
      await page.locator("#newsWeekSetModalCloseActionBtn").click()
      await page.locator("#newsWeekSetModal").waitFor({ state: "hidden", timeout: 10000 })
    }
    assert.deepEqual(weekWords.sort(), NEWS_WORDS.map((word) => word.english).sort(), "week-set modal renders the same five News words")
    await page.locator("#newsWeekSetModalCloseActionBtn").click()

    await page.goto(`${ORIGIN}/student/library.html?apiOrigin=${encodeURIComponent(ORIGIN)}&myWords=true`, { waitUntil: "domcontentloaded" })
    await page.locator("#libraryStatus").waitFor({ state: "visible", timeout: 30000 })
    for (const word of NEWS_WORDS) {
      await page.locator("#librarySearch").fill(word.english)
      await page.locator('#libraryFilters button[type="submit"]').click()
      const matchingContribution = newsContributionIds[words.findIndex((entry) => entry.english === word.english)]
      await page.locator(`[data-entry-id="${matchingContribution}"]`).waitFor({ state: "visible", timeout: 30000 })
      assert.equal(await page.locator(`[data-entry-id="${matchingContribution}"]`).innerText(), "Edit", `Student Library exposes Edit for ${word.english}`)
    }
    await page.locator("#librarySearch").fill("air-strike")
    await page.locator('#libraryFilters button[type="submit"]').click()
    await page.locator(`[data-entry-id="${newsContributionIds[0]}"]`).click()
    const newsEditDialog = page.locator("dialog.library-edit-dialog")
    await newsEditDialog.waitFor({ state: "visible", timeout: 10000 })
    assert.match(await newsEditDialog.locator('[data-vocabulary-field="definition"]').inputValue(), /\*\*bold\*\*[\s\S]*- first[\s\S]*\n[ ]{4}- \*nested\*/u)
    await newsEditDialog.locator("[data-library-edit-cancel]").click()

    for (const fixture of lifecycleFixtures) {
      await page.locator("#librarySearch").fill(fixture.english)
      await page.locator('#libraryFilters button[type="submit"]').click()
      const entryButton = page.locator(`[data-entry-id="${fixture.entryId}"]`)
      if (fixture.label === "expired") {
        await page.locator("#libraryStatus").waitFor({ state: "visible", timeout: 30000 })
        await page.waitForFunction(() => !/Loading/u.test(document.getElementById("libraryStatus")?.textContent || ""), null, { timeout: 30000 })
        assert.equal(await entryButton.count(), 0, "expired contribution has no Edit control")
        expectedForbiddenConsoleErrors += 1
        const rejected = await page.evaluate(async ({ entryId, payload }) => {
          const response = await fetch(`/api/student/library/entries/${encodeURIComponent(entryId)}/edit`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
          return { status: response.status, body: await response.json() }
        }, { entryId: fixture.entryId, payload: fixture.payload })
        assert.equal(rejected.status, 403, "expired canonicalized contribution is blocked server-side")
        continue
      }
      await entryButton.waitFor({ state: "visible", timeout: 30000 })
      assert.equal(await entryButton.innerText(), "Edit", `${fixture.label} owned contribution remains editable`)
      await entryButton.click()
      const dialog = page.locator("dialog.library-edit-dialog")
      await dialog.waitFor({ state: "visible", timeout: 10000 })
      assert.equal(await dialog.locator('[data-vocabulary-field="english"]').inputValue(), fixture.english)
      assert.equal(await dialog.locator('[data-vocabulary-field="definition"]').inputValue(), fixture.payload.definition)
      await dialog.locator('[data-vocabulary-field="vietnamese"]').fill(`${fixture.label} edited`)
      const responseWait = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/student/library/entries/${fixture.entryId}/edit`, { timeout: 30000 })
      await dialog.locator("[data-library-edit-submit]").click()
      assert.equal((await responseWait).status(), 201, `${fixture.label} Edit -> Submit returns HTTP 201`)
      await dialog.waitFor({ state: "detached", timeout: 10000 })
      const refreshed = await prisma.libraryContribution.findUnique({ where: { id: fixture.contributionId }, select: { payloadJson: true } })
      assert.equal(refreshed?.payloadJson?.vietnamese, `${fixture.label} edited`)
    }
    assert.deepEqual(consoleErrors, [], `browser console errors: ${consoleErrors.join(" | ")}`)
    assert.deepEqual(requestFailures, [], `browser request failures: ${requestFailures.join(" | ")}`)
    await page.screenshot({ path: "/tmp/student-news-library-lifecycle.png", fullPage: true })
  } finally {
    await page?.close().catch(() => {})
    await context?.close().catch(() => {})
    await browser?.close().catch(() => {})
    await prisma.libraryContributionRevision.deleteMany({ where: { contributionId: { in: [...newsContributionIds, ...lifecycleFixtures.map((fixture) => fixture.contributionId)] } } }).catch(() => {})
    await prisma.libraryContribution.deleteMany({ where: { id: { in: [...newsContributionIds, ...lifecycleFixtures.map((fixture) => fixture.contributionId)] } } }).catch(() => {})
    await prisma.libraryEntryRevision.deleteMany({ where: { entryId: { in: lifecycleFixtures.map((fixture) => fixture.entryId) } } }).catch(() => {})
    await prisma.libraryEntry.deleteMany({ where: { id: { in: lifecycleFixtures.map((fixture) => fixture.entryId) } } }).catch(() => {})
    if (reportId) {
      await prisma.studentNewWord.deleteMany({ where: { studentRefId, sourceReportId: reportId } }).catch(() => {})
      await prisma.studentNewsReport.delete({ where: { id: reportId } }).catch(() => {})
    }
  }
})
