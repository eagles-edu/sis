import assert from "node:assert/strict"
import fs from "node:fs"
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

process.env.NODE_ENV = process.env.NODE_ENV || "development"
process.env.SIS_ENV_FILE = process.env.SIS_ENV_FILE || ".env.dev"
process.env.EXERCISE_MAILER_ORIGIN = process.env.EXERCISE_MAILER_ORIGIN || "*"
process.env.MAILER_DEBUG = process.env.MAILER_DEBUG || "false"
process.env.STUDENT_ADMIN_USER = process.env.STUDENT_ADMIN_USER || "admin"
process.env.STUDENT_ADMIN_PASS = process.env.STUDENT_ADMIN_PASS || "3825u2z"
process.env.STUDENT_STUDENT_USER = process.env.STUDENT_STUDENT_USER || "kramer001"
process.env.STUDENT_STUDENT_PASS = process.env.STUDENT_STUDENT_PASS || "P1k@ch00"
process.env.STUDENT_PARENT_USER = process.env.STUDENT_PARENT_USER || "cmkramer001"
process.env.STUDENT_PARENT_PASS = process.env.STUDENT_PARENT_PASS || "P1k@ch00"

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

function toUrlText(resource) {
  if (typeof resource === "string") return resource
  if (resource && typeof resource.url === "string") return resource.url
  return String(resource)
}

function jsonTextResponse(status, payload = {}) {
  const statusTextByCode = {
    200: "OK",
    401: "Unauthorized",
    404: "Not Found",
  }
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: statusTextByCode[status] || "",
    async text() {
      return JSON.stringify(payload)
    },
  }
}

async function loginParent(page, origin, credentials) {
  const response = await fetch(`${origin}/api/parent/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(credentials),
  })
  assert.ok(response.ok, `parent login failed with ${response.status}`)
  const setCookie = response.headers.get("set-cookie") || ""
  const match = setCookie.match(/^parent_portal_sid=([^;]+)/i)
  assert.ok(match, "parent login did not return a session cookie")
  await page.context().addCookies([
    { name: "parent_portal_sid", value: match[1], url: origin },
  ])
  const url = new URL("/parent", origin)
  url.searchParams.set("apiOrigin", origin)
  await page.goto(url.toString(), { waitUntil: "domcontentloaded" })
  await page.waitForFunction(() => Boolean(globalThis.document.getElementById("portalCard")))
}

async function grantParentSession(page, origin, credentials) {
  const response = await fetch(`${origin}/api/parent/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(credentials),
  })
  assert.ok(response.ok, `parent login failed with ${response.status}`)
  const setCookie = response.headers.get("set-cookie") || ""
  const match = setCookie.match(/^parent_portal_sid=([^;]+)/i)
  assert.ok(match, "parent login did not return a session cookie")
  await page.context().addCookies([
    { name: "parent_portal_sid", value: match[1], url: origin },
  ])
}

async function loginStudent(page, origin, credentials) {
  const response = await fetch(`${origin}/api/student/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(credentials),
  })
  assert.ok(response.ok, `student login failed with ${response.status}`)
  const setCookie = response.headers.get("set-cookie") || ""
  const match = setCookie.match(/^student_portal_sid=([^;]+)/i)
  assert.ok(match, "student login did not return a session cookie")
  await page.context().addCookies([
    { name: "student_portal_sid", value: match[1], url: origin },
  ])
  const url = new URL("/student", origin)
  url.searchParams.set("apiOrigin", origin)
  await page.goto(url.toString(), { waitUntil: "domcontentloaded" })
  await page.waitForFunction(() => Boolean(globalThis.document.getElementById("appPanel")))
}

async function grantStudentSession(page, origin, credentials) {
  const response = await fetch(`${origin}/api/student/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(credentials),
  })
  assert.ok(response.ok, `student login failed with ${response.status}`)
  const setCookie = response.headers.get("set-cookie") || ""
  const match = setCookie.match(/^student_portal_sid=([^;]+)/i)
  assert.ok(match, "student login did not return a session cookie")
  await page.context().addCookies([
    { name: "student_portal_sid", value: match[1], url: origin },
  ])
}

