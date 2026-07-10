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

let reportFlowAccountsPromise = null
let reportFlowFixtureSeedPromise = null

async function ensureReportFlowFixture() {
  if (!reportFlowFixtureSeedPromise) {
    reportFlowFixtureSeedPromise = (async () => {
      const { getSharedPrismaClient } = await import("../src/infra/db/prisma-client.mjs")
      const prisma = await getSharedPrismaClient()
      try {
        const visibleRows = await prisma.$queryRaw`
          select
            p."parentsId" as "parentsId",
            s."eaglesId" as "eaglesId"
          from "ParentClassReport" r
          join "Student" s on s.id = r."studentRefId"
          join "ParentPortalStudentLink" l on l."studentRefId" = s.id
          join "ParentPortalAccount" p on p.id = l."parentAccountId"
          where p.status = 'active'
            and (r."approvedAt" is not null or r."publishedAt" is not null or r."notificationQueuedAt" is not null)
          group by p."parentsId", s."eaglesId"
          order by count(r.id) desc, p."parentsId" asc, s."eaglesId" asc
          limit 1
        `
        if (visibleRows.length > 0) return

        const draftRows = await prisma.$queryRaw`
          select
            r.id as "reportId",
            p."parentsId" as "parentsId",
            s."eaglesId" as "eaglesId"
          from "ParentClassReport" r
          join "Student" s on s.id = r."studentRefId"
          join "ParentPortalStudentLink" l on l."studentRefId" = s.id
          join "ParentPortalAccount" p on p.id = l."parentAccountId"
          where p.status = 'active'
            and r."approvedAt" is null
            and r."publishedAt" is null
            and r."notificationQueuedAt" is null
          order by r."generatedAt" desc, p."parentsId" asc, s."eaglesId" asc
          limit 1
        `
        assert.ok(draftRows.length > 0, "report-flow test database should expose at least one draft report fixture")
        const [draftRow] = draftRows
        const reportId = String(draftRow.reportId || "").trim()
        assert.ok(reportId, "report-flow draft fixture should include a report id")
        const now = new Date().toISOString()
        await prisma.$executeRaw`
          update "ParentClassReport"
          set
            "workflowState" = 'published',
            "approvedAt" = ${now},
            "publishedAt" = ${now},
            "notificationQueuedAt" = ${now},
            "approvedByUsername" = 'report-flow'
          where id = ${reportId}
        `
      } finally {
        await prisma.$disconnect()
      }
    })()
  }
  return reportFlowFixtureSeedPromise
}

async function getReportFlowAccounts() {
  if (!reportFlowAccountsPromise) {
    reportFlowAccountsPromise = (async () => {
      await ensureReportFlowFixture()
      const { getSharedPrismaClient } = await import("../src/infra/db/prisma-client.mjs")
      const prisma = await getSharedPrismaClient()
      try {
        const rows = await prisma.$queryRaw`
          select
            p."parentsId" as "parentsId",
            s."eaglesId" as "eaglesId"
          from "ParentPortalAccount" p
          join "ParentPortalStudentLink" l on l."parentAccountId" = p.id
          join "Student" s on s.id = l."studentRefId"
          join "ParentClassReport" r on r."studentRefId" = s.id
          where p.status = 'active'
            and (r."approvedAt" is not null or r."publishedAt" is not null or r."notificationQueuedAt" is not null)
          group by p."parentsId", s."eaglesId"
          order by count(r.id) desc, p."parentsId" asc, s."eaglesId" asc
          limit 1
        `
        assert.ok(rows.length > 0, "report-flow test database should expose at least one parent report fixture")
        return {
          parentUser: String(rows[0].parentsId || "").trim(),
          parentPass: "P1k@ch00",
          studentUser: String(rows[0].eaglesId || "").trim(),
          studentPass: "P1k@ch00",
        }
      } finally {
        await prisma.$disconnect()
      }
    })()
  }
  return reportFlowAccountsPromise
}

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

async function collectReportArchiveHref(origin, role) {
  const dashboard = await fetchDashboardJson(origin, role)
  const dashboardChild =
    (Array.isArray(dashboard?.children) && dashboard.children.find((entry) => Array.isArray(entry?.details?.reportArchive) && entry.details.reportArchive.length))
    || dashboard?.child
    || dashboard?.children?.child
    || null
  const reportArchive =
    dashboardChild?.details?.reportArchive
    || dashboard?.details?.reportArchive
    || []
  const report = Array.isArray(reportArchive) ? reportArchive[0] : null
  const reportId = String(report?.id || "").trim()
  let href = ""
  if (reportId) {
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
    const prefix = role === "parent" ? "/parent/reports" : "/student/reports"
    href = `${prefix}/${encodeURIComponent(`${slug}-${reportId}`)}`
  }
  assert.ok(href, `${role} portal should provide a slugged report href`)
  return new URL(href, origin).toString()
}

