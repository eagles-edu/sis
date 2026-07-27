import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"
import { chromium } from "playwright"

const ORIGIN = process.env.ADMIN_PERF_ORIGIN || "http://127.0.0.1:8788"
const ENV_PATH = process.env.SIS_ENV_FILE || ".env.dev"

function readEnv(filePath) {
  const values = {}
  if (!fs.existsSync(filePath)) return values
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const index = line.indexOf("=")
    if (index < 1 || line.trim().startsWith("#")) continue
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")
  }
  return values
}

const env = readEnv(ENV_PATH)
const admin = {
  user: process.env.STUDENT_ADMIN_USER || env.STUDENT_ADMIN_USER || "admin",
  pass: process.env.STUDENT_ADMIN_PASS || env.STUDENT_ADMIN_PASS,
}

const PERF_INIT_SCRIPT = `
  (() => {
    const state = { cls: 0, lcp: 0 };
    globalThis.__SIS_ADMIN_PERF_REGRESSION__ = state;
    if (!globalThis.PerformanceObserver) return;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === "layout-shift" && !entry.hadRecentInput) state.cls += entry.value || 0;
          if (entry.entryType === "largest-contentful-paint") state.lcp = Math.max(state.lcp, entry.startTime || 0);
        }
      }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.lcp = Math.max(state.lcp, entry.startTime || 0);
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {}
  })();
`

async function login(page) {
  assert.ok(admin.pass, "STUDENT_ADMIN_PASS is required for the authenticated performance regression test")
  await page.goto(`${ORIGIN}/admin`, { waitUntil: "domcontentloaded" })
  if (await page.locator("#loginUser").count()) {
    await page.locator("#loginUser").fill(admin.user)
    await page.locator("#loginPass").fill(admin.pass)
    const loginResponse = page.waitForResponse(
      (response) => /\/api\/admin\/auth\/login(?:\?|$)/u.test(response.url()),
      { timeout: 30000 },
    )
    await page.locator("#loginForm button[type=submit], #loginBtn").first().click()
    const response = await loginResponse
    assert.equal(response.status(), 200, "admin login must succeed for the performance test")
    await page.reload({ waitUntil: "domcontentloaded" })
  }
  await page.locator("#app").waitFor({ state: "visible", timeout: 30000 })
}

test("authenticated admin overview preserves desktop/mobile critical performance", async (t) => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())

  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } })
    await context.addInitScript(PERF_INIT_SCRIPT)
    const page = await context.newPage()
    await login(page)

    const requests = []
    page.on("request", (request) => requests.push(request.url()))
    await page.waitForTimeout(1500)
    requests.length = 0
    await page.reload({ waitUntil: "domcontentloaded" })
    await page.locator("#ovTotalEnrollment").waitFor({ state: "visible", timeout: 30000 })
    await page.waitForTimeout(1200)

    const metrics = await page.evaluate(() => ({
      ...globalThis.__SIS_ADMIN_PERF_REGRESSION__,
      shellStatus: document.getElementById("ovTotalEnrollment")?.textContent || "",
      activePage: document.querySelector(".page-section.active")?.dataset.page || "",
    }))
    console.log(
      `[admin-performance] ${viewport.name} ` +
      `CLS=${Number(metrics.cls || 0).toFixed(4)} ` +
      `LCP=${Math.round(metrics.lcp || 0)}ms ` +
      `dashboardRequests=${requests.filter((url) => /\/api\/admin\/dashboard(?:\?|$)/u.test(url)).length} ` +
      `fullBundleBeforeInteraction=${requests.filter((url) => /student-admin\\.min\\.js(?:\\?|$)/u.test(url)).length}`,
    )
    assert.match(metrics.shellStatus, /\d+/u, `${viewport.name}: overview shell did not become ready`)
    assert.equal(metrics.activePage, "overview", `${viewport.name}: wrong initial page`)
    assert.ok(metrics.cls <= 0.01, `${viewport.name}: CLS ${metrics.cls} exceeded 0.01`)
    assert.ok(metrics.lcp > 0 && metrics.lcp <= 4000, `${viewport.name}: LCP ${metrics.lcp}ms exceeded 4000ms`)
    assert.equal(
      requests.filter((url) => /student-admin\.min\.js(?:\?|$)/u.test(url)).length,
      0,
      `${viewport.name}: full admin bundle loaded before interaction`,
    )
    assert.equal(
      requests.filter((url) => /\/api\/admin\/dashboard(?:\?|$)/u.test(url)).length,
      1,
      `${viewport.name}: overview dashboard should load once`,
    )

    const fullAppResponse = page.waitForResponse(
      (response) => /student-admin\.min\.js(?:\?|$)/u.test(response.url()),
      { timeout: 30000 },
    )
    await page.locator("#floatingMenuBtn").click()
    await fullAppResponse
    await context.close()
  }
})