async function startServer() {
  const { startExerciseMailer } = await import("../server/exercise-mailer.mjs")
  const server = await startExerciseMailer({ transporter: makeMockTransport(), port: 0 })
  await new Promise((resolve) => server.once("listening", resolve))
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0
  return { server, origin: `http://127.0.0.1:${port}` }
}

function buildMangledReportHref(reportHref, replacementSlug = "mismatch") {
  const url = new URL(reportHref)
  const segments = url.pathname.split("/")
  const lastSegment = segments.pop() || ""
  const lastHyphen = lastSegment.lastIndexOf("-")
  assert.ok(lastHyphen > 0, "report href should include a slug and trailing report id")
  const reportId = lastSegment.slice(lastHyphen + 1)
  const replacementSegment = `${replacementSlug}-${reportId}`
  segments.push(replacementSegment)
  url.pathname = segments.join("/")
  return url.toString()
}

function extractTrailingReportId(reportHref) {
  const url = new URL(reportHref)
  const lastSegment = url.pathname.split("/").pop() || ""
  const lastHyphen = lastSegment.lastIndexOf("-")
  assert.ok(lastHyphen > 0, "report href should include a slug and trailing report id")
  return lastSegment.slice(lastHyphen + 1)
}

async function openReportArchivePage(page, role, reportHref) {
  await page.goto(reportHref, { waitUntil: "domcontentloaded" })
  await page.waitForURL((url) => url.pathname.startsWith(role === "parent" ? "/parent/reports/" : "/student/reports/"), { timeout: 30000 })
  await page.waitForFunction((currentRole) => {
    const body = globalThis.document.body
    return Boolean(body && body.classList.contains(`${currentRole}-portal-page`))
  }, role)
}

