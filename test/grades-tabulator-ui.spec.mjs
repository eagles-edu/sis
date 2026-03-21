import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { JSDOM } from "jsdom"

const TABULATOR_HTML_PATH = path.resolve(process.cwd(), "web-asset/admin/grades-tabulator.html")
const TABULATOR_HTML = fs
  .readFileSync(TABULATOR_HTML_PATH, "utf8")
  .replace(/<link[^>]*tabulator\.min\.css[^>]*>\s*/i, "")
  .replace(/<script src="\.\.\/vendor\/tabulatorz\/tabulator\.min\.js"><\/script>\s*/i, "")
const TABULATOR_UI_PREFS_KEY = "sis.grades-tabulator.ui-prefs.v1"
const ADMIN_UI_SETTINGS_KEY = "sis.admin.uiSettings"

function expectedCurrentSchoolYearLabel(date = new Date()) {
  const safeDate = date instanceof Date ? new Date(date.getTime()) : new Date(date)
  const year = safeDate.getFullYear()
  const month = safeDate.getMonth() + 1
  if (month >= 8) return `${year}-${year + 1}`
  return `${year - 1}-${year}`
}

function expectedSystemDefaultSchoolYearLabel() {
  const match = TABULATOR_HTML.match(/const DEFAULT_SYSTEM_SCHOOL_YEAR = \"(\d{4}-\d{4})\"/)
  if (match && match[1]) return match[1]
  return expectedCurrentSchoolYearLabel()
}

function jsonResponse(status, payload = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return payload
    },
  }
}

async function waitFor(assertion, timeoutMs = 1800) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion()
      return
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  assertion()
}

function makeTabulatorFetchHandler({
  authenticated = true,
  gradeRecords,
  settingsSchoolYear = "2025-2026",
} = {}) {
  const records = Array.isArray(gradeRecords) && gradeRecords.length
    ? gradeRecords
    : [
        {
          id: "grade-1",
          assignmentName: "Quiz 1",
          dueAt: "2026-03-03T00:00:00.000Z",
          submittedAt: "2026-03-04T00:00:00.000Z",
          score: 8,
          maxScore: 10,
          homeworkCompleted: true,
          homeworkOnTime: false,
          schoolYear: "2025-2026",
          quarter: "q1",
        },
      ]

  return async (resource, init = {}) => {
    const urlText =
      typeof resource === "string"
        ? resource
        : resource && typeof resource === "object" && "url" in resource
          ? String(resource.url)
          : ""
    const parsed = new URL(urlText, "http://127.0.0.1")
    const pathname = parsed.pathname
    const method = String(init.method || "GET").toUpperCase()

    if (pathname === "/api/admin/auth/me" && method === "GET") {
      if (!authenticated) return jsonResponse(401, { error: "Unauthorized" })
      return jsonResponse(200, {
        authenticated: true,
        user: { username: "admin", role: "admin" },
      })
    }

    if (pathname === "/api/admin/settings/ui" && method === "GET") {
      return jsonResponse(200, {
        uiSettings: {
          schoolSetup: { schoolYear: settingsSchoolYear },
        },
      })
    }

    if (pathname === "/api/admin/students" && method === "GET") {
      return jsonResponse(200, {
        items: [
          {
            id: "student-1",
            counts: { gradeRecords: 1 },
          },
        ],
      })
    }

    if (pathname === "/api/admin/students/student-1" && method === "GET") {
      return jsonResponse(200, {
        student: {
          id: "student-1",
          eaglesId: "SIS-001",
          profile: {
            englishName: "Starter Student",
            currentGrade: "Pre-A1 Starters",
            schoolName: "Main",
          },
          gradeRecords: records,
        },
      })
    }

    return jsonResponse(404, { error: "Not found" })
  }
}

