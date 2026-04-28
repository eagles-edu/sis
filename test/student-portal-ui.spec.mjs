import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { JSDOM } from "jsdom"

const STUDENT_PORTAL_HTML_PATH = path.resolve(process.cwd(), "web-asset/student/student-portal.html")
const SHARED_THEME_PATH = path.resolve(process.cwd(), "web-asset/shared/portal-theme.css")
const STUDENT_PORTAL_HTML = fs.readFileSync(STUDENT_PORTAL_HTML_PATH, "utf8")
const SHARED_THEME = fs.readFileSync(SHARED_THEME_PATH, "utf8")
const STUDENT_PORTAL_HTML_FOR_TEST = STUDENT_PORTAL_HTML
  .replace(/<link rel="stylesheet" href="\/web-asset\/shared\/portal-theme\.css">\s*/i, "")
  .replace(/<script src="\/web-asset\/shared\/portal-navigation\.js"><\/script>\s*/i, "")
  .replace(/<script type="module">\s*import svgIcon[\s\S]*?<\/script>\s*/i, "")
  .replace(/<script src="\/web-asset\/vendor\/fullcalendar\/index\.global\.min\.js"><\/script>\s*/i, "")

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
              event.preventDefault()
              const destination = getDestination(link) || ""
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

test("student portal dark theme keeps identity, metric, and homework surfaces on the dark card hierarchy", () => {
  assert.match(SHARED_THEME, /html\[data-theme="dark"\] body\.student-portal-page \.identity-item/s)
  assert.match(SHARED_THEME, /html\[data-theme="dark"\] body\.student-portal-page \.metric/s)
  assert.match(SHARED_THEME, /html\[data-theme="dark"\] body\.student-portal-page \.homework-card-shell/s)
  assert.match(SHARED_THEME, /html\[data-theme="dark"\] body\.student-portal-page \.homework-link,/i)
  assert.match(SHARED_THEME, /html\[data-theme="dark"\] body\.student-portal-page \.homework-card-label/s)
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
            currentGrade: "EggChicks",
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

  dom.window.close()
})
