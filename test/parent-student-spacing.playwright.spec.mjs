/* global getComputedStyle */
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
  } catch {
    void 0
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

async function captureStyles(page, selectors) {
  return await page.evaluate((inputSelectors) => {
    const result = {}
    for (const [key, selector] of Object.entries(inputSelectors)) {
      const el = document.querySelector(selector)
      if (!el) {
        result[key] = null
        continue
      }
      const cs = getComputedStyle(el)
      result[key] = {
        fontSize: cs.fontSize,
        minHeight: cs.minHeight,
        paddingTop: cs.paddingTop,
        paddingBottom: cs.paddingBottom,
        marginTop: cs.marginTop,
        marginBottom: cs.marginBottom,
        gap: cs.gap,
        lineHeight: cs.lineHeight,
      }
    }
    return result
  }, selectors)
}

function assertStyleMatch(label, left, right) {
  assert.deepEqual(left, right, `${label} should match student spacing exactly`)
}

function assertClose(label, left, right, tolerance = 24) {
  assert.ok(
    Math.abs(left - right) <= tolerance,
    `${label} should stay within ${tolerance}px of the student layout (student=${right}, parent=${left})`,
  )
}

test(
  "parent portal spacing mirrors student portal spacing on shared structural blocks",
  { skip: resolvePlaywrightSkipReason() },
  async () => {
    const server = createStaticServer(ROOT_DIR)
    const browser = await chromium.launch(CHROMIUM_LAUNCH_OPTIONS)
    const page = await browser.newPage({ viewport: { width: 1440, height: 1600 } })

    const selectors = {
      identityPanel: "#identityPanel",
      metricsPanel: "#metricsPanel",
      pastDueHomeworkCard: "#pastDueHomeworkCard",
      currentHomeworkCard: "#currentHomeworkCard",
      newsQueueCard: "#newsQueueCard",
      attendanceCalendarCard: "#attendanceCalendarCard",
      attendanceCalendarMetrics: "#attendanceCalendarMetrics",
      performanceReportsCard: "#performanceReportsCard",
      gradesYtdCard: "#gradesYtdCard",
      pastDueHomeworkShell: "#pastDueHomeworkCard .homework-card-shell",
      currentHomeworkShell: "#currentHomeworkCard .homework-card-shell",
    }

    const revealPortalSurface = (portalType) => {
      document.documentElement.dataset.theme = "light"
      if (portalType === "student") {
        document.documentElement.dataset.studentAuthState = "authenticated"
        document.getElementById("loginPanel")?.classList.add("hidden")
        document.getElementById("appPanel")?.classList.remove("hidden")
        document.getElementById("studentDetailPageCard")?.classList.remove("hidden")
      } else {
        document.documentElement.dataset.parentAuthState = "authenticated"
        document.getElementById("loginCard")?.classList.add("hidden")
        document.getElementById("portalCard")?.classList.remove("hidden")
        document.getElementById("portalDetailCard")?.classList.remove("hidden")
        document.getElementById("childPageCard")?.classList.add("hidden")
      }
      document.querySelectorAll(".hidden,[hidden]").forEach((element) => {
        element.classList?.remove("hidden")
        element.removeAttribute("hidden")
        if (element instanceof HTMLElement) {
          element.style.display = ""
        }
      })
    }

    const captureGeometry = async () =>
      await page.evaluate((inputSelectors) => {
        const result = {}
        for (const [key, selector] of Object.entries(inputSelectors)) {
          const el = document.querySelector(selector)
          if (!el) {
            result[key] = null
            continue
          }
          const rect = el.getBoundingClientRect()
          result[key] = {
            top: rect.top,
            height: rect.height,
            bottom: rect.bottom,
          }
        }
        return result
      }, selectors)

    try {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0

      await page.goto(`http://127.0.0.1:${port}/web-asset/student/student-portal.html`, {
        waitUntil: "networkidle",
      })
      await page.evaluate(revealPortalSurface, "student")
      await page.waitForTimeout(150)
      const studentStyles = await captureStyles(page, selectors)
      const studentGeometry = await captureGeometry()

      await page.goto(`http://127.0.0.1:${port}/web-asset/parent/parent-portal.html`, {
        waitUntil: "networkidle",
      })
      await page.evaluate(revealPortalSurface, "parent")
      await page.waitForTimeout(150)
      const parentStyles = await captureStyles(page, selectors)
      const parentGeometry = await captureGeometry()
      const parentQuickLinksSpacing = await page.evaluate(() => {
        const panel = document.querySelector("#quickLinksPanel")
        const identity = document.querySelector("#studentIdentity")
        if (!(panel instanceof HTMLElement) || !(identity instanceof HTMLElement)) return null
        const panelRect = panel.getBoundingClientRect()
        const identityRect = identity.getBoundingClientRect()
        return identityRect.top - panelRect.bottom
      })

      for (const key of Object.keys(selectors)) {
        assertStyleMatch(key, parentStyles[key], studentStyles[key])
      }

      assertClose("identityPanel.top", parentGeometry.identityPanel.top, studentGeometry.identityPanel.top)
      assert.ok(
        typeof parentQuickLinksSpacing === "number" && parentQuickLinksSpacing >= 8,
        "parent selector strip should sit above the identity strip with visible spacing",
      )
      const parentReloadMetrics = await page.evaluate(() => {
        const el = document.querySelector("#reloadBtn")
        if (!(el instanceof HTMLElement)) return null
        const cs = getComputedStyle(el)
        return {
          fontSize: cs.fontSize,
          minHeight: cs.minHeight,
          paddingTop: cs.paddingTop,
          paddingBottom: cs.paddingBottom,
        }
      })
      assert.ok(parentReloadMetrics, "parent reload button should exist")
      assert.ok(
        Number.parseFloat(parentReloadMetrics.fontSize) >= 13,
        `parent reload button font size should stay readable (got ${parentReloadMetrics.fontSize})`,
      )
      assert.ok(
        Number.parseFloat(parentReloadMetrics.minHeight) >= 40,
        `parent reload button should stay full-size (got ${parentReloadMetrics.minHeight})`,
      )
    } finally {
      await page.close().catch(() => {})
      await browser.close().catch(() => {})
      await new Promise((resolve) => server.close(resolve))
    }
  },
)