async function createTabulatorDom(fetchHandler, url, options = {}) {
  const dom = new JSDOM(TABULATOR_HTML, {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    url,
    beforeParse(window) {
      if (typeof options.beforeParse === "function") options.beforeParse(window)
      window.fetch = (resource, init = {}) => fetchHandler(resource, init)
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 35))
  return dom
}

test("tabulator query filters override persisted preferences for school-year and quarter", async () => {
  const dom = await createTabulatorDom(
    makeTabulatorFetchHandler({ authenticated: true }),
    "http://127.0.0.1/web-asset/admin/grades-tabulator.html?apiOrigin=http://127.0.0.1&currentSchoolYear=2025-2026&schoolYear=2025-2026&period=quarter&quarter=q1",
    {
      beforeParse(window) {
        window.localStorage.setItem(
          TABULATOR_UI_PREFS_KEY,
          JSON.stringify({
            filters: {
              period: "quarter",
              schoolYear: "2024-2025",
              quarter: "q3",
            },
          }),
        )
      },
    },
  )

  await waitFor(() => {
    const statusText = String(dom.window.document.getElementById("statusLine")?.textContent || "")
    assert.match(statusText, /SIS load complete/i)
  }, 5000)

  const document = dom.window.document
  const schoolYearEl = document.getElementById("schoolYear")
  const quarterEl = document.getElementById("quarter")
  assert.ok(schoolYearEl instanceof dom.window.HTMLSelectElement)
  assert.ok(quarterEl instanceof dom.window.HTMLSelectElement)
  assert.equal(schoolYearEl.value, "2025-2026")
  assert.equal(quarterEl.value, "q1")
  assert.equal(
    Array.from(schoolYearEl.options).some((entry) => String(entry.value) === "2025-2026"),
    true,
  )
  assert.equal(
    document.querySelector('[data-period="quarter"]')?.classList.contains("is-active"),
    true,
  )

  dom.window.close()
})

test("tabulator seeds current school-year even when auth is required", async () => {
  const dom = await createTabulatorDom(
    makeTabulatorFetchHandler({ authenticated: false }),
    "http://127.0.0.1/web-asset/admin/grades-tabulator.html?apiOrigin=http://127.0.0.1&currentSchoolYear=2025-2026&schoolYear=2025-2026&period=quarter&quarter=q1",
  )

  await waitFor(() => {
    const statusText = String(dom.window.document.getElementById("statusLine")?.textContent || "")
    assert.match(statusText, /Login required/i)
  })

  const document = dom.window.document
  const schoolYearEl = document.getElementById("schoolYear")
  const quarterEl = document.getElementById("quarter")
  assert.ok(schoolYearEl instanceof dom.window.HTMLSelectElement)
  assert.ok(quarterEl instanceof dom.window.HTMLSelectElement)
  assert.equal(schoolYearEl.value, "2025-2026")
  assert.equal(quarterEl.value, "q1")
  assert.equal(
    Array.from(schoolYearEl.options).some((entry) => String(entry.value) === "2025-2026"),
    true,
  )

  dom.window.close()
})

test("tabulator no-query load seeds current school-year over stale all preference", async () => {
  const expectedCurrentSchoolYear = expectedSystemDefaultSchoolYearLabel()
  const dom = await createTabulatorDom(
    makeTabulatorFetchHandler({ authenticated: false }),
    "http://127.0.0.1/web-asset/admin/grades-tabulator.html?apiOrigin=http://127.0.0.1",
    {
      beforeParse(window) {
        window.localStorage.setItem(
          TABULATOR_UI_PREFS_KEY,
          JSON.stringify({
            filters: {
              period: "quarter",
              schoolYear: "all",
              quarter: "q3",
            },
          }),
        )
      },
    },
  )

  await waitFor(() => {
    const statusText = String(dom.window.document.getElementById("statusLine")?.textContent || "")
    assert.match(statusText, /Login required/i)
  })

  const document = dom.window.document
  const schoolYearEl = document.getElementById("schoolYear")
  assert.ok(schoolYearEl instanceof dom.window.HTMLSelectElement)
  assert.equal(schoolYearEl.value, expectedCurrentSchoolYear)
  assert.equal(
    Array.from(schoolYearEl.options).some((entry) => String(entry.value) === expectedCurrentSchoolYear),
    true,
  )

  dom.window.close()
})

test("tabulator no-query load uses school setup year from local settings", async () => {
  const expectedSchoolYear = "2026-2027"
  const dom = await createTabulatorDom(
    makeTabulatorFetchHandler({ authenticated: false }),
    "http://127.0.0.1/web-asset/admin/grades-tabulator.html?apiOrigin=http://127.0.0.1",
    {
      beforeParse(window) {
        window.localStorage.setItem(
          ADMIN_UI_SETTINGS_KEY,
          JSON.stringify({
            schoolSetup: {
              schoolYear: expectedSchoolYear,
            },
          }),
        )
        window.localStorage.setItem(
          TABULATOR_UI_PREFS_KEY,
          JSON.stringify({
            filters: {
              period: "quarter",
              schoolYear: "all",
              quarter: "q1",
            },
          }),
        )
      },
    },
  )

  await waitFor(() => {
    const statusText = String(dom.window.document.getElementById("statusLine")?.textContent || "")
    assert.match(statusText, /Login required/i)
  })

  const document = dom.window.document
  const schoolYearEl = document.getElementById("schoolYear")
  assert.ok(schoolYearEl instanceof dom.window.HTMLSelectElement)
  assert.equal(schoolYearEl.value, expectedSchoolYear)
  assert.equal(
    Array.from(schoolYearEl.options).some((entry) => String(entry.value) === expectedSchoolYear),
    true,
  )

  dom.window.close()
})

test("tabulator query schoolYear=all still resolves current school-year default", async () => {
  const expectedCurrentSchoolYear = expectedSystemDefaultSchoolYearLabel()
  const dom = await createTabulatorDom(
    makeTabulatorFetchHandler({ authenticated: false }),
    "http://127.0.0.1/web-asset/admin/grades-tabulator.html?apiOrigin=http://127.0.0.1&period=quarter&schoolYear=all&quarter=q3",
  )

  await waitFor(() => {
    const statusText = String(dom.window.document.getElementById("statusLine")?.textContent || "")
    assert.match(statusText, /Login required/i)
  })

  const document = dom.window.document
  const schoolYearEl = document.getElementById("schoolYear")
  const quarterEl = document.getElementById("quarter")
  assert.ok(schoolYearEl instanceof dom.window.HTMLSelectElement)
  assert.ok(quarterEl instanceof dom.window.HTMLSelectElement)
  assert.equal(schoolYearEl.value, expectedCurrentSchoolYear)
  assert.equal(quarterEl.value, "q1")
  assert.equal(
    Array.from(schoolYearEl.options).some((entry) => String(entry.value) === expectedCurrentSchoolYear),
    true,
  )

  dom.window.close()
})

test("tabulator schoolYear=all quarter query uses ssot current quarter", async () => {
  const expectedSchoolYear = "2026-2027"
  const dom = await createTabulatorDom(
    makeTabulatorFetchHandler({
      authenticated: true,
      settingsSchoolYear: expectedSchoolYear,
      gradeRecords: [
        {
          id: "grade-q1",
          assignmentName: "Q1 Quiz",
          dueAt: "2026-09-03T00:00:00.000Z",
          submittedAt: "2026-09-04T00:00:00.000Z",
          score: 8,
          maxScore: 10,
          homeworkCompleted: true,
          homeworkOnTime: true,
          schoolYear: expectedSchoolYear,
          quarter: "q1",
        },
        {
          id: "grade-q3",
          assignmentName: "Q3 Quiz",
          dueAt: "2027-03-03T00:00:00.000Z",
          submittedAt: "2027-03-04T00:00:00.000Z",
          score: 9,
          maxScore: 10,
          homeworkCompleted: true,
          homeworkOnTime: true,
          schoolYear: expectedSchoolYear,
          quarter: "q3",
        },
      ],
    }),
    "http://127.0.0.1/web-asset/admin/grades-tabulator.html?apiOrigin=http://127.0.0.1&period=quarter&schoolYear=all&quarter=q3",
    {
      beforeParse(window) {
        window.localStorage.setItem(
          ADMIN_UI_SETTINGS_KEY,
          JSON.stringify({
            schoolSetup: {
              schoolYear: expectedSchoolYear,
              startDate: "2026-08-10",
              endDate: "2027-05-28",
              quarters: [
                { quarter: "q1", startDate: "2026-08-10", endDate: "2026-10-31" },
                { quarter: "q2", startDate: "2026-11-01", endDate: "2027-01-31" },
                { quarter: "q3", startDate: "2027-02-01", endDate: "2027-03-31" },
                { quarter: "q4", startDate: "2027-04-01", endDate: "2027-05-28" },
              ],
            },
          }),
        )
      },
    },
  )

  await waitFor(() => {
    const statusText = String(dom.window.document.getElementById("statusLine")?.textContent || "")
    assert.match(statusText, /SIS load complete/i)
  }, 5000)

  const document = dom.window.document
  const schoolYearEl = document.getElementById("schoolYear")
  const quarterEl = document.getElementById("quarter")
  assert.ok(schoolYearEl instanceof dom.window.HTMLSelectElement)
  assert.ok(quarterEl instanceof dom.window.HTMLSelectElement)
  assert.equal(schoolYearEl.value, expectedSchoolYear)
  assert.equal(quarterEl.value, "q1")

  dom.window.close()
})

test("tabulator authenticated query quarter=q3 survives bootstrap when matching rows exist", async () => {
  const dom = await createTabulatorDom(
    makeTabulatorFetchHandler({
      authenticated: true,
      gradeRecords: [
        {
          id: "grade-q3",
          assignmentName: "Quiz Q3",
          dueAt: "2026-03-03T00:00:00.000Z",
          submittedAt: "2026-03-04T00:00:00.000Z",
          score: 9,
          maxScore: 10,
          homeworkCompleted: true,
          homeworkOnTime: true,
          schoolYear: "2025-2026",
          quarter: "q3",
        },
      ],
    }),
    "http://127.0.0.1/web-asset/admin/grades-tabulator.html?apiOrigin=http://127.0.0.1&currentSchoolYear=2025-2026&schoolYear=2025-2026&period=quarter&quarter=q3",
    {
      beforeParse(window) {
        window.localStorage.setItem(
          TABULATOR_UI_PREFS_KEY,
          JSON.stringify({
            filters: {
              period: "quarter",
              schoolYear: "2025-2026",
              quarter: "q1",
            },
          }),
        )
      },
    },
  )

  await waitFor(() => {
    const statusText = String(dom.window.document.getElementById("statusLine")?.textContent || "")
    assert.match(statusText, /SIS load complete/i)
  }, 5000)

  const document = dom.window.document
  const quarterEl = document.getElementById("quarter")
  const rowCountEl = document.getElementById("metricRows")
  assert.ok(quarterEl instanceof dom.window.HTMLSelectElement)
  assert.equal(quarterEl.value, "q3")
  assert.equal(String(rowCountEl?.textContent || ""), "1")
  assert.equal(
    document.querySelector('[data-period="quarter"]')?.classList.contains("is-active"),
    true,
  )

  dom.window.close()
})

test("tabulator authenticated bootstrap promotes server school setup year over stale local year", async () => {
  const expectedSchoolYear = "2026-2027"
  const dom = await createTabulatorDom(
    makeTabulatorFetchHandler({
      authenticated: true,
      settingsSchoolYear: expectedSchoolYear,
      gradeRecords: [
        {
          id: "grade-current",
          assignmentName: "Current Year Quiz",
          dueAt: "2026-09-03T00:00:00.000Z",
          submittedAt: "2026-09-04T00:00:00.000Z",
          score: 9,
          maxScore: 10,
          homeworkCompleted: true,
          homeworkOnTime: true,
          schoolYear: expectedSchoolYear,
          quarter: "q1",
        },
      ],
    }),
    "http://127.0.0.1/web-asset/admin/grades-tabulator.html?apiOrigin=http://127.0.0.1",
    {
      beforeParse(window) {
        window.localStorage.setItem(
          ADMIN_UI_SETTINGS_KEY,
          JSON.stringify({
            schoolSetup: {
              schoolYear: "2025-2026",
            },
          }),
        )
        window.localStorage.setItem(
          TABULATOR_UI_PREFS_KEY,
          JSON.stringify({
            filters: {
              period: "sytd",
              schoolYear: "all",
              quarter: "q1",
            },
          }),
        )
      },
    },
  )

  await waitFor(() => {
    const statusText = String(dom.window.document.getElementById("statusLine")?.textContent || "")
    assert.match(statusText, /SIS load complete/i)
  }, 5000)

  const document = dom.window.document
  const schoolYearEl = document.getElementById("schoolYear")
  const rowCountEl = document.getElementById("metricRows")
  assert.ok(schoolYearEl instanceof dom.window.HTMLSelectElement)
  assert.equal(schoolYearEl.value, expectedSchoolYear)
  assert.equal(
    Array.from(schoolYearEl.options).some((entry) => String(entry.value) === expectedSchoolYear),
    true,
  )
  assert.equal(String(rowCountEl?.textContent || ""), "1")

  dom.window.close()
})
