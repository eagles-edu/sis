import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const ROOT_DIR = process.cwd()
const ARTIFACTS_DIR = path.resolve(ROOT_DIR, "artifacts")
const AXE_PATH = path.resolve(ROOT_DIR, "node_modules/axe-core/axe.min.js")
const TEST_ADMIN_UI_SETTINGS_FILE = `/tmp/sis-admin-ui-settings-${process.pid}.json`

let chromium = null
try {
  ({ chromium } = await import("playwright"))
} catch (error) {
  void error
}

const CHROMIUM_EXECUTABLE_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
].filter(Boolean)

function resolveChromiumExecutablePath() {
  if (!chromium) return ""
  try {
    const bundledPath = chromium.executablePath()
    if (bundledPath && fs.existsSync(bundledPath)) return bundledPath
  } catch (error) {
    void error
  }
  for (const candidatePath of CHROMIUM_EXECUTABLE_CANDIDATES) {
    if (fs.existsSync(candidatePath)) return candidatePath
  }
  return ""
}

const CHROMIUM_EXECUTABLE_PATH = resolveChromiumExecutablePath()
const CHROMIUM_LAUNCH_OPTIONS = CHROMIUM_EXECUTABLE_PATH
  ? { headless: true, executablePath: CHROMIUM_EXECUTABLE_PATH }
  : { headless: true }

function resolvePlaywrightSkipReason() {
  if (!chromium) return "playwright package is not installed"
  if (!CHROMIUM_EXECUTABLE_PATH) return "playwright browser executable is not installed"
  return false
}

function makeMockTransport() {
  return {
    verify(cb) {
      setImmediate(() => cb(null, true))
    },
    async sendMail() {
      return { messageId: "mock-id" }
    },
  }
}

function themeInitScript(theme = "light") {
  const rawTheme = theme === "dark" ? "dark" : "light"
  return `
    (() => {
      try {
        localStorage.setItem("sis-theme", ${JSON.stringify(rawTheme)});
        localStorage.setItem("sis-theme-admin", ${JSON.stringify(rawTheme)});
        localStorage.setItem("sis-theme-parent", ${JSON.stringify(rawTheme)});
        localStorage.setItem("sis-theme-student", ${JSON.stringify(rawTheme)});
      } catch {
        void 0;
      }
    })();
  `
}

function ensureArtifactsDir() {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true })
}

async function ensureAxe(page) {
  if (!fs.existsSync(AXE_PATH)) {
    throw new Error("axe-core is not installed")
  }
  const hasAxe = await page.evaluate(() => Boolean(globalThis.axe))
  if (!hasAxe) {
    await page.addScriptTag({ path: AXE_PATH })
    await page.waitForFunction(() => Boolean(globalThis.axe))
  }
}

async function runAxe(page) {
  await ensureAxe(page)
  return await page.evaluate(async () => {
    const results = await globalThis.axe.run(globalThis.document, {
      resultTypes: ["violations"],
    })
    return results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact || "",
      help: violation.help || "",
      nodes: violation.nodes.slice(0, 4).map((node) => ({
        target: Array.isArray(node.target) ? node.target.join(" ") : String(node.target || ""),
        failureSummary: node.failureSummary || "",
      })),
    }))
  })
}

async function snapshotSurfaces(page, selectors) {
  return await page.evaluate((input) => {
    const read = (selector) => {
      const el = globalThis.document.querySelector(selector)
      if (!el) return null
      const cs = globalThis.getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      return {
        selector,
        id: el.id || "",
        className: (el.className || "").toString(),
        bg: cs.backgroundColor,
        bgImage: cs.backgroundImage,
        color: cs.color,
        border: cs.borderColor,
        display: cs.display,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }
    }

    const result = {}
    for (const selector of input) {
      result[selector] = read(selector)
    }

    return result
  }, selectors)
}

function summarizeAxe(violations = []) {
  return violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes,
  }))
}

function assertNoFocusAxeIssues(violations, label) {
  const focusRuleIds = new Set(["color-contrast", "link-name", "button-name"])
  const focusViolations = violations.filter((violation) => focusRuleIds.has(violation.id))
  assert.equal(
    focusViolations.length,
    0,
    `${label} should not have axe text/control issues: ${JSON.stringify(focusViolations, null, 2)}`,
  )
}

