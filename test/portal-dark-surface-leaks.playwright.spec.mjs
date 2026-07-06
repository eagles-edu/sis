import assert from "node:assert/strict"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import test from "node:test"

const ROOT_DIR = process.cwd()
const AXE_PATH = path.resolve(ROOT_DIR, "node_modules/axe-core/axe.min.js")

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

function startStaticServer(port) {
  return http.createServer((request, response) => {
    const urlPath = decodeURIComponent((request.url || "/").split("?")[0])
    const filePath = path.join(ROOT_DIR, urlPath === "/" ? "web-asset/admin/portal-hub.html" : urlPath.slice(1))
    if (!filePath.startsWith(ROOT_DIR)) {
      response.writeHead(403)
      response.end("forbidden")
      return
    }
    fs.readFile(filePath, (error, data) => {
      if (error) {
        response.writeHead(404)
        response.end("not found")
        return
      }
      const ext = path.extname(filePath)
      const type =
        ext === ".html" ? "text/html" :
        ext === ".css" ? "text/css" :
        ext === ".js" ? "application/javascript" :
        ext === ".svg" ? "image/svg+xml" :
        "application/octet-stream"
      response.setHeader("Content-Type", type)
      response.end(data)
    })
  }).listen(port)
}

function themeInitScript() {
  return `
    (() => {
      try {
        localStorage.setItem("sis-theme", "dark");
      } catch {
        void 0;
      }
    })();
  `
}

