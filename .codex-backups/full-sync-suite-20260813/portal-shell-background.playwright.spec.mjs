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

function approx(value, expected, tolerance, label) {
  assert.ok(
    Math.abs(value - expected) <= tolerance,
    `${label}: expected ${expected}±${tolerance}, got ${value}`,
  )
}

const PAGES = [
  { label: "admin", url: "/web-asset/admin/student-admin.html", shell: ".wrap" },
  { label: "student", url: "/web-asset/student/student-portal.html", shell: ".portal-shell" },
  { label: "parent", url: "/web-asset/parent/parent-portal.html", shell: ".portal-layout" },
  { label: "hub", url: "/web-asset/admin/portal-hub.html", shell: ".shell" },
]

const THEMES = ["light", "dark"]
const skipReason = resolvePlaywrightSkipReason()

test(
  "portal shells keep the body background pinned to the viewport edges",
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

      for (const theme of THEMES) {
        await page.addInitScript((rawTheme) => {
          try {
            localStorage.setItem("sis-theme", rawTheme)
          } catch {
            void 0
          }
        }, theme)

        for (const entry of PAGES) {
          await page.goto(`http://127.0.0.1:${port}${entry.url}?shell=${theme}`, {
            waitUntil: "domcontentloaded",
          })
          await page.waitForTimeout(100)

          const result = await page.evaluate((input) => {
            const bodyRect = document.body.getBoundingClientRect()
            const shellRect = document.querySelector(input.shell)?.getBoundingClientRect() || null
            return {
              viewportHeight: window.innerHeight,
              body: {
                top: Math.round(bodyRect.top),
                bottom: Math.round(bodyRect.bottom),
                height: Math.round(bodyRect.height),
              },
              shell: shellRect
                ? {
                    top: Math.round(shellRect.top),
                    bottom: Math.round(shellRect.bottom),
                    height: Math.round(shellRect.height),
                  }
                : null,
            }
          }, entry)

          const expectedBodyTop = entry.label === "admin" ? 24 : 0
          assert.equal(result.body.top, expectedBodyTop, `${theme}/${entry.label}: body should start at the expected viewport offset`)
          assert.ok(
            result.body.bottom >= result.viewportHeight,
            `${theme}/${entry.label}: body should extend to viewport bottom`,
          )
          assert.ok(result.body.height >= result.viewportHeight, `${theme}/${entry.label}: body height should cover the viewport`)
          assert.ok(result.shell, `${theme}/${entry.label}: missing shell element`)
          const expectedShellTop = entry.label === "admin" ? 48 : 24
          approx(result.shell.top, expectedShellTop, 2, `${theme}/${entry.label}: shell top offset`)
        }
      }
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
  },
)

test(
  "portal container radii stay on the shared ladder across representative admin surfaces",
  { skip: skipReason },
  async () => {
    const server = createStaticServer(ROOT_DIR)
    let browser = null

    try {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      browser = await chromium.launch(CHROMIUM_LAUNCH_OPTIONS)

      const cases = [
        {
          label: "student-points",
          url: `http://127.0.0.1:${port}/web-asset/admin/student-points.html`,
          selectors: {
            outer: ".card",
            innerA: ".chart-wrap",
            innerB: ".table-wrap",
          },
        },
        {
          label: "grades-tabulator",
          url: `http://127.0.0.1:${port}/web-asset/admin/grades-tabulator.html`,
          selectors: {
            outer: ".control-card",
            innerA: ".metric-card",
            innerB: ".grid-card",
          },
        },
      ]

      for (const viewport of [
        { width: 1440, height: 1200, label: "desktop" },
        { width: 390, height: 844, label: "mobile" },
      ]) {
        const page = await browser.newPage({ viewport })
        for (const testCase of cases) {
          await page.goto(testCase.url, { waitUntil: "domcontentloaded" })
          await page.waitForTimeout(100)
          const metrics = await page.evaluate((input) => {
            const read = (selector) => {
              const node = document.querySelector(selector)
              if (!(node instanceof HTMLElement)) return null
              const style = getComputedStyle(node)
              const rect = node.getBoundingClientRect()
              return {
                radius: parseFloat(style.borderTopLeftRadius || "0"),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              }
            }
            return {
              viewportWidth: window.innerWidth,
              scrollWidth: document.documentElement.scrollWidth,
              outer: read(input.selectors.outer),
              innerA: read(input.selectors.innerA),
              innerB: read(input.selectors.innerB),
            }
          }, testCase)

          assert.equal(metrics.viewportWidth, viewport.width, `${viewport.label}/${testCase.label}: viewport width mismatch`)
          assert.ok(
            metrics.scrollWidth <= viewport.width + 2,
            `${viewport.label}/${testCase.label}: should not horizontally overflow`,
          )
          assert.ok(metrics.outer, `${viewport.label}/${testCase.label}: missing outer container`)
          assert.ok(metrics.innerA, `${viewport.label}/${testCase.label}: missing inner A container`)
          assert.ok(metrics.innerB, `${viewport.label}/${testCase.label}: missing inner B container`)
          assert.ok(
            metrics.outer.radius >= metrics.innerA.radius,
            `${viewport.label}/${testCase.label}: outer radius should be at least as large as inner A`,
          )
          assert.ok(
            metrics.outer.radius >= metrics.innerB.radius,
            `${viewport.label}/${testCase.label}: outer radius should be at least as large as inner B`,
          )
          assert.notEqual(
            Math.round(metrics.outer.radius),
            14,
            `${viewport.label}/${testCase.label}: outer radius should not stay on the old literal`,
          )
        }
        await page.close()
      }
    } finally {
      if (browser) {
        await browser.close().catch(() => {})
      }
      if (server.listening) {
        await new Promise((resolve) => server.close(resolve))
      }
    }
  },
)

