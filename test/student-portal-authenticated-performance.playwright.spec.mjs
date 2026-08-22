import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"
import { parse as parseDotenv } from "dotenv"
import { chromium } from "playwright"

const ENV_FILE = process.env.SIS_ENV_FILE || ".env.dev"
const ENV_VALUES = fs.existsSync(ENV_FILE)
  ? parseDotenv(fs.readFileSync(ENV_FILE))
  : {}
const ORIGIN = (process.env.STUDENT_PORTAL_PERF_ORIGIN || "http://127.0.0.1:8788").replace(/\/$/u, "")
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
  for (const candidate of CHROMIUM_EXECUTABLE_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate
  }
  return ""
}

function studentCredentials() {
  if (ENV_VALUES.STUDENT_STUDENT_USER && ENV_VALUES.STUDENT_STUDENT_PASS) {
    return { user: ENV_VALUES.STUDENT_STUDENT_USER, pass: ENV_VALUES.STUDENT_STUDENT_PASS }
  }
  let accounts = []
  try {
    accounts = JSON.parse(ENV_VALUES.STUDENT_STUDENT_PORTAL_ACCOUNTS_JSON || "[]")
  } catch (error) {
    throw new Error(`Unable to parse student portal accounts from ${ENV_FILE}: ${error.message}`)
  }
  const account = accounts.find((entry) => entry?.eaglesId && entry?.password)
  return { user: account?.eaglesId || "", pass: account?.password || "" }
}

const STUDENT = studentCredentials()
const CHROMIUM_EXECUTABLE_PATH = resolveChromiumExecutablePath()
const SKIP_REASON = !CHROMIUM_EXECUTABLE_PATH
  ? "google-chrome-stable or another Chromium executable is required"
  : !STUDENT.user || !STUDENT.pass
    ? `student credentials are required from ${ENV_FILE}`
    : false

const PERF_INIT_SCRIPT = `
  (() => {
    const state = { cls: 0, lcp: 0 };
    globalThis.__SIS_STUDENT_PERF__ = state;
    if (!globalThis.PerformanceObserver) return;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === "largest-contentful-paint") {
            state.lcp = Math.max(state.lcp, entry.startTime || 0);
          }
        }
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) state.cls += entry.value || 0;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      void 0;
    }
  })();
`

async function loginThroughVisibleUi(page) {
  await page.goto(`${ORIGIN}/student`, { waitUntil: "domcontentloaded" })
  await page.locator("#loginEaglesId").fill(STUDENT.user)
  await page.locator("#loginPassword").fill(STUDENT.pass)
  const loginResponse = page.waitForResponse(
    (response) => /\/api\/student\/auth\/login(?:\?|$)/u.test(response.url()),
    { timeout: 30000 },
  )
  await page.locator("#loginForm button[type=submit]").click()
  const response = await loginResponse
  assert.equal(response.status(), 200, "visible student login must succeed")
  await page.locator("#appPanel").waitFor({ state: "visible", timeout: 30000 })
}

async function collectReloadEvidence(page, requests, failedRequests, consoleErrors, options = {}) {
  await page.reload({ waitUntil: "domcontentloaded" })
  const domContentLoadedState = await page.evaluate(() => ({
    authState: document.documentElement.dataset.studentAuthState || "",
    bodyVisibility: getComputedStyle(document.body).visibility,
    loginHidden: document.getElementById("loginPanel")?.classList.contains("hidden") === true,
    appHidden: document.getElementById("appPanel")?.classList.contains("hidden") !== false,
  }))

  await page.waitForFunction(() => {
    const app = document.getElementById("appPanel")
    return document.documentElement.dataset.studentAuthState === "authenticated"
      && app
      && !app.classList.contains("hidden")
      && getComputedStyle(document.body).visibility !== "hidden"
  }, undefined, { timeout: options.shellTimeout || 30000 })
  await page.waitForFunction(() => {
    const identity = document.getElementById("studentIdentity")?.textContent || ""
    return Boolean(identity.trim()) && !/loading/iu.test(identity)
  }, undefined, { timeout: 30000 })
  await page.waitForTimeout(1000)

  const browserEvidence = await page.evaluate(() => {
    const resources = performance.getEntriesByType("resource").map((entry) => ({
      name: entry.name,
      startTime: entry.startTime,
      duration: entry.duration,
    }))
    const lcp = Number(globalThis.__SIS_STUDENT_PERF__?.lcp || 0)
    return {
      url: location.href,
      title: document.title,
      authState: document.documentElement.dataset.studentAuthState || "",
      loginHidden: document.getElementById("loginPanel")?.classList.contains("hidden") === true,
      appHidden: document.getElementById("appPanel")?.classList.contains("hidden") !== false,
      bodyVisibility: getComputedStyle(document.body).visibility,
      identity: document.getElementById("identityPanel")?.textContent?.replace(/\s+/gu, " ").trim() || "",
      cls: Number(globalThis.__SIS_STUDENT_PERF__?.cls || 0),
      lcp,
      resources,
    }
  })

  const dashboardRequests = requests.filter((url) => /\/api\/student\/dashboard(?:\?|$)/u.test(url))
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
    dashboardRequests,
    brevoResourcesBeforeLcp,
    failedRequests: toleratedFailures,
    consoleErrors,
  }
}