async function fetchDashboardJson(origin, role) {
  const reportFlowAccounts = await getReportFlowAccounts()
  const credentials =
    role === "parent" ? {
      parentsId: reportFlowAccounts.parentUser,
      password: reportFlowAccounts.parentPass,
    } : {
      eaglesId: reportFlowAccounts.studentUser,
      password: reportFlowAccounts.studentPass,
    }
  const loginEndpoint = role === "parent" ? "/api/parent/auth/login" : "/api/student/auth/login"
  const loginResponse = await fetch(`${origin}${loginEndpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(credentials),
  })
  assert.ok(loginResponse.ok, `${role} login failed with ${loginResponse.status}`)
  const setCookie = loginResponse.headers.get("set-cookie") || ""
  const cookieMatch =
    role === "parent" ?
      setCookie.match(/^parent_portal_sid=([^;]+)/i) :
      setCookie.match(/^student_portal_sid=([^;]+)/i)
  assert.ok(cookieMatch, `${role} login did not return a session cookie`)
  const endpoint = role === "parent" ? "/api/parent/dashboard" : "/api/student/dashboard"
  const response = await fetch(`${origin}${endpoint}`, {
    headers: {
      accept: "application/json",
      cookie: `${role === "parent" ? "parent_portal_sid" : "student_portal_sid"}=${cookieMatch[1]}`,
    },
  })
  assert.ok(response.ok, `${role} dashboard fetch failed with ${response.status}`)
  return await response.json()
}

async function openPerformanceReports(page, role) {
  const navTarget = 'a[data-page-target="performance-reports"]'
  await page.locator(navTarget).first().evaluate((node) => node.click())
  await page.waitForTimeout(250)
  return []
}

async function collectParentReportArchiveHrefs(page, origin) {
  await page.locator('a[data-page-target="performance-reports"]').first().evaluate((node) => node.click())
  await page.waitForTimeout(250)
  const dashboard = await fetchDashboardJson(origin, "parent")
  const reportHrefs = []
  const children = Array.isArray(dashboard?.children) ? dashboard.children : []

  for (const child of children) {
    const reportArchive = Array.isArray(child?.details?.reportArchive) ? child.details.reportArchive : []
    if (!reportArchive.length) continue

    const childHrefs = reportArchive.map((report) => {
      const reportId = String(report?.id || "").trim()
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
      return new URL(`/parent/reports/${encodeURIComponent(`${slug}-${reportId}`)}`, origin).toString()
    })
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
      const reportFlowAccounts = await getReportFlowAccounts()
      const parentContext = await browser.newContext({ viewport: { width: 1280, height: 960 } })
      const studentContext = await browser.newContext({ viewport: { width: 1280, height: 960 } })
      try {
        const parentPage = await parentContext.newPage()
        const studentPage = await studentContext.newPage()
        await loginParent(parentPage, origin, {
          parentsId: reportFlowAccounts.parentUser,
          password: reportFlowAccounts.parentPass,
        })
        await loginStudent(studentPage, origin, {
          eaglesId: reportFlowAccounts.studentUser,
          password: reportFlowAccounts.studentPass,
        })

        const parentReportHrefs = await collectParentReportArchiveHrefs(parentPage, origin)
        for (const reportHref of parentReportHrefs) {
          const reportId = extractTrailingReportId(reportHref)
          assert.match(new URL(reportHref).pathname, new RegExp(`/parent/reports/.+-${reportId}$`))

          const mangledHref = buildMangledReportHref(reportHref, "cosmetic-slug")
          await openReportArchivePage(parentPage, "parent", mangledHref)
          await assertReportPageRendered(parentPage, "parent")
        }

        await openPerformanceReports(studentPage, "student")
        const studentReportHref = await collectReportArchiveHref(origin, "student")
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
      const reportFlowAccounts = await getReportFlowAccounts()
      const parentContext = await browser.newContext({ viewport: { width: 1280, height: 960 } })
      const studentContext = await browser.newContext({ viewport: { width: 1280, height: 960 } })
      try {
        const parentPage = await parentContext.newPage()
        const studentPage = await studentContext.newPage()
        await loginParent(parentPage, origin, {
          parentsId: reportFlowAccounts.parentUser,
          password: reportFlowAccounts.parentPass,
        })
        await loginStudent(studentPage, origin, {
          eaglesId: reportFlowAccounts.studentUser,
          password: reportFlowAccounts.studentPass,
        })

        for (const [role, page, grantSession, credentials] of [
          ["parent", parentPage, grantParentSession, {
            parentsId: reportFlowAccounts.parentUser,
            password: reportFlowAccounts.parentPass,
          }],
          ["student", studentPage, grantStudentSession, {
            eaglesId: reportFlowAccounts.studentUser,
            password: reportFlowAccounts.studentPass,
          }],
        ]) {
          await openPerformanceReports(page, role)
          const reportHref = await collectReportArchiveHref(origin, role)

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
      const reportFlowAccounts = await getReportFlowAccounts()
      const parentContext = await browser.newContext({ viewport: { width: 1280, height: 960 } })
      const studentContext = await browser.newContext({ viewport: { width: 1280, height: 960 } })
      try {
        const parentPage = await parentContext.newPage()
        const studentPage = await studentContext.newPage()
        await loginParent(parentPage, origin, {
          parentsId: reportFlowAccounts.parentUser,
          password: reportFlowAccounts.parentPass,
        })
        await loginStudent(studentPage, origin, {
          eaglesId: reportFlowAccounts.studentUser,
          password: reportFlowAccounts.studentPass,
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
          const reportHref = await collectReportArchiveHref(origin, role)

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