function luminance([r, g, b]) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function parseRgb(value) {
  const match = String(value).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function parseModernColor(value) {
  const match = String(value).match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
  if (!match) return null
  return [
    Math.round(Number(match[1]) * 255),
    Math.round(Number(match[2]) * 255),
    Math.round(Number(match[3]) * 255),
  ]
}

async function readStyle(page, selector) {
  return await page.evaluate((inputSelector) => {
    const el = document.querySelector(inputSelector)
    if (!el) return null
    const cs = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    return {
      selector: inputSelector,
      backgroundColor: cs.backgroundColor,
      backgroundImage: cs.backgroundImage,
      color: cs.color,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
    }
  }, selector)
}

async function readPseudoStyle(page, selector, pseudoElement) {
  return await page.evaluate(({ inputSelector, pseudo }) => {
    const el = document.querySelector(inputSelector)
    if (!el) return null
    const cs = getComputedStyle(el, pseudo)
    return {
      selector: inputSelector,
      pseudo,
      backgroundColor: cs.backgroundColor,
      borderColor: cs.borderColor,
      color: cs.color,
    }
  }, { inputSelector: selector, pseudo: pseudoElement })
}

async function normalizeColor(page, value) {
  return await page.evaluate((inputColor) => {
    const probe = document.createElement("span")
    probe.style.color = inputColor
    document.body.appendChild(probe)
    const computed = getComputedStyle(probe).color
    probe.remove()
    return computed
  }, value)
}

function assertNotLight(label, style) {
  assert.ok(style, `${label} should exist`)
  const bg = parseRgb(style.backgroundColor)
  assert.ok(bg, `${label} should expose a computed background color`)
  assert.ok(
    luminance(bg) < 205,
    `${label} background is still too light: ${style.backgroundColor}`,
  )
}

function assertLightChrome(label, style) {
  assert.ok(style, `${label} should exist`)
  const bg = parseRgb(style.backgroundColor)
  assert.ok(bg, `${label} should expose a computed background color`)
  assert.ok(
    luminance(bg) >= 220,
    `${label} should stay in the light chrome palette: ${style.backgroundColor}`,
  )
}

function assertImmutableChromeOrAmber(label, style) {
  assert.ok(style, `${label} should exist`)
  if (style.backgroundColor === "rgb(243, 191, 82)") {
    return
  }
  const bg = parseRgb(style.backgroundColor)
  assert.ok(bg, `${label} should expose a computed background color`)
  assert.ok(
    luminance(bg) >= 220,
    `${label} should stay in the immutable chrome palette or approved amber accent: ${style.backgroundColor}`,
  )
}

function assertDarkSurface(label, style) {
  assert.ok(style, `${label} should exist`)
  const bg = parseRgb(style.backgroundColor)
  if (bg) {
    assert.ok(
      luminance(bg) < 205,
      `${label} background is still too light: ${style.backgroundColor}`,
    )
    return
  }
  assert.ok(
    style.backgroundImage && style.backgroundImage !== "none",
    `${label} should expose a dark gradient or solid surface`,
  )
}

function assertMutedText(label, style) {
  assert.ok(style, `${label} should exist`)
  const fg = parseRgb(style.color)
  assert.ok(fg, `${label} should expose a computed text color`)
  assert.ok(
    luminance(fg) >= 120 && luminance(fg) <= 235,
    `${label} text should stay muted in dark mode: ${style.color}`,
  )
}

test("dark theme surfaces do not retain light-mode backgrounds", { skip: resolvePlaywrightSkipReason() }, async () => {
  const server = startStaticServer(8092)
  const browser = await chromium.launch(CHROMIUM_LAUNCH_OPTIONS)
  const page = await browser.newPage({ viewport: { width: 1440, height: 1600 } })
  await page.addInitScript(themeInitScript())

  const cases = [
    {
      url: "/web-asset/admin/student-admin.html",
      checks: [
        ["admin auth wrap", ".wrap"],
        ["admin auth panel", "#authPanel"],
      ],
    },
    {
      url: "/web-asset/student/student-portal.html",
      checks: [
        ["student login panel", "#loginPanel"],
        ["student env badge", "#envBadge"],
        ["student logo wrap", ".brand-logo-wrap.brand-logo-wrap--sm"],
      ],
    },
    {
      url: "/web-asset/parent/parent-portal.html",
      checks: [
        ["parent login card", "#loginCard"],
        ["parent env badge", "#envBadgeParent"],
        ["parent draft actions", ".draft-actions"],
        ["parent logo wrap", ".brand-logo-wrap.brand-logo-wrap--sm"],
      ],
    },
    {
      url: "/web-asset/admin/portal-hub.html",
      checks: [
        ["hub page body", "body.portal-hub-page"],
        ["hub wash layer", ".portal-hub-bg__wash"],
        ["hub logo wrap", ".brand-logo-wrap.brand-logo-wrap--lg"],
        ["hub prefooter", ".hub-prefooter"],
      ],
    },
    {
      url: "/web-asset/admin/student-points.html",
      checks: [
        ["student points body", "body"],
      ],
    },
  ]

  try {
    for (const testCase of cases) {
      await page.goto(`http://127.0.0.1:8092${testCase.url}`, { waitUntil: "networkidle" })
      await page.waitForTimeout(400)
      for (const [label, selector] of testCase.checks) {
        const style = await readStyle(page, selector)
        if (label === "admin auth wrap") {
          assert.ok(style, `${label} should exist`)
          assert.equal(
            style.backgroundColor,
            "rgba(0, 0, 0, 0)",
            `${label} should stay transparent so the login page background remains continuous`,
          )
          assert.equal(style.backgroundImage, "none", `${label} should not carry a separate fill layer`)
          continue
        }
        if (label === "admin auth panel") {
          assertDarkSurface(label, style)
          continue
        }
        if (label === "hub wash layer") {
          assert.ok(style, `${label} should exist`)
          assert.ok(
            !/rgb\(217,\s*237,\s*255\)|rgb\(223,\s*248,\s*234\)|#d9edff|#dff8ea/i.test(style.backgroundImage || ""),
            `${label} should not retain the light wash token: ${style.backgroundImage}`,
          )
          assert.ok(
            /rgba\(181,\s*0,\s*16,\s*0\.14\)|rgba\(109,\s*135,\s*191,\s*0\.18\)|rgba\(255,\s*255,\s*255,\s*0\.08\)|rgba\(16,\s*18,\s*22,\s*0\.24\)/i.test(style.backgroundImage || ""),
            `${label} should use the dark hub wash token: ${style.backgroundImage}`,
          )
          continue
        }
        assertNotLight(label, style)
      }
    }
  } finally {
    await page.close()
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("grades tabulator immutable buttons and chips keep shared chrome in dark mode", { skip: resolvePlaywrightSkipReason() }, async () => {
  const server = startStaticServer(8094)
  const browser = await chromium.launch(CHROMIUM_LAUNCH_OPTIONS)
  const page = await browser.newPage({ viewport: { width: 1440, height: 1600 } })
  await page.addInitScript(themeInitScript())

  const cases = [
    {
      url: "/web-asset/admin/grades-tabulator.html",
      checks: [
        ["grades period button", ".period-btn"],
        ["grades subtle button", ".grid-actions .btn.subtle"],
      ],
    },
    {
      url: "/web-asset/admin/student-admin.html",
      checks: [
        // The rubric legend control is intentionally amber in student-admin.css.
        ["admin legend button", ".pt-score-legend-btn", "rgb(243, 191, 82)"],
      ],
    },
  ]

  try {
    for (const testCase of cases) {
      await page.goto(`http://127.0.0.1:8094${testCase.url}`, { waitUntil: "networkidle" })
      await page.waitForTimeout(400)
      for (const check of testCase.checks) {
        const [label, selector, expectedBackground] = check
        const style = await readStyle(page, selector)
        if (testCase.url === "/web-asset/admin/grades-tabulator.html") {
          if (selector === ".grid-actions .btn.subtle") {
            assertImmutableChromeOrAmber(label, style)
          } else {
            assertLightChrome(label, style)
          }
        } else {
          assert.ok(style, `${label} should exist`)
          assert.equal(
            style.backgroundColor,
            expectedBackground,
            `${label} should stay on the intended amber accent token`,
          )
        }
      }
    }
  } finally {
    await page.close()
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("dark theme form fields stay legible in login shells and modals", { skip: resolvePlaywrightSkipReason() }, async () => {
  const server = startStaticServer(8095)
  const browser = await chromium.launch(CHROMIUM_LAUNCH_OPTIONS)
  const page = await browser.newPage({ viewport: { width: 1440, height: 1600 } })
  await page.addInitScript(themeInitScript())

  const cases = [
    {
      url: "/web-asset/student/student-portal.html",
      focusSelector: "#loginEaglesId",
      placeholderSelector: "#loginEaglesId",
    },
    {
      url: "/web-asset/parent/parent-portal.html",
      focusSelector: "#parentsId",
      placeholderSelector: "#parentsId",
    },
    {
      url: "/web-asset/parent/parent-portal.html",
      modalSelector: "#newsWeekSetModal",
      modalFocusSelector: "#newsViewerSourceLink",
    },
    {
      url: "/web-asset/parent/parent-portal.html",
      modalSelector: "#newsWeekSetModal",
      modalFocusSelector: "#newsViewerLeadSynopsis",
    },
    {
      url: "/web-asset/admin/student-admin.html",
      focusSelector: "#loginUser",
    },
  ]

  try {
    for (const testCase of cases) {
      await page.goto(`http://127.0.0.1:8095${testCase.url}`, { waitUntil: "networkidle" })
      await page.waitForTimeout(400)

      if (testCase.revealSelector) {
        await page.evaluate((selector) => {
          const el = document.querySelector(selector)
          if (el) el.classList.remove("hidden")
        }, testCase.revealSelector)
      }

      if (testCase.modalSelector) {
        await page.evaluate((selector) => {
          const modal = document.querySelector(selector)
          if (modal) modal.classList.remove("hidden")
        }, testCase.modalSelector)
        await page.waitForTimeout(50)
      }

      const focusSelector = testCase.modalFocusSelector || testCase.focusSelector
      const baseStyle = await readStyle(page, focusSelector)
      assert.ok(baseStyle, `${testCase.url} ${focusSelector} should exist`)
      const baseBg = parseRgb(baseStyle.backgroundColor) || parseModernColor(baseStyle.backgroundColor)
      assert.ok(baseBg, `${testCase.url} ${focusSelector} should expose a computed base background color`)

      await page.locator(focusSelector).click()
      await page.waitForTimeout(50)
      const isFocused = await page.evaluate((selector) => document.activeElement?.matches(selector), focusSelector)
      assert.ok(isFocused, `${testCase.url} ${focusSelector} should receive focus`)
      const focusedStyle = await readStyle(page, focusSelector)
      assert.ok(focusedStyle, `${testCase.url} ${focusSelector} should exist`)
      const focusedBg = parseRgb(focusedStyle.backgroundColor) || parseModernColor(focusedStyle.backgroundColor)
      assert.ok(focusedBg, `${testCase.url} ${focusSelector} should expose a computed background color`)
      assert.ok(
        luminance(focusedBg) < 205,
        `${testCase.url} ${focusSelector} should stay out of the white field palette: ${focusedStyle.backgroundColor}`,
      )

      const placeholderSelector = testCase.modalPlaceholderSelector || testCase.placeholderSelector
      if (placeholderSelector) {
        const placeholderStyle = await readPseudoStyle(page, placeholderSelector, "::placeholder")
        assert.ok(placeholderStyle, `${testCase.url} ${placeholderSelector} should expose placeholder styles`)
        const placeholderColor = await normalizeColor(page, placeholderStyle.color)
        const placeholderFg = parseRgb(placeholderColor) || parseModernColor(placeholderColor)
        assert.ok(placeholderFg, `${testCase.url} ${placeholderSelector} should expose a placeholder color`)
        assert.ok(
          luminance(placeholderFg) >= 80 && luminance(placeholderFg) <= 140,
          `${testCase.url} ${placeholderSelector} placeholder should stay muted in dark mode: ${placeholderStyle.color}`,
        )
      }
    }
  } finally {
    await page.close()
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("standalone admin pages use the shared portal theme in dark mode", { skip: resolvePlaywrightSkipReason() }, async () => {
  const server = startStaticServer(8096)
  const browser = await chromium.launch(CHROMIUM_LAUNCH_OPTIONS)
  const page = await browser.newPage({ viewport: { width: 1440, height: 1600 } })
  await page.addInitScript(themeInitScript())

  const cases = [
    {
      url: "/web-asset/admin/student-points.html",
      surfaces: ["section.card", "#loginPanel", ".chart-wrap", ".table-wrap"],
      text: ["#globalStatus", ".status"],
    },
    {
      url: "/web-asset/admin/grades-tabulator.html",
      surfaces: [".control-card", ".grid-card", ".metric-card", ".distribution-dialog", ".distribution-chart-shell"],
      text: [],
    },
  ]

  try {
    for (const testCase of cases) {
      await page.goto(`http://127.0.0.1:8096${testCase.url}`, { waitUntil: "networkidle" })
      await page.waitForTimeout(400)
      for (const selector of testCase.surfaces) {
        const style = await readStyle(page, selector)
        assertDarkSurface(`${testCase.url} ${selector}`, style)
      }
      for (const selector of testCase.text) {
        const style = await readStyle(page, selector)
        assertMutedText(`${testCase.url} ${selector}`, style)
      }
    }
  } finally {
    await page.close()
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
})