function setupTestEnv() {
  process.env.NODE_ENV = "development"
  process.env.SIS_ENV_FILE = ".env.dev"
  process.env.EXERCISE_MAILER_ORIGIN = "*"
  process.env.MAILER_DEBUG = "false"
  process.env.STUDENT_ADMIN_UI_SETTINGS_FILE = TEST_ADMIN_UI_SETTINGS_FILE
  try {
    fs.rmSync(TEST_ADMIN_UI_SETTINGS_FILE, { force: true })
  } catch (error) {
    void error
  }
}

function parseJsonEnv(name) {
  const raw = process.env[name]
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch (error) {
    void error
    return null
  }
}

function resolveReviewCredentials() {
  const adminUser = process.env.STUDENT_ADMIN_USER || "admin"
  const adminPass = process.env.STUDENT_ADMIN_PASS || "3825u2z"
  const studentAccounts = parseJsonEnv("STUDENT_STUDENT_PORTAL_ACCOUNTS_JSON")
  const studentAccount =
    Array.isArray(studentAccounts) ?
      studentAccounts.find((account) => {
        return account && account.status === "active" && account.eaglesId && account.password
      }) || studentAccounts[0] :
      null
  const studentEaglesId = studentAccount?.eaglesId || process.env.STUDENT_STUDENT_USER || "kramer001"
  const studentPass = studentAccount?.password || process.env.STUDENT_STUDENT_PASS || "P1k@ch00"
  const parentUser = process.env.STUDENT_PARENT_USER || "cmkramer001"
  const parentPass = process.env.STUDENT_PARENT_PASS || "P1k@ch00"
  return {
    admin: { user: adminUser, password: adminPass },
    student: { eaglesId: studentEaglesId, password: studentPass },
    parent: { parentsId: parentUser, password: parentPass },
  }
}

function pageState(page) {
  return page.evaluate(() => ({
    bodyClass: globalThis.document.body.className,
    title: globalThis.document.title,
    htmlTheme: globalThis.document.documentElement.dataset.theme || "",
    bodyText: (globalThis.document.body.textContent || "").replace(/\s+/g, " ").trim().slice(0, 220),
  }))
}

