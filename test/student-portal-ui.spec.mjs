import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { JSDOM } from "jsdom"

const STUDENT_PORTAL_HTML_PATH = path.resolve(process.cwd(), "web-asset/student/student-portal.html")
const SHARED_THEME_PATH = path.resolve(process.cwd(), "web-asset/shared/portal-theme.min.css")
const STUDENT_PORTAL_HTML = fs.readFileSync(STUDENT_PORTAL_HTML_PATH, "utf8")
const STUDENT_PORTAL_JS = fs.readFileSync(path.resolve(process.cwd(), "web-asset/student/student-portal.js"), "utf8")
const SHARED_THEME = fs.readFileSync(SHARED_THEME_PATH, "utf8")
const STUDENT_PORTAL_HTML_FOR_TEST = STUDENT_PORTAL_HTML
  .replace(/<script src="\/web-asset\/shared\/portal-theme-state\.js"><\/script>\s*/i, "")
  .replace(/<script[^>]+src="\/web-asset\/shared\/portal-(?:action-feedback|preferences|password-visibility|navigation)\.js"[^>]*><\/script>\s*/gi, "")
  .replace(/<script src="\/web-asset\/shared\/vocabulary-esl-editor\.js"><\/script>\s*/i, "")
  .replace(/<link rel="stylesheet" href="\/web-asset\/vendor\/tabulatorz\/tabulator\.min\.css">\s*/i, "")
  .replace(/<link rel="stylesheet" href="\/web-asset\/shared\/portal-theme\.min\.css">\s*/i, "")
  .replace(/<script src="\/web-asset\/shared\/portal-navigation\.js"><\/script>\s*/i, "")
  .replace(/<script src="\/web-asset\/shared\/portal-environment\.js"><\/script>\s*/i, "")
  .replace(/<script src="\/web-asset\/vendor\/tabulatorz\/tabulator\.min\.js"><\/script>\s*/i, "")
  .replace(/<script type="module">\s*import svgIcon[\s\S]*?<\/script>\s*/i, "")
  .replace(/<script src="\/web-asset\/vendor\/fullcalendar\/index\.global\.min\.js"><\/script>\s*/i, "")
  .replace(/<link rel="stylesheet" href="\/web-asset\/student\/student-portal\.min\.css">\s*/i, "")
  .replace(/<script src="\/web-asset\/student\/student-portal\.min\.js"[^>]*><\/script>/i, () => `<script>${STUDENT_PORTAL_JS}</script>`)
  .replace(/<head>/i, `<head><style>${SHARED_THEME}</style>`)

test("student portal uses the mirrored shared favicon", () => {
  assert.match(STUDENT_PORTAL_HTML, /href="\/web-asset\/images\/favicon\.ico\?=v2"/)
  assert.doesNotMatch(STUDENT_PORTAL_HTML, /\/web-asset\/student\/favicon\.ico/)
})

test("student news week-set controls keep visible and accessible names aligned", () => {
  assert.match(
    STUDENT_PORTAL_JS,
    /button\.title = "Open Week Set";\s*button\.setAttribute\("aria-label", button\.title\);/,
  )
})

function jsonTextResponse(status, payload = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return payload
    },
    async text() {
      return JSON.stringify(payload)
    },
  }
}

async function waitFor(assertion, timeoutMs = 1000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion()
      return
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 15))
    }
  }
  assertion()
}

function toUrlText(resource) {
  if (typeof resource === "string") return resource
  if (resource && typeof resource.url === "string") return resource.url
  return String(resource)
}

