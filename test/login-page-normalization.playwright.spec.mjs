import assert from "node:assert/strict"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import test from "node:test"

const ROOT_DIR = process.cwd()

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

function createStaticServer(rootDir) {
  return http.createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1")
    const pathname = decodeURIComponent(requestUrl.pathname)
    const relativePath = pathname === "/" ? "/index.html" : pathname
    const targetPath = path.resolve(rootDir, `.${relativePath}`)
    if (!targetPath.startsWith(rootDir)) {
      response.writeHead(403, { "content-type": "text/plain; charset=utf-8" })
      response.end("Forbidden")
      return
    }
    fs.readFile(targetPath, (error, buffer) => {
      if (error) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
        response.end("Not found")
        return
      }
      const ext = path.extname(targetPath).toLowerCase()
      const contentType =
        ext === ".html"
          ? "text/html; charset=utf-8"
          : ext === ".css"
            ? "text/css; charset=utf-8"
            : ext === ".js"
              ? "application/javascript; charset=utf-8"
              : ext === ".svg"
                ? "image/svg+xml"
                : ext === ".png"
                  ? "image/png"
                  : ext === ".ico"
                    ? "image/x-icon"
                    : "application/octet-stream"
      response.writeHead(200, { "content-type": contentType })
      response.end(buffer)
    })
  })
}

async function readRects(page, selectors) {
  return await page.evaluate((input) => {
    const readRect = (selector) => {
      const node = globalThis.document.querySelector(selector)
      if (!node) return null
      const rect = node.getBoundingClientRect()
      const style = globalThis.window.getComputedStyle(node)
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        display: style.display,
      }
    }
    const out = {}
    for (const [key, selector] of Object.entries(input)) {
      out[key] = readRect(selector)
    }
    return out
  }, selectors)
}

function rectExists(rect, label) {
  assert.ok(rect, `${label}: missing element`)
  assert.notEqual(rect.display, "none", `${label}: should be visible`)
}