async function collectReportArchiveHref(page, role) {
  const href = await page.evaluate(async (currentRole) => {
    const endpoint = currentRole === "parent" ? "/api/parent/dashboard" : "/api/student/dashboard"
    const response = await fetch(endpoint, {
      credentials: "include",
      headers: { accept: "application/json" },
    })
    const dashboard = await response.json()
    const dashboardChild =
      (Array.isArray(dashboard?.children) && dashboard.children[0])
      || dashboard?.child
      || dashboard?.children?.child
      || null
    const reportArchive =
      dashboardChild?.details?.reportArchive
      || dashboard?.details?.reportArchive
      || []
    const report = Array.isArray(reportArchive) ? reportArchive[0] : null
    const reportId = String(report?.id || "").trim()
    if (!reportId) return ""
    const slug = [
      report?.fullName,
      report?.englishName,
      report?.studentName,
      report?.className,
      report?.schoolYear,
      report?.quarter,
    ]
      .map((entry) => String(entry || "").trim().toLowerCase())
      .filter(Boolean)
      .join(" ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "report"
    const prefix = currentRole === "parent" ? "/parent/reports" : "/student/reports"
    return `${prefix}/${encodeURIComponent(`${slug}-${reportId}`)}`
  }, role)
  assert.ok(href, `${role} portal should provide a slugged report href`)
  return new URL(href, page.url()).toString()
}

async function openPerformanceReports(page, role) {
  const navTarget = 'a[data-page-target="performance-reports"]'
  await page.locator(navTarget).first().evaluate((node) => node.click())
  await page.waitForTimeout(250)
  const dashboard = await page.evaluate(async (currentRole) => {
    const endpoint = currentRole === "parent" ? "/api/parent/dashboard" : "/api/student/dashboard"
    const response = await fetch(endpoint, {
      credentials: "include",
      headers: { accept: "application/json" },
    })
    return await response.json()
  }, role)
  const dashboardChild =
    (Array.isArray(dashboard?.children) && dashboard.children[0])
    || dashboard?.child
    || dashboard?.children?.child
    || null
  const reportArchive =
    dashboardChild?.details?.reportArchive
    || dashboard?.details?.reportArchive
    || []
  assert.ok(Array.isArray(reportArchive) && reportArchive.length > 0, `${role} portal should expose a report archive`)
  return reportArchive
}

async function collectParentReportArchiveHrefs(page) {
  await page.locator('a[data-page-target="performance-reports"]').first().evaluate((node) => node.click())
  await page.waitForTimeout(250)
  const dashboard = await page.evaluate(async () => {
    const response = await fetch("/api/parent/dashboard", {
      credentials: "include",
      headers: { accept: "application/json" },
    })
    return await response.json()
  })
  const children = Array.isArray(dashboard?.children) ? dashboard.children : []
  const reportHrefs = []

  for (const child of children) {
    const childId = String(child?.eaglesId || "").trim()
    const reportArchive = Array.isArray(child?.details?.reportArchive) ? child.details.reportArchive : []
    if (!childId || !reportArchive.length) continue

    await page.evaluate((expectedChildId) => {
      const select = globalThis.document.getElementById("childSelect")
      if (!(select instanceof HTMLSelectElement)) {
        throw new Error("childSelect is not available")
      }
      select.value = expectedChildId
      select.dispatchEvent(new Event("change", { bubbles: true }))
    }, childId)
    await page.waitForFunction((expectedChildId) => {
      const select = globalThis.document.getElementById("childSelect")
      return Boolean(select && select.value === expectedChildId)
    }, childId)
    await page.waitForFunction((expectedCount) => {
      const links = globalThis.document.querySelectorAll('#performanceReportsList a[href^="/parent/reports/"]')
      return links.length === expectedCount
    }, reportArchive.length)

    const childHrefs = await page.locator('#performanceReportsList a[href^="/parent/reports/"]').evaluateAll((links, baseUrl) => {
      return links.map((link) => {
        const href = link.getAttribute("href") || ""
        return new URL(href, baseUrl).toString()
      })
    }, page.url())
    reportHrefs.push(...childHrefs)
  }

  assert.ok(reportHrefs.length > 0, "parent portal should expose report archives across all linked children")
  return reportHrefs
}

async function assertReportPageRendered(page, role) {
  await page.waitForFunction((currentRole) => {
    const body = globalThis.document.body
    return Boolean(body && body.classList.contains(`${currentRole}-portal-page`))
  }, role)

  const menuButtonSelector = role === "parent" ? "#parentMenuBtn" : "#menuBtn"
  const navSelector = role === "parent" ? "#parentSideNav" : "#sideNav"
  const scrimSelector = role === "parent" ? "#parentNavScrim" : "#navOverlay"

  assert.equal(await page.locator(menuButtonSelector).count(), 1, `${role} report should show the portal menu button`)
  assert.equal(await page.locator(navSelector).count(), 1, `${role} report should show the portal side nav`)
  assert.equal(await page.locator(scrimSelector).count(), 1, `${role} report should show the portal scrim`)

  await page.locator(menuButtonSelector).click()
  await page.waitForFunction((currentNavSelector) => {
    const nav = globalThis.document.querySelector(currentNavSelector)
    return Boolean(nav && nav.classList.contains("open") && globalThis.document.body.classList.contains("menu-open"))
  }, navSelector)
  await page.locator(scrimSelector).click()
  await page.waitForFunction((currentNavSelector) => {
    const nav = globalThis.document.querySelector(currentNavSelector)
    return Boolean(nav && !nav.classList.contains("open") && !globalThis.document.body.classList.contains("menu-open"))
  }, navSelector)

  const snapshot = await page.evaluate(() => ({
    snapshotId: String(globalThis.document.querySelector('[data-field="snapshot-id"]')?.textContent || "").trim(),
    capturedAt: String(globalThis.document.querySelector('[data-field="snapshot-captured-at"]')?.textContent || "").trim(),
    rubricRows: globalThis.document.querySelectorAll("#report-rubric-body tr").length,
  }))
  assert.notEqual(snapshot.snapshotId, "[[snapshot id]]", `${role} report should render an immutable snapshot id`)
  assert.notEqual(snapshot.capturedAt, "[[full timestamp]]", `${role} report should render a captured timestamp`)
  assert.ok(snapshot.rubricRows >= 1, `${role} report should render rubric rows`)
}

const skipReason = resolvePlaywrightSkipReason()

test(
  "slugged report URLs render for matching accounts and ignore cosmetic slug text",
  { skip: skipReason },
  async () => {
    const { server, origin } = await startServer()
    const browser = await chromium.launch(CHROMIUM_LAUNCH_OPTIONS)
    try {
      const parentContext = await browser.newContext({ viewport: { width: 1280, height: 960 } })
      const studentContext = await browser.newContext({ viewport: { width: 1280, height: 960 } })
      try {
        const parentPage = await parentContext.newPage()
        const studentPage = await studentContext.newPage()
        await loginParent(parentPage, origin, {
          parentsId: process.env.STUDENT_PARENT_USER || "cmkramer001",
          password: process.env.STUDENT_PARENT_PASS || "P1k@ch00",
        })
        await loginStudent(studentPage, origin, {
          eaglesId: process.env.STUDENT_STUDENT_USER || "kramer001",
          password: process.env.STUDENT_STUDENT_PASS || "P1k@ch00",
        })

        const parentReportHrefs = await collectParentReportArchiveHrefs(parentPage)
        for (const reportHref of parentReportHrefs) {
          const reportId = extractTrailingReportId(reportHref)
          assert.match(new URL(reportHref).pathname, new RegExp(`/parent/reports/.+-${reportId}$`))

          const mangledHref = buildMangledReportHref(reportHref, "cosmetic-slug")
          await openReportArchivePage(parentPage, "parent", mangledHref)
          await assertReportPageRendered(parentPage, "parent")
        }

        await openPerformanceReports(studentPage, "student")
        const studentReportHref = await collectReportArchiveHref(studentPage, "student")
        const studentReportId = extractTrailingReportId(studentReportHref)
        assert.match(new URL(studentReportHref).pathname, new RegExp(`/student/reports/.+-${studentReportId}$`))

        const mangledStudentHref = buildMangledReportHref(studentReportHref, "cosmetic-slug")
        await openReportArchivePage(studentPage, "student", mangledStudentHref)
        await assertReportPageRendered(studentPage, "student")
      } finally {
        await parentContext.close()
        await studentContext.close()
      }
    } finally {
      await browser.close()
      await new Promise((resolve) => server.close(resolve))
    }
  },
)

test(
  "unauthenticated report URLs preserve next and resume after login",
  { skip: skipReason },
  async () => {
    const { server, origin } = await startServer()
    const browser = await chromium.launch(CHROMIUM_LAUNCH_OPTIONS)
    try {
      const parentContext = await browser.newContext({ viewport: { width: 1280, height: 960 } })
      const studentContext = await browser.newContext({ viewport: { width: 1280, height: 960 } })
      try {
        const parentPage = await parentContext.newPage()
        const studentPage = await studentContext.newPage()
        await loginParent(parentPage, origin, {
          parentsId: process.env.STUDENT_PARENT_USER || "cmkramer001",
          password: process.env.STUDENT_PARENT_PASS || "P1k@ch00",
        })
        await loginStudent(studentPage, origin, {
          eaglesId: process.env.STUDENT_STUDENT_USER || "kramer001",
          password: process.env.STUDENT_STUDENT_PASS || "P1k@ch00",
        })

        for (const [role, page, grantSession, credentials] of [
          ["parent", parentPage, grantParentSession, {
            parentsId: process.env.STUDENT_PARENT_USER || "cmkramer001",
            password: process.env.STUDENT_PARENT_PASS || "P1k@ch00",
          }],
          ["student", studentPage, grantStudentSession, {
            eaglesId: process.env.STUDENT_STUDENT_USER || "kramer001",
            password: process.env.STUDENT_STUDENT_PASS || "P1k@ch00",
          }],
        ]) {
          await openPerformanceReports(page, role)
          const reportHref = await collectReportArchiveHref(page, role)

          const unauthContext = await browser.newContext({ viewport: { width: 1280, height: 960 } })
          try {
            const unauthPage = await unauthContext.newPage()
            await unauthPage.goto(reportHref, { waitUntil: "domcontentloaded" })
            await unauthPage.waitForURL((url) => url.pathname === (role === "parent" ? "/parent" : "/student"), { timeout: 30000 })
            const redirectedUrl = new URL(unauthPage.url())
            const expectedNext = new URL(reportHref)
            assert.equal(redirectedUrl.pathname, role === "parent" ? "/parent" : "/student", `${role} report should require auth before viewing`)
            assert.equal(redirectedUrl.searchParams.get("next"), `${expectedNext.pathname}${expectedNext.search}${expectedNext.hash}`, `${role} redirect should preserve next`)

            await grantSession(unauthPage, origin, credentials)
            await unauthPage.goto(unauthPage.url(), { waitUntil: "domcontentloaded" })
            await unauthPage.waitForURL((url) => url.pathname.startsWith(role === "parent" ? "/parent/reports/" : "/student/reports/"), { timeout: 30000 })
            await assertReportPageRendered(unauthPage, role)
          } finally {
            await unauthContext.close()
          }
        }
      } finally {
        await parentContext.close()
        await studentContext.close()
      }
    } finally {
      await browser.close()
      await new Promise((resolve) => server.close(resolve))
    }
  },
)

test(
  "wrong-account report URLs redirect home with a blocking mismatch modal",
  { skip: skipReason },
  async () => {
    const { server, origin } = await startServer()
    const browser = await chromium.launch(CHROMIUM_LAUNCH_OPTIONS)
    try {
      const parentContext = await browser.newContext({ viewport: { width: 1280, height: 960 } })
      const studentContext = await browser.newContext({ viewport: { width: 1280, height: 960 } })
      try {
        const parentPage = await parentContext.newPage()
        const studentPage = await studentContext.newPage()
        await loginParent(parentPage, origin, {
          parentsId: process.env.STUDENT_PARENT_USER || "cmkramer001",
          password: process.env.STUDENT_PARENT_PASS || "P1k@ch00",
        })
        await loginStudent(studentPage, origin, {
          eaglesId: process.env.STUDENT_STUDENT_USER || "kramer001",
          password: process.env.STUDENT_STUDENT_PASS || "P1k@ch00",
        })

        for (const [role, page, mismatchCredentials] of [
          ["parent", parentPage, {
            parentsId: process.env.STUDENT_PARENT_MISMATCH_USER || "cmalvin001",
            password: process.env.STUDENT_PARENT_MISMATCH_PASS || "P1k@ch00",
          }],
          ["student", studentPage, {
            eaglesId: process.env.STUDENT_STUDENT_MISMATCH_USER || "suri004",
            password: process.env.STUDENT_STUDENT_MISMATCH_PASS || "P1k@ch00",
          }],
        ]) {
          await openPerformanceReports(page, role)
          const reportHref = await collectReportArchiveHref(page, role)

          const mismatchContext = await browser.newContext({ viewport: { width: 1280, height: 960 } })
          try {
            const mismatchPage = await mismatchContext.newPage()
            if (role === "parent") {
              await grantParentSession(mismatchPage, origin, mismatchCredentials)
            } else {
              await grantStudentSession(mismatchPage, origin, mismatchCredentials)
            }
            await mismatchPage.goto(reportHref, { waitUntil: "domcontentloaded" })
            await mismatchPage.waitForFunction(() => {
              const modal = globalThis.document.getElementById("reportAccessErrorModal")
              return Boolean(modal && !modal.classList.contains("hidden"))
            })
            assert.equal(
              new URL(mismatchPage.url()).pathname,
              role === "parent" ? "/parent" : "/student",
            )

            const modalText = await mismatchPage.locator("#reportAccessErrorModalMessage").textContent()
            assert.equal(String(modalText || "").trim(), "LINK doesn't MATCH STUDENT OR FAMILY ACCOUNT")
            assert.equal(new URL(mismatchPage.url()).searchParams.get("reportAccessError"), null, "mismatch marker should be cleared after opening")
            await mismatchPage.locator("#closeReportAccessErrorModalBtn").click()
            await mismatchPage.waitForFunction(() => {
              const modal = globalThis.document.getElementById("reportAccessErrorModal")
              return Boolean(modal && modal.classList.contains("hidden"))
            })
            assert.equal(new URL(mismatchPage.url()).pathname, role === "parent" ? "/parent" : "/student")
          } finally {
            await mismatchContext.close()
          }
        }
      } finally {
        await parentContext.close()
        await studentContext.close()
      }
    } finally {
      await browser.close()
      await new Promise((resolve) => server.close(resolve))
    }
  },
)
