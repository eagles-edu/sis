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
const ADMIN_ROUTE_NAV_TIMEOUT_MS = 30000

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

async function runAxe(page, selector = "") {
  await ensureAxe(page)
  return await page.evaluate(async (scopeSelector) => {
    const root = scopeSelector ? globalThis.document.querySelector(scopeSelector) : globalThis.document
    if (!root) {
      throw new Error(`axe scope not found: ${scopeSelector}`)
    }
    const results = await globalThis.axe.run(root, {
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
  }, selector)
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

async function captureSharedSurfaceProfile(page, role) {
  return await page.evaluate((currentRole) => {
    const selectors =
      currentRole === "parent" ?
        {
          topbar: "main .card.hero",
          authCard: "#portalCard",
        } :
        {
          topbar: "main .card.topbar",
          authCard: "#studentHomeCard",
        }

    const sharedSelectors = {
      identity: "#identityPanel",
      metrics: "#metricsPanel",
      homework: "#pastDueHomeworkCard",
      currentHomework: "#currentHomeworkCard",
      homeworkShell: "#pastDueHomeworkCard .homework-card-shell",
      queue: "#newsQueueCard",
      portalGrid: ".portal-grid",
      portalCol: ".portal-col",
    }

    const read = (selector) => {
      const el = globalThis.document.querySelector(selector)
      if (!el) return null
      const cs = globalThis.getComputedStyle(el)
      return {
        display: cs.display,
        alignItems: cs.alignItems,
        alignContent: cs.alignContent,
        gridAutoFlow: cs.gridAutoFlow,
        gridTemplateColumns: cs.gridTemplateColumns,
        gap: cs.gap,
        minWidth: cs.minWidth,
        pt: cs.paddingTop,
        pr: cs.paddingRight,
        pb: cs.paddingBottom,
        pl: cs.paddingLeft,
        radius: cs.borderRadius,
        border: cs.border,
        shadow: cs.boxShadow,
        bg: cs.backgroundImage || cs.backgroundColor,
      }
    }

    const profile = { role: currentRole }
    for (const [key, selector] of Object.entries(selectors)) {
      profile[key] = read(selector)
    }
    for (const [key, selector] of Object.entries(sharedSelectors)) {
      profile[key] = read(selector)
    }
    return profile
  }, role)
}

async function capturePlacementProfile(page, role) {
  return await page.evaluate((currentRole) => {
    const gridSelector = currentRole === "parent" ? ".portal-col" : "#studentHomeGrid"
    const grid = globalThis.document.querySelector(gridSelector)
    if (!grid) return null
    const gridRect = grid.getBoundingClientRect()
    const selectors = [
      "#overviewPanel",
      "#identityPanel",
      "#metricsPanel",
      "#pastDueHomeworkCard",
      "#newsQueueCard",
      "#currentHomeworkCard",
      "#attendanceCalendarCard",
      "#performanceReportsCard",
      "#gradesYtdCard",
      "#recommendationsCard",
      "#portalStatus",
    ]
    const classify = (rect) => {
      const width = Math.round(rect.width)
      const fullWidth = Math.round(gridRect.width)
      if (Math.abs(width - fullWidth) <= 4) return "full"
      return rect.left < gridRect.left + fullWidth / 2 ? "left" : "right"
    }
    const items = []
    for (const selector of selectors) {
      const el = globalThis.document.querySelector(selector)
      if (!el) continue
      const rect = el.getBoundingClientRect()
      items.push({
        selector,
        lane: classify(rect),
        width: Math.round(rect.width),
        x: Math.round(rect.left - gridRect.left),
        y: Math.round(rect.top - gridRect.top),
      })
    }
    return items
  }, role)
}

async function captureFrameProfile(page, role) {
  return await page.evaluate((currentRole) => {
    const selectors =
      currentRole === "parent" ?
        {
          main: "main",
          topbar: "main .card.hero",
          grid: "#portalCard > .portal-grid",
        } :
        {
          main: "main",
          topbar: "main .card.topbar",
          grid: "#studentHomeCard > .portal-grid",
        }

    const read = (selector) => {
      const el = globalThis.document.querySelector(selector)
      if (!el) return null
      const rect = el.getBoundingClientRect()
      const cs = globalThis.getComputedStyle(el)
      return {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        margin: cs.margin,
        pt: cs.paddingTop,
        pr: cs.paddingRight,
        pb: cs.paddingBottom,
        pl: cs.paddingLeft,
      }
    }

    return {
      role: currentRole,
      main: read(selectors.main),
      topbar: read(selectors.topbar),
      grid: read(selectors.grid),
    }
  }, role)
}

function assertSharedSurfaceProfilesMatch(studentProfile, parentProfile, theme) {
  const keys = [
    "topbar",
    "authCard",
    "identity",
    "metrics",
    "homework",
    "currentHomework",
    "homeworkShell",
    "queue",
  ]
  const styleKeys = [
    "display",
    "alignItems",
    "alignContent",
    "gridAutoFlow",
    "gridTemplateColumns",
    "gap",
    "minWidth",
    "pt",
    "pr",
    "pb",
    "pl",
    "radius",
    "border",
    "shadow",
    "bg",
  ]
  for (const key of keys) {
    assert.ok(studentProfile?.[key], `${theme} student profile should include ${key}`)
    assert.ok(parentProfile?.[key], `${theme} parent profile should include ${key}`)
    assert.deepEqual(
      Object.fromEntries(styleKeys.map((styleKey) => [styleKey, studentProfile[key][styleKey]])),
      Object.fromEntries(styleKeys.map((styleKey) => [styleKey, parentProfile[key][styleKey]])),
      `${theme} parent/student surface mismatch for ${key}`,
    )
  }
}

function assertPlacementProfilesMatch(studentProfile, parentProfile, theme) {
  assert.ok(Array.isArray(studentProfile), `${theme} student placement profile should exist`)
  assert.ok(Array.isArray(parentProfile), `${theme} parent placement profile should exist`)
  const studentComparable = studentProfile.map((entry) => ({
    selector: entry.selector,
    lane: entry.lane,
  }))
  const parentComparable = parentProfile.map((entry) => ({
    selector: entry.selector,
    lane: entry.lane,
  }))
  assert.deepEqual(
    parentComparable,
    studentComparable,
    `${theme} parent/student placement mismatch`,
  )
}

function assertFrameProfilesMatch(studentProfile, parentProfile, theme) {
  assert.ok(studentProfile?.main, `${theme} student frame profile should include main`)
  assert.ok(parentProfile?.main, `${theme} parent frame profile should include main`)
  const keys = ["main", "topbar", "grid"]
  const stripHeight = (profile) => {
    if (!profile || typeof profile !== "object") return profile
    const { h, ...rest } = profile
    void h
    return rest
  }
  for (const key of keys) {
    assert.deepEqual(
      stripHeight(parentProfile[key]),
      stripHeight(studentProfile[key]),
      `${theme} parent/student frame mismatch for ${key}`,
    )
  }
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
  process.env.STUDENT_ADMIN_USER = process.env.STUDENT_ADMIN_USER || "admin"
  process.env.STUDENT_ADMIN_PASS = process.env.STUDENT_ADMIN_PASS || "3825u2z"
  process.env.STUDENT_STUDENT_USER = process.env.STUDENT_STUDENT_USER || "kramer001"
  process.env.STUDENT_STUDENT_PASS = process.env.STUDENT_STUDENT_PASS || "P1k@ch00"
  process.env.STUDENT_PARENT_USER = process.env.STUDENT_PARENT_USER || "cmkramer001"
  process.env.STUDENT_PARENT_PASS = process.env.STUDENT_PARENT_PASS || "P1k@ch00"
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
  let response = null
  let lastStatus = 0
  for (let attempt = 0; attempt < 5; attempt += 1) {
    response = await fetch(`${origin}/api/admin/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        username: credentials.user,
        password: credentials.password,
      }),
    })
    if (response.ok) break
    lastStatus = response.status
    if (response.status !== 503 && response.status !== 502 && response.status !== 504) {
      break
    }
    await page.waitForTimeout(250 * (attempt + 1))
  }
  if (!response || !response.ok) {
    const bodyText = response ? await response.text().catch(() => "") : ""
    throw new Error(
      `admin login failed with ${lastStatus || response?.status || "unknown"}${bodyText ? `: ${bodyText}` : ""}`,
    )
  }
  const setCookie = response.headers.get("set-cookie") || ""
  const match = setCookie.match(/^student_admin_sid=([^;]+)/i)
  if (!match) {
    throw new Error("admin login did not return a session cookie")
  }
  await page.context().addCookies([
    {
      name: "student_admin_sid",
      value: match[1],
      url: origin,
    },
  ])

  await page.goto(`${origin}/admin`, { waitUntil: "domcontentloaded" })
  await page.waitForFunction(() => {
    const app = globalThis.document.getElementById("app")
    return Boolean(app && !app.classList.contains("hidden"))
  }, undefined, { timeout: 30000 })
}

async function loginStudent(page, origin, credentials) {
  const response = await fetch(`${origin}/api/student/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(credentials),
  })
  if (!response.ok) {
    throw new Error(`student login failed with ${response.status}`)
  }
  const setCookie = response.headers.get("set-cookie") || ""
  const match = setCookie.match(/^student_portal_sid=([^;]+)/i)
  if (!match) {
    throw new Error("student login did not return a session cookie")
  }
  await page.context().addCookies([
    {
      name: "student_portal_sid",
      value: match[1],
      url: origin,
    },
  ])
  const url = new URL("/student", origin)
  url.searchParams.set("apiOrigin", origin)
  await page.goto(url.toString(), { waitUntil: "domcontentloaded" })
  await page.waitForFunction(() => {
    const app = globalThis.document.getElementById("appPanel")
    return Boolean(app && !app.classList.contains("hidden"))
  }, undefined, { timeout: 30000 })
}

async function loginParent(page, origin, credentials) {
  const response = await fetch(`${origin}/api/parent/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(credentials),
  })
  if (!response.ok) {
    throw new Error(`parent login failed with ${response.status}`)
  }
  const setCookie = response.headers.get("set-cookie") || ""
  const match = setCookie.match(/^parent_portal_sid=([^;]+)/i)
  if (!match) {
    throw new Error("parent login did not return a session cookie")
  }
  await page.context().addCookies([
    {
      name: "parent_portal_sid",
      value: match[1],
      url: origin,
    },
  ])
  const url = new URL("/parent", origin)
  url.searchParams.set("apiOrigin", origin)
  await page.goto(url.toString(), { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2000)
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
    traceReviewStage(`theme ${theme} admin route ${link.href || link.pageLink || link.text} -> goto`)
    if (link.pageLink) {
      await page.goto(new URL(link.href, origin).toString(), {
        waitUntil: "commit",
        timeout: ADMIN_ROUTE_NAV_TIMEOUT_MS,
      })
    } else {
      await page.goto(new URL(link.href, origin).toString(), { waitUntil: "domcontentloaded" })
    }
    traceReviewStage(`theme ${theme} admin route ${link.href || link.pageLink || link.text} -> settled`)
    await page.waitForTimeout(650)
    traceReviewStage(`theme ${theme} admin route ${link.href || link.pageLink || link.text} -> state`)
    const state = await pageState(page)
    traceReviewStage(`theme ${theme} admin route ${link.href || link.pageLink || link.text} -> surfaces`)
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
      "#newsReviewViewerBody .news-review-viewer-block",
      "#newsReviewViewerNote",
      ".news-review-note-line.pending",
      ".news-review-note-line.fixed",
      "#reloadBtn",
    ])
    const routeHref = String(link.href || "")
    const isPerformanceDataRoute = routeHref === "/admin/performance-data"
    let axe = []
    if (isPerformanceDataRoute) {
      const performanceSelectors = [
        "#performanceSortField",
        "#performanceSortDirBtn",
        "#performanceDataLevel",
        "#performanceDataStudent",
        "#performanceDataDateFrom",
        "#performanceDataDateTo",
        "#performanceDataSearch",
        "#performanceArchiveToggleBtn",
        "#performanceExportXlsxBtn",
        "#performancePrintPdfBtn",
        "#performanceColumnControls",
        "#performanceDataSummary",
      ]
      for (const selector of performanceSelectors) {
        traceReviewStage(`theme ${theme} admin route ${link.href || link.pageLink || link.text} -> axe ${selector}`)
        axe = axe.concat(summarizeAxe(await runAxe(page, selector)))
      }
    } else {
      traceReviewStage(`theme ${theme} admin route ${link.href || link.pageLink || link.text} -> axe`)
      axe = summarizeAxe(await runAxe(page))
    }
    routeStates.push({ link, state, surfaces, axe })
  }

  await page.goto(`${origin}/admin/news-reports`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(1000)
  traceReviewStage(`theme ${theme} admin news modal`)
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
      "#newsReviewViewerBody .news-review-viewer-block",
      "#newsReviewViewerNote",
      ".news-review-note-line.pending",
      ".news-review-note-line.fixed",
    ])
    const modalAxe = summarizeAxe(await runAxe(page))
    assertNoFocusAxeIssues(modalAxe, `admin news modal (${theme})`)
    const viewerBlock = await page
      .locator("#newsReviewViewerBody .news-review-viewer-block")
      .first()
      .evaluate((node) => {
        const cs = getComputedStyle(node)
        return { bg: cs.backgroundColor, color: cs.color, text: node.textContent || "" }
      })
    assert.notEqual(
      viewerBlock.bg,
      "rgba(0, 0, 0, 0)",
      "admin modal viewer block should use a surfaced card background in dark mode",
    )
    assert.notEqual(
      viewerBlock.color,
      "rgb(33, 33, 33)",
      "admin modal viewer block should not use body text color in dark mode",
    )
    routeStates.push({ link: { href: "/admin/news-reports", text: "News Reports" }, modalSurfaces, modalAxe, viewerBlock })
  }

  await page.goto(`${origin}/admin/grades-data`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(900)
  traceReviewStage(`theme ${theme} admin grades-data`)
  const gradeChartEmpty = await page.locator(".grade-chart-empty").first().evaluate((node) => {
    const cs = getComputedStyle(node)
    return { bg: cs.backgroundColor, bgImage: cs.backgroundImage, color: cs.color }
  })
  traceReviewStage(`theme ${theme} admin grades-data axe chart shell`)
  const gradeChartAxe = summarizeAxe(await runAxe(page, "#gradeChartShell"))
  assertNoFocusAxeIssues(gradeChartAxe, `admin grades-data chart shell (${theme})`)
  traceReviewStage(`theme ${theme} admin grades-data axe controls`)
  const gradeControlsAxe = summarizeAxe(await runAxe(page, "#gradeColumnControls"))
  assertNoFocusAxeIssues(gradeControlsAxe, `admin grades-data controls (${theme})`)
  routeStates.push({ link: { href: "/admin/grades-data", text: "Grades Data" }, gradeChartEmpty })

  coverage.push({ theme, role: "admin", links, routeStates })
}

async function reviewStudent(page, origin, theme, coverage, credentials) {
  traceReviewStage(`theme ${theme} student start`)
  await loginStudent(page, origin, credentials.student)
  traceReviewStage(`theme ${theme} student logged in`)

  traceReviewStage(`theme ${theme} student boot check`)
  const bootState = await page.evaluate(() => ({
    loginHidden: Boolean(globalThis.document.getElementById("loginPanel")?.classList.contains("hidden")),
    appPanelHidden: Boolean(globalThis.document.getElementById("appPanel")?.classList.contains("hidden")),
    bodyClass: globalThis.document.body.className,
  }))
  assert.equal(bootState.loginHidden, true, "authenticated student reload should not flash the login card")
  assert.equal(bootState.appPanelHidden, false, "authenticated student reload should show the app immediately")
  traceReviewStage(`theme ${theme} student surface profile`)
  const surfaceProfile = await captureSharedSurfaceProfile(page, "student")
  traceReviewStage(`theme ${theme} student placement profile`)
  const placementProfile = await capturePlacementProfile(page, "student")
  traceReviewStage(`theme ${theme} student frame profile`)
  const frameProfile = await captureFrameProfile(page, "student")

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
    traceReviewStage(`theme ${theme} student nav #${index} start`)
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
    traceReviewStage(`theme ${theme} student nav #${index} done`)
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

  await page.locator('a[data-page-target="performance-reports"]').first().dispatchEvent("click")
  await page.waitForTimeout(350)
  const reportArchiveLink = page.locator('a[href^="/student/reports/"]').first()
  if (await reportArchiveLink.count()) {
    const reportHref = await reportArchiveLink.getAttribute("href")
    await reportArchiveLink.click()
    await page.waitForURL((url) => url.pathname.startsWith("/student/reports/"), { timeout: 30000 })
    await page.waitForFunction(() => {
      const body = globalThis.document.body
      return Boolean(body && body.classList.contains("student-portal-page"))
    })
    await page.waitForTimeout(250)
    const reportMenuButton = page.locator("#menuBtn")
    const reportMenuNav = page.locator("#sideNav")
    const reportMenuOverlay = page.locator("#navOverlay")
    assert.equal(await reportMenuButton.count(), 1, "student report page should expose the portal menu button")
    assert.equal(await reportMenuNav.count(), 1, "student report page should expose the portal side nav")
    assert.equal(await reportMenuOverlay.count(), 1, "student report page should expose the portal overlay")
    await reportMenuButton.click()
    await page.waitForTimeout(150)
    await page.waitForFunction(() => {
      const nav = globalThis.document.getElementById("sideNav")
      return Boolean(nav && nav.classList.contains("open") && globalThis.document.body.classList.contains("menu-open"))
    })
    await reportMenuOverlay.click()
    await page.waitForFunction(() => {
      const nav = globalThis.document.getElementById("sideNav")
      return Boolean(nav && !nav.classList.contains("open") && !globalThis.document.body.classList.contains("menu-open"))
    })
    const reportSnapshot = await page.evaluate(() => ({
      snapshotId: String(globalThis.document.querySelector('[data-field="snapshot-id"]')?.textContent || "").trim(),
      capturedAt: String(globalThis.document.querySelector('[data-field="snapshot-captured-at"]')?.textContent || "").trim(),
      rubricRows: globalThis.document.querySelectorAll("#report-rubric-body tr").length,
    }))
    assert.notEqual(reportSnapshot.snapshotId, "[[snapshot id]]", `student report snapshot should load for ${reportHref || "report link"}`)
    assert.notEqual(reportSnapshot.capturedAt, "[[full timestamp]]", "student report should show a captured timestamp")
    assert.ok(reportSnapshot.rubricRows >= 1, "student report should render rubric rows")
  }

  coverage.push({ theme, role: "student", links: navMeta, routeStates: visited, surfaceProfile, placementProfile, frameProfile })
}

async function reviewParent(page, origin, theme, coverage, credentials) {
  traceReviewStage(`theme ${theme} parent start`)
  await loginParent(page, origin, credentials.parent)
  traceReviewStage(`theme ${theme} parent logged in`)

  traceReviewStage(`theme ${theme} parent boot check`)
  await page.waitForTimeout(1000)
  traceReviewStage(`theme ${theme} parent surface profile`)
  const surfaceProfile = await captureSharedSurfaceProfile(page, "parent")
  traceReviewStage(`theme ${theme} parent placement profile`)
  const placementProfile = await capturePlacementProfile(page, "parent")
  traceReviewStage(`theme ${theme} parent frame profile`)
  const frameProfile = await captureFrameProfile(page, "parent")

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
    traceReviewStage(`theme ${theme} parent nav #${index} start`)
    const navLink = navLinks.nth(index)
    await navLink.dispatchEvent("click")
    await page.waitForTimeout(450)
    const state = await pageState(page)
    const surfaces = await snapshotSurfaces(page, [
      "body",
      ".calendar-shell",
      ".homework-square",
      ".attendance-square",
      ".field-validation-message",
      "#newsWeekSetModal .portal-modal-dialog",
      "#newsWeekSetModal .portal-modal-body",
      "#newsWeekSetModal .portal-modal-close",
      "#newsViewerSourceLink",
    ])
    const axe = summarizeAxe(await runAxe(page))
    assertNoFocusAxeIssues(axe, `parent page target #${index} (${theme})`)
    traceReviewStage(`theme ${theme} parent nav #${index} done`)
    visited.push({ index, state, surfaces, axe })
  }

  const newsTarget = page.locator('a[data-page-target="news-reports"]')
  if (await newsTarget.count()) {
    traceReviewStage(`theme ${theme} parent news modal`)
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

  await page.locator('a[data-page-target="performance-reports"]').first().dispatchEvent("click")
  await page.waitForTimeout(350)
  const reportArchiveLink = page.locator('a[href^="/parent/reports/"]').first()
  if (await reportArchiveLink.count()) {
    const reportHref = await reportArchiveLink.getAttribute("href")
    await reportArchiveLink.click()
    await page.waitForURL((url) => url.pathname.startsWith("/parent/reports/"), { timeout: 30000 })
    await page.waitForFunction(() => {
      const body = globalThis.document.body
      return Boolean(body && body.classList.contains("parent-portal-page"))
    })
    await page.waitForTimeout(250)
    const reportMenuButton = page.locator("#parentMenuBtn")
    const reportMenuNav = page.locator("#parentSideNav")
    const reportMenuOverlay = page.locator("#parentNavScrim")
    assert.equal(await reportMenuButton.count(), 1, "parent report page should expose the portal menu button")
    assert.equal(await reportMenuNav.count(), 1, "parent report page should expose the portal side nav")
    assert.equal(await reportMenuOverlay.count(), 1, "parent report page should expose the portal scrim")
    await reportMenuButton.click()
    await page.waitForTimeout(150)
    await page.waitForFunction(() => {
      const nav = globalThis.document.getElementById("parentSideNav")
      return Boolean(nav && nav.classList.contains("open") && globalThis.document.body.classList.contains("menu-open"))
    })
    await reportMenuOverlay.click()
    await page.waitForFunction(() => {
      const nav = globalThis.document.getElementById("parentSideNav")
      return Boolean(nav && !nav.classList.contains("open") && !globalThis.document.body.classList.contains("menu-open"))
    })
    const reportSnapshot = await page.evaluate(() => ({
      snapshotId: String(globalThis.document.querySelector('[data-field="snapshot-id"]')?.textContent || "").trim(),
      capturedAt: String(globalThis.document.querySelector('[data-field="snapshot-captured-at"]')?.textContent || "").trim(),
      rubricRows: globalThis.document.querySelectorAll("#report-rubric-body tr").length,
    }))
    assert.notEqual(reportSnapshot.snapshotId, "[[snapshot id]]", `parent report snapshot should load for ${reportHref || "report link"}`)
    assert.notEqual(reportSnapshot.capturedAt, "[[full timestamp]]", "parent report should show a captured timestamp")
    assert.ok(reportSnapshot.rubricRows >= 1, "parent report should render rubric rows")
  }

  coverage.push({ theme, role: "parent", links: navMeta, routeStates: visited, surfaceProfile, placementProfile, frameProfile })
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

function traceReviewStage(stage) {
  process.stderr.write(`[portal-site-review] ${stage}\n`)
}

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
        traceReviewStage(`theme ${theme} -> hub`)
        const hubContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
        await hubContext.addInitScript(themeInitScript(theme))
        await reviewHub(await hubContext.newPage(), origin, theme, coverage)
        await hubContext.close()

        traceReviewStage(`theme ${theme} -> admin`)
        const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
        await adminContext.addInitScript(themeInitScript(theme))
        await reviewAdmin(await adminContext.newPage(), origin, theme, coverage, credentials)
        traceReviewStage(`theme ${theme} -> admin utilities`)
        await reviewAdminUtilities(await adminContext.newPage(), origin, theme, coverage)
        await adminContext.close()

        traceReviewStage(`theme ${theme} -> student`)
        const studentContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
        await studentContext.addInitScript(themeInitScript(theme))
        await reviewStudent(await studentContext.newPage(), origin, theme, coverage, credentials)
        await studentContext.close()
      }
    } finally {
      await browser.close().catch(() => {})
      await new Promise((resolve) => server.close(resolve))
    }

    fs.writeFileSync(
      path.resolve(ARTIFACTS_DIR, "portal-site-review.json"),
      JSON.stringify({ coverage }, null, 2),
    )

    for (const theme of ["light", "dark"]) {
      const studentProfile = coverage.find((entry) => entry.theme === theme && entry.role === "student")?.surfaceProfile
      const studentPlacement = coverage.find((entry) => entry.theme === theme && entry.role === "student")?.placementProfile
      const studentFrame = coverage.find((entry) => entry.theme === theme && entry.role === "student")?.frameProfile
      assert.ok(studentProfile, `student surface profile should exist (${theme})`)
      assert.ok(studentPlacement, `student placement profile should exist (${theme})`)
      assert.ok(studentFrame, `student frame profile should exist (${theme})`)
    }

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
