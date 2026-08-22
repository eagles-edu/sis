import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"
import { parse as parseDotenv } from "dotenv"
import { chromium } from "playwright"

const ENV_FILE = process.env.SIS_ENV_FILE || ".env.dev"
const ENV_VALUES = fs.existsSync(ENV_FILE)
  ? parseDotenv(fs.readFileSync(ENV_FILE))
  : {}
const ORIGIN = (process.env.PARENT_PORTAL_PERF_ORIGIN || "http://127.0.0.1:8788").replace(/\/$/u, "")
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]
const CHROMIUM_EXECUTABLE_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
].filter(Boolean)

function resolveChromiumExecutablePath() {
  return CHROMIUM_EXECUTABLE_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || ""
}

function parentCredentials() {
  const user = process.env.STUDENT_PARENT_USER || ENV_VALUES.STUDENT_PARENT_USER || ""
  const pass = process.env.STUDENT_PARENT_PASS || ENV_VALUES.STUDENT_PARENT_PASS || ""
  return { user, pass }
}

const PARENT = parentCredentials()
const CHROMIUM_EXECUTABLE_PATH = resolveChromiumExecutablePath()
const SKIP_REASON = !CHROMIUM_EXECUTABLE_PATH
  ? "google-chrome-stable or another Chromium executable is required"
  : !PARENT.user || !PARENT.pass
    ? `parent credentials are required from ${ENV_FILE}`
    : false

const PERF_INIT_SCRIPT = `
  (() => {
    const state = { cls: 0, lcp: 0 };
    globalThis.__SIS_PARENT_PERF__ = state;
    if (!globalThis.PerformanceObserver) return;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === "largest-contentful-paint") state.lcp = Math.max(state.lcp, entry.startTime || 0);
          if (entry.entryType === "layout-shift" && !entry.hadRecentInput) state.cls += entry.value || 0;
        }
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === "layout-shift" && !entry.hadRecentInput) state.cls += entry.value || 0;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {}
  })();
`

async function loginThroughVisibleUi(page) {
  await page.goto(`${ORIGIN}/parent`, { waitUntil: "domcontentloaded" })
  await page.locator("#parentsId").fill(PARENT.user)
  await page.locator("#parentPassword").fill(PARENT.pass)
  const loginResponse = page.waitForResponse(
    (response) => /\/api\/parent\/auth\/login(?:\?|$)/u.test(response.url()),
    { timeout: 30000 },
  )
  await page.locator("#loginForm button[type=submit]").click()
  const response = await loginResponse
  assert.equal(response.status(), 200, "visible parent login must succeed")
  await page.locator("#portalCard").waitFor({ state: "visible", timeout: 30000 })
  await page.locator("#studentIdentity").waitFor({ state: "visible", timeout: 30000 })
}

async function collectReloadEvidence(page, requests, failedRequests, consoleErrors) {
  await page.reload({ waitUntil: "domcontentloaded" })
  const domContentLoadedState = await page.evaluate(() => ({
    authState: document.documentElement.dataset.parentAuthState || "",
    bodyVisibility: getComputedStyle(document.body).visibility,
    loginHidden: document.getElementById("loginCard")?.classList.contains("hidden") === true,
    portalHidden: document.getElementById("portalCard")?.classList.contains("hidden") !== false,
  }))

  await page.waitForFunction(() => {
    const portal = document.getElementById("portalCard")
    const identity = document.getElementById("studentIdentity")?.textContent || ""
    return document.documentElement.dataset.parentAuthState === "authenticated"
      && portal
      && !portal.classList.contains("hidden")
      && getComputedStyle(document.body).visibility !== "hidden"
      && Boolean(identity.trim())
      && !/đang tải|loading/iu.test(identity)
  }, undefined, { timeout: 30000 })
  await page.waitForTimeout(1000)

  const browserEvidence = await page.evaluate(() => {
    const resources = performance.getEntriesByType("resource").map((entry) => ({
      name: entry.name,
      startTime: entry.startTime,
    }))
    const lcp = Number(globalThis.__SIS_PARENT_PERF__?.lcp || 0)
    return {
      url: location.href,
      title: document.title,
      authState: document.documentElement.dataset.parentAuthState || "",
      loginHidden: document.getElementById("loginCard")?.classList.contains("hidden") === true,
      portalHidden: document.getElementById("portalCard")?.classList.contains("hidden") !== false,
      bodyVisibility: getComputedStyle(document.body).visibility,
      identity: document.getElementById("studentIdentity")?.textContent?.replace(/\s+/gu, " ").trim() || "",
      cls: Number(globalThis.__SIS_PARENT_PERF__?.cls || 0),
      lcp,
      resources,
    }
  })
  const brevoResourcesBeforeLcp = browserEvidence.resources.filter((entry) =>
    /(?:brevo-conversations|fe-conversations-widget)\.brevo\.com/u.test(entry.name)
      && browserEvidence.lcp > 0
      && entry.startTime < browserEvidence.lcp,
  )
  const toleratedFailures = failedRequests.filter((entry) =>
    !(entry.url.includes("brevo") && entry.errorText === "net::ERR_ABORTED"),
  )
  return {
    domContentLoadedState,
    browserEvidence,
    childrenRequests: requests.filter((entry) => /\/api\/parent\/children(?:\?|$)/u.test(entry.url)),
    dashboardRequests: requests.filter((entry) => /\/api\/parent\/dashboard(?:\?|$)/u.test(entry.url)),
    profileRequests: requests.filter((entry) => /\/api\/parent\/children\/[^/]+\/profile(?:\?|$)/u.test(entry.url)),
    criticalRequestStartDelta: Math.abs(
      (requests.find((entry) => /\/api\/parent\/children(?:\?|$)/u.test(entry.url))?.startedAt || 0)
      - (requests.find((entry) => /\/api\/parent\/dashboard(?:\?|$)/u.test(entry.url))?.startedAt || 0),
    ),
    brevoResourcesBeforeLcp,
    failedRequests: toleratedFailures,
    consoleErrors,
  }
}