async function createStudentPortalDom(fetchHandler, url, options = {}) {
  const dom = new JSDOM(STUDENT_PORTAL_HTML_FOR_TEST, {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    url,
    beforeParse(window) {
      window.fetch = (resource, init = {}) => fetchHandler(resource, init)
      window.scrollTo = () => {}
      window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(Date.now()), 0)
      window.cancelAnimationFrame = (handle) => window.clearTimeout(handle)
      if (options.initialAuthState) {
        window.__SIS_STUDENT_INITIAL_AUTH__ = options.initialAuthState
      }
      if (typeof options.beforeParse === "function") {
        options.beforeParse(window)
      }
      window.HTMLElement.prototype.scrollIntoView = () => {}
      window.SISPortalNav = {
        bindAnchoredNavLinks({ selector = ".side-link", getDestination = (link) => link.getAttribute("href") || "", onActivate = null, onClose = null, rootNode = window.document } = {}) {
          const links = rootNode.querySelectorAll(selector)
          links.forEach((link) => {
            link.addEventListener("click", (event) => {
              const destination = getDestination(link) || ""
              if (!destination.startsWith("#")) return
              event.preventDefault()
              if (typeof onActivate === "function") {
                onActivate({ link, destination })
              }
              const raf = window.requestAnimationFrame?.bind(window) || ((callback) => window.setTimeout(callback, 0))
              raf(() => {
                raf(() => {
                  const target = window.document.querySelector(destination)
                  target?.scrollIntoView({ behavior: "auto", block: "start" })
                })
              })
              if (typeof onClose === "function") {
                onClose({ link, destination })
              }
            })
          })
          return links
        },
      }
      window.FullCalendar = {
        Calendar: class CalendarStub {
          constructor(element) {
            this.element = element
            this.events = []
          }

          removeAllEvents() {
            this.events = []
          }

          addEventSource(events = []) {
            this.events = Array.isArray(events) ? [...events] : []
          }

          gotoDate(dateText) {
            this.currentDate = dateText
          }

          updateSize() {}

          render() {
            const eventHtml = this.events
              .map((event) => `<div class="fc-event">${String(event?.title || "")}</div>`)
              .join("")
            this.element.innerHTML = `<div class="fc">${eventHtml}</div>`
          }

          destroy() {}
        },
      }
    },
  })

  await new Promise((resolve) => setTimeout(resolve, 30))
  return dom
}

