import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"
import { parse as parseDotenv } from "dotenv"
import { chromium } from "playwright"

const ENV_FILE = process.env.SIS_ENV_FILE || ".env.dev"
const ENV_VALUES = fs.existsSync(ENV_FILE) ? parseDotenv(fs.readFileSync(ENV_FILE)) : {}
const ORIGIN = (process.env.STUDENT_LIBRARY_EDIT_ORIGIN || "http://127.0.0.1:8788").replace(/\/$/u, "")
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
  ? "Student Library persistence proof is restricted to the explicit dev environment"
  : !fs.existsSync(EXECUTABLE_PATH)
    ? `${EXECUTABLE_PATH} is required`
    : !STUDENT.user || !STUDENT.pass
      ? `student credentials are required from ${ENV_FILE}`
      : false

test("authenticated Student Library Edit -> Submit persists the canonical contribution", { skip: SKIP_REASON }, async () => {
  Object.assign(process.env, ENV_VALUES)
  const { getSharedPrismaClient } = await import("../src/infra/db/prisma-client.mjs")
  const prisma = await getSharedPrismaClient()
  const stamp = String(Date.now())
  const english = `libraryeditregression${stamp}`
  const sourceId = `student-library-edit-submit-regression-${stamp}`
  let entryId = ""
  let contributionId = ""
  let browser
  try {
    const student = await prisma.student.findUnique({ where: { eaglesId: STUDENT.user }, select: { id: true } })
    assert.ok(student?.id, "configured student must be linked to a Student row")
    const entry = await prisma.libraryEntry.create({
      data: {
        normalizedKey: english,
        english,
        partOfSpeech: "noun",
        phraseType: null,
        etymologyType: null,
        etymology: null,
        originPath: null,
        originReferences: [],
        vietnamese: "từ kiểm thử",
        syllabication: "LI-brary",
        syllableCount: 2,
        definition: "Temporary authenticated edit-submit proof.",
        countability: "countable",
        nounType: "common",
        nounNumber: "singular",
        physicalQuality: "concrete",
        grammaticalNumber: "singular",
        primaryClassification: "common",
        reviewStatus: "approved",
        createdByName: "student-library-regression",
        lastEditedByName: "student-library-regression",
      },
      select: { id: true },
    })
    entryId = entry.id
    const contribution = await prisma.libraryContribution.create({
      data: {
        entryId,
        studentRefId: student.id,
        contributorName: STUDENT.user,
        sourceKind: "student_new_words",
        sourceId,
        status: "approved",
        dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        payloadJson: {
          english,
          partOfSpeech: "noun",
          vietnamese: "từ kiểm thử",
          syllabication: "LI-brary",
          definition: "Temporary authenticated edit-submit proof.\n\n**Etymology**\n1530s, from Latin.\n\n**Works Cited:**\n- Regression source.",
          countability: "countable",
          nounType: "common",
          nounNumber: "singular",
          physicalQuality: "concrete",
          grammaticalNumber: "singular",
          primaryClassification: "common",
          etymologyType: "borrowed",
          etymology: "1530s, from Latin.",
          originPath: "Latin → English",
          originReferences: [{ source: "Regression source", url: "https://example.invalid/library-edit-submit-regression" }],
        },
      },
      select: { id: true },
    })
    contributionId = contribution.id

    browser = await chromium.launch({ executablePath: EXECUTABLE_PATH, headless: true })
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    const consoleErrors = []
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()) })
    const loginResponse = page.waitForResponse((response) => /\/api\/student\/auth\/login(?:\?|$)/u.test(response.url()), { timeout: 30000 })
    await page.goto(`${ORIGIN}/student`, { waitUntil: "domcontentloaded" })
    await page.locator("#loginEaglesId").fill(STUDENT.user)
    await page.locator("#loginPassword").fill(STUDENT.pass)
    await page.locator('#loginForm button[type="submit"]').click()
    assert.equal((await loginResponse).status(), 200, "visible student login succeeds")
    await page.locator("#appPanel").waitFor({ state: "visible", timeout: 30000 })
    await page.goto(`${ORIGIN}/student/library.html?myWords=true`, { waitUntil: "domcontentloaded" })

    const editButton = page.locator(`[data-entry-id="${entryId}"]`).first()
    await editButton.waitFor({ state: "visible", timeout: 30000 })
    assert.equal(await editButton.innerText(), "Edit")
    await editButton.click()
    const dialog = page.locator("dialog.library-edit-dialog")
    await dialog.waitFor({ state: "visible", timeout: 10000 })
    assert.equal(await dialog.locator("[data-library-edit-submit]").innerText(), "Submit")
    assert.equal(await dialog.locator('[data-vocabulary-esl-field="etymologyType"]').inputValue(), "borrowed")
    assert.equal(await dialog.locator('[data-vocabulary-esl-field="etymology"]').inputValue(), "1530s, from Latin.")
    assert.equal(await dialog.locator('[data-vocabulary-origin-field="originPath"]').inputValue(), "Latin → English")
    assert.match(await dialog.locator('[data-vocabulary-field="definition"]').inputValue(), /\*\*Etymology\*\*/u)
    assert.match(await dialog.locator('[data-vocabulary-origin-field="originReferences"]').inputValue(), /Regression source/u)
    await dialog.locator('[data-vocabulary-field="vietnamese"]').fill("từ kiểm thử đã sửa")
    const saveResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/student/library/entries/${entryId}/edit`, { timeout: 30000 })
    await dialog.locator("[data-library-edit-submit]").click()
    const response = await saveResponse
    assert.equal(response.status(), 201, "Student Library Edit -> Submit returns HTTP 201")
    assert.equal((await response.json()).ok, true, "Student Library Edit -> Submit returns ok:true")
    await dialog.waitFor({ state: "detached", timeout: 10000 })

    const saved = await prisma.libraryContribution.findUnique({ where: { id: contributionId }, select: { payloadJson: true } })
    const savedPayload = saved?.payloadJson || {}
    assert.equal(savedPayload.vietnamese, "từ kiểm thử đã sửa")
    assert.equal(savedPayload.nounType, "common")
    assert.equal(savedPayload.etymologyType, "borrowed")
    assert.equal(savedPayload.etymology, "1530s, from Latin.")
    assert.equal(savedPayload.originPath, "Latin → English")
    assert.deepEqual(savedPayload.originReferences, [{ source: "Regression source", url: "https://example.invalid/library-edit-submit-regression" }])
    assert.match(savedPayload.definition, /\*\*Etymology\*\*/u)
    assert.deepEqual(consoleErrors, [])
    await context.close()
  } finally {
    if (browser) await browser.close().catch(() => {})
    if (contributionId) {
      await prisma.libraryContributionRevision.deleteMany({ where: { contributionId } })
      await prisma.libraryContribution.delete({ where: { id: contributionId } }).catch(() => {})
    }
    if (entryId) {
      await prisma.libraryEntryRevision.deleteMany({ where: { entryId } })
      await prisma.libraryEntry.delete({ where: { id: entryId } }).catch(() => {})
    }
    await prisma.$disconnect()
  }
})