test("authenticated parent boot follows student critical performance sequence", { skip: SKIP_REASON }, async (t) => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_EXECUTABLE_PATH })
  t.after(() => browser.close())

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } })
    await context.addInitScript(PERF_INIT_SCRIPT)
    const page = await context.newPage()
    const requests = []
    const failedRequests = []
    const consoleErrors = []
    page.on("request", (request) => requests.push({ url: request.url(), startedAt: Date.now() }))
    page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), errorText: request.failure()?.errorText || "" }))
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text())
    })

    await loginThroughVisibleUi(page)
    await page.waitForTimeout(1000)
    requests.length = 0
    failedRequests.length = 0
    consoleErrors.length = 0
    const evidence = await collectReloadEvidence(page, requests, failedRequests, consoleErrors)
    console.log(
      `[parent-performance] ${viewport.name} `
      + `DCL(auth=${evidence.domContentLoadedState.authState},body=${evidence.domContentLoadedState.bodyVisibility},`
      + `loginHidden=${evidence.domContentLoadedState.loginHidden},portalHidden=${evidence.domContentLoadedState.portalHidden}) `
      + `LCP=${Math.round(evidence.browserEvidence.lcp)}ms `
      + `CLS=${Number(evidence.browserEvidence.cls).toFixed(4)} `
      + `childrenRequests=${evidence.childrenRequests.length} `
      + `dashboardRequests=${evidence.dashboardRequests.length} `
      + `profileRequests=${evidence.profileRequests.length} `
      + `criticalStartDelta=${evidence.criticalRequestStartDelta}ms `
      + `brevoBeforeLcp=${evidence.brevoResourcesBeforeLcp.length}`,
    )

    assert.equal(evidence.browserEvidence.url, `${ORIGIN}/parent`, `${viewport.name}: wrong authenticated URL`)
    assert.ok(evidence.browserEvidence.title, `${viewport.name}: parent page title is missing`)
    assert.equal(evidence.browserEvidence.authState, "authenticated", `${viewport.name}: authenticated marker missing`)
    assert.equal(evidence.browserEvidence.loginHidden, true, `${viewport.name}: login panel remained visible`)
    assert.equal(evidence.browserEvidence.portalHidden, false, `${viewport.name}: authenticated portal stayed hidden`)
    assert.equal(evidence.browserEvidence.bodyVisibility, "visible", `${viewport.name}: body stayed hidden after boot`)
    assert.ok(evidence.browserEvidence.identity && !/đang tải|loading/iu.test(evidence.browserEvidence.identity), `${viewport.name}: identity shell did not render`)
    assert.ok(evidence.browserEvidence.lcp > 0 && evidence.browserEvidence.lcp <= 4000, `${viewport.name}: LCP ${evidence.browserEvidence.lcp}ms exceeded 4000ms`)
    assert.ok(evidence.browserEvidence.cls <= 0.01, `${viewport.name}: CLS ${evidence.browserEvidence.cls} exceeded 0.01`)
    assert.equal(evidence.childrenRequests.length, 1, `${viewport.name}: children must load once per authenticated reload`)
    assert.equal(evidence.dashboardRequests.length, 1, `${viewport.name}: dashboard must load once per authenticated reload`)
    assert.ok(evidence.criticalRequestStartDelta <= 100, `${viewport.name}: parent children/dashboard requests did not overlap (${evidence.criticalRequestStartDelta}ms)`)
    assert.ok(evidence.profileRequests.length <= 1, `${viewport.name}: child profile must not duplicate during boot`)
    assert.deepEqual(evidence.brevoResourcesBeforeLcp, [], `${viewport.name}: Brevo entered the critical path before LCP`)
    assert.deepEqual(evidence.failedRequests, [], `${viewport.name}: authenticated reload had failed requests`)
    assert.deepEqual(evidence.consoleErrors, [], `${viewport.name}: authenticated reload had console errors`)

    await page.locator("#parentMenuBtn").click()
    await page.locator("body.menu-open").waitFor({ state: "attached", timeout: 30000 })
    await page.locator("#parentMenuBtn").click()
    await page.waitForFunction(() => !document.body.classList.contains("menu-open"))
    await page.screenshot({ path: `/tmp/parent-boot-final-${viewport.name}.png`, fullPage: false })
    await context.close()
  }
})