function parseRgb(value) {
  const match = String(value).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function luminance([r, g, b]) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

const skipReason = resolvePlaywrightSkipReason()

test(
  "login pages use a compact centered login shell with support links",
  { skip: skipReason },
  async () => {
    const server = createStaticServer(ROOT_DIR)
    let browser = null
    let page = null

    try {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0

      browser = await chromium.launch(CHROMIUM_LAUNCH_OPTIONS)
      page = await browser.newPage({ viewport: { width: 1440, height: 1200 } })

      const studentUrl = `http://127.0.0.1:${port}/web-asset/student/student-portal.html`
      await page.goto(studentUrl, { waitUntil: "domcontentloaded" })
      await page.evaluate(() => {
        document.documentElement.dataset.studentAuthState = "unauthenticated"
      })
      await page.waitForTimeout(120)
      let rects = await readRects(page, {
        topbar: ".topbar",
        statusStrip: ".status-strip",
        loginPanel: "#loginPanel",
      })
      assert.equal(rects.topbar?.display, "none", "student login: topbar should be hidden")
      assert.equal(rects.statusStrip?.display, "none", "student login: status strip should be hidden")
      rectExists(rects.loginPanel, "student login panel")
      assert.ok(rects.loginPanel.y >= 40 && rects.loginPanel.y <= 180, "student login: top margin should be compact")
      assert.ok(rects.loginPanel.w <= 560, "student login: login panel should stay centered and narrow")
      assert.ok(
        (await page.locator("#loginPanel h2").evaluate((node) => parseFloat(getComputedStyle(node).fontSize))) >= 22,
        "student login: title should be larger for readability",
      )
      assert.ok(
        (await page.locator("#loginPanel label").first().evaluate((node) => parseFloat(getComputedStyle(node).fontSize))) >= 15,
        "student login: labels should be easier to read",
      )
      assert.ok(
        (await page.locator("#loginPanel .login-link").first().evaluate((node) => parseFloat(getComputedStyle(node).fontSize))) >= 16,
        "student login: support links should be larger",
      )
      assert.match(
        await page.locator("#loginPanel .login-link").first().getAttribute("href"),
        /^mailto:support@eagles\.edu\.vn\?subject=Student%20portal%20password%20reset$/
      )
      assert.equal(await page.locator("#loginPanel .login-link").nth(1).getAttribute("href"), "tel:0937667818")
      assert.equal(await page.locator("#loginPanel .login-link").count(), 2)

      const parentUrl = `http://127.0.0.1:${port}/web-asset/parent/parent-portal.html`
      await page.goto(parentUrl, { waitUntil: "domcontentloaded" })
      await page.evaluate(() => {
        document.documentElement.dataset.parentAuthState = "unauthenticated"
      })
      await page.waitForTimeout(120)
      rects = await readRects(page, {
        hero: ".hero",
        sideNav: ".side-nav",
        navScrim: ".nav-scrim",
        loginCard: "#loginCard",
      })
      assert.equal(rects.hero?.display, "none", "parent login: hero should be hidden")
      assert.equal(rects.sideNav?.display, "none", "parent login: side nav should be hidden")
      assert.equal(rects.navScrim?.display, "none", "parent login: nav scrim should be hidden")
      rectExists(rects.loginCard, "parent login card")
      assert.ok(rects.loginCard.y >= 40 && rects.loginCard.y <= 180, "parent login: top margin should be compact")
      assert.ok(rects.loginCard.w <= 560, "parent login: login card should stay centered and narrow")
      assert.ok(
        (await page.locator("#loginCard h2").evaluate((node) => parseFloat(getComputedStyle(node).fontSize))) >= 22,
        "parent login: title should be larger for readability",
      )
      assert.ok(
        (await page.locator("#loginCard label").first().evaluate((node) => parseFloat(getComputedStyle(node).fontSize))) >= 15,
        "parent login: labels should be easier to read",
      )
      assert.ok(
        (await page.locator("#loginCard .login-link").first().evaluate((node) => parseFloat(getComputedStyle(node).fontSize))) >= 16,
        "parent login: support links should be larger",
      )
      assert.match(
        await page.locator("#loginCard .login-link").first().getAttribute("href"),
        /^mailto:support@eagles\.edu\.vn\?subject=Parent%20portal%20password%20reset$/
      )
      assert.equal(await page.locator("#loginCard .login-link").nth(1).getAttribute("href"), "tel:0937667818")
      assert.equal(await page.locator("#loginCard .login-link").count(), 2)

      await page.goto(`http://127.0.0.1:${port}/web-asset/admin/student-admin.html`, {
        waitUntil: "domcontentloaded",
      })
      await page.waitForTimeout(120)
      rects = await readRects(page, {
        authPanel: "#authPanel",
      })
      rectExists(rects.authPanel, "admin auth panel")
      assert.ok(rects.authPanel.y >= 40 && rects.authPanel.y <= 220, "admin login: top margin should be compact")
      assert.ok(rects.authPanel.w <= 700, "admin login: auth panel should stay centered and narrow")
      assert.ok(
        (await page.locator("#authPanel h1").evaluate((node) => parseFloat(getComputedStyle(node).fontSize))) >= 24,
        "admin login: title should be larger for readability",
      )
      assert.ok(
        (await page.locator("#authPanel label").first().evaluate((node) => parseFloat(getComputedStyle(node).fontSize))) >= 15,
        "admin login: labels should be easier to read",
      )
      assert.ok(
        (await page.locator("#authPanel .login-link").first().evaluate((node) => parseFloat(getComputedStyle(node).fontSize))) >= 16,
        "admin login: support links should be larger",
      )
      assert.match(
        await page.locator("#authPanel .login-link").first().getAttribute("href"),
        /^mailto:support@eagles\.edu\.vn\?subject=Admin%20password%20reset$/
      )
      assert.equal(await page.locator("#authPanel .login-link").nth(1).getAttribute("href"), "tel:0937667818")
      assert.equal(await page.locator("#authPanel .login-link").count(), 2)
      assert.ok(
        (await page.locator("#authPanel input").first().evaluate((node) => getComputedStyle(node).minHeight)) >= "48px",
        "admin login: inputs should be beefier"
      )

      await page.evaluate(() => {
        localStorage.setItem("sis-theme", "dark")
      })
      await page.reload({ waitUntil: "domcontentloaded" })
      await page.waitForTimeout(120)
      const darkAuthSurface = await page.evaluate(() => {
        const bodyStyle = getComputedStyle(document.body)
        const wrapStyle = getComputedStyle(document.querySelector(".wrap"))
        const authPanel = document.getElementById("authPanel")
        const authStyle = authPanel ? getComputedStyle(authPanel) : null
        return {
          bodyBackgroundImage: bodyStyle.backgroundImage,
          wrapBackgroundColor: wrapStyle.backgroundColor,
          wrapBackgroundImage: wrapStyle.backgroundImage,
          authBackgroundColor: authStyle ? authStyle.backgroundColor : "",
          authBackgroundImage: authStyle ? authStyle.backgroundImage : "",
        }
      })
      assert.notEqual(darkAuthSurface.bodyBackgroundImage, "none", "admin dark login should keep the page gradient")
      assert.equal(
        darkAuthSurface.wrapBackgroundColor,
        "rgba(0, 0, 0, 0)",
        "admin dark login wrap should stay transparent so the page backdrop does not split",
      )
      assert.equal(
        darkAuthSurface.wrapBackgroundImage,
        "none",
        "admin dark login wrap should not paint its own fill layer",
      )
      assert.notEqual(
        darkAuthSurface.authBackgroundImage,
        "none",
        "admin dark login card should keep its own confined surface"
      )
      assert.equal(
        darkAuthSurface.authBackgroundColor,
        "rgba(0, 0, 0, 0)",
        "admin dark login card should render as a gradient surface rather than a flat fill"
      )
      const darkLinkColor = await page.locator("#authPanel .login-link").first().evaluate((node) => getComputedStyle(node).color)
      const darkLinkRgb = parseRgb(darkLinkColor)
      assert.ok(darkLinkRgb && luminance(darkLinkRgb) >= 175, `admin dark login links should be brighter: ${darkLinkColor}`)

      await page.goto(`http://127.0.0.1:${port}/web-asset/admin/student-points.html`, {
        waitUntil: "domcontentloaded",
      })
      await page.evaluate(() => {
        document.getElementById("loginPanel")?.classList.remove("hidden")
        document.getElementById("appPanel")?.classList.add("hidden")
      })
      await page.waitForTimeout(120)
      rects = await readRects(page, {
        loginPanel: "#loginPanel",
      })
      rectExists(rects.loginPanel, "student points login panel")
      assert.ok(rects.loginPanel.y >= 40 && rects.loginPanel.y <= 220, "student points: top margin should be compact")
      assert.ok(rects.loginPanel.w <= 700, "student points: login panel should stay centered and narrow")
      assert.notEqual(
        await page.evaluate(() => getComputedStyle(document.body).backgroundImage),
        "none",
        "student points: login background should keep a single gradient layer"
      )
      assert.equal(
        await page.evaluate(() => getComputedStyle(document.body, "::before").backgroundImage),
        "none",
        "student points: login background should not use the extra wash layer"
      )
      assert.match(
        await page.locator("#loginPanel .login-link").first().getAttribute("href"),
        /^mailto:support@eagles\.edu\.vn\?subject=Student%20points%20password%20reset$/
      )
      assert.equal(await page.locator("#loginPanel .login-link").nth(1).getAttribute("href"), "tel:0937667818")
      assert.equal(await page.locator("#loginPanel .login-link").count(), 2)
    } finally {
      if (page) {
        await page.close().catch(() => {})
      }
      if (browser) {
        await browser.close().catch(() => {})
      }
      if (server.listening) {
        await new Promise((resolve) => server.close(resolve))
      }
    }
  }
)