test("student portal dark theme keeps overview, identity, metric, and homework surfaces on the dark card hierarchy", () => {
  assert.match(SHARED_THEME, /body\.parent-portal-page #parentOverviewSummary,body\.student-portal-page #studentOverviewSummary\{/s)
  assert.match(SHARED_THEME, /body:is\(\.student-portal-page, \.parent-portal-page\) :is\(#studentOverviewSummary, #parentOverviewSummary\)\.panel\{/s)
})

test("student portal initial auth paints the dashboard without probing /me", async () => {
  const calls = []
  let meCalls = 0
  const dom = await createStudentPortalDom(
    async (resource, init = {}) => {
      const urlText = toUrlText(resource)
      const method = String(init.method || "GET").toUpperCase()
      calls.push(`${method} ${urlText}`)

      const parsed = new URL(urlText, "http://preview.invalid")
      const pathname = parsed.pathname

      if (pathname === "/api/student/auth/me" && method === "GET") {
        meCalls += 1
        return jsonTextResponse(401, { error: "Unauthorized" })
      }

      if (pathname === "/api/student/dashboard" && method === "GET") {
        return jsonTextResponse(200, {
          child: {
            eaglesId: "flyers01",
            fullName: "Student One",
            englishName: "Student One",
            currentGrade: "Eggs & Chicks",
            studentNumber: 106,
            attendance: { total: 20, present: 19, absent: 1, late: 0, excused: 0 },
            assignments: { pending: 0, overdue: 0, completed: 1 },
            grades: { averageScorePercent: 92 },
            performance: { reportCount: 1 },
          },
          newsReports: {
            submittedCount: 1,
            statusSummary: {
              approved: 1,
              submitted: 0,
              revisionRequested: 0,
            },
          },
          calendarTracks: {
            review: [],
            homework: [],
          },
        })
      }

      if (pathname === "/api/student/news-reports/calendar" && method === "GET") {
        return jsonTextResponse(200, {
          window: {
            reportDate: "2026-04-26",
            closesAt: "2026-04-27T23:59:00+07:00",
            todayDate: "2026-04-26",
          },
          calendar: [],
          items: [],
          openReport: null,
        })
      }

      return jsonTextResponse(200, {})
    },
    "http://127.0.0.1:46145/web-asset/student/student-portal.html",
    {
      initialAuthState: {
        authenticated: true,
        user: {
          eaglesId: "flyers01",
          role: "student",
        },
      },
    },
  )

  const document = dom.window.document
  await waitFor(() => {
    assert.equal(document.getElementById("loginPanel").classList.contains("hidden"), true)
    assert.equal(document.getElementById("appPanel").classList.contains("hidden"), false)
  })

  assert.equal(meCalls, 0)
  assert.ok(!calls.some((entry) => entry.includes("/api/student/auth/me")))
  assert.match(document.documentElement.getAttribute("data-student-auth-state") || "", /authenticated/i)
  assert.match(document.getElementById("globalStatus")?.textContent || "", /Student session active/i)
  assert.equal(document.querySelectorAll("#newsQueueCard details").length, 0)
  assert.equal(document.querySelectorAll("#newsPageQueueDetails details").length, 0)
  assert.equal(document.getElementById("newsQueueDetails")?.tagName, "DIV")
  assert.equal(document.getElementById("newsPageQueueDetails")?.tagName, "DIV")

  dom.window.close()
})

test("student portal grades YTD uses the setup-defined quarter when a stored label is stale", async () => {
  const fixedNow = "2025-11-15T09:00:00.000Z"
  const dom = await createStudentPortalDom(
    async (resource, init = {}) => {
      const urlText = toUrlText(resource)
      const method = String(init.method || "GET").toUpperCase()
      const parsed = new URL(urlText, "http://preview.invalid")
      const pathname = parsed.pathname

      if (pathname === "/api/student/auth/me" && method === "GET") {
        return jsonTextResponse(401, { error: "Unauthorized" })
      }

      if (pathname === "/api/student/dashboard" && method === "GET") {
        return jsonTextResponse(200, {
          child: {
            eaglesId: "flyers01",
            fullName: "Student One",
            englishName: "Student One",
            currentGrade: "Eggs & Chicks",
            studentNumber: 106,
            attendance: { total: 20, present: 19, absent: 1, late: 0, excused: 0 },
            assignments: { pending: 0, overdue: 0, completed: 2 },
            grades: { averageScorePercent: 92 },
            performance: { reportCount: 1 },
            schoolSetup: {
              startDate: "2025-08-01",
              endDate: "2026-07-31",
              schoolYear: "2025-2026",
              quarters: [
                { quarter: "q1", startDate: "2025-08-01", endDate: "2025-10-31" },
                { quarter: "q2", startDate: "2025-11-01", endDate: "2026-01-31" },
                { quarter: "q3", startDate: "2026-02-01", endDate: "2026-04-30" },
                { quarter: "q4", startDate: "2026-05-01", endDate: "2026-07-31" },
              ],
            },
            details: {
              currentHomework: [],
              overdueHomework: [],
              assignmentHistory: [
                {
                  id: "q1-complete",
                  assignmentName: "Reading Log",
                  className: "Eggs & Chicks",
                  dueDate: "2025-09-10",
                  dueAt: "2025-09-10T00:00:00.000Z",
                  scorePercent: 92,
                  comments: "Submitted cleanly and on time.",
                  status: "completed",
                  homeworkCompleted: true,
                  homeworkOnTime: true,
                  quarter: "q1",
                },
                {
                  id: "q2-stale-label",
                  assignmentName: "Quarter Two Draft",
                  className: "Eggs & Chicks",
                  dueDate: "2025-11-20",
                  dueAt: "2025-11-20T00:00:00.000Z",
                  comments: "Stored label is stale, setup date should win.",
                  status: "pending",
                  homeworkCompleted: false,
                  homeworkOnTime: false,
                  quarter: "q1",
                },
              ],
              attendanceHistory: [],
              gradeHistory: [
                {
                  id: "q1-complete",
                  assignmentName: "Reading Log",
                  className: "Eggs & Chicks",
                  dueDate: "2025-09-10",
                  dueAt: "2025-09-10T00:00:00.000Z",
                  scorePercent: 92,
                  comments: "Submitted cleanly and on time.",
                  status: "completed",
                  homeworkCompleted: true,
                  homeworkOnTime: true,
                  quarter: "q1",
                },
                {
                  id: "q2-stale-label",
                  assignmentName: "Quarter Two Draft",
                  className: "Eggs & Chicks",
                  dueDate: "2025-11-20",
                  dueAt: "2025-11-20T00:00:00.000Z",
                  comments: "Stored label is stale, setup date should win.",
                  status: "pending",
                  homeworkCompleted: false,
                  homeworkOnTime: false,
                  quarter: "q1",
                },
              ],
              reportArchive: [],
              unfinishedCurrentQuarterAssignments: [],
              pastQuartersUnfinishedAssignments: [],
            },
          },
          newsReports: {
            submittedCount: 1,
            statusSummary: {
              approved: 1,
              submitted: 0,
              revisionRequested: 0,
            },
          },
          calendarTracks: {
            review: [],
            homework: [],
          },
        })
      }

      if (pathname === "/api/student/news-reports/calendar" && method === "GET") {
        return jsonTextResponse(200, {
          window: {
            reportDate: "2026-04-26",
            closesAt: "2026-04-27T23:59:00+07:00",
            todayDate: "2026-04-26",
          },
          calendar: [],
          items: [],
          openReport: null,
        })
      }

      return jsonTextResponse(200, {})
    },
    "http://127.0.0.1:46145/web-asset/student/student-portal.html",
    {
      initialAuthState: {
        authenticated: true,
        user: {
          eaglesId: "flyers01",
          role: "student",
        },
      },
      beforeParse(window) {
        const fixed = new Date(fixedNow).valueOf()
        const RealDate = window.Date
        class MockDate extends RealDate {
          constructor(...args) {
            super(...(args.length ? args : [fixed]))
          }
          static now() {
            return fixed
          }
        }
        window.Date = MockDate
        window.Tabulator = class {
          constructor(elementOrSelector, options = {}) {
            this.window = window
            this.options = options
            this.element = typeof elementOrSelector === "string" ? window.document.querySelector(elementOrSelector) : elementOrSelector
            this.render()
          }
          render() {
            if (!this.element) return
            const doc = this.window.document
            const root = doc.createElement("div")
            root.className = "tabulator"
            const header = doc.createElement("div")
            header.className = "tabulator-header"
            const headerRow = doc.createElement("div")
            headerRow.className = "tabulator-row tabulator-header-row"
            const columns = Array.isArray(this.options.columns) ? this.options.columns : []
            columns.forEach((column) => {
              const headerCell = doc.createElement("div")
              headerCell.className = "tabulator-col"
              const title = doc.createElement("div")
              title.className = "tabulator-col-title"
              title.textContent = typeof column.title === "string" ? column.title : String(column.title || "")
              headerCell.append(title)
              headerRow.append(headerCell)
            })
            header.append(headerRow)
            const table = doc.createElement("div")
            table.className = "tabulator-table"
            const data = Array.isArray(this.options.data) ? this.options.data : []
            data.forEach((rowData) => {
              const rowEl = doc.createElement("div")
              rowEl.className = "tabulator-row"
              const rowApi = {
                getData: () => rowData,
                getElement: () => rowEl,
              }
              if (typeof this.options.rowFormatter === "function") {
                this.options.rowFormatter(rowApi)
              }
              columns.forEach((column) => {
                const cell = doc.createElement("div")
                cell.className = "tabulator-cell"
                const cellApi = {
                  getValue: () => rowData?.[column.field],
                  getData: () => rowData,
                  getRow: () => rowApi,
                  getElement: () => cell,
                  getColumn: () => ({ getField: () => column.field }),
                }
                if (typeof column.formatter === "function") {
                  const formatted = column.formatter(cellApi)
                  if (formatted instanceof window.Node) {
                    cell.append(formatted)
                  } else if (formatted != null) {
                    cell.innerHTML = String(formatted)
                  }
                } else {
                  cell.textContent = rowData?.[column.field] == null ? "" : String(rowData[column.field])
                }
                rowEl.append(cell)
              })
              table.append(rowEl)
            })
            root.append(header, table)
            this.element.replaceChildren(root)
          }
          destroy() {
            if (this.element) this.element.replaceChildren()
          }
        }
      },
    }
  )

  const document = dom.window.document

  await new Promise((resolve) => dom.window.setTimeout(resolve, 40))

  await waitFor(() => {
    assert.equal(document.getElementById("appPanel").classList.contains("hidden"), false)
  }, 5000)

  document.querySelector('a[data-page-target="grades-ytd"]').click()

  await waitFor(() => {
    const activeButton = Array.from(document.querySelectorAll(".grade-quarter-picker-btn")).find(
      (button) => button.getAttribute("aria-pressed") === "true"
    )
    assert.match(activeButton?.textContent || "", /Q2/i)
  }, 5000)

  Array.from(document.querySelectorAll(".grade-quarter-picker-btn"))
    .find((button) => /Q2/i.test(button.textContent || ""))
    ?.click()

  await waitFor(() => {
    const grid = document.querySelector(".grade-tabulator-shell")
    assert.match(grid?.textContent || "", /Quarter Two Draft/i)
    assert.doesNotMatch(grid?.textContent || "", /Reading Log/i)
  }, 5000)

  await new Promise((resolve) => dom.window.setTimeout(resolve, 20))
  dom.window.close()
})
