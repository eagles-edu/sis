import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import test from "node:test"
import { parse as parseDotenv } from "dotenv"
import { chromium } from "playwright"
import { resolveStandardStudentCredentials } from "./helpers/standard-portal-credentials.mjs"
import { listStudentNewsReportsForReview } from "../src/modules/admin/student-news-review.mjs"
import "../tools/assert-prisma-environment.mjs"

const ENV_FILE = String(process.env.SIS_ENV_FILE || "").trim()
const ENV_VALUES = fs.existsSync(ENV_FILE) ? parseDotenv(fs.readFileSync(ENV_FILE)) : {}
const ORIGIN = (process.env.STUDENT_NEWS_LIBRARY_ORIGIN || "http://127.0.0.1:8788").replace(/\/$/u, "")
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/google-chrome-stable"
const IS_DEV_RUN = process.env.NODE_ENV === "development" && ENV_FILE === ".env.dev"

function studentCredentials() {
  return resolveStandardStudentCredentials(ENV_VALUES)
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
  { partOfSpeech: "noun", english: "confederations", vietnamese: "các liên bang", syllabication: "con-fed-er-á-tions", definition: "Groups of states or organizations united for a shared purpose.", esl: { countability: "countable", physicalQuality: "abstract", grammaticalNumber: "plural", primaryClassification: "common" } },
  { partOfSpeech: "noun", english: "check-in", vietnamese: "thủ tục nhận phòng", syllabication: "check-in", definition: "The act of registering on arrival.", esl: { countability: "countable", physicalQuality: "abstract", grammaticalNumber: "singular", primaryClassification: "compound" } },
  { partOfSpeech: "adjective", english: "life-size", vietnamese: "kích thước thật", syllabication: "life-size", definition: "Having the same size as the real subject.", esl: { grammarClassification: { grammarSubtype: "attributive" } } },
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

async function createNewsFixture(prisma, studentRefId, stamp, vocabularyWords = NEWS_WORDS) {
  const reportDate = new Date()
  const vocabulary = vocabularyWords.map((word) => ({ ...word, id: `news-library-word-${stamp}-${word.english}` }))
  return prisma.studentNewsReport.create({
    data: {
      id: `news-library-report-${stamp}`,
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
    const entryId = `student-news-library-lifecycle-entry-${stamp}-${label}`
    const contributionId = `student-news-library-lifecycle-contribution-${stamp}-${label}`
    const payload = libraryPayload(english, definitions[label])
    const entry = await prisma.libraryEntry.create({
      data: {
        id: entryId,
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
        id: contributionId,
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

test("authenticated student News and New Words saves, Library visibility, week-set modal, and contribution lifecycle", { skip: SKIP_REASON }, async (t) => {
  Object.assign(process.env, ENV_VALUES)
  const { getSharedPrismaClient } = await import("../src/infra/db/prisma-client.mjs")
  const prisma = await getSharedPrismaClient()
  const stamp = randomUUID()
  const alphaStamp = stamp.replaceAll("-", "").replace(/[0-9]/gu, (digit) => String.fromCharCode(97 + Number(digit)))
  const legacyWordEnglish = `legacyconfederations${alphaStamp}`
  let reportId = ""
  let studentRefId = ""
  const newsContributionIds = []
  const newsContributionIdsByWord = new Map()
  const lifecycleFixtures = []
  const newWordsFixtureIds = []
  let savedNewWordEnglish = ""
  let browser
  let context
  let page
  const consoleErrors = []
  const requestFailures = []
  let expectedForbiddenConsoleErrors = 0
  let expectedBadRequestConsoleErrors = 0
  t.after(async () => {
    const cleanupErrors = []
    const attempt = async (operation) => {
      try {
        await operation()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    if (page) await attempt(() => page.close())
    if (context) await attempt(() => context.close())
    if (browser) await attempt(() => browser.close())

    for (let cleanupPass = 0; cleanupPass < 2; cleanupPass += 1) {
      const lifecycleSourcePrefix = `student-news-library-lifecycle-${stamp}-`
      const newsSourceIds = NEWS_WORDS.map((word) => `news-library-word-${stamp}-${word.english}`)
      const lifecycleContributionIds = ["pending", "legacy", "awaiting", "active", "expired"]
        .map((label) => `student-news-library-lifecycle-contribution-${stamp}-${label}`)
      const syntheticContributions = await prisma.libraryContribution.findMany({
        where: {
          OR: [
            { id: { in: [...newsContributionIds, ...lifecycleContributionIds] } },
            { sourceId: { in: newsSourceIds } },
            { sourceId: { startsWith: lifecycleSourcePrefix } },
          ],
        },
        select: { id: true },
      }).catch((error) => {
        cleanupErrors.push(error)
        return []
      })
      const contributionIds = [...new Set([
        ...newsContributionIds,
        ...lifecycleFixtures.map((fixture) => fixture.contributionId),
        ...syntheticContributions.map((contribution) => contribution.id),
      ])]
      if (contributionIds.length) {
        await attempt(() => prisma.libraryContributionRevision.deleteMany({ where: { contributionId: { in: contributionIds } } }))
        await attempt(() => prisma.libraryContribution.deleteMany({ where: { id: { in: contributionIds } } }))
      }

      const lifecycleEntryKeys = ["pending", "legacy", "awaiting", "active", "expired"]
        .map((label) => `lifecycle${label}${stamp}`)
      const lifecycleEntries = await prisma.libraryEntry.findMany({
        where: { normalizedKey: { in: lifecycleEntryKeys } },
        select: { id: true },
      }).catch((error) => {
        cleanupErrors.push(error)
        return []
      })
      const entryIds = [...new Set([
        ...lifecycleFixtures.map((fixture) => fixture.entryId),
        ...lifecycleEntries.map((entry) => entry.id),
      ])]
      if (entryIds.length) {
        await attempt(() => prisma.libraryEntryRevision.deleteMany({ where: { entryId: { in: entryIds } } }))
        await attempt(() => prisma.libraryEntry.deleteMany({ where: { id: { in: entryIds } } }))
      }

      if (studentRefId) {
        const wordCleanupConditions = [{ englishKey: legacyWordEnglish }, { id: { in: newWordsFixtureIds } }]
        if (savedNewWordEnglish) wordCleanupConditions.push({ englishKey: savedNewWordEnglish })
        if (reportId) wordCleanupConditions.push({ sourceReportId: reportId })
        await attempt(() => prisma.studentNewWord.deleteMany({
          where: { studentRefId, OR: wordCleanupConditions },
        }))
      }
      if (reportId) await attempt(() => prisma.studentNewsReport.deleteMany({ where: { id: reportId } }))
    }
    await attempt(() => prisma.$disconnect())
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Synthetic Student News and Library cleanup failed")
  })
  const runWorkflow = async () => {
    const student = await prisma.student.findUnique({ where: { eaglesId: STUDENT.user }, select: { id: true } })
    assert.ok(student?.id, "configured student must be linked to a Student row")
    studentRefId = student.id
    const preexistingNewsWordKeys = new Set((await prisma.studentNewWord.findMany({
      where: { studentRefId, englishKey: { in: NEWS_WORDS.map((word) => word.english.toLocaleLowerCase("en-US")) } },
      select: { englishKey: true },
    })).map((word) => word.englishKey))
    const expectedSeedWords = NEWS_WORDS.filter((word) => !preexistingNewsWordKeys.has(word.english.toLocaleLowerCase("en-US")))
    const pastedWord = expectedSeedWords.find((word) => word.english !== "confederations")
    assert.ok(pastedWord, "at least one submittable News fixture word is new for the configured student")
    const reportWords = [pastedWord, ...NEWS_WORDS.filter((word) => word !== pastedWord)]
    const pastedWordEnglish = pastedWord.english
    const invalidLegacyWord = await prisma.studentNewWord.create({
      data: {
        studentRefId,
        englishKey: legacyWordEnglish,
        partOfSpeech: "noun",
        english: legacyWordEnglish,
        vietnamese: "các liên bang",
        syllabication: "leg-a-cy-con-fed-er-á-tions",
        definition: "An unchanged previously saved New Words entry with a legal internal single-letter stressed vowel.",
      },
      select: { id: true },
    })
    newWordsFixtureIds.push(invalidLegacyWord.id)
    const refreshOrderEnglish = `libraryrefreshorder${alphaStamp}`
    const refreshOrderWord = await prisma.studentNewWord.create({
      data: {
        studentRefId,
        englishKey: refreshOrderEnglish,
        partOfSpeech: "noun",
        english: refreshOrderEnglish,
        vietnamese: "từ kiểm thử",
        syllabication: refreshOrderEnglish,
        definition: "Synthetic word for failed-save contribution isolation.",
      },
      select: { id: true },
    })
    newWordsFixtureIds.push(refreshOrderWord.id)
    const refreshOrderContribution = await prisma.libraryContribution.create({
      data: {
        studentRefId,
        contributorName: STUDENT.user,
        sourceKind: "student_new_words",
        sourceId: refreshOrderWord.id,
        payloadJson: libraryPayload(refreshOrderEnglish, "Synthetic word for failed-save contribution isolation."),
        status: "pending_review",
      },
      select: { id: true },
    })
    newsContributionIds.push(refreshOrderContribution.id)
    reportId = `news-library-report-${stamp}`
    await createNewsFixture(prisma, studentRefId, stamp, reportWords)
    lifecycleFixtures.push(...await createLibraryLifecycleFixtures(prisma, studentRefId, stamp))

    browser = await chromium.launch({ executablePath: EXECUTABLE_PATH, headless: true })
    context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
    page = await context.newPage()
    page.on("console", (message) => {
      if (message.type() !== "error") return
      if (expectedBadRequestConsoleErrors > 0 && /400 \(Bad Request\)/u.test(message.text())) {
        expectedBadRequestConsoleErrors -= 1
        return
      }
      if (expectedForbiddenConsoleErrors > 0 && /403 \(Forbidden\)/u.test(message.text())) {
        expectedForbiddenConsoleErrors -= 1
        return
      }
      consoleErrors.push(message.text())
    })
    page.on("requestfailed", (request) => {
      const failure = request.failure()?.errorText || "failed"
      const optionalWidgetAbort = new URL(request.url()).hostname === "conversations-widget.brevo.com" && failure === "net::ERR_ABORTED"
      if (!optionalWidgetAbort) requestFailures.push(`${request.method()} ${request.url()} ${failure}`)
    })
    await loginStudent(page)
    expectedBadRequestConsoleErrors += 1
    const rejectedDraftSave = await page.evaluate(async (wordId) => {
      const currentResponse = await fetch("/api/student/new-words", { credentials: "include" })
      const current = await currentResponse.json()
      if (!currentResponse.ok) throw new Error(`New Words load failed: HTTP ${currentResponse.status}`)
      const items = current.items.map((word) => word.id === wordId ? { ...word, syllabication: "not-valid" } : word)
      const response = await fetch("/api/student/new-words", { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) })
      return { status: response.status, body: await response.json() }
    }, refreshOrderWord.id)
    assert.equal(rejectedDraftSave.status, 400, "authoritative validation rejects the invalid New Words draft")
    const unchangedPendingContribution = await prisma.libraryContribution.findUnique({ where: { id: refreshOrderContribution.id }, select: { payloadJson: true } })
    assert.equal(unchangedPendingContribution?.payloadJson?.syllabication, refreshOrderEnglish, "a rejected New Words save does not refresh its pending Library contribution")
    const validRetry = await page.evaluate(async (wordId) => {
      const currentResponse = await fetch("/api/student/new-words", { credentials: "include" })
      const current = await currentResponse.json()
      if (!currentResponse.ok) throw new Error(`New Words reload failed: HTTP ${currentResponse.status}`)
      const items = current.items.map((word) => word.id === wordId ? { ...word, vietnamese: "từ kiểm thử đã lưu" } : word)
      const response = await fetch("/api/student/new-words", { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) })
      return { status: response.status, body: await response.json() }
    }, refreshOrderWord.id)
    assert.equal(validRetry.status, 200, "a valid retry persists New Words after the rejected draft")
    const refreshedPendingContribution = await prisma.libraryContribution.findUnique({ where: { id: refreshOrderContribution.id }, select: { payloadJson: true } })
    assert.equal(refreshedPendingContribution?.payloadJson?.vietnamese, "từ kiểm thử đã lưu", "a valid save still refreshes its pending Library contribution")
    await page.goto(`${ORIGIN}/student/library.html?apiOrigin=${encodeURIComponent(ORIGIN)}`, { waitUntil: "domcontentloaded" })
    await page.locator("#studentLibraryAddOneBtn").click()
    assert.equal(await page.locator("[data-vocabulary-dictionary-builder], [data-dictionary-builder-open-sources], [data-dictionary-builder-source-leds], [data-vocabulary-origin-analysis], [data-vocabulary-transitivity-check]").count(), 0, "student New Words rows do not render admin-only Dictionary Builder, origin, or transitivity controls")
    const newWordsDefinition = page.locator('#studentLibraryNewWordsRows [data-vocabulary-field="definition"]')
    await newWordsDefinition.waitFor({ state: "visible", timeout: 10000 })
    const pastedDefinition = await page.evaluate(() => {
      const textarea = document.querySelector('#studentLibraryNewWordsRows [data-vocabulary-field="definition"]')
      textarea.addEventListener("paste", (event) => event.stopPropagation())
      textarea.focus()
      const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true })
      Object.defineProperty(paste, "clipboardData", {
        value: {
          getData(type) {
            if (type === "text/html") return "<p>A <strong>bold</strong> and <em>italic</em> definition.</p>"
            if (type === "text/plain") return "A bold and italic definition."
            return ""
          },
        },
      })
      textarea.dispatchEvent(paste)
      return { prevented: paste.defaultPrevented, value: textarea.value, rendered: window.SIS_VOCABULARY_ESL.definitionHtml(textarea.value) }
    })
    assert.equal(pastedDefinition.prevented, true, "the shared paste handler intercepts rich clipboard data before row handlers")
    assert.equal(pastedDefinition.value, "A **bold** and *italic* definition.")
    assert.match(pastedDefinition.rendered, /<strong>bold<\/strong> and <em>italic<\/em>/u)

    await page.goto(`${ORIGIN}/student?apiOrigin=${encodeURIComponent(ORIGIN)}`, { waitUntil: "domcontentloaded" })
    await page.locator("#appPanel").waitFor({ state: "visible", timeout: 30000 })
    await page.click("#openNewsPageBtn")
    await page.locator("#newsPageCard").waitFor({ state: "visible", timeout: 30000 })
    await page.locator('#newsVocabularyRows [data-vocabulary-field="english"]').nth(0).waitFor({ state: "visible", timeout: 30000 })
    assert.equal(await page.locator('#newsVocabularyRows [data-vocabulary-field="english"]').count(), 5, "the real News fixture has exactly five vocabulary editors")

    await page.evaluate((english) => {
      const row = [...document.querySelectorAll("#newsVocabularyRows [data-news-vocabulary-row]")].find((candidate) => candidate.querySelector('[data-vocabulary-field="english"]')?.value === english)
      const textarea = row?.querySelector('[data-vocabulary-field="definition"]')
      if (!textarea) throw new Error(`definition editor not found for ${english}`)
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
    }, pastedWordEnglish)
    const draftResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/student/news-reports/draft", { timeout: 30000 })
    await page.click("#saveDraftBtn")
    assert.equal((await draftResponse).status(), 200, "News Save returns HTTP 200")
    await page.waitForFunction(() => /Draft saved/i.test(document.getElementById("formStatus")?.textContent || ""))
    const savedDraft = await prisma.studentNewsReport.findUnique({ where: { id: reportId }, select: { vocabularyJson: true, submissionState: true } })
    assert.equal(savedDraft?.submissionState, "draft")
    assert.equal(savedDraft?.vocabularyJson?.length, 5)
    assert.equal(savedDraft?.vocabularyJson?.find((entry) => entry.english === "confederations")?.syllabication, "con-fed-er-á-tions")
    assert.match(savedDraft?.vocabularyJson?.find((entry) => entry.english === pastedWordEnglish)?.definition || "", /\*\*bold\*\*[\s\S]*- first[\s\S]*\n[ ]{4}- \*nested\*/u)
    const adminReviewDrafts = await listStudentNewsReportsForReview({ status: "all", studentRefId })
    assert.equal(adminReviewDrafts.items.some((item) => item.id === reportId), false, "a persisted student draft stays out of the admin review list")
    const draftCalendarEvent = page.locator("#calendarGrid .fc-event-news-status").filter({ hasText: "DRAFT" }).first()
    await draftCalendarEvent.waitFor({ state: "visible", timeout: 10000 })
    assert.match(await draftCalendarEvent.getAttribute("title") || "", /Draft saved; not submitted for review\./u)

    const checkResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/student/news-reports/check", { timeout: 30000 })
    await page.click("#checkBtn")
    const checkResult = await checkResponse.catch(async (error) => {
      const status = await page.locator("#formStatus").innerText().catch(() => "unavailable")
      const disabled = await page.locator("#checkBtn").isDisabled().catch(() => true)
      throw new Error(`${error.message}; News status: ${status}; Check disabled: ${disabled}`)
    })
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
    await page.waitForFunction(() => [...document.querySelectorAll("#calendarGrid .fc-event-news-status")].some((event) => event.textContent.trim().toLowerCase() === "ready"), null, { timeout: 10000 })
    const readyCalendarEvent = page.locator("#calendarGrid .fc-event-news-status").filter({ hasText: /^Ready$/i }).first()
    assert.match(await readyCalendarEvent.getAttribute("title") || "", /Checks passed; not submitted for review\./u)
    const readyWeekSetRow = page.locator("#newsPageQueueBody tr[data-news-week-set-id]").first()
    await readyWeekSetRow.waitFor({ state: "visible", timeout: 10000 })
    assert.match(await readyWeekSetRow.innerText(), /0\/5[\s\S]*Ready/u, "a checked but unsubmitted report remains editable and is labeled Ready")
    assert.match(await page.locator("#newsPageQueueSummary").innerText(), /Submitted\s*0/u, "ready reports do not inflate submitted-review counts")

    const wordData = await page.evaluate(async () => {
      const response = await fetch("/api/student/new-words", { credentials: "include" })
      return { status: response.status, body: await response.json() }
    })
    assert.equal(wordData.status, 200, "authenticated New Words list returns HTTP 200")
    const words = (wordData.body.items || []).filter((word) => word.sourceReportId === reportId)
    assert.deepEqual(words.map((word) => word.english).sort(), expectedSeedWords.map((word) => word.english).sort(), "every new real word is seeded from the checked News report without duplicating an existing student word")
    for (const word of words.filter((entry) => entry.english !== "confederations")) {
      const submitted = await page.evaluate(async (entry) => {
        const response = await fetch("/api/student/library/submissions", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId: entry.id, entry }) })
        return { status: response.status, body: await response.json() }
      }, word)
      assert.equal(submitted.status, 201, `Library submission succeeds for ${word.english}`)
      assert.equal(submitted.body.ok, true)
      newsContributionIds.push(submitted.body.contribution.id)
      newsContributionIdsByWord.set(word.english, submitted.body.contribution.id)
    }

    const weekSetButtons = page.locator('#newsPageQueueBody button[data-open-news-week-set]')
    const weekSetCount = await weekSetButtons.count()
    let weekWords = []
    for (let index = 0; index < weekSetCount; index += 1) {
      await weekSetButtons.nth(index).click()
      await page.locator("#newsWeekSetModal").waitFor({ state: "visible", timeout: 10000 })
      weekWords = await page.locator('#newsWeekSetModalVocabularyRows [data-vocabulary-field="english"]').evaluateAll((inputs) => inputs.map((input) => input.value).filter(Boolean))
      if (NEWS_WORDS.every((word) => weekWords.includes(word.english))) {
        assert.equal(await page.locator("#newsViewerReviewStatusChip").innerText(), "-", "a ready report has no admin review status before Submit")
        break
      }
      await page.locator("#newsWeekSetModalCloseActionBtn").click()
      await page.locator("#newsWeekSetModal").waitFor({ state: "hidden", timeout: 10000 })
    }
    assert.deepEqual(weekWords.sort(), NEWS_WORDS.map((word) => word.english).sort(), "week-set modal renders the same five News words")
    await page.locator("#newsWeekSetModalCloseActionBtn").click()

    await page.goto(`${ORIGIN}/student/library.html?apiOrigin=${encodeURIComponent(ORIGIN)}&myWords=true`, { waitUntil: "domcontentloaded" })
    await page.locator("#libraryStatus").waitFor({ state: "visible", timeout: 30000 })
    await page.locator("#studentLibraryAddOneBtn").click()
    const newWordRow = page.locator("#studentLibraryNewWordsRows [data-news-vocabulary-row]").last()
    savedNewWordEnglish = `regressionword-${alphaStamp}`
    await newWordRow.locator('[data-vocabulary-field="partOfSpeech"]').selectOption("noun")
    await newWordRow.locator('[data-vocabulary-field="english"]').fill(savedNewWordEnglish)
    await newWordRow.locator('[data-vocabulary-field="vietnamese"]').fill("từ kiểm thử")
    await newWordRow.locator('[data-vocabulary-field="syllabication"]').fill(savedNewWordEnglish)
    await newWordRow.locator('[data-vocabulary-field="definition"]').fill("A regression word saved through the Student Library form.")
    const newWordsSaveResponse = page.waitForResponse((response) => response.request().method() === "PUT" && new URL(response.url()).pathname === "/api/student/new-words", { timeout: 30000 })
    await page.locator("#studentLibrarySaveWordsBtn").click()
    assert.equal((await newWordsSaveResponse).status(), 200, "Student Library Save Changes persists a new word even when an unchanged legacy row has an internal single-letter stressed vowel")
    await page.waitForFunction(() => /word saved to New Words/i.test(document.getElementById("studentLibraryNewWordsStatus")?.textContent || ""), null, { timeout: 10000 })
    const savedNewWord = await prisma.studentNewWord.findFirst({ where: { studentRefId, englishKey: savedNewWordEnglish } })
    assert.ok(savedNewWord?.id, "the new word is persisted in the student New Words table")
    newWordsFixtureIds.push(savedNewWord.id)
    const repeatedSave = await page.evaluate(async () => {
      const currentResponse = await fetch("/api/student/new-words", { credentials: "include" })
      const current = await currentResponse.json()
      if (!currentResponse.ok || !Array.isArray(current.items)) throw new Error(`New Words reload failed before replay: HTTP ${currentResponse.status}`)
      const response = await fetch("/api/student/new-words", { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: current.items }) })
      return { status: response.status, body: await response.json() }
    })
    assert.equal(repeatedSave.status, 200, "replaying the exact persisted Student Library payload succeeds")
    assert.equal(repeatedSave.body.items.filter((word) => word.english === savedNewWordEnglish).length, 1, "the replay response contains the new word exactly once")
    const persistedRegressionWords = await prisma.studentNewWord.findMany({
      where: { studentRefId, englishKey: { in: [savedNewWordEnglish, legacyWordEnglish] } },
      select: { id: true, englishKey: true, syllabication: true },
    })
    assert.equal(persistedRegressionWords.filter((word) => word.englishKey === savedNewWordEnglish).length, 1, "replaying the save does not duplicate the new word")
    const persistedLegacyWord = persistedRegressionWords.find((word) => word.englishKey === legacyWordEnglish)
    assert.equal(persistedLegacyWord?.id, invalidLegacyWord.id, "the unchanged legacy word remains in place across repeated saves")
    assert.equal(persistedLegacyWord?.syllabication, "leg-a-cy-con-fed-er-á-tions", "the unchanged legacy syllabication is preserved")
    await page.reload({ waitUntil: "domcontentloaded" })
    await page.locator("#libraryStatus").waitFor({ state: "visible", timeout: 10000 })
    const reloadedNewWords = await page.evaluate(async () => {
      const response = await fetch("/api/student/new-words", { credentials: "include" })
      return { status: response.status, body: await response.json() }
    })
    assert.equal(reloadedNewWords.status, 200, "the authenticated New Words list remains available after page reload")
    assert.equal(reloadedNewWords.body.items.filter((word) => word.english === savedNewWordEnglish).length, 1, "the saved word is still persisted exactly once after page reload")
    for (const word of words.filter((entry) => entry.english !== "confederations")) {
      await page.locator("#librarySearch").fill(word.english)
      await page.locator('#libraryFilters button[type="submit"]').click()
      const matchingContribution = newsContributionIdsByWord.get(word.english)
      await page.locator(`[data-entry-id="${matchingContribution}"]`).waitFor({ state: "visible", timeout: 30000 })
      assert.equal(await page.locator(`[data-entry-id="${matchingContribution}"]`).innerText(), "Edit", `Student Library exposes Edit for ${word.english}`)
    }
    const pastedContributionId = newsContributionIdsByWord.get(pastedWordEnglish)
    assert.ok(pastedContributionId, "the pasted News word is submitted for Library review")
    await page.locator("#librarySearch").fill(pastedWordEnglish)
    await page.locator('#libraryFilters button[type="submit"]').click()
    await page.locator(`[data-entry-id="${pastedContributionId}"]`).click()
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
    assert.equal(expectedBadRequestConsoleErrors, 0, "the expected invalid-save response is the only ignored bad-request console message")
    assert.deepEqual(consoleErrors, [], `browser console errors: ${consoleErrors.join(" | ")}`)
    assert.deepEqual(requestFailures, [], `browser request failures: ${requestFailures.join(" | ")}`)
    await page.screenshot({ path: "/tmp/student-news-library-lifecycle.png", fullPage: true })
  }
  await runWorkflow()
})