async function loginAdmin(page, origin, credentials) {
  await page.goto(`${origin}/admin`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("#loginForm", { timeout: 15000 })
  await page.fill("#loginUser", credentials.user)
  await page.fill("#loginPass", credentials.password)
  await page.click("#loginBtn")
  await page.waitForFunction(() => {
    const app = globalThis.document.getElementById("app")
    return Boolean(app && !app.classList.contains("hidden"))
  })
}

async function loginStudent(page, origin, credentials) {
  await page.goto(`${origin}/student`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("#loginForm", { timeout: 15000 })
  await page.fill("#loginEaglesId", credentials.eaglesId)
  await page.fill("#loginPassword", credentials.password)
  await page.click("#loginBtn")
  await page.waitForFunction(() => {
    const app = globalThis.document.getElementById("appPanel")
    return Boolean(app && !app.classList.contains("hidden"))
  })
}

async function loginParent(page, origin, credentials) {
  await page.goto(`${origin}/parent`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("#loginCard", { timeout: 15000 })
  await page.fill("#parentsId", credentials.parentsId)
  await page.fill("#parentPassword", credentials.password)
  await page.click("#loginBtn")
  await page.waitForFunction(() => {
    const app = globalThis.document.getElementById("portalCard")
    return Boolean(app && !app.classList.contains("hidden"))
  })
}

async function reviewHub(page, origin, theme, coverage) {
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(250)
  const links = await page.evaluate(() =>
    Array.from(globalThis.document.querySelectorAll("a[data-portal-target]")).map((link) => ({
      text: String(link.textContent || "").replace(/\s+/g, " ").trim(),
      href: link.getAttribute("href") || "",
      portalTarget: link.getAttribute("data-portal-target") || "",
    })),
  )
  assert.equal(links.length, 3, "hub should expose three portal cards")

  const screenshots = []
  for (let index = 0; index < links.length; index += 1) {
    const link = links[index]
    await page.goto(new URL(link.href, origin).toString(), { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(250)
    screenshots.push({
      index,
      link,
      state: await pageState(page),
      surfaces: await snapshotSurfaces(page, ["body", ".portal-card", ".panel"]),
      axe: summarizeAxe(await runAxe(page)),
    })
  }

  coverage.push({ theme, role: "hub", links, screenshots })
}

async function reviewAdmin(page, origin, theme, coverage, credentials) {
  await loginAdmin(page, origin, credentials.admin)

  await page.goto(`${origin}/admin`, { waitUntil: "domcontentloaded" })
  const bootState = await page.evaluate(() => ({
    authPanelHidden: Boolean(globalThis.document.getElementById("authPanel")?.classList.contains("hidden")),
    appHidden: Boolean(globalThis.document.getElementById("app")?.classList.contains("hidden")),
    bodyClass: globalThis.document.body.className,
  }))
  assert.equal(bootState.authPanelHidden, true, "authenticated admin reload should not flash the login panel")
  assert.equal(bootState.appHidden, false, "authenticated admin reload should show the app immediately")

  const links = await page.evaluate(() =>
    Array.from(globalThis.document.querySelectorAll("a[data-page-link]")).map((link) => ({
      text: String(link.textContent || "").replace(/\s+/g, " ").trim(),
      href: link.getAttribute("href") || "",
      pageLink: link.getAttribute("data-page-link") || "",
    })),
  )
  assert.ok(links.length >= 10, "admin should expose the full route link set")

  const routeStates = []
  for (const link of links) {
    await page.goto(new URL(link.href, origin).toString(), { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(650)
    const state = await pageState(page)
    const surfaces = await snapshotSurfaces(page, [
      "body",
      ".wrap",
      ".app-shell",
      ".panel",
      ".card",
      ".queue-modal-card",
      ".grade-chart-shell",
      ".grade-chart-empty",
      "#newsReviewViewerModal .queue-modal-card",
      "#newsReviewViewerBody a",
      "#newsReviewViewerNote",
      ".news-review-note-line.pending",
      ".news-review-note-line.fixed",
      "#reloadBtn",
    ])
    const axe = summarizeAxe(await runAxe(page))
    assertNoFocusAxeIssues(axe, `admin route ${link.href} (${theme})`)
    routeStates.push({ link, state, surfaces, axe })
  }

  await page.goto(`${origin}/admin/news-reports`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(1000)
  const openBtn = page.locator("button[data-news-review-open-week-set]").first()
  if (await openBtn.count()) {
    await openBtn.click()
    await page.waitForTimeout(400)
    await page.waitForFunction(() => {
      const modal = globalThis.document.getElementById("newsReviewViewerModal")
      return Boolean(modal && !modal.classList.contains("hidden"))
    })
    const modalSurfaces = await snapshotSurfaces(page, [
      "#newsReviewViewerModal",
      "#newsReviewViewerBody a",
      "#newsReviewViewerNote",
      ".news-review-note-line.pending",
      ".news-review-note-line.fixed",
    ])
    const modalAxe = summarizeAxe(await runAxe(page))
    assertNoFocusAxeIssues(modalAxe, `admin news modal (${theme})`)
    const sourceLink = await page.locator("#newsReviewViewerBody a").first().evaluate((node) => {
      const cs = getComputedStyle(node)
      return { color: cs.color, text: node.textContent || "" }
    })
    assert.notEqual(sourceLink.color, "rgb(33, 33, 33)", "admin modal source link should not use body text color in dark mode")
    routeStates.push({ link: { href: "/admin/news-reports", text: "News Reports" }, modalSurfaces, modalAxe, sourceLink })
  }

  await page.goto(`${origin}/admin/grades-data`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(900)
  const gradeChartEmpty = await page.locator(".grade-chart-empty").first().evaluate((node) => {
    const cs = getComputedStyle(node)
    return { bg: cs.backgroundColor, bgImage: cs.backgroundImage, color: cs.color }
  })
  routeStates.push({ link: { href: "/admin/grades-data", text: "Grades Data" }, gradeChartEmpty })

  coverage.push({ theme, role: "admin", links, routeStates })
}

async function reviewStudent(page, origin, theme, coverage, credentials) {
  await loginStudent(page, origin, credentials.student)

  await page.goto(`${origin}/student`, { waitUntil: "domcontentloaded" })
  const bootState = await page.evaluate(() => ({
    loginHidden: Boolean(globalThis.document.getElementById("loginPanel")?.classList.contains("hidden")),
    appPanelHidden: Boolean(globalThis.document.getElementById("appPanel")?.classList.contains("hidden")),
    bodyClass: globalThis.document.body.className,
  }))
  assert.equal(bootState.loginHidden, true, "authenticated student reload should not flash the login card")
  assert.equal(bootState.appPanelHidden, false, "authenticated student reload should show the app immediately")

  const navLinks = page.locator("a[data-page-target]")
  const navMeta = await page.evaluate(() =>
    Array.from(globalThis.document.querySelectorAll("a[data-page-target]")).map((link) => ({
      text: String(link.textContent || "").replace(/\s+/g, " ").trim(),
      href: link.getAttribute("href") || "",
      pageTarget: link.getAttribute("data-page-target") || "",
      viewTarget: link.getAttribute("data-view-target") || "",
    })),
  )
  assert.ok(navMeta.length >= 6, "student should expose the full in-page link set")

  const visited = []
  for (let index = 0; index < await navLinks.count(); index += 1) {
    const navLink = navLinks.nth(index)
    await navLink.dispatchEvent("click")
    await page.waitForTimeout(450)
    const state = await pageState(page)
    const surfaces = await snapshotSurfaces(page, [
      "body",
      ".calendar-shell",
      ".detail-calendar-shell",
      ".homework-square",
      ".field-validation-message",
      ".status.bad",
      ".status.ok",
      "#newsWeekSetModal .portal-modal-dialog",
      "#newsWeekSetModal .portal-modal-backdrop",
      "#newsViewerSourceLink",
      "#newsComplianceModal .portal-modal-dialog",
      "#newsComplianceModal .field-validation-message",
      "#newsComplianceModal .status.bad",
      "#newsComplianceModal .status.ok",
    ])
    const axe = summarizeAxe(await runAxe(page))
    assertNoFocusAxeIssues(axe, `student page target #${index} (${theme})`)
    visited.push({ index, state, surfaces, axe })
  }

  const newsTarget = page.locator('a[data-page-target="news"]')
  if (await newsTarget.count()) {
    await newsTarget.first().dispatchEvent("click")
    await page.waitForTimeout(350)
    const openNewsBtn = page.locator("#openNewsPageBtn")
    if (await openNewsBtn.count()) {
      await openNewsBtn.dispatchEvent("click")
      await page.waitForTimeout(400)
    }
    const reportButtons = page.locator('button[data-open-news-week-set]')
    if (await reportButtons.count()) {
      await reportButtons.first().dispatchEvent("click")
      await page.waitForTimeout(400)
      const modalOpen = await page.evaluate(() => Boolean(globalThis.document.getElementById("newsWeekSetModal") && !globalThis.document.getElementById("newsWeekSetModal")?.classList.contains("hidden")))
      assert.equal(modalOpen, true, "student news modal should open")
      const modalSurfaces = await snapshotSurfaces(page, [
        "#newsWeekSetModal .portal-modal-dialog",
        "#newsWeekSetModal .portal-modal-body",
        "#newsWeekSetModal .portal-modal-close",
        "#newsViewerSourceLink",
        "#openNewsComplianceModalBtn",
        ".field-validation-message",
      ])
      const modalAxe = summarizeAxe(await runAxe(page))
      assertNoFocusAxeIssues(modalAxe, `student news modal (${theme})`)
      const sourceLink = await page.locator("#newsViewerSourceLink").first().evaluate((node) => {
        const cs = getComputedStyle(node)
        return { color: cs.color, bg: cs.backgroundColor, bgImage: cs.backgroundImage, value: (node.value || "").slice(0, 80) }
      })
      if (theme === "dark") {
        assert.notEqual(sourceLink.bg, "rgb(255, 255, 255)", "student news source field should not stay white in dark mode")
        assert.notEqual(sourceLink.color, "rgb(33, 33, 33)", "student news source field should not use the light text color in dark mode")
      }
      const validationMessage = await page.locator(".field-validation-message").first().evaluate((node) => {
        const cs = getComputedStyle(node)
        return { color: cs.color, text: node.textContent || "" }
      }).catch(() => null)
      if (validationMessage) {
        assert.notEqual(validationMessage.color, "rgb(154, 20, 36)", "student validation text should have a dark-mode variant")
      }
      visited.push({ newsModal: true, modalSurfaces, modalAxe, sourceLink, validationMessage })
      const complianceBtn = page.locator("#openNewsComplianceModalBtn")
      if (await complianceBtn.count()) {
        await complianceBtn.dispatchEvent("click")
        await page.waitForTimeout(300)
        const complianceSurfaces = await snapshotSurfaces(page, [
          "#newsComplianceModal .portal-modal-dialog",
          "#newsComplianceModal .field-validation-message",
          "#newsComplianceModal .portal-modal-close",
          "#newsComplianceModal .status.bad",
          "#newsComplianceModal .status.ok",
        ])
        const complianceAxe = summarizeAxe(await runAxe(page))
        assertNoFocusAxeIssues(complianceAxe, `student compliance modal (${theme})`)
        visited.push({ complianceModal: true, complianceSurfaces, complianceAxe })
      }
    }
  }

  coverage.push({ theme, role: "student", links: navMeta, routeStates: visited })
}

async function reviewParent(page, origin, theme, coverage, credentials) {
  await loginParent(page, origin, credentials.parent)

  await page.goto(`${origin}/parent`, { waitUntil: "domcontentloaded" })
  const bootState = await page.evaluate(() => ({
    loginHidden: Boolean(globalThis.document.getElementById("loginCard")?.classList.contains("hidden")),
    portalHidden: Boolean(globalThis.document.getElementById("portalCard")?.classList.contains("hidden")),
    bodyClass: globalThis.document.body.className,
  }))
  assert.equal(bootState.loginHidden, true, "authenticated parent reload should not flash the login card")
  assert.equal(bootState.portalHidden, false, "authenticated parent reload should show the portal immediately")

  const navLinks = page.locator("a[data-page-target]")
  const navMeta = await page.evaluate(() =>
    Array.from(globalThis.document.querySelectorAll("a[data-page-target]")).map((link) => ({
      text: String(link.textContent || "").replace(/\s+/g, " ").trim(),
      href: link.getAttribute("href") || "",
      pageTarget: link.getAttribute("data-page-target") || "",
      viewTarget: link.getAttribute("data-view-target") || "",
    })),
  )
  assert.ok(navMeta.length >= 8, "parent should expose the full in-page link set")

  const visited = []
  for (let index = 0; index < await navLinks.count(); index += 1) {
    const navLink = navLinks.nth(index)
    await navLink.dispatchEvent("click")
    await page.waitForTimeout(450)
    const state = await pageState(page)
    const surfaces = await snapshotSurfaces(page, [
      "body",
      ".calendar-shell",
      ".homework-square",
      ".attendance-square",
      ".dashboard-surface-shell",
      ".field-validation-message",
      "#newsWeekSetModal .portal-modal-dialog",
      "#newsWeekSetModal .portal-modal-body",
      "#newsWeekSetModal .portal-modal-close",
      "#newsViewerSourceLink",
    ])
    const axe = summarizeAxe(await runAxe(page))
    assertNoFocusAxeIssues(axe, `parent page target #${index} (${theme})`)
    visited.push({ index, state, surfaces, axe })
  }

  const newsTarget = page.locator('a[data-page-target="news-reports"]')
  if (await newsTarget.count()) {
    await newsTarget.first().dispatchEvent("click")
    await page.waitForTimeout(350)
    const buttons = page.locator('button[data-open-news-week-set]')
    if (await buttons.count()) {
      await buttons.first().dispatchEvent("click")
      await page.waitForTimeout(400)
      const modalOpen = await page.evaluate(() => Boolean(globalThis.document.getElementById("newsWeekSetModal") && !globalThis.document.getElementById("newsWeekSetModal")?.classList.contains("hidden")))
      assert.equal(modalOpen, true, "parent news modal should open")
      const modalSurfaces = await snapshotSurfaces(page, [
        "#newsWeekSetModal .portal-modal-dialog",
        "#newsWeekSetModal .portal-modal-body",
        "#newsWeekSetModal .portal-modal-close",
        "#newsViewerSourceLink",
      ])
      const modalAxe = summarizeAxe(await runAxe(page))
      assertNoFocusAxeIssues(modalAxe, `parent news modal (${theme})`)
      const sourceLink = await page.locator("#newsViewerSourceLink").first().evaluate((node) => {
        const cs = getComputedStyle(node)
        return { color: cs.color, bg: cs.backgroundColor, bgImage: cs.backgroundImage, value: (node.value || "").slice(0, 80) }
      })
      if (theme === "dark") {
        assert.notEqual(sourceLink.bg, "rgb(255, 255, 255)", "parent news source field should not stay white in dark mode")
        assert.notEqual(sourceLink.color, "rgb(33, 33, 33)", "parent news source field should not use the light text color in dark mode")
      }
      visited.push({ newsModal: true, modalSurfaces, modalAxe, sourceLink })
    }
  }

  coverage.push({ theme, role: "parent", links: navMeta, routeStates: visited })
}

async function reviewAdminUtilities(page, origin, theme, coverage) {
  await page.goto(`${origin}/admin/points-management`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(900)
  const pointsState = await pageState(page)
  const pointsSurfaces = await snapshotSurfaces(page, [
    "body",
    "#loginPanel",
    "#ledgerSummary",
    "#pointChart",
    ".panel",
    ".card",
  ])
  const pointsAxe = summarizeAxe(await runAxe(page))
  assertNoFocusAxeIssues(pointsAxe, `admin points management (${theme})`)

  await page.goto(`${origin}/web-asset/admin/grades-tabulator.html`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(900)
  const gradesState = await pageState(page)
  const gradesSurfaces = await snapshotSurfaces(page, [
    "body",
    "#reloadBtn",
    "#gradesTable",
    "#gradeChartEmpty",
    ".grade-chart-empty",
  ])
  const gradesAxe = summarizeAxe(await runAxe(page))
  assertNoFocusAxeIssues(gradesAxe, `grades tabulator (${theme})`)
  const reloadButton = await page.locator("#reloadBtn").first().evaluate((node) => {
    const cs = getComputedStyle(node)
    return { color: cs.color, bg: cs.backgroundColor, text: node.textContent || "" }
  }).catch(() => null)
  if (reloadButton && theme === "dark") {
    assert.notEqual(reloadButton.color, "rgb(33, 33, 33)", "grades tabulator reload button should keep readable dark text")
  }

  coverage.push({ theme, role: "admin-utilities", pointsState, pointsSurfaces, pointsAxe, gradesState, gradesSurfaces, gradesAxe, reloadButton })
}

const skipReason = resolvePlaywrightSkipReason()

setupTestEnv()

test(
  "portal site review sweeps light and dark portal views, link targets, modals, and text contrast",
  { skip: skipReason },
  async () => {
    ensureArtifactsDir()
    const credentials = resolveReviewCredentials()
    const { startExerciseMailer } = await import("../server/exercise-mailer.mjs")
    const server = await startExerciseMailer({ transporter: makeMockTransport(), port: 0 })
    await new Promise((resolve) => server.once("listening", resolve))
    const address = server.address()
    const port = typeof address === "object" && address ? address.port : 0
    const origin = `http://127.0.0.1:${port}`
    const browser = await chromium.launch(CHROMIUM_LAUNCH_OPTIONS)
    const coverage = []

    try {
      for (const theme of ["light", "dark"]) {
        const hubContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
        await hubContext.addInitScript(themeInitScript(theme))
        await reviewHub(await hubContext.newPage(), origin, theme, coverage)
        await hubContext.close()

        const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
        await adminContext.addInitScript(themeInitScript(theme))
        await reviewAdmin(await adminContext.newPage(), origin, theme, coverage, credentials)
        await reviewAdminUtilities(await adminContext.newPage(), origin, theme, coverage)
        await adminContext.close()

        const studentContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
        await studentContext.addInitScript(themeInitScript(theme))
        await reviewStudent(await studentContext.newPage(), origin, theme, coverage, credentials)
        await studentContext.close()

        const parentContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
        await parentContext.addInitScript(themeInitScript(theme))
        await reviewParent(await parentContext.newPage(), origin, theme, coverage, credentials)
        await parentContext.close()
      }
    } finally {
      await browser.close().catch(() => {})
      await new Promise((resolve) => server.close(resolve))
    }

    fs.writeFileSync(
      path.resolve(ARTIFACTS_DIR, "portal-site-review.json"),
      JSON.stringify({ coverage }, null, 2),
    )

    const summary = coverage
      .map((entry) => ({
        theme: entry.theme,
        role: entry.role,
        pages: Array.isArray(entry.links) ? entry.links.length : 0,
      }))
      .reduce((acc, entry) => {
        const key = `${entry.theme}:${entry.role}`
        acc[key] = entry.pages
        return acc
      }, {})

    assert.ok(Object.keys(summary).length >= 6, "site review should cover both themes and all portal roles")
  },
)