test("authenticated student boot uses one dashboard request and keeps Brevo off the LCP path", { skip: SKIP_REASON }, async (t) => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROMIUM_EXECUTABLE_PATH,
  })
  t.after(() => browser.close())

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
    })
    await context.addInitScript(PERF_INIT_SCRIPT)
    const page = await context.newPage()
    const requests = []
    const failedRequests = []
    const consoleErrors = []
    page.on("request", (request) => requests.push(request.url()))
    page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), errorText: request.failure()?.errorText || "" }))
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text())
    })

    await loginThroughVisibleUi(page)
    await page.waitForTimeout(1000)
    requests.length = 0
    failedRequests.length = 0
    consoleErrors.length = 0

    let releaseNewWordsResponse
    let newWordsResponseReleased = false
    const heldNewWordsResponse = new Promise((resolve) => {
      releaseNewWordsResponse = resolve
    })
    let finishNewWordsHandler
    const newWordsHandlerFinished = new Promise((resolve) => {
      finishNewWordsHandler = resolve
    })
    await page.route("**/api/student/new-words**", async (route) => {
      try {
        await heldNewWordsResponse
        await route.continue()
        newWordsResponseReleased = true
      } finally {
        finishNewWordsHandler()
      }
    })
    let evidence
    try {
      evidence = await collectReloadEvidence(page, requests, failedRequests, consoleErrors, { shellTimeout: 5000 })
      assert.equal(newWordsResponseReleased, false, `${viewport.name}: authenticated shell waited for New Words response`)
    } finally {
      releaseNewWordsResponse()
      await Promise.race([
        newWordsHandlerFinished,
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ])
      await page.unroute("**/api/student/new-words**")
    }
    await page.waitForTimeout(250)
    console.log(
      `[student-performance] ${viewport.name} `
      + `DCL(auth=${evidence.domContentLoadedState.authState},body=${evidence.domContentLoadedState.bodyVisibility},`
      + `loginHidden=${evidence.domContentLoadedState.loginHidden},appHidden=${evidence.domContentLoadedState.appHidden}) `
      + `LCP=${Math.round(evidence.browserEvidence.lcp)}ms `
      + `CLS=${Number(evidence.browserEvidence.cls).toFixed(4)} `
      + `dashboardRequests=${evidence.dashboardRequests.length} `
      + `brevoBeforeLcp=${evidence.brevoResourcesBeforeLcp.length}`,
    )

    assert.equal(evidence.browserEvidence.url, `${ORIGIN}/student`, `${viewport.name}: wrong authenticated URL`)
    assert.ok(evidence.browserEvidence.title, `${viewport.name}: student page title is missing`)
    assert.equal(evidence.browserEvidence.authState, "authenticated", `${viewport.name}: authenticated marker missing`)
    assert.equal(evidence.browserEvidence.loginHidden, true, `${viewport.name}: login panel remained visible`)
    assert.equal(evidence.browserEvidence.appHidden, false, `${viewport.name}: authenticated app panel stayed hidden`)
    assert.equal(evidence.browserEvidence.bodyVisibility, "visible", `${viewport.name}: body stayed hidden after boot`)
    assert.ok(evidence.browserEvidence.identity && !/loading/iu.test(evidence.browserEvidence.identity), `${viewport.name}: identity shell did not render`)
    assert.ok(evidence.browserEvidence.lcp > 0 && evidence.browserEvidence.lcp <= 4000, `${viewport.name}: LCP ${evidence.browserEvidence.lcp}ms exceeded 4000ms`)
    assert.ok(evidence.browserEvidence.cls <= 0.01, `${viewport.name}: CLS ${evidence.browserEvidence.cls} exceeded 0.01`)
    assert.equal(evidence.dashboardRequests.length, 1, `${viewport.name}: dashboard must load once per authenticated reload`)
    assert.equal(
      requests.filter((url) => /\/api\/student\/preferences(?:\?|$)/u.test(url)).length,
      1,
      `${viewport.name}: preferences must hydrate once per authenticated reload`,
    )
    assert.equal(
      requests.filter((url) => /\/api\/student\/new-words(?:\?|$)/u.test(url)).length,
      0,
      `${viewport.name}: New Words must remain unopened during authenticated boot`,
    )
    const newWordsRequestsBeforeNewsOpen = requests.filter((url) => /\/api\/student\/new-words(?:\?|$)/u.test(url)).length
    const newWordsResponse = page.waitForResponse((response) => /\/api\/student\/new-words(?:\?|$)/u.test(response.url()), { timeout: 5000 })
    await page.locator("#openNewsPageBtn").click()
    await newWordsResponse
    await page.waitForFunction(() => document.documentElement.dataset.studentActiveSurface === "news")
    assert.equal(
      requests.filter((url) => /\/api\/student\/new-words(?:\?|$)/u.test(url)).length - newWordsRequestsBeforeNewsOpen,
      1,
      `${viewport.name}: News activation must request New Words once`,
    )
    assert.deepEqual(evidence.brevoResourcesBeforeLcp, [], `${viewport.name}: Brevo entered the critical path before LCP`)
    assert.deepEqual(evidence.failedRequests, [], `${viewport.name}: authenticated reload had failed requests`)
    assert.deepEqual(evidence.consoleErrors, [], `${viewport.name}: authenticated reload had console errors`)

    await context.close()
  }
})
