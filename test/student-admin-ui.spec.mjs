import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { JSDOM } from "jsdom"

const ADMIN_HTML_PATH = path.resolve(process.cwd(), "web-asset/admin/student-admin.html")
const ADMIN_HTML = fs.readFileSync(ADMIN_HTML_PATH, "utf8")

function jsonResponse(status, payload = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return payload
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

async function settleDomAsync(dom, rounds = 3, delayMs = 20) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => dom.window.setTimeout(resolve, delayMs))
  }
}

function localIsoDate(value = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  const year = String(date.getFullYear()).padStart(4, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function nextSundayIsoDate(value = new Date()) {
  const source = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  const date = new Date(source.getFullYear(), source.getMonth(), source.getDate())
  let offset = (7 - date.getDay()) % 7
  if (offset === 0) offset = 7
  date.setDate(date.getDate() + offset)
  return localIsoDate(date)
}

async function createAdminUiDom(fetchHandler, url = "http://127.0.0.1/admin/students", options = {}) {
  const dom = new JSDOM(ADMIN_HTML, {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    url,
    beforeParse(window) {
      if (typeof options.beforeParse === "function") options.beforeParse(window)
      window.fetch = (resource, init = {}) => fetchHandler(resource, init)
    },
  })

  await new Promise((resolve) => setTimeout(resolve, 30))
  return dom
}

function submitLogin(dom, { username = "admin", password = "admin-pass-123" } = {}) {
  const document = dom.window.document
  document.getElementById("loginUser").value = username
  document.getElementById("loginPass").value = password
  const submitEvent = new dom.window.Event("submit", { bubbles: true, cancelable: true })
  document.getElementById("loginForm").dispatchEvent(submitEvent)
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
}

function openPage(dom, pageSlug) {
  const document = dom.window.document
  const menuLink = document.querySelector(`[data-page-link="${pageSlug}"]`)
  if (menuLink) {
    menuLink.click()
    return
  }
  const targetPath = `/admin/students/${encodeURIComponent(pageSlug)}`
  dom.window.history.pushState({ page: pageSlug }, "", targetPath)
  dom.window.dispatchEvent(new dom.window.PopStateEvent("popstate"))
}

const SCHOOL_SETUP_ADMIN_ALLOWED_PAGES = [
  "overview",
  "student-admin",
  "school-setup",
  "profile",
  "attendance",
  "attendance-admin",
  "assignments",
  "assignments-data",
  "parent-tracking",
  "performance-data",
  "grades",
  "grades-data",
  "reports",
  "family",
  "users",
  "permissions",
  "settings",
]

function schoolSetupAdminRolePolicy() {
  return {
    role: "admin",
    canRead: true,
    canWrite: true,
    canManageUsers: true,
    canManagePermissions: true,
    startPage: "overview",
    allowedPages: [...SCHOOL_SETUP_ADMIN_ALLOWED_PAGES],
  }
}

function schoolSetupBootstrapResponses(url, rolePolicy) {
  if (url.includes("/api/admin/permissions")) {
    return jsonResponse(200, {
      roles: {
        admin: { ...rolePolicy, allowedPages: [...rolePolicy.allowedPages] },
      },
    })
  }
  if (url.includes("/api/admin/users")) return jsonResponse(200, { items: [] })
  if (url.includes("/api/admin/filters")) return jsonResponse(200, { levels: ["Pre-A1 Starters"], schools: ["Main"] })
  if (url.includes("/api/admin/students")) return jsonResponse(200, { items: [] })
  if (url.includes("/api/admin/dashboard")) {
    return jsonResponse(200, {
      levelCompletion: [],
      classEnrollmentAttendance: [],
      weeklyAssignmentCompletion: [],
      today: {},
    })
  }
  if (url.includes("/api/admin/notifications/batch-status")) return jsonResponse(200, { items: [], total: 0, hasMore: false })
  if (url.includes("/api/admin/exercise-results/incoming")) return jsonResponse(200, { items: [], total: 0, hasMore: false, statuses: [] })
  if (url.includes("/api/admin/runtime/service-control")) {
    return jsonResponse(200, {
      available: false,
      enabled: false,
      service: "exercise-mailer.service",
      status: "inactive",
      detail: "n/a",
    })
  }
  return null
}

async function createSchoolSetupAdminDom(options = {}) {
  const rolePolicy = schoolSetupAdminRolePolicy()
  let authenticated = false
  return createAdminUiDom(
    async (resource, init = {}) => {
      const url = String(resource)
      if (url.includes("/api/admin/auth/me")) {
        if (!authenticated) return jsonResponse(401, { error: "Unauthorized" })
        return jsonResponse(200, {
          authenticated: true,
          user: { username: "admin", role: "admin" },
          rolePolicy,
        })
      }
      if (url.includes("/api/admin/auth/login")) {
        authenticated = true
        return jsonResponse(200, {
          user: { username: "admin", role: "admin" },
          rolePolicy,
        })
      }
      if (url.includes("/api/admin/auth/logout")) {
        authenticated = false
        return jsonResponse(200, { ok: true })
      }
      const bootstrapResponse = schoolSetupBootstrapResponses(url, rolePolicy)
      if (bootstrapResponse) return bootstrapResponse
      return jsonResponse(200, {})
    },
    options.url,
    options
  )
}

test("admin ui login shows invalid credentials errors on the login panel", async () => {
  const calls = []
  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const url = String(resource)
    const method = init.method || "GET"
    calls.push(`${method} ${url}`)

    if (url.includes("/api/admin/auth/me")) {
      return jsonResponse(401, { error: "Unauthorized" })
    }

    if (url.includes("/api/admin/auth/login")) {
      return jsonResponse(401, { error: "Invalid username or password" })
    }

    return jsonResponse(404, { error: "Not found" })
  })

  submitLogin(dom, { password: "wrong" })

  await waitFor(() => {
    assert.ok(calls.includes("POST /api/admin/auth/login"))
  })

  await waitFor(() => {
    const text = dom.window.document.getElementById("authStatus").textContent
    assert.match(text, /Invalid username or password/i)
  })

  const document = dom.window.document
  assert.equal(document.getElementById("authPanel").classList.contains("hidden"), false)
  assert.equal(document.getElementById("app").classList.contains("hidden"), true)

  await settleDomAsync(dom)
  dom.window.close()
})

test("admin ui login success swaps panels and restores login button state", async () => {
  const calls = []
  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const url = String(resource)
    const method = init.method || "GET"
    calls.push(`${method} ${url}`)

    if (url.includes("/api/admin/auth/me")) {
      return jsonResponse(401, { error: "Unauthorized" })
    }

    if (url.includes("/api/admin/auth/login")) {
      return jsonResponse(200, {
        user: { username: "admin", role: "admin" },
        rolePolicy: {
          role: "admin",
          canRead: true,
          canWrite: true,
          canManageUsers: true,
          canManagePermissions: true,
          startPage: "overview",
          allowedPages: ["overview", "profile", "attendance", "grades", "reports", "family", "users", "permissions"],
        },
      })
    }

    if (url.includes("/api/admin/permissions")) {
      return jsonResponse(200, {
        roles: {
          admin: {
            role: "admin",
            canRead: true,
            canWrite: true,
            canManageUsers: true,
            canManagePermissions: true,
            startPage: "overview",
            allowedPages: ["overview", "profile", "attendance", "grades", "reports", "family", "users", "permissions"],
          },
        },
      })
    }

    if (url.includes("/api/admin/users")) {
      return jsonResponse(200, { items: [] })
    }

    if (url.includes("/api/admin/filters")) {
      return jsonResponse(200, { levels: [], schools: [] })
    }

    if (url.includes("/api/admin/students")) {
      return jsonResponse(200, { items: [] })
    }

    return jsonResponse(200, {})
  })

  submitLogin(dom)

  await waitFor(() => {
    const document = dom.window.document
    assert.equal(document.getElementById("authPanel").classList.contains("hidden"), true)
    assert.equal(document.getElementById("app").classList.contains("hidden"), false)
  })

  await waitFor(() => {
    const statusText = dom.window.document.getElementById("status").textContent
    assert.match(statusText, /Authenticated as admin/i)
  })

  const document = dom.window.document
  const loginButton = document.getElementById("loginBtn")
  assert.equal(loginButton.disabled, false)
  assert.equal(loginButton.textContent, "Login")
  assert.ok(calls.includes("POST /api/admin/auth/login"))

  await settleDomAsync(dom)
  dom.window.close()
})

test("tracking data submenus are visible for admin and hidden for teacher", async () => {
  const buildDomForRole = async (roleName) =>
    createAdminUiDom(async (resource, init = {}) => {
      const url = String(resource)
      void init

      if (url.includes("/api/admin/auth/me")) return jsonResponse(401, { error: "Unauthorized" })

      if (url.includes("/api/admin/auth/login")) {
        return jsonResponse(200, {
          user: { username: roleName, role: roleName },
          rolePolicy:
            roleName === "admin"
              ? {
                  role: "admin",
                  canRead: true,
                  canWrite: true,
                  canManageUsers: true,
                  canManagePermissions: true,
                  startPage: "overview",
                  allowedPages: [
                    "overview",
                    "profile",
                    "attendance",
                    "attendance-admin",
                    "assignments",
                    "parent-tracking",
                    "grades",
                    "reports",
                    "family",
                    "users",
                    "permissions",
                    "settings",
                  ],
                }
              : {
                  role: "teacher",
                  canRead: true,
                  canWrite: false,
                  canManageUsers: false,
                  canManagePermissions: false,
                  startPage: "overview",
                  allowedPages: [
                    "overview",
                    "profile",
                    "attendance",
                    "assignments",
                    "parent-tracking",
                    "grades",
                    "reports",
                    "family",
                  ],
                },
        })
      }

      if (url.includes("/api/admin/permissions")) {
        return jsonResponse(200, {
          roles: {
            admin: {
              role: "admin",
              canRead: true,
              canWrite: true,
              canManageUsers: true,
              canManagePermissions: true,
              startPage: "overview",
              allowedPages: [
                "overview",
                "profile",
                "attendance",
                "attendance-admin",
                "assignments",
                "parent-tracking",
                "grades",
                "reports",
                "family",
                "users",
                "permissions",
                "settings",
              ],
            },
            teacher: {
              role: "teacher",
              canRead: true,
              canWrite: false,
              canManageUsers: false,
              canManagePermissions: false,
              startPage: "overview",
              allowedPages: [
                "overview",
                "profile",
                "attendance",
                "assignments",
                "parent-tracking",
                "grades",
                "reports",
                "family",
              ],
            },
          },
        })
      }

      if (url.includes("/api/admin/users")) return jsonResponse(200, { items: [] })
      if (url.includes("/api/admin/filters")) return jsonResponse(200, { levels: ["Pre-A1 Starters"], schools: [] })
      if (url.includes("/api/admin/students/stu-")) {
        return jsonResponse(200, {
          id: "stu-01",
          eaglesId: "SIS-001",
          profile: { fullName: "Student One", currentGrade: "Pre-A1 Starters" },
          attendanceRecords: [],
          gradeRecords: [],
          parentReports: [],
        })
      }
      if (url.includes("/api/admin/students")) {
        return jsonResponse(200, {
          items: [
            {
              id: "stu-01",
              eaglesId: "SIS-001",
              profile: { fullName: "Student One", currentGrade: "Pre-A1 Starters" },
              counts: { attendanceRecords: 0 },
            },
          ],
        })
      }
      if (url.includes("/api/admin/dashboard")) {
        return jsonResponse(200, {
          today: { attendance: 0, absences: 0, tardy10PlusPercent: 0, tardy30PlusPercent: 0 },
          assignments: { total: 0, completedOnTime: 0, completedLate: 0, outstanding: 0, outstandingYtd: 0 },
          weeklyAssignmentCompletion: [],
          atRiskWeek: { total: 0, students: [] },
          classEnrollmentAttendance: [],
          levelCompletion: [],
        })
      }
      if (url.includes("/api/admin/exercise-titles")) return jsonResponse(200, { items: [] })
      return jsonResponse(200, {})
    })

  const adminDom = await buildDomForRole("admin")
  submitLogin(adminDom, { username: "admin" })
  await waitFor(() => {
    const text = adminDom.window.document.getElementById("status").textContent
    assert.match(text, /Authenticated as admin/i)
  })
  await waitFor(() => {
    const document = adminDom.window.document
    const topLevelTexts = Array.from(
      document.querySelectorAll('[data-menu-group="tracking"] .menu-group-links a[data-page-link]:not(.menu-sublink):not(.hidden)'),
    ).map((entry) => normalizeText(entry.textContent))
    assert.deepEqual(topLevelTexts, [
      "Attendance",
      "Assignments",
      "Grades",
      "Performance",
      "All Reports",
    ])

    const submenuChecks = [
      {
        id: "attendanceAdminSubmenu",
        links: [
          {
            pageLink: "attendance-admin",
            expected: /Attendance data/i,
          },
        ],
      },
      {
        id: "assignmentDataSubmenu",
        links: [
          {
            pageLink: "assignments-data",
            expected: /Assignments data/i,
          },
        ],
      },
      {
        id: "gradesDataSubmenu",
        links: [
          {
            pageLink: "grades-data",
            expected: /Grades data/i,
          },
        ],
      },
      {
        id: "performanceDataSubmenu",
        links: [
          {
            pageLink: "performance-data",
            expected: /Performance data/i,
          },
        ],
      },
    ]
    submenuChecks.forEach(({ id, links }) => {
      const submenu = document.getElementById(id)
      assert.ok(submenu)
      assert.equal(submenu.classList.contains("hidden"), false)
      links.forEach(({ pageLink, expected }) => {
        const menuLinks = submenu.querySelectorAll(`[data-page-link="${pageLink}"]`)
        assert.equal(menuLinks.length, 1)
        assert.match(menuLinks[0].textContent || "", expected)
      })
    })
  })
  adminDom.window.document.getElementById("logoutBtn").click()
  await waitFor(() => {
    assert.equal(adminDom.window.document.getElementById("authPanel").classList.contains("hidden"), false)
  })
  adminDom.window.close()

  const teacherDom = await buildDomForRole("teacher")
  submitLogin(teacherDom, { username: "teacher" })
  await waitFor(() => {
    const text = teacherDom.window.document.getElementById("status").textContent
    assert.match(text, /Authenticated as teacher/i)
  })
  await waitFor(() => {
    const document = teacherDom.window.document
    const topLevelTexts = Array.from(
      document.querySelectorAll('[data-menu-group="tracking"] .menu-group-links a[data-page-link]:not(.menu-sublink):not(.hidden)'),
    ).map((entry) => normalizeText(entry.textContent))
    assert.deepEqual(topLevelTexts, [
      "Attendance",
      "Assignments",
      "Grades",
      "Performance",
      "All Reports",
    ])

    const submenuChecks = [
      { id: "attendanceAdminSubmenu", pageLinks: ["attendance-admin"] },
      { id: "assignmentDataSubmenu", pageLinks: ["assignments-data"] },
      { id: "performanceDataSubmenu", pageLinks: ["performance-data"] },
      { id: "gradesDataSubmenu", pageLinks: ["grades-data"] },
    ]
    submenuChecks.forEach(({ id, pageLinks }) => {
      const submenu = document.getElementById(id)
      assert.ok(submenu)
      assert.equal(submenu.classList.contains("hidden"), true)
      pageLinks.forEach((pageLink) => {
        assert.equal(submenu.querySelectorAll(`[data-page-link="${pageLink}"]`).length, 1)
      })
    })
  })
  teacherDom.window.document.getElementById("logoutBtn").click()
  await waitFor(() => {
    assert.equal(teacherDom.window.document.getElementById("authPanel").classList.contains("hidden"), false)
  })
  teacherDom.window.close()
})

test("student search fallback keeps accent-insensitive matches discoverable", async () => {
  const studentListQueries = []
  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const parsedUrl = new URL(String(resource), "http://127.0.0.1")
    const pathname = parsedUrl.pathname
    const method = normalizeText(init.method || "GET").toUpperCase()

    if (pathname === "/api/admin/auth/me") return jsonResponse(401, { error: "Unauthorized" })
    if (pathname === "/api/admin/auth/login") {
      return jsonResponse(200, {
        user: { username: "admin", role: "admin" },
        rolePolicy: {
          role: "admin",
          canRead: true,
          canWrite: true,
          canManageUsers: true,
          canManagePermissions: true,
          startPage: "overview",
          allowedPages: [
            "overview",
            "student-admin",
            "profile",
            "attendance",
            "attendance-admin",
            "assignments",
            "assignments-data",
            "parent-tracking",
            "performance-data",
            "grades",
            "grades-data",
            "reports",
            "family",
            "users",
            "permissions",
            "settings",
          ],
        },
      })
    }
    if (pathname === "/api/admin/permissions") {
      return jsonResponse(200, {
        roles: {
          admin: {
            role: "admin",
            canRead: true,
            canWrite: true,
            canManageUsers: true,
            canManagePermissions: true,
            startPage: "overview",
            allowedPages: [
              "overview",
              "student-admin",
              "profile",
              "attendance",
              "attendance-admin",
              "assignments",
              "assignments-data",
              "parent-tracking",
              "performance-data",
              "grades",
              "grades-data",
              "reports",
              "family",
              "users",
              "permissions",
              "settings",
            ],
          },
        },
      })
    }
    if (pathname === "/api/admin/users") return jsonResponse(200, { items: [] })
    if (pathname === "/api/admin/filters") return jsonResponse(200, { levels: ["Pre-A1 Starters"], schools: [] })
    if (pathname === "/api/admin/students" && method === "GET") {
      studentListQueries.push(parsedUrl.search)
      const queryText = normalizeText(parsedUrl.searchParams.get("q"))
      if (queryText) return jsonResponse(200, { items: [] })
      return jsonResponse(200, {
        items: [
          {
            id: "stu-vi-01",
            eaglesId: "vi001",
            profile: { fullName: "Nguy\u1ec5n \u00c1nh", englishName: "", currentGrade: "Pre-A1 Starters" },
            counts: { attendanceRecords: 0 },
          },
        ],
      })
    }
    if (pathname === "/api/admin/dashboard") {
      return jsonResponse(200, {
        today: { attendance: 0, absences: 0, tardy10PlusPercent: 0, tardy30PlusPercent: 0 },
        assignments: { total: 0, completedOnTime: 0, completedLate: 0, outstanding: 0, outstandingYtd: 0 },
        weeklyAssignmentCompletion: [],
        atRiskWeek: { total: 0, students: [] },
        classEnrollmentAttendance: [],
        levelCompletion: [],
      })
    }
    if (pathname === "/api/admin/runtime/service-control") {
      return jsonResponse(404, { error: "Not found" })
    }
    if (pathname === "/api/admin/exercise-results/incoming") {
      return jsonResponse(200, { ok: true, total: 0, hasMore: false, statuses: [], items: [] })
    }
    if (pathname === "/api/admin/exercise-titles") return jsonResponse(200, { items: [] })
    return jsonResponse(200, {})
  })

  submitLogin(dom, { username: "admin" })

  await waitFor(() => {
    const studentRows = dom.window.document.querySelectorAll("#studentRows tr")
    assert.equal(studentRows.length, 1)
  })

  const document = dom.window.document
  const searchEl = document.getElementById("searchQ")
  const callsBeforeSearch = studentListQueries.length
  searchEl.value = "nguyen anh"
  document.getElementById("searchBtn").click()

  await waitFor(() => {
    assert.ok(studentListQueries.slice(callsBeforeSearch).some((query) => query.includes("q=nguyen%20anh")))
  })

  await waitFor(() => {
    const studentRows = document.querySelectorAll("#studentRows tr")
    assert.equal(studentRows.length, 1)
    assert.match(studentRows[0].textContent || "", /Nguy\u1ec5n \u00c1nh/i)
  })

  await waitFor(() => {
    assert.ok(studentListQueries.length >= callsBeforeSearch + 2)
  })
  await waitFor(() => {
    assert.ok(
      studentListQueries
        .slice(callsBeforeSearch)
        .some((query) => query.includes("take=1000") && !normalizeText(new URLSearchParams(query).get("q")))
    )
  })

  dom.window.close()
})

test("student search keeps direct query result and avoids fallback refetch", async () => {
  const studentListQueries = []
  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const parsedUrl = new URL(String(resource), "http://127.0.0.1")
    const pathname = parsedUrl.pathname
    const method = normalizeText(init.method || "GET").toUpperCase()

    if (pathname === "/api/admin/auth/me") return jsonResponse(401, { error: "Unauthorized" })
    if (pathname === "/api/admin/auth/login") {
      return jsonResponse(200, {
        user: { username: "admin", role: "admin" },
        rolePolicy: {
          role: "admin",
          canRead: true,
          canWrite: true,
          canManageUsers: true,
          canManagePermissions: true,
          startPage: "overview",
          allowedPages: [
            "overview",
            "student-admin",
            "profile",
            "attendance",
            "attendance-admin",
            "assignments",
            "assignments-data",
            "parent-tracking",
            "performance-data",
            "grades",
            "grades-data",
            "reports",
            "family",
            "users",
            "permissions",
            "settings",
          ],
        },
      })
    }
    if (pathname === "/api/admin/permissions") {
      return jsonResponse(200, {
        roles: {
          admin: {
            role: "admin",
            canRead: true,
            canWrite: true,
            canManageUsers: true,
            canManagePermissions: true,
            startPage: "overview",
            allowedPages: [
              "overview",
              "student-admin",
              "profile",
              "attendance",
              "attendance-admin",
              "assignments",
              "assignments-data",
              "parent-tracking",
              "performance-data",
              "grades",
              "grades-data",
              "reports",
              "family",
              "users",
              "permissions",
              "settings",
            ],
          },
        },
      })
    }
    if (pathname === "/api/admin/users") return jsonResponse(200, { items: [] })
    if (pathname === "/api/admin/filters") return jsonResponse(200, { levels: ["Pre-A1 Starters"], schools: [] })
    if (pathname === "/api/admin/students" && method === "GET") {
      studentListQueries.push(parsedUrl.search)
      const queryText = normalizeText(parsedUrl.searchParams.get("q"))
      if (queryText === "nguyen anh") {
        return jsonResponse(200, {
          items: [
            {
              id: "stu-vi-02",
              eaglesId: "vi002",
              profile: { fullName: "Nguy\u1ec5n \u00c1nh", englishName: "", currentGrade: "Pre-A1 Starters" },
              counts: { attendanceRecords: 0 },
            },
          ],
        })
      }
      return jsonResponse(200, { items: [] })
    }
    if (pathname === "/api/admin/dashboard") {
      return jsonResponse(200, {
        today: { attendance: 0, absences: 0, tardy10PlusPercent: 0, tardy30PlusPercent: 0 },
        assignments: { total: 0, completedOnTime: 0, completedLate: 0, outstanding: 0, outstandingYtd: 0 },
        weeklyAssignmentCompletion: [],
        atRiskWeek: { total: 0, students: [] },
        classEnrollmentAttendance: [],
        levelCompletion: [],
      })
    }
    if (pathname === "/api/admin/runtime/service-control") {
      return jsonResponse(404, { error: "Not found" })
    }
    if (pathname === "/api/admin/exercise-results/incoming") {
      return jsonResponse(200, { ok: true, total: 0, hasMore: false, statuses: [], items: [] })
    }
    if (pathname === "/api/admin/exercise-titles") return jsonResponse(200, { items: [] })
    return jsonResponse(200, {})
  })

  submitLogin(dom, { username: "admin" })

  await waitFor(() => {
    const document = dom.window.document
    assert.equal(document.querySelectorAll("#studentRows tr").length, 0)
  })

  const document = dom.window.document
  const searchEl = document.getElementById("searchQ")
  const callsBeforeSearch = studentListQueries.length
  searchEl.value = "nguyen anh"
  document.getElementById("searchBtn").click()

  await waitFor(() => {
    const studentRows = document.querySelectorAll("#studentRows tr")
    assert.equal(studentRows.length, 1)
    assert.match(studentRows[0].textContent || "", /Nguy\u1ec5n \u00c1nh/i)
  })

  assert.ok(studentListQueries.slice(callsBeforeSearch).some((query) => query.includes("q=nguyen%20anh")))
  assert.equal(
    studentListQueries
      .slice(callsBeforeSearch)
      .some(
        (query) =>
          query.includes("take=1000")
          && query.includes("level=")
          && query.includes("school=")
          && !normalizeText(new URLSearchParams(query).get("q"))
      ),
    false
  )

  dom.window.close()
})

test("top search level scope narrows assignment student dropdown and supports datalist selection", async () => {
  const studentRequests = []
  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const parsedUrl = new URL(String(resource), "http://127.0.0.1")
    const pathname = parsedUrl.pathname
    const method = normalizeText(init.method || "GET").toUpperCase()

    if (pathname === "/api/admin/auth/me") return jsonResponse(401, { error: "Unauthorized" })
    if (pathname === "/api/admin/auth/login") {
      return jsonResponse(200, {
        user: { username: "admin", role: "admin" },
        rolePolicy: {
          role: "admin",
          canRead: true,
          canWrite: true,
          canManageUsers: true,
          canManagePermissions: true,
          startPage: "overview",
          allowedPages: [
            "overview",
            "student-admin",
            "profile",
            "attendance",
            "attendance-admin",
            "assignments",
            "assignments-data",
            "parent-tracking",
            "performance-data",
            "grades",
            "grades-data",
            "reports",
            "family",
            "users",
            "permissions",
            "settings",
          ],
        },
      })
    }
    if (pathname === "/api/admin/permissions") {
      return jsonResponse(200, {
        roles: {
          admin: {
            role: "admin",
            canRead: true,
            canWrite: true,
            canManageUsers: true,
            canManagePermissions: true,
            startPage: "overview",
            allowedPages: [
              "overview",
              "student-admin",
              "profile",
              "attendance",
              "attendance-admin",
              "assignments",
              "assignments-data",
              "parent-tracking",
              "performance-data",
              "grades",
              "grades-data",
              "reports",
              "family",
              "users",
              "permissions",
              "settings",
            ],
          },
        },
      })
    }
    if (pathname === "/api/admin/users") return jsonResponse(200, { items: [] })
    if (pathname === "/api/admin/filters") {
      return jsonResponse(200, {
        levels: ["Pre-A1 Starters", "A1 Movers"],
        schools: [],
      })
    }
    if (pathname === "/api/admin/students" && method === "GET") {
      const q = normalizeText(parsedUrl.searchParams.get("q"))
      const level = normalizeText(parsedUrl.searchParams.get("level"))
      const school = normalizeText(parsedUrl.searchParams.get("school"))
      const take = normalizeText(parsedUrl.searchParams.get("take"))
      studentRequests.push({ q, level, school, take })
      const all = [
        {
          id: "stu-01",
          eaglesId: "SIS-001",
          profile: { fullName: "Starter Student", currentGrade: "Pre-A1 Starters" },
          counts: { attendanceRecords: 0 },
        },
        {
          id: "stu-02",
          eaglesId: "SIS-002",
          profile: { fullName: "Mover Student", currentGrade: "A1 Movers" },
          counts: { attendanceRecords: 0 },
        },
      ]
      if (take === "1000") return jsonResponse(200, { items: all })
      if (level === "A1 Movers") return jsonResponse(200, { items: [all[1]] })
      if (q === "SIS-002") return jsonResponse(200, { items: [all[1]] })
      return jsonResponse(200, { items: all })
    }
    if (pathname === "/api/admin/dashboard") {
      return jsonResponse(200, {
        today: { attendance: 0, absences: 0, tardy10PlusPercent: 0, tardy30PlusPercent: 0 },
        assignments: { total: 0, completedOnTime: 0, completedLate: 0, outstanding: 0, outstandingYtd: 0 },
        weeklyAssignmentCompletion: [],
        atRiskWeek: { total: 0, students: [] },
        classEnrollmentAttendance: [],
        levelCompletion: [],
      })
    }
    if (pathname === "/api/admin/runtime/service-control") return jsonResponse(404, { error: "Not found" })
    if (pathname === "/api/admin/exercise-results/incoming") {
      return jsonResponse(200, { ok: true, total: 0, hasMore: false, statuses: [], items: [] })
    }
    if (pathname === "/api/admin/exercise-titles") return jsonResponse(200, { items: [] })
    return jsonResponse(200, {})
  })

  submitLogin(dom, { username: "admin" })

  await waitFor(() => {
    assert.equal(dom.window.document.getElementById("authPanel").classList.contains("hidden"), true)
    assert.equal(dom.window.document.getElementById("app").classList.contains("hidden"), false)
  })

  const document = dom.window.document
  const levelEl = document.getElementById("filterLevel")
  levelEl.value = "A1 Movers"
  levelEl.dispatchEvent(new dom.window.Event("change", { bubbles: true }))

  await waitFor(() => {
    assert.ok(studentRequests.some((entry) => entry.level === "A1 Movers"))
  })

  await waitFor(() => {
    const options = Array.from(document.querySelectorAll("#searchStudentOptions option"))
    assert.equal(options.length, 1)
    assert.match(options[0].value, /Mover Student/i)
  })

  openPage(dom, "assignments")
  await waitFor(() => {
    const studentOptions = Array.from(document.querySelectorAll("#assignStudent option"))
    const optionText = studentOptions.map((option) => normalizeText(option.textContent || ""))
    assert.equal(optionText.some((text) => /Mover Student/i.test(text)), true)
    assert.equal(optionText.some((text) => /Starter Student/i.test(text)), false)
  })

  const datalistValue = normalizeText(document.querySelector("#searchStudentOptions option")?.value)
  assert.ok(datalistValue)
  const beforeScopedSearch = studentRequests.length
  document.getElementById("searchQ").value = datalistValue
  document.getElementById("searchBtn").click()

  await waitFor(() => {
    const scopedCalls = studentRequests.slice(beforeScopedSearch)
    assert.ok(scopedCalls.some((entry) => entry.q === "SIS-002"))
  })

  await new Promise((resolve) => setTimeout(resolve, 80))
  document.getElementById("logoutBtn").click()
  await waitFor(() => {
    assert.equal(document.getElementById("authPanel").classList.contains("hidden"), false)
  })

  dom.window.close()
})

test("top search option uses englishName and studentNumber when fullName is missing", async () => {
  const studentRequests = []
  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const parsedUrl = new URL(String(resource), "http://127.0.0.1")
    const pathname = parsedUrl.pathname
    const method = normalizeText(init.method || "GET").toUpperCase()

    if (pathname === "/api/admin/auth/me") return jsonResponse(401, { error: "Unauthorized" })
    if (pathname === "/api/admin/auth/login") {
      return jsonResponse(200, {
        user: { username: "admin", role: "admin" },
        rolePolicy: {
          role: "admin",
          canRead: true,
          canWrite: true,
          canManageUsers: true,
          canManagePermissions: true,
          startPage: "overview",
          allowedPages: [
            "overview",
            "student-admin",
            "profile",
            "attendance",
            "attendance-admin",
            "assignments",
            "assignments-data",
            "parent-tracking",
            "performance-data",
            "grades",
            "grades-data",
            "reports",
            "family",
            "users",
            "permissions",
            "settings",
          ],
        },
      })
    }
    if (pathname === "/api/admin/permissions") {
      return jsonResponse(200, {
        roles: {
          admin: {
            role: "admin",
            canRead: true,
            canWrite: true,
            canManageUsers: true,
            canManagePermissions: true,
            startPage: "overview",
            allowedPages: [
              "overview",
              "student-admin",
              "profile",
              "attendance",
              "attendance-admin",
              "assignments",
              "assignments-data",
              "parent-tracking",
              "performance-data",
              "grades",
              "grades-data",
              "reports",
              "family",
              "users",
              "permissions",
              "settings",
            ],
          },
        },
      })
    }
    if (pathname === "/api/admin/users") return jsonResponse(200, { items: [] })
    if (pathname === "/api/admin/filters") return jsonResponse(200, { levels: ["A1 Movers"], schools: [] })
    if (pathname === "/api/admin/students" && method === "GET") {
      studentRequests.push(parsedUrl.search)
      return jsonResponse(200, {
        items: [
          {
            id: "stu-anna",
            eaglesId: "anna002",
            studentNumber: 222,
            profile: {
              fullName: "",
              englishName: "Anna 2",
              currentGrade: "A1 Movers",
            },
            counts: { attendanceRecords: 0 },
          },
        ],
      })
    }
    if (pathname === "/api/admin/dashboard") {
      return jsonResponse(200, {
        today: { attendance: 0, absences: 0, tardy10PlusPercent: 0, tardy30PlusPercent: 0 },
        assignments: { total: 0, completedOnTime: 0, completedLate: 0, outstanding: 0, outstandingYtd: 0 },
        weeklyAssignmentCompletion: [],
        atRiskWeek: { total: 0, students: [] },
        classEnrollmentAttendance: [],
        levelCompletion: [],
      })
    }
    if (pathname === "/api/admin/runtime/service-control") return jsonResponse(404, { error: "Not found" })
    if (pathname === "/api/admin/exercise-results/incoming") {
      return jsonResponse(200, { ok: true, total: 0, hasMore: false, statuses: [], items: [] })
    }
    if (pathname === "/api/admin/exercise-titles") return jsonResponse(200, { items: [] })
    return jsonResponse(200, {})
  })

  submitLogin(dom, { username: "admin" })

  await waitFor(() => {
    const options = Array.from(dom.window.document.querySelectorAll("#searchStudentOptions option"))
    assert.equal(options.length, 1)
    assert.match(normalizeText(options[0].value), /^\(Anna 2\)\s+anna002\s+<222>$/i)
  })

  const optionValue = normalizeText(dom.window.document.querySelector("#searchStudentOptions option")?.value)
  const callsBeforeSearch = studentRequests.length
  dom.window.document.getElementById("searchQ").value = optionValue
  dom.window.document.getElementById("searchBtn").click()

  await waitFor(() => {
    const scopedCalls = studentRequests.slice(callsBeforeSearch)
    assert.ok(scopedCalls.some((entry) => entry.includes("q=anna002")))
  })

  await settleDomAsync(dom)
  dom.window.close()
})

test("student admin child page owns students panel while search stays visible", async () => {
  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const url = String(resource)
    void init

    if (url.includes("/api/admin/auth/me")) return jsonResponse(401, { error: "Unauthorized" })

    if (url.includes("/api/admin/auth/login")) {
      return jsonResponse(200, {
        user: { username: "admin", role: "admin" },
        rolePolicy: {
          role: "admin",
          canRead: true,
          canWrite: true,
          canManageUsers: true,
          canManagePermissions: true,
          startPage: "overview",
          allowedPages: [
            "overview",
            "student-admin",
            "profile",
            "attendance",
            "assignments",
            "grades",
            "reports",
            "family",
            "users",
            "permissions",
            "settings",
          ],
        },
      })
    }

    if (url.includes("/api/admin/permissions")) {
      return jsonResponse(200, {
        roles: {
          admin: {
            role: "admin",
            canRead: true,
            canWrite: true,
            canManageUsers: true,
            canManagePermissions: true,
            startPage: "overview",
            allowedPages: [
              "overview",
              "student-admin",
              "profile",
              "attendance",
              "assignments",
              "grades",
              "reports",
              "family",
              "users",
              "permissions",
              "settings",
            ],
          },
        },
      })
    }

    if (url.includes("/api/admin/users")) return jsonResponse(200, { items: [] })
    if (url.includes("/api/admin/filters")) return jsonResponse(200, { levels: ["Pre-A1 Starters"], schools: [] })
    if (url.includes("/api/admin/students/stu-")) {
      return jsonResponse(200, {
        id: "stu-01",
        eaglesId: "SIS-001",
        profile: { fullName: "Student One", currentGrade: "Pre-A1 Starters" },
        attendanceRecords: [],
        gradeRecords: [],
        parentReports: [],
      })
    }
    if (url.includes("/api/admin/students")) {
      return jsonResponse(200, {
        items: [
          {
            id: "stu-01",
            eaglesId: "SIS-001",
            profile: { fullName: "Student One", currentGrade: "Pre-A1 Starters" },
            counts: { attendanceRecords: 0 },
          },
          {
            id: "stu-02",
            eaglesId: "steve001",
            profile: { fullName: "Steve Tester", currentGrade: "A1 Movers" },
            counts: { attendanceRecords: 0 },
          },
        ],
      })
    }
    if (url.includes("/api/admin/dashboard")) {
      return jsonResponse(200, {
        today: { attendance: 0, absences: 0, tardy10PlusPercent: 0, tardy30PlusPercent: 0 },
        assignments: { total: 0, completedOnTime: 0, completedLate: 0, outstanding: 0, outstandingYtd: 0 },
        weeklyAssignmentCompletion: [],
        atRiskWeek: { total: 0, students: [] },
        classEnrollmentAttendance: [],
        levelCompletion: [],
      })
    }
    if (url.includes("/api/admin/exercise-titles")) return jsonResponse(200, { items: [] })
    return jsonResponse(200, {})
  })

  submitLogin(dom, { username: "admin" })
  await waitFor(() => {
    const text = dom.window.document.getElementById("status").textContent
    assert.match(text, /Authenticated as admin/i)
  })

  await waitFor(() => {
    assert.equal(dom.window.document.getElementById("topControlsPanel").classList.contains("hidden"), true)
    assert.equal(dom.window.document.getElementById("studentListPanel").classList.contains("hidden"), true)
    assert.equal(dom.window.document.getElementById("topSearchResultsPanel").classList.contains("hidden"), false)
    assert.ok(dom.window.document.querySelectorAll("#topSearchRows tr.top-search-row").length >= 1)
  })

  const quickOpenRow = dom.window.document.querySelector("#topSearchRows tr.top-search-row")
  assert.ok(quickOpenRow)
  quickOpenRow.click()
  await waitFor(() => {
    const profilePage = dom.window.document.querySelector('.page-section[data-page="profile"]')
    assert.equal(profilePage?.classList.contains("active"), true)
    assert.match(dom.window.document.getElementById("status").textContent || "", /Student loaded into Profile/i)
  })

  dom.window.document.querySelector('[data-page-link="student-admin"]').click()
  await waitFor(() => {
    assert.equal(dom.window.document.getElementById("topControlsPanel").classList.contains("hidden"), false)
    assert.equal(dom.window.document.getElementById("studentListPanel").classList.contains("hidden"), false)
    assert.equal(dom.window.document.getElementById("topSearchResultsPanel").classList.contains("hidden"), true)
  })

  dom.window.document.getElementById("logoutBtn").click()
  await waitFor(() => {
    assert.equal(dom.window.document.getElementById("authPanel").classList.contains("hidden"), false)
  })
  dom.window.close()
})

test("top search results support show-all expansion and sortable headers", async () => {
  const studentItems = [
    ["stu-01", "EAG-010", "Nina North", "B1 PET"],
    ["stu-02", "EAG-003", "Aaron Able", "Pre-A1 Starters"],
    ["stu-03", "EAG-014", "Chris Crest", "C1+ TAYK"],
    ["stu-04", "EAG-001", "Bella Brook", "A1 Movers"],
    ["stu-05", "EAG-009", "Derek Dawn", "A2 Flyers"],
    ["stu-06", "EAG-004", "Eva East", "A2 KET"],
    ["stu-07", "EAG-013", "Frank Field", "B2+ IELTS"],
    ["stu-08", "EAG-012", "Gina Grove", "Private"],
    ["stu-09", "EAG-008", "Hank Hill", "Eggs & Chicks"],
    ["stu-10", "EAG-006", "Ivy Isle", "A1 Movers"],
    ["stu-11", "EAG-005", "Jules Jet", "A2 KET"],
    ["stu-12", "EAG-011", "Kyle Key", "B1 PET"],
    ["stu-13", "EAG-002", "Lia Lake", "A2 Flyers"],
    ["stu-14", "EAG-007", "Mona March", "B2+ IELTS"],
  ].map(([id, eaglesId, fullName, currentGrade]) => ({
    id,
    eaglesId,
    profile: { fullName, currentGrade },
    counts: { attendanceRecords: 0 },
  }))

  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const parsedUrl = new URL(String(resource), "http://127.0.0.1")
    const pathname = parsedUrl.pathname
    const method = normalizeText(init.method || "GET").toUpperCase()

    if (pathname === "/api/admin/auth/me") return jsonResponse(401, { error: "Unauthorized" })
    if (pathname === "/api/admin/auth/login") {
      return jsonResponse(200, {
        user: { username: "admin", role: "admin" },
        rolePolicy: {
          role: "admin",
          canRead: true,
          canWrite: true,
          canManageUsers: true,
          canManagePermissions: true,
          startPage: "overview",
          allowedPages: [
            "overview",
            "student-admin",
            "profile",
            "attendance",
            "attendance-admin",
            "assignments",
            "assignments-data",
            "parent-tracking",
            "performance-data",
            "grades",
            "grades-data",
            "reports",
            "family",
            "users",
            "permissions",
            "settings",
          ],
        },
      })
    }
    if (pathname === "/api/admin/permissions") {
      return jsonResponse(200, {
        roles: {
          admin: {
            role: "admin",
            canRead: true,
            canWrite: true,
            canManageUsers: true,
            canManagePermissions: true,
            startPage: "overview",
            allowedPages: [
              "overview",
              "student-admin",
              "profile",
              "attendance",
              "attendance-admin",
              "assignments",
              "assignments-data",
              "parent-tracking",
              "performance-data",
              "grades",
              "grades-data",
              "reports",
              "family",
              "users",
              "permissions",
              "settings",
            ],
          },
        },
      })
    }
    if (pathname === "/api/admin/users") return jsonResponse(200, { items: [] })
    if (pathname === "/api/admin/filters") {
      return jsonResponse(200, {
        levels: ["Pre-A1 Starters", "A1 Movers", "A2 Flyers", "A2 KET", "B1 PET", "B2+ IELTS", "C1+ TAYK", "Private"],
        schools: [],
      })
    }
    if (pathname === "/api/admin/students" && method === "GET") {
      return jsonResponse(200, { items: studentItems })
    }
    if (pathname === "/api/admin/dashboard") {
      return jsonResponse(200, {
        today: { attendance: 0, absences: 0, tardy10PlusPercent: 0, tardy30PlusPercent: 0 },
        assignments: { total: 0, completedOnTime: 0, completedLate: 0, outstanding: 0, outstandingYtd: 0 },
        weeklyAssignmentCompletion: [],
        atRiskWeek: { total: 0, students: [] },
        classEnrollmentAttendance: [],
        levelCompletion: [],
      })
    }
    if (pathname === "/api/admin/runtime/service-control") return jsonResponse(404, { error: "Not found" })
    if (pathname === "/api/admin/exercise-results/incoming") {
      return jsonResponse(200, { ok: true, total: 0, hasMore: false, statuses: [], items: [] })
    }
    if (pathname === "/api/admin/exercise-titles") return jsonResponse(200, { items: [] })
    return jsonResponse(200, {})
  })

  submitLogin(dom, { username: "admin" })

  await waitFor(() => {
    assert.equal(dom.window.document.querySelectorAll("#topSearchRows tr.top-search-row").length, 12)
    const countText = normalizeText(dom.window.document.getElementById("topSearchCount").textContent)
    assert.match(countText, /14 results \(showing 12\)/i)
    const expandBtn = dom.window.document.getElementById("topSearchExpandBtn")
    assert.equal(expandBtn.classList.contains("hidden"), false)
    assert.match(expandBtn.textContent || "", /Show All/i)
  })

  const document = dom.window.document
  const expandBtn = document.getElementById("topSearchExpandBtn")
  expandBtn.click()

  await waitFor(() => {
    assert.equal(document.querySelectorAll("#topSearchRows tr.top-search-row").length, 14)
    assert.equal(document.querySelector(".top-search-results-box")?.classList.contains("expanded"), true)
    assert.match(expandBtn.textContent || "", /Show Less/i)
    assert.equal(normalizeText(document.getElementById("topSearchCount").textContent), "14 results")
  })

  const idHeader = document.querySelector('th[data-top-search-sort="eaglesId"]')
  assert.ok(idHeader)
  idHeader.click()
  await waitFor(() => {
    assert.equal(normalizeText(document.querySelector("#topSearchRows tr td")?.textContent), "EAG-001")
    assert.equal(idHeader.getAttribute("aria-sort"), "ascending")
  })
  idHeader.click()
  await waitFor(() => {
    assert.equal(normalizeText(document.querySelector("#topSearchRows tr td")?.textContent), "EAG-014")
    assert.equal(idHeader.getAttribute("aria-sort"), "descending")
  })

  const nameHeader = document.querySelector('th[data-top-search-sort="name"]')
  assert.ok(nameHeader)
  nameHeader.click()
  await waitFor(() => {
    assert.equal(normalizeText(document.querySelector("#topSearchRows tr td:nth-child(2)")?.textContent), "Aaron Able")
    assert.equal(nameHeader.getAttribute("aria-sort"), "ascending")
  })

  const levelHeader = document.querySelector('th[data-top-search-sort="level"]')
  assert.ok(levelHeader)
  levelHeader.click()
  await waitFor(() => {
    const firstLevelText = normalizeText(document.querySelector("#topSearchRows tr td:nth-child(3)")?.textContent)
    assert.match(firstLevelText, /EggChic|Starters/i)
    assert.equal(levelHeader.getAttribute("aria-sort"), "ascending")
  })

  dom.window.close()
})

test("static preview path over http allows login without apiOrigin", async () => {
  const calls = []
  let healthzInit = null
  const dom = await createAdminUiDom(
    async (resource, init = {}) => {
      const url = String(resource)
      const method = init.method || "GET"
      calls.push(`${method} ${url}`)

      if (url.includes("/healthz")) {
        healthzInit = init
        return jsonResponse(200, {
          status: "ok",
          lastVerifyOk: true,
          studentAdminRuntime: {
            pagePath: "/admin/students",
            apiPrefix: "/api/admin",
            sessionDriver: "redis",
            sessionTtlSeconds: 28800,
            filterCache: {
              backend: "redis",
              hits: 7,
              misses: 2,
              lastError: "",
            },
          },
          runtimeSelfHeal: {
            enabled: true,
            lastResult: "in-sync",
            syncCount: 3,
          },
        })
      }

      if (url.includes("/api/admin/auth/me")) {
        return jsonResponse(401, { error: "Unauthorized" })
      }

      if (url.includes("/api/admin/auth/login")) {
        return jsonResponse(200, {
          user: { username: "admin", role: "admin" },
          rolePolicy: {
            role: "admin",
            canRead: true,
            canWrite: true,
            canManageUsers: true,
            canManagePermissions: true,
            startPage: "overview",
            allowedPages: ["overview", "profile", "attendance", "grades", "reports", "family", "users", "permissions"],
          },
        })
      }

      if (url.includes("/api/admin/permissions")) {
        return jsonResponse(200, {
          roles: {
            admin: {
              role: "admin",
              canRead: true,
              canWrite: true,
              canManageUsers: true,
              canManagePermissions: true,
              startPage: "overview",
              allowedPages: ["overview", "profile", "attendance", "grades", "reports", "family", "users", "permissions"],
            },
          },
        })
      }

      if (url.includes("/api/admin/users")) {
        return jsonResponse(200, { items: [] })
      }

      if (url.includes("/api/admin/filters")) {
        return jsonResponse(200, { levels: [], schools: [] })
      }

      if (url.includes("/api/admin/students")) {
        return jsonResponse(200, { items: [] })
      }

      return jsonResponse(200, {})
    },
    "http://127.0.0.1:46145/web-asset/admin/student-admin.html"
  )

  const document = dom.window.document
  assert.doesNotMatch(document.getElementById("status").textContent, /Static preview mode requires \?apiOrigin=/i)
  await waitFor(() => {
    assert.ok(healthzInit)
    assert.equal(healthzInit.credentials, "omit")
  })
  const menuToggle = document.getElementById("menuToggleBtn")
  assert.ok(menuToggle)
  menuToggle.click()
  assert.equal(document.body.classList.contains("menu-open"), true)
  menuToggle.click()
  assert.equal(document.body.classList.contains("menu-open"), false)
  await waitFor(() => {
    const hub = document.querySelector('[data-system-key="hub"]')
    const sessionStore = document.querySelector('[data-system-key="sessionStore"]')
    const selfHeal = document.querySelector('[data-system-key="selfHeal"]')
    assert.ok(hub?.classList.contains("ok"))
    assert.ok(sessionStore?.classList.contains("ok"))
    assert.ok(selfHeal?.classList.contains("ok"))
    assert.match(document.getElementById("systemHealthSummary").textContent, /OK/i)
  })

  submitLogin(dom)

  await waitFor(() => {
    assert.ok(calls.some((entry) => entry === "POST http://127.0.0.1:8787/api/admin/auth/login"))
  })

  await waitFor(() => {
    assert.equal(document.getElementById("authPanel").classList.contains("hidden"), true)
    assert.equal(document.getElementById("app").classList.contains("hidden"), false)
  })

  dom.window.close()
})

test("floating menu toggle opens and closes slide-over navigation", async () => {
  const dom = await createAdminUiDom(
    async (resource) => {
      const url = String(resource)
      if (url.includes("/api/admin/auth/me")) return jsonResponse(401, { error: "Unauthorized" })
      if (url.includes("/healthz")) return jsonResponse(200, { status: "ok", lastVerifyOk: true })
      return jsonResponse(200, {})
    },
    "http://127.0.0.1/admin/students",
    {
      beforeParse(window) {
        Object.defineProperty(window, "innerWidth", { value: 1366, configurable: true, writable: true })
      },
    }
  )

  const document = dom.window.document
  const menuToggle = document.getElementById("menuToggleBtn")
  const floatingMenuBtn = document.getElementById("floatingMenuBtn")
  const menuBackdrop = document.getElementById("menuBackdrop")
  assert.ok(menuToggle)
  assert.ok(floatingMenuBtn)
  assert.ok(menuBackdrop)
  assert.equal(menuToggle.textContent?.trim(), "Menu")
  assert.equal(floatingMenuBtn.getAttribute("aria-expanded"), "false")
  assert.equal(document.body.classList.contains("menu-open"), false)
  assert.equal(document.body.classList.contains("menu-collapsed"), false)

  floatingMenuBtn.click()
  assert.equal(document.body.classList.contains("menu-open"), true)
  assert.equal(menuToggle.textContent?.trim(), "Close Menu")
  assert.equal(floatingMenuBtn.getAttribute("aria-expanded"), "true")

  menuBackdrop.click()
  assert.equal(document.body.classList.contains("menu-open"), false)
  assert.equal(menuToggle.textContent?.trim(), "Menu")
  assert.equal(floatingMenuBtn.getAttribute("aria-expanded"), "false")

  menuToggle.click()
  assert.equal(document.body.classList.contains("menu-open"), true)
  assert.equal(floatingMenuBtn.getAttribute("aria-expanded"), "true")

  menuToggle.click()
  assert.equal(document.body.classList.contains("menu-open"), false)
  assert.equal(menuToggle.textContent?.trim(), "Menu")
  assert.equal(floatingMenuBtn.getAttribute("aria-expanded"), "false")

  dom.window.close()
})

test("hosted sis-admin path probes auth endpoint instead of healthz", async () => {
  let healthzCalls = 0
  let authMeCalls = 0
  let authMeInit = null

  const dom = await createAdminUiDom(
    async (resource, init = {}) => {
      const url = String(resource)

      if (url.includes("/healthz")) {
        healthzCalls += 1
        return jsonResponse(403, { error: "Forbidden" })
      }

      if (url.includes("/api/sis-admin/auth/me")) {
        authMeCalls += 1
        authMeInit = init
        return jsonResponse(401, { error: "Unauthorized" })
      }

      return jsonResponse(200, {})
    },
    "https://admin.eagles.edu.vn/sis-admin/student-admin.html"
  )

  await waitFor(() => {
    assert.ok(authMeCalls >= 1)
    assert.ok(authMeInit)
    assert.equal(authMeInit.credentials, "include")
  })
  assert.equal(healthzCalls, 0)

  await waitFor(() => {
    assert.match(dom.window.document.getElementById("hubStatusMeta").textContent, /auth endpoint/i)
  })

  dom.window.close()
})

test("hosted sis-admin path hydrates runtime diagnostics from admin runtime health endpoint", async () => {
  const calls = []
  const adminRolePolicy = {
    role: "admin",
    canRead: true,
    canWrite: true,
    canManageUsers: true,
    canManagePermissions: true,
    startPage: "overview",
    allowedPages: [
      "overview",
      "profile",
      "attendance",
      "attendance-admin",
      "assignments",
      "assignments-data",
      "parent-tracking",
      "performance-data",
      "grades",
      "grades-data",
      "reports",
      "family",
      "student-admin",
      "users",
      "permissions",
      "settings",
    ],
  }
  const dom = await createAdminUiDom(
    async (resource, init = {}) => {
      const url = String(resource)
      const method = init.method || "GET"
      calls.push(`${method} ${url}`)

      if (url.includes("/healthz")) {
        return jsonResponse(403, { error: "Forbidden" })
      }

      if (url.includes("/api/sis-admin/auth/me")) {
        return jsonResponse(200, {
          authenticated: true,
          user: { username: "admin", role: "admin" },
          rolePolicy: adminRolePolicy,
        })
      }

      if (url.includes("/api/sis-admin/runtime/health")) {
        return jsonResponse(200, {
          status: "ok",
          lastVerifyOk: true,
          lastVerifyAt: "2026-03-01T13:00:00.000Z",
          lastStoreOk: true,
          lastIntakeStoreOk: true,
          lastSendOk: true,
          studentAdminRuntime: {
            pagePath: "/admin/students",
            apiPrefix: "/api/sis-admin",
            sessionDriver: "redis",
            sessionTtlSeconds: 28800,
            filterCache: {
              backend: "redis",
              hits: 11,
              misses: 2,
              lastError: "",
            },
          },
          runtimeSelfHeal: {
            enabled: true,
            lastResult: "in-sync",
            syncCount: 4,
          },
        })
      }

      if (url.includes("/api/sis-admin/permissions")) {
        return jsonResponse(200, {
          role: "admin",
          roles: { admin: adminRolePolicy },
        })
      }

      if (url.includes("/api/sis-admin/users")) {
        return jsonResponse(200, { items: [] })
      }

      if (url.includes("/api/sis-admin/filters")) {
        return jsonResponse(200, { levels: [], schools: [] })
      }

      if (url.includes("/api/sis-admin/students")) {
        return jsonResponse(200, { items: [] })
      }

      if (url.includes("/api/sis-admin/dashboard")) {
        return jsonResponse(200, {
          today: { attendance: 0, absences: 0, tardy10PlusPercent: 0, tardy30PlusPercent: 0 },
          assignments: { total: 0, completedOnTime: 0, completedLate: 0, outstanding: 0, outstandingYtd: 0 },
          weeklyAssignmentCompletion: [],
          atRiskWeek: { total: 0, students: [] },
          classEnrollmentAttendance: [],
          levelCompletion: [],
        })
      }

      if (url.includes("/api/sis-admin/runtime/service-control")) {
        return jsonResponse(200, {
          ok: true,
          enabled: true,
          available: true,
          service: "exercise-mailer.service",
          status: "active",
          detail: "active",
          checkedAt: "2026-03-01T13:00:00.000Z",
        })
      }

      if (url.includes("/api/sis-admin/exercise-results/incoming")) {
        return jsonResponse(200, {
          total: 0,
          hasMore: false,
          statuses: [],
          items: [],
        })
      }

      if (url.includes("/api/sis-admin/exercise-titles")) {
        return jsonResponse(200, { items: [] })
      }

      if (url.includes("/api/sis-admin/notifications/batch-status")) {
        return jsonResponse(200, { ok: true, queueType: "parent-report", total: 0, hasMore: false, items: [] })
      }

      return jsonResponse(200, {})
    },
    "https://admin.eagles.edu.vn/sis-admin/student-admin.html"
  )

  await waitFor(() => {
    assert.equal(dom.window.document.getElementById("authPanel").classList.contains("hidden"), true)
    assert.equal(dom.window.document.getElementById("app").classList.contains("hidden"), false)
  })

  await waitFor(() => {
    const adminRuntime = dom.window.document.querySelector('[data-system-key="adminRuntime"]')
    const sessionStore = dom.window.document.querySelector('[data-system-key="sessionStore"]')
    const filterCache = dom.window.document.querySelector('[data-system-key="filterCache"]')
    const selfHeal = dom.window.document.querySelector('[data-system-key="selfHeal"]')
    assert.ok(adminRuntime?.classList.contains("ok"))
    assert.ok(sessionStore?.classList.contains("ok"))
    assert.ok(filterCache?.classList.contains("ok"))
    assert.ok(selfHeal?.classList.contains("ok"))
    assert.match(adminRuntime?.textContent || "", /page=\/admin\/students/i)
    assert.match(sessionStore?.textContent || "", /driver=redis/i)
    assert.match(filterCache?.textContent || "", /backend=redis/i)
    assert.match(selfHeal?.textContent || "", /result=in-sync/i)
  })

  assert.ok(calls.some((entry) => entry.includes("/api/sis-admin/runtime/health")))

  dom.window.close()
})

test("admin ui login tolerates missing dashboard/exercise-title endpoints on older runtime", async () => {
  const calls = []
  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const url = String(resource)
    const method = init.method || "GET"
    calls.push(`${method} ${url}`)

    if (url.includes("/api/admin/auth/me")) {
      return jsonResponse(401, { error: "Unauthorized" })
    }

    if (url.includes("/api/admin/auth/login")) {
      return jsonResponse(200, {
        user: { username: "admin", role: "admin" },
        rolePolicy: {
          role: "admin",
          canRead: true,
          canWrite: true,
          canManageUsers: true,
          canManagePermissions: true,
          startPage: "overview",
          allowedPages: ["overview", "profile", "attendance", "assignments", "grades", "reports", "family", "users", "permissions", "settings"],
        },
      })
    }

    if (url.includes("/api/admin/permissions")) {
      return jsonResponse(200, {
        roles: {
          admin: {
            role: "admin",
            canRead: true,
            canWrite: true,
            canManageUsers: true,
            canManagePermissions: true,
            startPage: "overview",
            allowedPages: ["overview", "profile", "attendance", "assignments", "grades", "reports", "family", "users", "permissions", "settings"],
          },
        },
      })
    }

    if (url.includes("/api/admin/users")) {
      return jsonResponse(200, { items: [] })
    }

    if (url.includes("/api/admin/filters")) {
      return jsonResponse(200, { levels: [], schools: [] })
    }

    if (url.includes("/api/admin/students")) {
      return jsonResponse(200, { items: [] })
    }

    if (url.includes("/api/admin/dashboard")) {
      return jsonResponse(404, { error: "Admin endpoint not found" })
    }

    if (url.includes("/api/admin/exercise-titles")) {
      return jsonResponse(404, { error: "Admin endpoint not found" })
    }

    if (url.includes("/api/admin/notifications/batch-status")) {
      return jsonResponse(404, { error: "Admin endpoint not found" })
    }

    return jsonResponse(200, {})
  })

  submitLogin(dom)

  await waitFor(() => {
    const document = dom.window.document
    assert.equal(document.getElementById("authPanel").classList.contains("hidden"), true)
    assert.equal(document.getElementById("app").classList.contains("hidden"), false)
  })

  await waitFor(() => {
    const text = dom.window.document.getElementById("status").textContent
    assert.match(text, /Authenticated as admin/i)
  })
  assert.equal(
    calls.some((entry) => entry.includes("/api/admin/notifications/batch-status")),
    false
  )

  dom.window.close()
})

test("assignments page uses level tiles, itemized exercise links, and completion recording", async () => {
  const emailPayloads = []
  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const url = String(resource)
    const method = init.method || "GET"

    if (url.includes("/api/admin/auth/me")) return jsonResponse(401, { error: "Unauthorized" })

    if (url.includes("/api/admin/auth/login")) {
      return jsonResponse(200, {
        user: { username: "admin", role: "admin" },
        rolePolicy: {
          role: "admin",
          canRead: true,
          canWrite: true,
          canManageUsers: true,
          canManagePermissions: true,
          startPage: "overview",
          allowedPages: ["overview", "profile", "attendance", "assignments", "grades", "reports", "family", "users", "permissions", "settings"],
        },
      })
    }

    if (url.includes("/api/admin/permissions")) {
      return jsonResponse(200, {
        roles: {
          admin: {
            role: "admin",
            canRead: true,
            canWrite: true,
            canManageUsers: true,
            canManagePermissions: true,
            startPage: "overview",
            allowedPages: ["overview", "profile", "attendance", "assignments", "grades", "reports", "family", "users", "permissions", "settings"],
          },
        },
      })
    }

    if (url.includes("/api/admin/users")) return jsonResponse(200, { items: [] })
    if (url.includes("/api/admin/filters")) return jsonResponse(200, { levels: ["Pre-A1 Starters", "A1 Movers"], schools: [] })
    if (url.includes("/api/admin/students")) {
      return jsonResponse(200, {
        items: [
          {
            id: "stu-01",
            eaglesId: "SIS-001",
            email: "starter@example.com",
            profile: {
              fullName: "Starter Student",
              currentGrade: "Pre-A1 Starters",
              studentEmail: "starter@example.com",
            },
            counts: { attendanceRecords: 0 },
          },
          {
            id: "stu-02",
            eaglesId: "SIS-002",
            email: "mover@example.com",
            profile: {
              fullName: "Mover Student",
              currentGrade: "A1 Movers",
              studentEmail: "mover@example.com",
            },
            counts: { attendanceRecords: 0 },
          },
        ],
      })
    }
    if (url.includes("/api/admin/dashboard")) {
      return jsonResponse(200, {
        today: { attendance: 0, absences: 0, tardy10PlusPercent: 0, tardy30PlusPercent: 0 },
        assignments: { total: 0, completedOnTime: 0, completedLate: 0, outstanding: 0, outstandingYtd: 0 },
        weeklyAssignmentCompletion: [],
        atRiskWeek: { total: 0, students: [] },
        classEnrollmentAttendance: [],
        levelCompletion: [],
      })
    }
    if (url.includes("/api/admin/exercise-titles")) {
      return jsonResponse(200, {
        items: [
          { title: "Starter Listening 01", url: "https://megs.example/hw/starter-listening-01" },
          { title: "Starter Reading 01", url: "https://megs.example/hw/starter-reading-01" },
        ],
      })
    }
    if (method === "POST" && url.includes("/api/admin/notifications/email")) {
      const payload = typeof init.body === "string" ? JSON.parse(init.body || "{}") : init.body || {}
      emailPayloads.push(payload)
      return jsonResponse(200, { sent: Array.isArray(payload.recipients) ? payload.recipients.length : 0 })
    }
    return jsonResponse(200, {})
  })

  submitLogin(dom)

  await waitFor(() => {
    assert.equal(dom.window.document.getElementById("authPanel").classList.contains("hidden"), true)
    assert.equal(dom.window.document.getElementById("app").classList.contains("hidden"), false)
  })

  const document = dom.window.document
  document.querySelector('[data-page-link="assignments"]').click()

  await waitFor(() => {
    assert.ok(document.querySelectorAll("#assignmentLevelTiles button").length >= 2)
    assert.ok(document.querySelector("#assignmentExerciseSelect option[value='Starter Listening 01']"))
  })

  const startersTile = Array.from(document.querySelectorAll("#assignmentLevelTiles button")).find((button) =>
    /Pre-A1 Starters/i.test(button.textContent || "")
  )
  assert.ok(startersTile)
  startersTile.click()

  const todayIso = localIsoDate(new Date())
  const dueIso = nextSundayIsoDate(new Date())
  await waitFor(() => {
    assert.equal(document.getElementById("assignLevel").value, "Pre-A1 Starters")
    assert.equal(document.getElementById("assignAssignedAt").value, todayIso)
    assert.equal(document.getElementById("assignDueAt").value, dueIso)
  })

  document.getElementById("assignTitle").value = "Week 8 Starter Pack"
  document.getElementById("assignmentExerciseSelect").value = "Starter Listening 01"
  document.getElementById("assignmentExerciseSelect").dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  assert.equal(document.getElementById("assignmentExerciseUrl").value, "https://megs.example/hw/starter-listening-01")
  document.getElementById("assignmentAddItemBtn").click()

  await waitFor(() => {
    const text = document.getElementById("assignmentItemRows").textContent || ""
    assert.match(text, /Starter Listening 01/i)
  })

  document.getElementById("assignmentSaveTemplateBtn").click()
  await waitFor(() => {
    const rowText = document.getElementById("assignmentTemplateRows").textContent || ""
    assert.match(rowText, /Week 8 Starter Pack/i)
    assert.match(rowText, /0\/1 done/i)
  })

  const draftDoneCheckbox = document.querySelector("#assignmentItemRows input[type='checkbox']")
  assert.ok(draftDoneCheckbox)
  draftDoneCheckbox.checked = true
  draftDoneCheckbox.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  document.getElementById("assignmentSaveTemplateBtn").click()

  await waitFor(() => {
    const rowText = document.getElementById("assignmentTemplateRows").textContent || ""
    assert.match(rowText, /Completed/i)
    const link = document.querySelector("#assignmentTemplateRows a.assignment-item-link")
    assert.ok(link)
    assert.equal(link.getAttribute("href"), "https://megs.example/hw/starter-listening-01")
  })

  document.getElementById("assignmentSendBtn").click()
  await waitFor(() => {
    assert.equal(emailPayloads.length, 1)
    assert.match(emailPayloads[0].message || "", /Starter Listening 01/i)
    assert.match(emailPayloads[0].message || "", /https:\/\/megs\.example\/hw\/starter-listening-01/i)
    assert.ok(Array.isArray(emailPayloads[0].recipients))
    assert.ok(emailPayloads[0].recipients.includes("starter@example.com"))
  })
  await waitFor(() => {
    assert.match(document.getElementById("status").textContent || "", /Assignment notification sent/i)
  })

  document.getElementById("logoutBtn").click()
  await waitFor(() => {
    assert.equal(document.getElementById("authPanel").classList.contains("hidden"), false)
  })

  dom.window.close()
})

test("parent tracking page auto-fills metrics, reuses lesson summary, and queues weekend batch email", async () => {
  const queuedEmailPayloads = []
  const savedReportPayloads = []

  const detailById = {
    "stu-01": {
      id: "stu-01",
      eaglesId: "SIS-001",
      email: "starter@example.com",
      profile: {
        fullName: "Starter Student",
        currentGrade: "Pre-A1 Starters",
        studentEmail: "starter@example.com",
        motherEmail: "mom@example.com",
        fatherEmail: "dad@example.com",
      },
      attendanceRecords: [],
      gradeRecords: [
        {
          id: "gr-01",
          className: "Pre-A1 Starters",
          level: "Pre-A1 Starters",
          schoolYear: "2026-2027",
          quarter: "q1",
          assignmentName: "Homework Past Due",
          dueAt: "2026-09-01",
          submittedAt: "",
          homeworkCompleted: false,
          homeworkOnTime: false,
          score: 6,
          maxScore: 10,
          behaviorScore: 6,
          participationScore: 5,
          inClassScore: 6,
          comments: "Needs follow-up",
        },
        {
          id: "gr-02",
          className: "Pre-A1 Starters",
          level: "Pre-A1 Starters",
          schoolYear: "2026-2027",
          quarter: "q1",
          assignmentName: "Homework Completed",
          dueAt: "2026-08-30",
          submittedAt: "2026-08-29",
          homeworkCompleted: true,
          homeworkOnTime: true,
          score: 9,
          maxScore: 10,
          behaviorScore: 8,
          participationScore: 9,
          inClassScore: 8,
          comments: "Good work",
        },
      ],
      parentReports: [],
    },
    "stu-02": {
      id: "stu-02",
      eaglesId: "SIS-002",
      email: "mover@example.com",
      profile: {
        fullName: "Mover Student",
        currentGrade: "Pre-A1 Starters",
        studentEmail: "mover@example.com",
      },
      attendanceRecords: [],
      gradeRecords: [],
      parentReports: [],
    },
  }

  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const url = String(resource)
    const method = init.method || "GET"

    if (url.includes("/api/admin/auth/me")) return jsonResponse(401, { error: "Unauthorized" })
    if (url.includes("/api/admin/auth/login")) {
      return jsonResponse(200, {
        user: { username: "admin", role: "admin" },
        rolePolicy: {
          role: "admin",
          canRead: true,
          canWrite: true,
          canManageUsers: true,
          canManagePermissions: true,
          startPage: "overview",
          allowedPages: [
            "overview",
            "profile",
            "attendance",
            "attendance-admin",
            "assignments",
            "parent-tracking",
            "grades",
            "reports",
            "family",
            "users",
            "permissions",
            "settings",
          ],
        },
      })
    }
    if (url.includes("/api/admin/permissions")) {
      return jsonResponse(200, {
        roles: {
          admin: {
            role: "admin",
            canRead: true,
            canWrite: true,
            canManageUsers: true,
            canManagePermissions: true,
            startPage: "overview",
            allowedPages: [
              "overview",
              "profile",
              "attendance",
              "attendance-admin",
              "assignments",
              "parent-tracking",
              "grades",
              "reports",
              "family",
              "users",
              "permissions",
              "settings",
            ],
          },
        },
      })
    }
    if (url.includes("/api/admin/users")) return jsonResponse(200, { items: [] })
    if (url.includes("/api/admin/filters")) return jsonResponse(200, { levels: ["Pre-A1 Starters"], schools: [] })
    if (url.includes("/api/admin/students?")) {
      return jsonResponse(200, {
        items: [
          {
            id: "stu-01",
            eaglesId: "SIS-001",
            email: "starter@example.com",
            profile: { fullName: "Starter Student", currentGrade: "Pre-A1 Starters", studentEmail: "starter@example.com" },
          },
          {
            id: "stu-02",
            eaglesId: "SIS-002",
            email: "mover@example.com",
            profile: { fullName: "Mover Student", currentGrade: "Pre-A1 Starters", studentEmail: "mover@example.com" },
          },
        ],
      })
    }
    if (method === "POST" && url.includes("/api/admin/students/") && url.includes("/reports")) {
      const payload = typeof init.body === "string" ? JSON.parse(init.body || "{}") : init.body || {}
      savedReportPayloads.push(payload)
      const studentRefId = url.includes("/stu-02/") ? "stu-02" : "stu-01"
      return jsonResponse(200, { report: { id: `rep-${savedReportPayloads.length}` }, student: detailById[studentRefId] })
    }
    if (url.includes("/api/admin/students/stu-01")) return jsonResponse(200, detailById["stu-01"])
    if (url.includes("/api/admin/students/stu-02")) return jsonResponse(200, detailById["stu-02"])
    if (method === "POST" && url.includes("/api/admin/notifications/email")) {
      const payload = typeof init.body === "string" ? JSON.parse(init.body || "{}") : init.body || {}
      queuedEmailPayloads.push(payload)
      return jsonResponse(200, {
        ok: true,
        queued: true,
        deliveryMode: "weekend-batch",
        scheduledFor: "2026-09-05T12:00:00.000Z",
      })
    }
    if (url.includes("/api/admin/dashboard")) {
      return jsonResponse(200, {
        today: { attendance: 0, absences: 0, tardy10PlusPercent: 0, tardy30PlusPercent: 0 },
        assignments: { total: 0, completedOnTime: 0, completedLate: 0, outstanding: 0, outstandingYtd: 0 },
        weeklyAssignmentCompletion: [],
        atRiskWeek: { total: 0, students: [] },
        classEnrollmentAttendance: [],
        levelCompletion: [],
      })
    }
    if (url.includes("/api/admin/exercise-titles")) return jsonResponse(200, { items: [] })
    return jsonResponse(200, {})
  })

  submitLogin(dom)
  await waitFor(() => {
    assert.equal(dom.window.document.getElementById("authPanel").classList.contains("hidden"), true)
    assert.equal(dom.window.document.getElementById("app").classList.contains("hidden"), false)
  })

  const document = dom.window.document
  openPage(dom, "parent-tracking")

  await waitFor(() => {
    const levelTiles = document.querySelectorAll("#parentTrackingLevelTiles button")
    assert.ok(levelTiles.length >= 1)
    const studentSelect = document.getElementById("pt_studentRefId")
    assert.ok(studentSelect)
    assert.ok(studentSelect.querySelector('option[value="stu-01"]'))
  })

  const skillsCard = Array.from(document.querySelectorAll(".progress-report-card h4")).find((entry) =>
    /Basic Student Skills/i.test(entry.textContent || "")
  )?.closest(".progress-report-card")
  const conductCard = Array.from(document.querySelectorAll(".progress-report-card h4")).find((entry) =>
    /Conduct During Class/i.test(entry.textContent || "")
  )?.closest(".progress-report-card")
  const homeworkCard = Array.from(document.querySelectorAll(".progress-report-card h4")).find((entry) =>
    /Homework Completion/i.test(entry.textContent || "")
  )?.closest(".progress-report-card")
  assert.ok(skillsCard)
  assert.ok(conductCard)
  assert.ok(homeworkCard)
  assert.equal(homeworkCard.classList.contains("progress-report-span-2"), true)
  assert.notEqual(skillsCard.compareDocumentPosition(homeworkCard) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, 0)
  assert.notEqual(conductCard.compareDocumentPosition(homeworkCard) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, 0)

  const recField = document.querySelector('textarea[name="pt_rec_listening"]')
  assert.ok(recField)
  recField.focus()
  const shorthandSelect = document.getElementById("pt_actionShorthand")
  assert.ok(shorthandSelect)
  shorthandSelect.selectedIndex = 1
  document.getElementById("pt_actionAddition").value = "Parent confirms completion by nightly signature."
  document.getElementById("pt_actionInsertBtn").click()
  await waitFor(() => {
    const normalized = normalizeText(recField.value)
    assert.match(normalized, /Observed:/i)
    assert.match(normalized, /Parent confirms completion by nightly signature/i)
  })
  assert.match(document.getElementById("pt_actionHelperStatus").textContent || "", /Inserted shorthand/i)

  const selectedDate = "2026-09-15"
  document.getElementById("pt_classDate").value = selectedDate
  document.getElementById("pt_classDate").dispatchEvent(new dom.window.Event("change", { bubbles: true }))

  document.getElementById("pt_lessonSummary").value = "Reviewed Unit 3 grammar and reading strategy."
  document.getElementById("pt_lessonSummary").dispatchEvent(new dom.window.Event("input", { bubbles: true }))

  document.getElementById("pt_studentRefId").value = "stu-01"
  document.getElementById("pt_studentRefId").dispatchEvent(new dom.window.Event("change", { bubbles: true }))

  await waitFor(() => {
    const recipients = document.getElementById("pt_recipients").value
    assert.match(recipients, /starter@example\.com/i)
    assert.match(recipients, /mom@example\.com/i)
    assert.match(document.getElementById("pt_outstandingRows").textContent || "", /Homework Past Due/i)
    const hwCompletion = Number.parseFloat(document.getElementById("pt_homeworkCompletionRate").value || "0")
    assert.ok(hwCompletion > 0)
  })

  document.getElementById("pt_studentRefId").value = "stu-02"
  document.getElementById("pt_studentRefId").dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  await waitFor(() => {
    assert.equal(
      document.getElementById("pt_lessonSummary").value,
      "Reviewed Unit 3 grammar and reading strategy."
    )
  })

  document.getElementById("pt_studentRefId").value = "stu-01"
  document.getElementById("pt_studentRefId").dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  document.getElementById("pt_queueSendBtn").click()

  await waitFor(() => {
    assert.equal(savedReportPayloads.length >= 1, true)
    assert.equal(queuedEmailPayloads.length, 1)
    assert.equal(queuedEmailPayloads[0].deliveryMode, "weekend-batch")
    assert.ok(Array.isArray(queuedEmailPayloads[0].recipients))
    assert.ok(queuedEmailPayloads[0].recipients.includes("starter@example.com"))
    assert.ok(queuedEmailPayloads[0].recipients.includes("mom@example.com"))
    assert.match(queuedEmailPayloads[0].message || "", /Homework Past Due/i)
  })

  await waitFor(() => {
    const statusText = document.getElementById("pt_status").textContent || ""
    assert.match(statusText, /Queued for weekend batch/i)
  })

  dom.window.close()
})

test("overview queued parent reports list opens modal and supports hold/edit/requeue/send-all actions", async () => {
  const batchActions = []
  let queueItems = [
    {
      id: "queue-01",
      queueType: "parent-report",
      status: "queued",
      assignmentTitle: "Starter Student class report",
      exerciseTitle: "Pre-A1 Starters",
      level: "Pre-A1 Starters",
      dueAt: "2026-09-15",
      message: "Initial queued message",
      recipients: ["starter@example.com", "mom@example.com"],
      queuedByUsername: "teacher_01",
      queuedAt: "2026-09-14T11:00:00.000Z",
      scheduledFor: "2026-09-14T12:00:00.000Z",
      attempts: 0,
      lastError: "",
    },
  ]

  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const url = String(resource)
    const method = init.method || "GET"

    if (url.includes("/api/admin/auth/me")) return jsonResponse(401, { error: "Unauthorized" })
    if (url.includes("/api/admin/auth/login")) {
      return jsonResponse(200, {
        user: { username: "admin", role: "admin" },
        rolePolicy: {
          role: "admin",
          canRead: true,
          canWrite: true,
          canManageUsers: true,
          canManagePermissions: true,
          startPage: "overview",
          allowedPages: [
            "overview",
            "profile",
            "attendance",
            "attendance-admin",
            "assignments",
            "parent-tracking",
            "grades",
            "reports",
            "family",
            "users",
            "permissions",
            "settings",
          ],
        },
      })
    }
    if (url.includes("/api/admin/permissions")) {
      return jsonResponse(200, {
        roles: {
          admin: {
            role: "admin",
            canRead: true,
            canWrite: true,
            canManageUsers: true,
            canManagePermissions: true,
            startPage: "overview",
            allowedPages: [
              "overview",
              "profile",
              "attendance",
              "attendance-admin",
              "assignments",
              "parent-tracking",
              "grades",
              "reports",
              "family",
              "users",
              "permissions",
              "settings",
            ],
          },
        },
      })
    }
    if (url.includes("/api/admin/users")) return jsonResponse(200, { items: [] })
    if (url.includes("/api/admin/filters")) return jsonResponse(200, { levels: ["Pre-A1 Starters"], schools: [] })
    if (url.includes("/api/admin/students")) return jsonResponse(200, { items: [] })
    if (url.includes("/api/admin/exercise-titles")) return jsonResponse(200, { items: [] })
    if (url.includes("/api/admin/dashboard")) {
      return jsonResponse(200, {
        today: { attendance: 0, absences: 0, tardy10PlusPercent: 0, tardy30PlusPercent: 0 },
        assignments: { total: 0, completedOnTime: 0, completedLate: 0, outstanding: 0, outstandingYtd: 0 },
        weeklyAssignmentCompletion: [],
        atRiskWeek: { total: 0, students: [] },
        classEnrollmentAttendance: [],
        levelCompletion: [],
        parentReportQueue: {
          total: queueItems.length,
          hasMore: false,
          items: queueItems,
        },
      })
    }

    if (method === "GET" && url.includes("/api/admin/notifications/batch-status")) {
      return jsonResponse(200, {
        ok: true,
        queueType: "parent-report",
        queueSize: queueItems.length,
        total: queueItems.length,
        hasMore: false,
        items: queueItems,
      })
    }

    if (method === "POST" && url.includes("/api/admin/notifications/batch-status")) {
      const payload = typeof init.body === "string" ? JSON.parse(init.body || "{}") : init.body || {}
      batchActions.push(payload)

      if (payload.action === "hold" && payload.queueId === "queue-01") {
        queueItems = [{ ...queueItems[0], status: "hold" }]
        return jsonResponse(200, { ok: true, action: "hold", item: queueItems[0] })
      }
      if (payload.action === "edit" && payload.queueId === "queue-01") {
        queueItems = [
          {
            ...queueItems[0],
            assignmentTitle: payload.assignmentTitle || queueItems[0].assignmentTitle,
            message: payload.message || queueItems[0].message,
            recipients: Array.isArray(payload.recipients) ? payload.recipients : queueItems[0].recipients,
            status: "queued",
          },
        ]
        return jsonResponse(200, { ok: true, action: "edit", item: queueItems[0] })
      }
      if (payload.action === "requeue" && payload.queueId === "queue-01") {
        queueItems = [{ ...queueItems[0], status: "queued", scheduledFor: "2026-09-20T12:00:00.000Z" }]
        return jsonResponse(200, { ok: true, action: "requeue", item: queueItems[0] })
      }
      if (payload.action === "sendAll") {
        return jsonResponse(200, { ok: true, processed: queueItems.length, sent: queueItems.length, failed: 0 })
      }
      return jsonResponse(400, { error: "Unexpected action" })
    }

    return jsonResponse(200, {})
  })

  submitLogin(dom)
  await waitFor(() => {
    assert.equal(dom.window.document.getElementById("authPanel").classList.contains("hidden"), true)
    assert.equal(dom.window.document.getElementById("app").classList.contains("hidden"), false)
  })

  const document = dom.window.document
  await waitFor(() => {
    const section = document.getElementById("overviewParentQueueSection")
    assert.ok(section)
    assert.equal(section.classList.contains("hidden"), false)
    assert.match(document.getElementById("overviewParentQueueRows").textContent || "", /Starter Student class report/i)
  })

  document.querySelector('[data-queue-open="queue-01"]').click()
  await waitFor(() => {
    assert.equal(document.getElementById("parentQueueModal").classList.contains("hidden"), false)
    assert.equal(document.getElementById("parentQueueItemId").value, "queue-01")
  })

  document.getElementById("parentQueueHoldBtn").click()
  await waitFor(() => {
    assert.ok(batchActions.some((entry) => entry.action === "hold"))
    assert.equal(document.getElementById("parentQueueItemStatus").value, "hold")
  })

  document.getElementById("parentQueueItemTitle").value = "Updated parent report title"
  document.getElementById("parentQueueItemMessage").value = "Edited queued message"
  document.getElementById("parentQueueEditBtn").click()
  await waitFor(() => {
    assert.ok(batchActions.some((entry) => entry.action === "edit"))
    assert.equal(document.getElementById("parentQueueItemTitle").value, "Updated parent report title")
  })

  document.getElementById("parentQueueRequeueBtn").click()
  await waitFor(() => {
    assert.ok(batchActions.some((entry) => entry.action === "requeue"))
    assert.equal(document.getElementById("parentQueueItemStatus").value, "queued")
  })

  document.getElementById("parentQueueSendAllBtn").click()
  await waitFor(() => {
    assert.ok(batchActions.some((entry) => entry.action === "sendAll"))
  })
  await waitFor(() => {
    assert.match(document.getElementById("status").textContent || "", /Queued (parent|performance) reports processed/i)
  })

  dom.window.close()
})

test("overview anonymous exercise submissions panel renders and supports show-all toggle", async () => {
  const incomingCalls = []
  const incomingActionCalls = []
  const serviceControlCalls = []
  const API_BASE = "http://127.0.0.1"
  const knownStudents = [
    {
      id: "stu-target-01",
      eaglesId: "target001",
      email: "target001@example.com",
      profile: { fullName: "Target Student", currentGrade: "A1 Movers" },
      attendanceRecords: [],
      gradeRecords: [],
      parentReports: [],
    },
  ]
  let createdStudent = null
  const incomingItems = [
    {
      id: "incoming-01",
      status: "queued",
      submittedStudentId: "anon001",
      submittedEmail: "anon001@example.com",
      pageTitle: "Starter Homework Quiz",
      totalQuestions: 20,
      correctCount: 16,
      scorePercent: 80,
      reviewedByUsername: "",
      createdAt: "2026-09-14T10:00:00.000Z",
    },
    {
      id: "incoming-02",
      status: "queued",
      submittedStudentId: "anon002",
      submittedEmail: "anon002@example.com",
      pageTitle: "Common Nouns Checkpoint",
      totalQuestions: 20,
      correctCount: 19,
      scorePercent: 95,
      reviewedByUsername: "",
      createdAt: "2026-09-13T10:00:00.000Z",
    },
    {
      id: "incoming-03",
      status: "resolved",
      submittedStudentId: "anon003",
      submittedEmail: "anon003@example.com",
      pageTitle: "Resolved Listening Quiz",
      totalQuestions: 10,
      correctCount: 7,
      scorePercent: 70,
      reviewedByUsername: "admin",
      createdAt: "2026-09-13T09:00:00.000Z",
    },
  ]

  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const url = String(resource)
    const method = init.method || "GET"
    const parsedUrl = new URL(url, API_BASE)
    const pathname = parsedUrl.pathname

    if (pathname === "/api/admin/auth/me") return jsonResponse(401, { error: "Unauthorized" })
    if (pathname === "/api/admin/auth/login") {
      return jsonResponse(200, {
        user: { username: "admin", role: "admin" },
        rolePolicy: {
          role: "admin",
          canRead: true,
          canWrite: true,
          canManageUsers: true,
          canManagePermissions: true,
          startPage: "overview",
          allowedPages: [
            "overview",
            "profile",
            "attendance",
            "attendance-admin",
            "assignments",
            "parent-tracking",
            "grades",
            "reports",
            "family",
            "users",
            "permissions",
            "settings",
          ],
        },
      })
    }
    if (pathname === "/api/admin/permissions") {
      return jsonResponse(200, {
        roles: {
          admin: {
            role: "admin",
            canRead: true,
            canWrite: true,
            canManageUsers: true,
            canManagePermissions: true,
            startPage: "overview",
            allowedPages: [
              "overview",
              "profile",
              "attendance",
              "attendance-admin",
              "assignments",
              "parent-tracking",
              "grades",
              "reports",
              "family",
              "users",
              "permissions",
              "settings",
            ],
          },
        },
      })
    }
    if (pathname === "/api/admin/users") return jsonResponse(200, { items: [] })
    if (pathname === "/api/admin/filters") return jsonResponse(200, { levels: [], schools: [] })
    if (pathname === "/api/admin/students" && method === "GET") {
      const q = normalizeText(parsedUrl.searchParams.get("q"))
      if (q) {
        const matched = knownStudents.find((entry) => normalizeText(entry.eaglesId) === q)
          || (createdStudent && normalizeText(createdStudent.eaglesId) === q ? createdStudent : null)
        return jsonResponse(200, { items: matched ? [matched] : [] })
      }
      const items = createdStudent ? [createdStudent] : []
      return jsonResponse(200, { items })
    }
    if (method === "GET" && pathname.startsWith("/api/admin/students/")) {
      const refId = decodeURIComponent(pathname.split("/").pop() || "")
      const student =
        knownStudents.find((entry) => entry.id === refId) ||
        (createdStudent && createdStudent.id === refId ? createdStudent : null)
      if (!student) return jsonResponse(404, { error: "Not found" })
      return jsonResponse(200, student)
    }
    if (pathname === "/api/admin/exercise-titles") return jsonResponse(200, { items: [] })
    if (pathname === "/api/admin/dashboard") {
      return jsonResponse(200, {
        today: { attendance: 0, absences: 0, tardy10PlusPercent: 0, tardy30PlusPercent: 0 },
        assignments: { total: 0, completedOnTime: 0, completedLate: 0, outstanding: 0, outstandingYtd: 0 },
        weeklyAssignmentCompletion: [],
        atRiskWeek: { total: 0, students: [] },
        classEnrollmentAttendance: [],
        levelCompletion: [],
        parentReportQueue: { total: 0, hasMore: false, items: [] },
      })
    }
    if (method === "GET" && pathname === "/api/admin/exercise-results/incoming") {
      incomingCalls.push(url)
      const showAll = parsedUrl.searchParams.get("showAll") === "1"
      const activeItems = incomingItems.filter((entry) => entry.status === "queued" || entry.status === "temporary")
      const items = showAll ? incomingItems : activeItems.slice(0, 1)
      return jsonResponse(200, {
        ok: true,
        total: showAll ? incomingItems.length : activeItems.length,
        hasMore: !showAll && activeItems.length > 1,
        statuses: showAll ? [] : ["queued", "temporary"],
        items,
      })
    }
    if (method === "POST" && pathname === "/api/admin/exercise-results/incoming") {
      const payload = init.body ? JSON.parse(init.body) : {}
      incomingActionCalls.push(payload)
      const index = incomingItems.findIndex((entry) => entry.id === payload.incomingResultId)
      if (index < 0) return jsonResponse(404, { error: "Incoming result not found" })

      if (payload.action === "match") {
        incomingItems[index] = {
          ...incomingItems[index],
          status: "resolved",
          reviewedByUsername: "admin",
        }
        return jsonResponse(200, {
          ok: true,
          action: "match",
          studentRefId: payload.studentRefId,
          item: incomingItems[index],
        })
      }

      if (payload.action === "create-account") {
        createdStudent = {
          id: "stu-created-01",
          eaglesId: payload.eaglesId,
          eaglesId: payload.eaglesId,
          email: payload.email,
          profile: { fullName: payload.fullName || "New Student", currentGrade: "" },
          attendanceRecords: [],
          gradeRecords: [],
          parentReports: [],
        }
        incomingItems[index] = {
          ...incomingItems[index],
          status: "resolved",
          reviewedByUsername: "admin",
        }
        return jsonResponse(200, {
          ok: true,
          action: "create-account",
          student: createdStudent,
          studentRefId: createdStudent.id,
          item: incomingItems[index],
        })
      }

      if (payload.action === "archive") {
        incomingItems[index] = {
          ...incomingItems[index],
          status: "archived",
          reviewedByUsername: "admin",
        }
        return jsonResponse(200, { ok: true, action: "archive", item: incomingItems[index] })
      }

      return jsonResponse(400, { error: "Unexpected incoming queue action" })
    }
    if (method === "GET" && pathname === "/api/admin/runtime/service-control") {
      serviceControlCalls.push("status")
      return jsonResponse(200, {
        ok: true,
        enabled: true,
        available: true,
        service: "exercise-mailer.service",
        status: "active",
        detail: "service=exercise-mailer.service is active",
        checkedAt: "10:00:00 AM",
      })
    }
    if (method === "POST" && pathname === "/api/admin/runtime/service-control") {
      const payload = init.body ? JSON.parse(init.body) : {}
      serviceControlCalls.push(payload.action || "restart")
      return jsonResponse(200, {
        ok: true,
        action: "restart",
        enabled: true,
        available: true,
        service: "exercise-mailer.service",
        status: "active",
        detail: "Restarted exercise-mailer.service; status=active.",
        checkedAt: "10:01:00 AM",
      })
    }

    return jsonResponse(200, {})
  })

  submitLogin(dom)
  await waitFor(() => {
    assert.equal(dom.window.document.getElementById("authPanel").classList.contains("hidden"), true)
    assert.equal(dom.window.document.getElementById("app").classList.contains("hidden"), false)
  })

  const document = dom.window.document
  const promptResponses = ["target001", "newuser001", "New Student"]
  dom.window.prompt = () => promptResponses.shift() || null

  await waitFor(() => {
    const section = document.getElementById("overviewIncomingExerciseSection")
    assert.ok(section)
    assert.equal(section.classList.contains("hidden"), false)
    assert.match(document.getElementById("overviewIncomingExerciseRows").textContent || "", /Starter Homework Quiz/i)
    assert.match(document.getElementById("overviewIncomingExerciseSummary").textContent || "", /statuses=queued,temporary/i)
    assert.match(document.getElementById("overviewIncomingExerciseRows").textContent || "", /Add to Specific Student/i)
    assert.match(document.getElementById("overviewIncomingExerciseRows").textContent || "", /Create New User/i)
    const serviceCard = document.getElementById("exerciseMailerServiceCard")
    assert.ok(serviceCard)
    assert.equal(serviceCard.classList.contains("hidden"), false)
    assert.match(document.getElementById("exerciseMailerServiceMeta").textContent || "", /status=ACTIVE/i)
  })

  const addToStudentBtn = document.querySelector(
    '#overviewIncomingExerciseRows tr:first-child button[data-incoming-disposition-action="match"]'
  )
  assert.ok(addToStudentBtn, "add-to-specific-student action button is rendered for queued item")
  addToStudentBtn.click()
  await waitFor(() => {
    assert.ok(
      incomingActionCalls.some(
        (entry) =>
          entry.action === "match"
          && entry.incomingResultId === "incoming-01"
          && entry.studentRefId === "stu-target-01"
      )
    )
    assert.match(document.getElementById("status").textContent || "", /Added this quiz score to target001/i)
    assert.match(document.getElementById("overviewIncomingExerciseRows").textContent || "", /Common Nouns Checkpoint/i)
  })

  const createUserBtn = document.querySelector(
    '#overviewIncomingExerciseRows tr:first-child button[data-incoming-disposition-action="create-account"]'
  )
  assert.ok(createUserBtn, "create-new-user action button is rendered for queued item")
  createUserBtn.click()
  await waitFor(() => {
    assert.ok(
      incomingActionCalls.some(
        (entry) =>
          entry.action === "create-account"
          && entry.incomingResultId === "incoming-02"
          && entry.eaglesId === "newuser001"
      )
    )
    assert.match(document.getElementById("status").textContent || "", /auto-added quiz score/i)
    assert.equal(
      document.querySelector('.page-section[data-page="profile"]')?.classList.contains("active"),
      true
    )
    assert.equal(document.getElementById("f_eaglesId").value, "newuser001")
  })

  openPage(dom, "overview")
  document.getElementById("overviewIncomingExerciseExpandBtn").click()
  await waitFor(() => {
    assert.ok(incomingCalls.some((url) => url.includes("showAll=1")))
    assert.match(document.getElementById("overviewIncomingExerciseRows").textContent || "", /Resolved Listening Quiz/i)
    assert.equal(document.getElementById("overviewIncomingExerciseExpandBtn").textContent, "Show Active Only")
  })

  const rows = Array.from(document.querySelectorAll("#overviewIncomingExerciseRows tr"))
  const rowForIncoming01 = rows.find((row) => normalizeText(row.textContent).includes("anon001"))
  assert.ok(rowForIncoming01, "incoming-01 row is present in show-all mode")
  const archiveBtn = rowForIncoming01.querySelector('button[data-incoming-disposition-action="archive"]')
  assert.ok(archiveBtn, "archive action button is rendered for resolved item")
  archiveBtn.click()
  await waitFor(() => {
    assert.ok(
      incomingActionCalls.some(
        (entry) => entry.action === "archive" && entry.incomingResultId === "incoming-01"
      )
    )
    assert.match(document.getElementById("overviewIncomingExerciseRows").textContent || "", /archived/i)
  })

  document.getElementById("exerciseMailerRestartBtn").click()
  await waitFor(() => {
    assert.ok(serviceControlCalls.includes("restart"))
    assert.match(document.getElementById("status").textContent || "", /Restart command completed/i)
  })

  dom.window.close()
})

test("settings global level-tile style propagates to attendance and assignments tiles", async () => {
  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const url = String(resource)
    void init

    if (url.includes("/api/admin/auth/me")) return jsonResponse(401, { error: "Unauthorized" })
    if (url.includes("/api/admin/auth/login")) {
      return jsonResponse(200, {
        user: { username: "admin", role: "admin" },
        rolePolicy: {
          role: "admin",
          canRead: true,
          canWrite: true,
          canManageUsers: true,
          canManagePermissions: true,
          startPage: "overview",
          allowedPages: ["overview", "profile", "attendance", "assignments", "grades", "reports", "family", "users", "permissions", "settings"],
        },
      })
    }
    if (url.includes("/api/admin/permissions")) {
      return jsonResponse(200, {
        roles: {
          admin: {
            role: "admin",
            canRead: true,
            canWrite: true,
            canManageUsers: true,
            canManagePermissions: true,
            startPage: "overview",
            allowedPages: ["overview", "profile", "attendance", "assignments", "grades", "reports", "family", "users", "permissions", "settings"],
          },
        },
      })
    }
    if (url.includes("/api/admin/users")) return jsonResponse(200, { items: [] })
    if (url.includes("/api/admin/filters")) return jsonResponse(200, { levels: ["Pre-A1 Starters", "A1 Movers"], schools: [] })
    if (url.includes("/api/admin/students")) {
      return jsonResponse(200, {
        items: [
          {
            id: "stu-01",
            eaglesId: "SIS-001",
            profile: { fullName: "Starter Student", currentGrade: "Pre-A1 Starters" },
            counts: { attendanceRecords: 0 },
          },
          {
            id: "stu-02",
            eaglesId: "SIS-002",
            profile: { fullName: "Mover Student", currentGrade: "A1 Movers" },
            counts: { attendanceRecords: 0 },
          },
        ],
      })
    }
    if (url.includes("/api/admin/dashboard")) {
      return jsonResponse(200, {
        today: { attendance: 0, absences: 0, tardy10PlusPercent: 0, tardy30PlusPercent: 0 },
        assignments: { total: 0, completedOnTime: 0, completedLate: 0, outstanding: 0, outstandingYtd: 0 },
        weeklyAssignmentCompletion: [],
        atRiskWeek: { total: 0, students: [] },
        classEnrollmentAttendance: [],
        levelCompletion: [],
      })
    }
    if (url.includes("/api/admin/exercise-titles")) return jsonResponse(200, { items: [] })
    return jsonResponse(200, {})
  })

  submitLogin(dom, { username: "admin" })
  await waitFor(() => {
    assert.equal(dom.window.document.getElementById("authPanel").classList.contains("hidden"), true)
    assert.equal(dom.window.document.getElementById("app").classList.contains("hidden"), false)
  })

  const document = dom.window.document
  document.querySelector('[data-page-link="settings"]').click()

  await waitFor(() => {
    const select = document.getElementById("attendanceLevelStyleLevel")
    assert.ok(select)
    assert.ok(select.querySelector('option[value="Pre-A1 Starters"]'))
  })

  const select = document.getElementById("attendanceLevelStyleLevel")
  select.value = "Pre-A1 Starters"
  select.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  document.getElementById("attendanceLevelTitle").value = "Starter Tile Global"
  document.getElementById("attendanceLevelColor").value = "#123456"
  document.getElementById("attendanceLevelApplyBtn").click()

  await waitFor(() => {
    assert.match(document.getElementById("status").textContent || "", /Global class-level tile style updated/i)
  })

  await waitFor(() => {
    const attendanceTile = document.querySelector('#attendanceLevelTiles .attendance-level-tile[data-level="Pre-A1 Starters"]')
    const assignmentTile = document.querySelector('#assignmentLevelTiles .attendance-level-tile[data-level="Pre-A1 Starters"]')
    assert.ok(attendanceTile)
    assert.ok(assignmentTile)
    assert.match(attendanceTile.textContent || "", /Starter Tile Global/i)
    assert.match(assignmentTile.textContent || "", /Starter Tile Global/i)
    assert.match(attendanceTile.getAttribute("style") || "", /rgb\(18,\s*52,\s*86\)/i)
    assert.match(assignmentTile.getAttribute("style") || "", /rgb\(18,\s*52,\s*86\)/i)
  })

  document.getElementById("logoutBtn").click()
  await waitFor(() => {
    assert.equal(document.getElementById("authPanel").classList.contains("hidden"), false)
  })
  dom.window.close()
})

test("legacy alias level-tile config still applies to assignments input tiles", async () => {
  const dom = await createAdminUiDom(
    async (resource, init = {}) => {
      const url = String(resource)
      void init

      if (url.includes("/api/admin/auth/me")) return jsonResponse(401, { error: "Unauthorized" })
      if (url.includes("/api/admin/auth/login")) {
        return jsonResponse(200, {
          user: { username: "admin", role: "admin" },
          rolePolicy: {
            role: "admin",
            canRead: true,
            canWrite: true,
            canManageUsers: true,
            canManagePermissions: true,
            startPage: "overview",
            allowedPages: ["overview", "profile", "attendance", "assignments", "grades", "reports", "family", "users", "permissions", "settings"],
          },
        })
      }
      if (url.includes("/api/admin/permissions")) {
        return jsonResponse(200, {
          roles: {
            admin: {
              role: "admin",
              canRead: true,
              canWrite: true,
              canManageUsers: true,
              canManagePermissions: true,
              startPage: "overview",
              allowedPages: ["overview", "profile", "attendance", "assignments", "grades", "reports", "family", "users", "permissions", "settings"],
            },
          },
        })
      }
      if (url.includes("/api/admin/users")) return jsonResponse(200, { items: [] })
      if (url.includes("/api/admin/filters")) return jsonResponse(200, { levels: ["Pre-A1 Starters"], schools: [] })
      if (url.includes("/api/admin/students")) {
        return jsonResponse(200, {
          items: [
            {
              id: "stu-01",
              eaglesId: "SIS-001",
              profile: { fullName: "Starter Student", currentGrade: "Pre-A1 Starters" },
              counts: { attendanceRecords: 0 },
            },
          ],
        })
      }
      if (url.includes("/api/admin/dashboard")) {
        return jsonResponse(200, {
          today: { attendance: 0, absences: 0, tardy10PlusPercent: 0, tardy30PlusPercent: 0 },
          assignments: { total: 0, completedOnTime: 0, completedLate: 0, outstanding: 0, outstandingYtd: 0 },
          weeklyAssignmentCompletion: [],
          atRiskWeek: { total: 0, students: [] },
          classEnrollmentAttendance: [],
          levelCompletion: [],
        })
      }
      if (url.includes("/api/admin/exercise-titles")) return jsonResponse(200, { items: [] })
      return jsonResponse(200, {})
    },
    "http://127.0.0.1/admin/students",
    {
      beforeParse(window) {
        window.localStorage.setItem(
          "sis.admin.levelTiles.v1",
          JSON.stringify({
            starters: {
              title: "Starter Tile Legacy",
              bgColor: "#224466",
              imageDataUrl: "",
            },
          })
        )
      },
    }
  )

  submitLogin(dom, { username: "admin" })

  await waitFor(() => {
    const document = dom.window.document
    assert.equal(document.getElementById("authPanel").classList.contains("hidden"), true)
    const assignmentTile = document.querySelector('#assignmentLevelTiles .attendance-level-tile[data-level="Pre-A1 Starters"]')
    assert.ok(assignmentTile)
    assert.match(assignmentTile.textContent || "", /Starter Tile Legacy/i)
    assert.match(assignmentTile.getAttribute("style") || "", /rgb\(34,\s*68,\s*102\)/i)
  })

  dom.window.close()
})

test("overview level buttons use full system level labels and natural grade order", async () => {
  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const url = String(resource)
    void init

    if (url.includes("/api/admin/auth/me")) {
      return jsonResponse(401, { error: "Unauthorized" })
    }

    if (url.includes("/api/admin/auth/login")) {
      return jsonResponse(200, {
        user: { username: "admin", role: "admin" },
        rolePolicy: {
          role: "admin",
          canRead: true,
          canWrite: true,
          canManageUsers: true,
          canManagePermissions: true,
          startPage: "overview",
          allowedPages: ["overview", "profile", "attendance", "assignments", "grades", "reports", "family", "users", "permissions", "settings"],
        },
      })
    }

    if (url.includes("/api/admin/permissions")) {
      return jsonResponse(200, {
        roles: {
          admin: {
            role: "admin",
            canRead: true,
            canWrite: true,
            canManageUsers: true,
            canManagePermissions: true,
            startPage: "overview",
            allowedPages: ["overview", "profile", "attendance", "assignments", "grades", "reports", "family", "users", "permissions", "settings"],
          },
        },
      })
    }

    if (url.includes("/api/admin/users")) {
      return jsonResponse(200, { items: [] })
    }

    if (url.includes("/api/admin/filters")) {
      return jsonResponse(200, { levels: ["Grade 10", "Grade 4", "Grade 7", "Grade 8", "Grade 9"], schools: [] })
    }

    if (url.includes("/api/admin/students")) {
      return jsonResponse(200, {
        items: [
          { id: "stu-01", profile: { currentGrade: "Grade 4" } },
          { id: "stu-02", profile: { currentGrade: "Grade 10" } },
        ],
      })
    }

    if (url.includes("/api/admin/dashboard")) {
      return jsonResponse(200, {
        today: {
          totalEnrollment: 24,
          attendancePercentOfEnrollment: 75,
          unenrolledYtd: 3,
          attendance: 18,
          absences: 6,
          tardy10PlusPercent: 0,
          tardy30PlusPercent: 0,
        },
        assignments: {
          total: 0,
          completedOnTime: 0,
          completedLate: 0,
          outstanding: 0,
          outstandingYtd: 0,
        },
        atRiskWeek: {
          total: 0,
          students: [],
        },
        classEnrollmentAttendance: [
          { level: "Grade 10", enrolled: 12, attendanceToday: 10 },
          { level: "Grade 4", enrolled: 14, attendanceToday: 13 },
          { level: "Grade 7", enrolled: 8, attendanceToday: 7 },
          { level: "Grade 8", enrolled: 9, attendanceToday: 8 },
          { level: "Grade 9", enrolled: 11, attendanceToday: 10 },
        ],
        levelCompletion: [
          { level: "Grade 10", enrolledStudents: 12, completedStudents: 8, totalAssignments: 20, completedAssignments: 11, uncompletedStudents: [] },
          { level: "Grade 4", enrolledStudents: 14, completedStudents: 12, totalAssignments: 24, completedAssignments: 18, uncompletedStudents: [] },
          { level: "Grade 7", enrolledStudents: 8, completedStudents: 6, totalAssignments: 16, completedAssignments: 11, uncompletedStudents: [] },
          { level: "Grade 8", enrolledStudents: 9, completedStudents: 7, totalAssignments: 18, completedAssignments: 13, uncompletedStudents: [] },
          { level: "Grade 9", enrolledStudents: 11, completedStudents: 8, totalAssignments: 22, completedAssignments: 15, uncompletedStudents: [] },
        ],
      })
    }

    if (url.includes("/api/admin/exercise-titles")) {
      return jsonResponse(200, { items: [] })
    }

    return jsonResponse(200, {})
  })

  submitLogin(dom)

  await waitFor(() => {
    const document = dom.window.document
    assert.equal(document.getElementById("authPanel").classList.contains("hidden"), true)
    assert.equal(document.getElementById("app").classList.contains("hidden"), false)
  })

  await waitFor(() => {
    const labels = Array.from(dom.window.document.querySelectorAll("#overviewBarDetailActions button")).map((btn) =>
      btn.textContent.trim()
    )
    assert.deepEqual(labels, ["Grade 4", "Grade 7", "Grade 8", "Grade 9", "Grade 10"])
  })

  await waitFor(() => {
    const document = dom.window.document
    assert.equal(document.getElementById("ovTotalEnrollment")?.textContent?.trim(), "24")
    assert.equal(document.getElementById("ovAttendancePctEnrollment")?.textContent?.trim(), "75.0%")
    assert.equal(document.getElementById("ovUnenrolledYtd")?.textContent?.trim(), "3")
  })

  dom.window.close()
})

test("overview assignment line chart renders global Mon-Sun student counts", async () => {
  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const url = String(resource)
    void init

    if (url.includes("/api/admin/auth/me")) {
      return jsonResponse(401, { error: "Unauthorized" })
    }

    if (url.includes("/api/admin/auth/login")) {
      return jsonResponse(200, {
        user: { username: "admin", role: "admin" },
        rolePolicy: {
          role: "admin",
          canRead: true,
          canWrite: true,
          canManageUsers: true,
          canManagePermissions: true,
          startPage: "overview",
          allowedPages: ["overview", "profile", "attendance", "assignments", "grades", "reports", "family", "users", "permissions", "settings"],
        },
      })
    }

    if (url.includes("/api/admin/permissions")) {
      return jsonResponse(200, {
        roles: {
          admin: {
            role: "admin",
            canRead: true,
            canWrite: true,
            canManageUsers: true,
            canManagePermissions: true,
            startPage: "overview",
            allowedPages: ["overview", "profile", "attendance", "assignments", "grades", "reports", "family", "users", "permissions", "settings"],
          },
        },
      })
    }

    if (url.includes("/api/admin/users")) {
      return jsonResponse(200, { items: [] })
    }

    if (url.includes("/api/admin/filters")) {
      return jsonResponse(200, { levels: ["Pre-A1 Starters", "A1 Movers"], schools: [] })
    }

    if (url.includes("/api/admin/students")) {
      return jsonResponse(200, { items: [] })
    }

    if (url.includes("/api/admin/dashboard")) {
      return jsonResponse(200, {
        today: {
          attendance: 0,
          absences: 0,
          tardy10PlusPercent: 0,
          tardy30PlusPercent: 0,
        },
        assignments: {
          total: 0,
          completedOnTime: 0,
          completedLate: 0,
          outstanding: 0,
          outstandingYtd: 0,
        },
        weeklyAssignmentCompletion: [
          { index: 0, day: "Mon", studentsWithAssignments: 30, studentsCompletedAll: 12 },
          { index: 1, day: "Tue", studentsWithAssignments: 32, studentsCompletedAll: 14 },
          { index: 2, day: "Wed", studentsWithAssignments: 35, studentsCompletedAll: 18 },
          { index: 3, day: "Thu", studentsWithAssignments: 31, studentsCompletedAll: 20 },
          { index: 4, day: "Fri", studentsWithAssignments: 28, studentsCompletedAll: 22 },
          { index: 5, day: "Sat", studentsWithAssignments: 10, studentsCompletedAll: 9 },
          { index: 6, day: "Sun", studentsWithAssignments: 4, studentsCompletedAll: 4 },
        ],
        atRiskWeek: {
          total: 0,
          students: [],
        },
        classEnrollmentAttendance: [],
        levelCompletion: [
          { level: "Pre-A1 Starters", enrolledStudents: 14, completedStudents: 12, totalAssignments: 24, completedAssignments: 18, uncompletedStudents: [] },
          { level: "A1 Movers", enrolledStudents: 10, completedStudents: 8, totalAssignments: 20, completedAssignments: 14, uncompletedStudents: [] },
        ],
      })
    }

    if (url.includes("/api/admin/exercise-titles")) {
      return jsonResponse(200, { items: [] })
    }

    return jsonResponse(200, {})
  })

  submitLogin(dom)

  await waitFor(() => {
    const document = dom.window.document
    assert.equal(document.getElementById("authPanel").classList.contains("hidden"), true)
    assert.equal(document.getElementById("app").classList.contains("hidden"), false)
  })

  await waitFor(() => {
    const textLabels = Array.from(dom.window.document.querySelectorAll("#overviewLineChart text"))
      .map((node) => node.textContent.trim())
      .filter(Boolean)
    const dayLabels = textLabels.filter((label) =>
      ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].includes(label)
    )
    assert.deepEqual(dayLabels, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])
    assert.equal(textLabels.includes("Pre-A1 Starters"), false)
    assert.equal(textLabels.includes("A1 Movers"), false)

    const completionPoints = Array.from(dom.window.document.querySelectorAll("#overviewLineChart circle"))
    assert.ok(completionPoints.length >= 1)
    const expectedPointCount = Math.min(7, ((new Date().getDay() + 6) % 7) + 1)
    assert.equal(completionPoints.length, expectedPointCount)
    // Monday starts at 0% by design for weekly cumulative trend.
    assert.equal(completionPoints[0].getAttribute("cy"), "228")
  })

  dom.window.close()
})

test("overview assignment line chart shows none when no homework exists in current week", async () => {
  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const url = String(resource)
    void init

    if (url.includes("/api/admin/auth/me")) return jsonResponse(401, { error: "Unauthorized" })

    if (url.includes("/api/admin/auth/login")) {
      return jsonResponse(200, {
        user: { username: "admin", role: "admin" },
        rolePolicy: {
          role: "admin",
          canRead: true,
          canWrite: true,
          canManageUsers: true,
          canManagePermissions: true,
          startPage: "overview",
          allowedPages: ["overview", "profile", "attendance", "assignments", "grades", "reports", "family", "users", "permissions", "settings"],
        },
      })
    }

    if (url.includes("/api/admin/permissions")) {
      return jsonResponse(200, {
        roles: {
          admin: {
            role: "admin",
            canRead: true,
            canWrite: true,
            canManageUsers: true,
            canManagePermissions: true,
            startPage: "overview",
            allowedPages: ["overview", "profile", "attendance", "assignments", "grades", "reports", "family", "users", "permissions", "settings"],
          },
        },
      })
    }

    if (url.includes("/api/admin/users")) return jsonResponse(200, { items: [] })
    if (url.includes("/api/admin/filters")) return jsonResponse(200, { levels: ["Pre-A1 Starters"], schools: [] })
    if (url.includes("/api/admin/students")) return jsonResponse(200, { items: [] })

    if (url.includes("/api/admin/dashboard")) {
      return jsonResponse(200, {
        today: { attendance: 0, absences: 0, tardy10PlusPercent: 0, tardy30PlusPercent: 0 },
        assignments: { total: 0, completedOnTime: 0, completedLate: 0, outstanding: 0, outstandingYtd: 0 },
        weeklyAssignmentCompletion: [
          { index: 0, day: "Mon", studentsWithAssignments: 0, studentsCompletedAll: 0 },
          { index: 1, day: "Tue", studentsWithAssignments: 0, studentsCompletedAll: 0 },
          { index: 2, day: "Wed", studentsWithAssignments: 0, studentsCompletedAll: 0 },
          { index: 3, day: "Thu", studentsWithAssignments: 0, studentsCompletedAll: 0 },
          { index: 4, day: "Fri", studentsWithAssignments: 0, studentsCompletedAll: 0 },
          { index: 5, day: "Sat", studentsWithAssignments: 0, studentsCompletedAll: 0 },
          { index: 6, day: "Sun", studentsWithAssignments: 0, studentsCompletedAll: 0 },
        ],
        atRiskWeek: { total: 0, students: [] },
        classEnrollmentAttendance: [],
        levelCompletion: [],
      })
    }

    if (url.includes("/api/admin/exercise-titles")) return jsonResponse(200, { items: [] })
    return jsonResponse(200, {})
  })

  submitLogin(dom)

  await waitFor(() => {
    const text = dom.window.document.querySelector("#overviewLineChart")?.textContent || ""
    assert.match(text, /No homework assigned this week/i)
    assert.equal(dom.window.document.querySelectorAll("#overviewLineChart circle").length, 0)
  })

  dom.window.close()
})

test("overview canonical classes follow SIS level order", async () => {
  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const url = String(resource)
    void init

    if (url.includes("/api/admin/auth/me")) {
      return jsonResponse(401, { error: "Unauthorized" })
    }

    if (url.includes("/api/admin/auth/login")) {
      return jsonResponse(200, {
        user: { username: "admin", role: "admin" },
        rolePolicy: {
          role: "admin",
          canRead: true,
          canWrite: true,
          canManageUsers: true,
          canManagePermissions: true,
          startPage: "overview",
          allowedPages: ["overview", "profile", "attendance", "assignments", "grades", "reports", "family", "users", "permissions", "settings"],
        },
      })
    }

    if (url.includes("/api/admin/permissions")) {
      return jsonResponse(200, {
        roles: {
          admin: {
            role: "admin",
            canRead: true,
            canWrite: true,
            canManageUsers: true,
            canManagePermissions: true,
            startPage: "overview",
            allowedPages: ["overview", "profile", "attendance", "assignments", "grades", "reports", "family", "users", "permissions", "settings"],
          },
        },
      })
    }

    if (url.includes("/api/admin/users")) {
      return jsonResponse(200, { items: [] })
    }

    if (url.includes("/api/admin/filters")) {
      return jsonResponse(200, {
        levels: ["Private", "A2 KET", "Pre-A1 Starters", "C1+ TAYK", "Eggs & Chicks", "A1 Movers", "B2+ IELTS", "B1 PET", "A2 Flyers"],
        schools: [],
      })
    }

    if (url.includes("/api/admin/students")) {
      return jsonResponse(200, { items: [] })
    }

    if (url.includes("/api/admin/dashboard")) {
      return jsonResponse(200, {
        today: {
          attendance: 0,
          absences: 0,
          tardy10PlusPercent: 0,
          tardy30PlusPercent: 0,
        },
        assignments: {
          total: 0,
          completedOnTime: 0,
          completedLate: 0,
          outstanding: 0,
          outstandingYtd: 0,
        },
        weeklyAssignmentCompletion: [],
        atRiskWeek: {
          total: 0,
          students: [],
        },
        classEnrollmentAttendance: [],
        levelCompletion: [
          { level: "Private", enrolledStudents: 4, completedStudents: 1, totalAssignments: 10, completedAssignments: 3, uncompletedStudents: [] },
          { level: "A2 KET", enrolledStudents: 9, completedStudents: 6, totalAssignments: 17, completedAssignments: 12, uncompletedStudents: [] },
          { level: "Pre-A1 Starters", enrolledStudents: 12, completedStudents: 9, totalAssignments: 20, completedAssignments: 16, uncompletedStudents: [] },
          { level: "C1+ TAYK", enrolledStudents: 5, completedStudents: 4, totalAssignments: 11, completedAssignments: 9, uncompletedStudents: [] },
          { level: "Eggs & Chicks", enrolledStudents: 6, completedStudents: 4, totalAssignments: 12, completedAssignments: 8, uncompletedStudents: [] },
          { level: "A1 Movers", enrolledStudents: 10, completedStudents: 7, totalAssignments: 18, completedAssignments: 13, uncompletedStudents: [] },
          { level: "B2+ IELTS", enrolledStudents: 8, completedStudents: 7, totalAssignments: 15, completedAssignments: 13, uncompletedStudents: [] },
          { level: "B1 PET", enrolledStudents: 9, completedStudents: 7, totalAssignments: 16, completedAssignments: 12, uncompletedStudents: [] },
          { level: "A2 Flyers", enrolledStudents: 11, completedStudents: 8, totalAssignments: 19, completedAssignments: 14, uncompletedStudents: [] },
        ],
      })
    }

    if (url.includes("/api/admin/exercise-titles")) {
      return jsonResponse(200, { items: [] })
    }

    return jsonResponse(200, {})
  })

  submitLogin(dom)

  await waitFor(() => {
    const document = dom.window.document
    assert.equal(document.getElementById("authPanel").classList.contains("hidden"), true)
    assert.equal(document.getElementById("app").classList.contains("hidden"), false)
  })

  await waitFor(() => {
    const labels = Array.from(dom.window.document.querySelectorAll("#overviewBarDetailActions button")).map((btn) =>
      btn.textContent.trim()
    )
    assert.deepEqual(labels, [
      "Eggs & Chicks",
      "Pre-A1 Starters",
      "A1 Movers",
      "A2 Flyers",
      "A2 KET",
      "B1 PET",
      "B2+ IELTS",
      "C1+ TAYK",
      "Private",
    ])
  })

  dom.window.close()
})

test("overview level visuals apply brand colors on buttons, bars, and detail border", async () => {
  const previewCreatePayloads = []
  let smallScreen = false

  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const url = String(resource)
    const method = init.method || "GET"

    if (url.includes("/api/admin/auth/me")) {
      return jsonResponse(401, { error: "Unauthorized" })
    }

    if (url.includes("/api/admin/auth/login")) {
      return jsonResponse(200, {
        user: { username: "admin", role: "admin" },
        rolePolicy: {
          role: "admin",
          canRead: true,
          canWrite: true,
          canManageUsers: true,
          canManagePermissions: true,
          startPage: "overview",
          allowedPages: ["overview", "profile", "attendance", "assignments", "grades", "reports", "family", "users", "permissions", "settings"],
        },
      })
    }

    if (url.includes("/api/admin/permissions")) {
      return jsonResponse(200, {
        roles: {
          admin: {
            role: "admin",
            canRead: true,
            canWrite: true,
            canManageUsers: true,
            canManagePermissions: true,
            startPage: "overview",
            allowedPages: ["overview", "profile", "attendance", "assignments", "grades", "reports", "family", "users", "permissions", "settings"],
          },
        },
      })
    }

    if (url.includes("/api/admin/users")) {
      return jsonResponse(200, { items: [] })
    }

    if (url.includes("/api/admin/filters")) {
      return jsonResponse(200, {
        levels: ["Pre-A1 Starters", "A1 Movers"],
        schools: [],
      })
    }

    if (url.includes("/api/admin/students")) {
      return jsonResponse(200, { items: [] })
    }

    if (url.includes("/api/admin/dashboard")) {
      return jsonResponse(200, {
        today: {
          attendance: 0,
          absences: 0,
          tardy10PlusPercent: 0,
          tardy30PlusPercent: 0,
        },
        assignments: {
          total: 0,
          completedOnTime: 0,
          completedLate: 0,
          outstanding: 0,
          outstandingYtd: 0,
        },
        weeklyAssignmentCompletion: [],
        atRiskWeek: {
          total: 0,
          students: [],
        },
        classEnrollmentAttendance: [
          { level: "Pre-A1 Starters", enrolled: 12, attendanceToday: 11 },
          { level: "A1 Movers", enrolled: 10, attendanceToday: 9 },
        ],
        levelCompletion: [
          {
            level: "Pre-A1 Starters",
            enrolledStudents: 12,
            completedStudents: 9,
            totalAssignments: 20,
            completedAssignments: 14,
            uncompletedStudents: [
              {
                studentRefId: "stu-01",
                eaglesId: "SIS-001",
                fullName: "Starter Student",
                outstandingCount: 2,
                assignmentNames: ["HW 1"],
                emails: ["starter@example.com"],
              },
            ],
          },
          {
            level: "A1 Movers",
            enrolledStudents: 10,
            completedStudents: 8,
            totalAssignments: 18,
            completedAssignments: 12,
            uncompletedStudents: [],
          },
        ],
      })
    }

    if (url.includes("/api/admin/exercise-titles")) {
      return jsonResponse(200, { items: [] })
    }

    if (method === "POST" && url.includes("/api/admin/assignment-announcements/volatile")) {
      const payload = init.body ? JSON.parse(init.body) : {}
      previewCreatePayloads.push(payload)
      return jsonResponse(200, {
        ok: true,
        url: `https://preview.example.com/volatile/${previewCreatePayloads.length}`,
        ttlMinutes: 480,
        expiresAt: "2026-03-01T08:00:00.000Z",
      })
    }

    return jsonResponse(200, {})
  }, "http://127.0.0.1/admin/students", {
    beforeParse(window) {
      const today = localIsoDate()
      window.matchMedia = (query) => ({
        matches: smallScreen && /\(max-width:\s*820px\)/i.test(String(query || "")),
        media: String(query || ""),
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() { return false },
      })
      window.localStorage.setItem(
        "sis.admin.assignmentTemplates",
        JSON.stringify([
          {
            id: "starter-current-week",
            assignmentTitle: "Starter Week Current",
            level: "Pre-A1 Starters",
            assignedAt: today,
            dueAt: nextSundayIsoDate(today),
            items: [
              { title: "Common Nouns", url: "https://exercise.example.com/common-nouns" },
              { title: "Proper Nouns", url: "https://exercise.example.com/proper-nouns" },
            ],
            updatedAt: "2026-03-01T01:15:00.000Z",
          },
          {
            id: "starter-old-week",
            assignmentTitle: "Starter Week Old",
            level: "Pre-A1 Starters",
            assignedAt: "2025-12-01",
            dueAt: "2025-12-07",
            items: [
              { title: "Old Exercise", url: "https://exercise.example.com/old" },
            ],
            updatedAt: "2025-12-01T03:00:00.000Z",
          },
        ])
      )
    },
  })

  submitLogin(dom)

  await waitFor(() => {
    const document = dom.window.document
    assert.equal(document.getElementById("authPanel").classList.contains("hidden"), true)
    assert.equal(document.getElementById("app").classList.contains("hidden"), false)
  })

  const document = dom.window.document
  let scrollCalls = 0
  const panel = document.getElementById("levelDetailPanel")
  panel.scrollIntoView = () => { scrollCalls += 1 }

  await waitFor(() => {
    const startersBtn = Array.from(document.querySelectorAll("#overviewBarDetailActions button")).find((button) =>
      /Pre-A1 Starters/i.test(button.textContent || "")
    )
    const moversBtn = Array.from(document.querySelectorAll("#overviewBarDetailActions button")).find((button) =>
      /A1 Movers/i.test(button.textContent || "")
    )
    assert.ok(startersBtn)
    assert.ok(moversBtn)
    assert.ok(startersBtn.classList.contains("panelbg-starters"))
    assert.ok(moversBtn.classList.contains("panelbg-mov"))

    const fills = Array.from(document.querySelectorAll("#overviewBarChart rect"))
      .map((entry) => String(entry.getAttribute("fill") || "").toLowerCase())
      .filter(Boolean)
    assert.ok(fills.includes("#fcab15"))
    assert.ok(fills.includes("#913198"))

    startersBtn.click()
  })

  await waitFor(() => {
    const panel = document.getElementById("levelDetailPanel")
    assert.equal(panel.classList.contains("hidden"), false)
    assert.equal(panel.style.getPropertyValue("--level-panel-accent"), "#FCAB15")
    assert.match(document.getElementById("levelDetailTitle").textContent, /Homework progress - Pre-A1 Starters/i)
    const studentCells = document.querySelectorAll("#levelDetailRows tr td")
    assert.ok(studentCells.length >= 5)
    assert.match(document.getElementById("levelDetailRows")?.textContent || "", /Starter Student/i)
    assert.equal(document.getElementById("levelReminderAssignment").value, "Starter Week Current")
    assert.equal(
      document.getElementById("levelReminderLink").value,
      "https://preview.example.com/volatile/1"
    )
    assert.equal(scrollCalls, 0)
    assert.equal(previewCreatePayloads.length, 1)
    assert.equal(previewCreatePayloads[0].assignmentTitle, "Starter Week Current")
    assert.equal(previewCreatePayloads[0].level, "Pre-A1 Starters")
  })

  smallScreen = true
  await waitFor(() => {
    const moversBtn = Array.from(document.querySelectorAll("#overviewBarDetailActions button")).find((button) =>
      /A1 Movers/i.test(button.textContent || "")
    )
    assert.ok(moversBtn)
    moversBtn.click()
  })

  await waitFor(() => {
    assert.match(document.getElementById("levelDetailTitle").textContent || "", /Homework progress - A1 Movers/i)
    const rowText = document.querySelector("#levelDetailRows tr td")?.textContent || ""
    assert.match(rowText, /No uncompleted students/i)
    assert.ok(scrollCalls >= 1)
  })

  dom.window.close()
})

test("attendance main defaults to absent and admin child shows per-student stats", async () => {
  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const url = String(resource)
    void init

    if (url.includes("/api/admin/auth/me")) return jsonResponse(401, { error: "Unauthorized" })

    if (url.includes("/api/admin/auth/login")) {
      return jsonResponse(200, {
        user: { username: "admin", role: "admin" },
        rolePolicy: {
          role: "admin",
          canRead: true,
          canWrite: true,
          canManageUsers: true,
          canManagePermissions: true,
          startPage: "overview",
          allowedPages: [
            "overview",
            "profile",
            "attendance",
            "assignments",
            "grades",
            "reports",
            "family",
            "users",
            "permissions",
            "settings",
          ],
        },
      })
    }

    if (url.includes("/api/admin/permissions")) {
      return jsonResponse(200, {
        roles: {
          admin: {
            role: "admin",
            canRead: true,
            canWrite: true,
            canManageUsers: true,
            canManagePermissions: true,
            startPage: "overview",
            allowedPages: [
              "overview",
              "profile",
              "attendance",
              "assignments",
              "grades",
              "reports",
              "family",
              "users",
              "permissions",
              "settings",
            ],
          },
        },
      })
    }

    if (url.includes("/api/admin/users")) return jsonResponse(200, { items: [] })
    if (url.includes("/api/admin/filters")) return jsonResponse(200, { levels: ["Pre-A1 Starters"], schools: [] })
    if (url.includes("/api/admin/students/stu-01")) {
      return jsonResponse(200, {
        id: "stu-01",
        eaglesId: "SIS-001",
        profile: { fullName: "Student One", currentGrade: "Pre-A1 Starters" },
        attendanceRecords: [
          { id: "att-1", attendanceDate: "2026-02-24", status: "present", comments: "" },
          { id: "att-2", attendanceDate: "2026-02-25", status: "absent", comments: "" },
          { id: "att-3", attendanceDate: "2026-02-26", status: "late", comments: "tardy 10m" },
        ],
        gradeRecords: [],
        parentReports: [],
      })
    }
    if (url.includes("/api/admin/students")) {
      return jsonResponse(200, {
        items: [
          {
            id: "stu-01",
            eaglesId: "SIS-001",
            profile: { fullName: "Student One", currentGrade: "Pre-A1 Starters" },
            counts: { attendanceRecords: 3 },
          },
        ],
      })
    }
    if (url.includes("/api/admin/dashboard")) {
      return jsonResponse(200, {
        today: { attendance: 0, absences: 0, tardy10PlusPercent: 0, tardy30PlusPercent: 0 },
        assignments: { total: 0, completedOnTime: 0, completedLate: 0, outstanding: 0, outstandingYtd: 0 },
        weeklyAssignmentCompletion: [],
        atRiskWeek: { total: 0, students: [] },
        classEnrollmentAttendance: [],
        levelCompletion: [],
      })
    }
    if (url.includes("/api/admin/exercise-titles")) return jsonResponse(200, { items: [] })
    return jsonResponse(200, {})
  })

  submitLogin(dom, { username: "admin" })
  await waitFor(() => {
    const text = dom.window.document.getElementById("status").textContent
    assert.match(text, /Authenticated as admin/i)
  })

  dom.window.document.querySelector('[data-page-link="attendance"]').click()
  await waitFor(() => {
    const headers = Array.from(
      dom.window.document.querySelectorAll('#attendanceLandingSection table thead th')
    ).map((entry) => (entry.textContent || "").trim())
    assert.deepEqual(headers, ["Student", "Attendance (Today)"])
  })
  await waitFor(() => {
    const promptRow = dom.window.document.querySelector("#attendanceLandingRows tr td")
    assert.ok(promptRow)
    assert.match(promptRow.textContent || "", /Select a class level/i)
  })
  await waitFor(() => {
    const firstLevelTile = dom.window.document.querySelector("#attendanceLevelTiles .attendance-level-tile")
    assert.ok(firstLevelTile)
    firstLevelTile.click()
  })
  await waitFor(() => {
    const absentChecked = dom.window.document.querySelector(
      '#attendanceLandingRows input[type="radio"][value="absent"]:checked'
    )
    assert.ok(absentChecked)
  })

  dom.window.document.querySelector('[data-page-link="attendance-admin"]').click()
  await waitFor(() => {
    const adminSection = dom.window.document.querySelector('[data-page="attendance-admin"]')
    assert.ok(adminSection)
    assert.equal(adminSection.classList.contains("active"), true)
    const row = dom.window.document.querySelector("#attendanceAdminRows tr")
    assert.ok(row)
    const cells = row.querySelectorAll("td")
    assert.equal(cells.length, 5)
    assert.equal((cells[1].textContent || "").trim(), "2")
    assert.equal((cells[2].textContent || "").trim(), "1")
    assert.equal((cells[3].textContent || "").trim(), "1")
    assert.equal((cells[4].textContent || "").trim(), "0")
  })

  await settleDomAsync(dom)
  dom.window.close()
})

test("clear buttons reset local admin form fields", async () => {
  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const url = String(resource)
    const method = init.method || "GET"
    void method

    if (url.includes("/api/admin/auth/me")) {
      return jsonResponse(401, { error: "Unauthorized" })
    }

    return jsonResponse(404, { error: "Not found" })
  })

  const document = dom.window.document

  document.getElementById("loginUser").value = "admin"
  document.getElementById("loginPass").value = "secret"
  document.getElementById("loginClearBtn").click()
  assert.equal(document.getElementById("loginUser").value, "")
  assert.equal(document.getElementById("loginPass").value, "")

  document.getElementById("a_id").value = "att-1"
  document.getElementById("a_className").value = "Class A"
  document.getElementById("a_schoolYear").value = "2026-2027"
  document.getElementById("a_quarter").value = "q4"
  document.getElementById("a_date").value = "2026-02-27"
  document.getElementById("a_status").value = "late"
  document.getElementById("a_comments").value = "traffic"
  document.getElementById("attendanceClearBtn").click()
  assert.equal(document.getElementById("a_id").value, "")
  assert.equal(document.getElementById("a_className").value, "")
  assert.match(document.getElementById("a_schoolYear").value, /^\d{4}-\d{4}$/)
  assert.match(document.getElementById("a_quarter").value, /^q[1-4]$/)
  assert.match(document.getElementById("a_date").value, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(document.getElementById("a_status").value, "absent")
  assert.equal(document.getElementById("a_comments").value, "")

  document.getElementById("g_id").value = "grade-1"
  document.getElementById("g_className").value = "Class B"
  document.getElementById("g_schoolYear").value = "2026-2027"
  document.getElementById("g_assignmentName").value = "Essay"
  document.getElementById("g_homeworkCompleted").value = "true"
  document.getElementById("gradeClearBtn").click()
  assert.equal(document.getElementById("g_id").value, "")
  assert.equal(document.getElementById("g_className").value, "")
  assert.equal(document.getElementById("g_schoolYear").value, "")
  assert.equal(document.getElementById("g_quarter").value, "q1")
  assert.equal(document.getElementById("g_assignmentName").value, "")
  assert.equal(document.getElementById("g_homeworkCompleted").value, "")

  document.getElementById("r_id").value = "report-1"
  document.getElementById("r_className").value = "Class C"
  document.getElementById("r_schoolYear").value = "2026-2027"
  document.getElementById("r_quarter").value = "q4"
  document.getElementById("r_comments").value = "notes"
  document.getElementById("reportClearBtn").click()
  assert.equal(document.getElementById("r_id").value, "")
  assert.equal(document.getElementById("r_className").value, "")
  assert.equal(document.getElementById("r_schoolYear").value, "")
  assert.equal(document.getElementById("r_quarter").value, "q1")
  assert.equal(document.getElementById("r_comments").value, "")

  document.getElementById("familyPhone").value = "0908000000"
  document.getElementById("familyResult").textContent = "match"
  document.getElementById("familyClearResultBtn").click()
  assert.equal(document.getElementById("familyPhone").value, "")
  assert.match(document.getElementById("familyResult").textContent, /No family lookup yet/i)

  document.getElementById("u_id").value = "user-1"
  document.getElementById("u_username").value = "teacher01"
  document.getElementById("u_role").value = "admin"
  document.getElementById("u_password").value = "pass-1"
  document.getElementById("userClearBtn").click()
  assert.equal(document.getElementById("u_id").value, "")
  assert.equal(document.getElementById("u_username").value, "")
  assert.equal(document.getElementById("u_role").value, "teacher")
  assert.equal(document.getElementById("u_password").value, "")

  document.getElementById("levelReminderAssignment").value = "Homework 1"
  document.getElementById("levelReminderLink").value = "https://example.org"
  document.getElementById("levelReminderDueAt").value = "2026-02-28"
  document.getElementById("levelReminderMode").value = "all"
  document.getElementById("levelReminderTemplate").value = "custom"
  document.getElementById("levelReminderClearBtn").click()
  assert.equal(document.getElementById("levelReminderAssignment").value, "")
  assert.equal(document.getElementById("levelReminderLink").value, "")
  assert.equal(document.getElementById("levelReminderDueAt").value, "")
  assert.equal(document.getElementById("levelReminderMode").value, "selected")
  assert.match(document.getElementById("levelReminderTemplate").value, /\{\{\s*name\s*\}\}/i)

  dom.window.close()
})

test("profile settings layout editor supports tab/type/sequence updates and custom field create-delete", async () => {
  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const url = String(resource)
    const method = init.method || "GET"
    void method

    if (url.includes("/api/admin/auth/me")) return jsonResponse(401, { error: "Unauthorized" })
    if (url.includes("/api/admin/auth/login")) {
      return jsonResponse(200, {
        user: { username: "admin", role: "admin" },
        rolePolicy: {
          role: "admin",
          canRead: true,
          canWrite: true,
          canManageUsers: true,
          canManagePermissions: true,
          startPage: "overview",
          allowedPages: [
            "overview",
            "student-admin",
            "profile",
            "attendance",
            "assignments",
            "parent-tracking",
            "grades",
            "reports",
            "family",
            "users",
            "permissions",
            "settings",
          ],
        },
      })
    }
    if (url.includes("/api/admin/permissions")) {
      return jsonResponse(200, {
        roles: {
          admin: {
            role: "admin",
            canRead: true,
            canWrite: true,
            canManageUsers: true,
            canManagePermissions: true,
            startPage: "overview",
            allowedPages: [
              "overview",
              "student-admin",
              "profile",
              "attendance",
              "assignments",
              "parent-tracking",
              "grades",
              "reports",
              "family",
              "users",
              "permissions",
              "settings",
            ],
          },
        },
      })
    }
    if (url.includes("/api/admin/users")) return jsonResponse(200, { items: [] })
    if (url.includes("/api/admin/filters")) return jsonResponse(200, { levels: ["Pre-A1 Starters", "A1 Movers"], schools: ["Main Campus"] })
    if (url.includes("/api/admin/students")) return jsonResponse(200, { items: [] })
    if (url.includes("/api/admin/dashboard")) {
      return jsonResponse(200, {
        levelCompletion: [],
        classEnrollmentAttendance: [],
        weeklyAssignmentCompletion: [],
        today: {},
      })
    }
    if (url.includes("/api/admin/notifications/batch-status")) return jsonResponse(200, { items: [], total: 0, hasMore: false })
    if (url.includes("/api/admin/exercise-results/incoming")) return jsonResponse(200, { items: [], total: 0, hasMore: false, statuses: [] })
    if (url.includes("/api/admin/runtime/service-control")) {
      return jsonResponse(200, {
        available: false,
        enabled: false,
        service: "exercise-mailer.service",
        status: "inactive",
        detail: "n/a",
      })
    }
    return jsonResponse(200, {})
  })

  dom.window.confirm = () => true
  submitLogin(dom)

  await waitFor(() => {
    assert.equal(dom.window.document.getElementById("app").classList.contains("hidden"), false)
  })

  openPage(dom, "settings")
  await waitFor(() => {
    const row = dom.window.document.querySelector('#profileFieldLayoutRows tr[data-profile-field-key="emailFormSig"]')
    assert.ok(row)
  })

  const document = dom.window.document
  const signatureRow = document.querySelector('#profileFieldLayoutRows tr[data-profile-field-key="emailFormSig"]')
  assert.ok(signatureRow)
  signatureRow.querySelector('[data-layout-key="tabId"]').value = "profile"
  signatureRow.querySelector('[data-layout-key="inputType"]').value = "textarea"
  signatureRow.querySelector('[data-layout-key="sequence"]').value = "15"
  document.getElementById("profileFieldLayoutApplyBtn").click()

  await waitFor(() => {
    assert.match(document.getElementById("profileFieldLayoutStatus").textContent || "", /applied/i)
    const signatureField = document.getElementById("f_signatureEmail")
    assert.ok(signatureField)
    assert.equal(signatureField.tagName, "TEXTAREA")
    assert.equal(
      signatureField.closest("[data-profile-tab-panel]")?.getAttribute("data-profile-tab-panel"),
      "profile"
    )
    const profilePanel = document.querySelector('[data-profile-tab-panel="profile"]')
    const fieldIds = Array.from(profilePanel.querySelectorAll('[id^="f_"]')).map((el) => el.id)
    assert.ok(fieldIds.indexOf("f_signatureEmail") >= 0)
  })

  document.getElementById("profileFieldCreateKey").value = "customHealthNote"
  document.getElementById("profileFieldCreateLabelVi").value = "Ghi chú custom"
  document.getElementById("profileFieldCreateType").value = "text"
  document.getElementById("profileFieldCreateTab").value = "covid"
  document.getElementById("profileFieldCreateWidth").value = "6"
  document.getElementById("profileFieldCreateSectionVi").value = "COVID"
  document.getElementById("profileFieldCreatePlaceholderVi").value = "nhap ghi chu"
  document.getElementById("profileFieldCreateSequence").value = "515"
  document.getElementById("profileFieldCreateBtn").click()

  await waitFor(() => {
    const customRow = document.querySelector('#profileFieldLayoutRows tr[data-profile-field-key="customHealthNote"]')
    assert.ok(customRow)
    assert.equal(
      document.querySelector('#profileFieldLayoutRows tr[data-profile-field-key="custom-health-note"]'),
      null
    )
    assert.match(document.getElementById("profileFieldLayoutStatus").textContent || "", /Created field/i)
  })

  openPage(dom, "profile")
  document.querySelector('[data-profile-tab="covid"]')?.click()
  await waitFor(() => {
    const customField = document.getElementById("f_customHealthNote")
    assert.ok(customField)
    assert.equal(
      customField.closest("[data-profile-tab-panel]")?.getAttribute("data-profile-tab-panel"),
      "covid"
    )
  })

  openPage(dom, "settings")
  await waitFor(() => {
    const customRow = document.querySelector('#profileFieldLayoutRows tr[data-profile-field-key="customHealthNote"]')
    assert.ok(customRow)
    const deleteBtn = customRow.querySelector('[data-profile-layout-action="delete"]')
    assert.ok(deleteBtn)
    deleteBtn.click()
  })

  await waitFor(() => {
    assert.equal(
      document.querySelector('#profileFieldLayoutRows tr[data-profile-field-key="customHealthNote"]'),
      null
    )
  })

  openPage(dom, "profile")
  document.querySelector('[data-profile-tab="covid"]')?.click()
  await waitFor(() => {
    assert.equal(document.getElementById("f_customHealthNote"), null)
  })

  dom.window.close()
})

test("profile payload mapping preserves mapped fields and custom form payload keys", async () => {
  let studentDetail = {
    id: "stu-01",
    studentNumber: 1001,
    eaglesId: "1001",
    email: "seed@example.com",
    profile: {
      fullName: "Seed Student",
      currentGrade: "Pre-A1 Starters",
      studentEmail: "seed@example.com",
      normalizedFormPayload: {
        legacyField: "keep-me",
      },
      rawFormPayload: {
        legacyField: "keep-me",
      },
    },
    attendanceRecords: [],
    gradeRecords: [],
    parentReports: [],
  }

  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const url = String(resource)
    const method = init.method || "GET"

    if (url.includes("/api/admin/auth/me")) return jsonResponse(401, { error: "Unauthorized" })
    if (url.includes("/api/admin/auth/login")) {
      return jsonResponse(200, {
        user: { username: "admin", role: "admin" },
        rolePolicy: {
          role: "admin",
          canRead: true,
          canWrite: true,
          canManageUsers: true,
          canManagePermissions: true,
          startPage: "overview",
          allowedPages: [
            "overview",
            "student-admin",
            "profile",
            "attendance",
            "assignments",
            "parent-tracking",
            "grades",
            "reports",
            "family",
            "users",
            "permissions",
            "settings",
          ],
        },
      })
    }
    if (url.includes("/api/admin/permissions")) {
      return jsonResponse(200, {
        roles: {
          admin: {
            role: "admin",
            canRead: true,
            canWrite: true,
            canManageUsers: true,
            canManagePermissions: true,
            startPage: "overview",
            allowedPages: [
              "overview",
              "student-admin",
              "profile",
              "attendance",
              "assignments",
              "parent-tracking",
              "grades",
              "reports",
              "family",
              "users",
              "permissions",
              "settings",
            ],
          },
        },
      })
    }
    if (url.includes("/api/admin/users")) return jsonResponse(200, { items: [] })
    if (url.includes("/api/admin/filters")) return jsonResponse(200, { levels: ["Pre-A1 Starters"], schools: ["Main Campus"] })
    if (method === "GET" && url.includes("/api/admin/students/stu-01")) return jsonResponse(200, studentDetail)
    if (method === "GET" && url.includes("/api/admin/students")) {
      return jsonResponse(200, {
        items: [
          {
            id: "stu-01",
            eaglesId: studentDetail.eaglesId,
            profile: {
              fullName: studentDetail.profile.fullName,
              currentGrade: studentDetail.profile.currentGrade,
            },
          },
        ],
      })
    }
    if (url.includes("/api/admin/dashboard")) {
      return jsonResponse(200, {
        levelCompletion: [],
        classEnrollmentAttendance: [],
        weeklyAssignmentCompletion: [],
        today: {},
      })
    }
    if (url.includes("/api/admin/notifications/batch-status")) return jsonResponse(200, { items: [], total: 0, hasMore: false })
    if (url.includes("/api/admin/exercise-results/incoming")) return jsonResponse(200, { items: [], total: 0, hasMore: false, statuses: [] })
    if (url.includes("/api/admin/runtime/service-control")) {
      return jsonResponse(200, {
        available: false,
        enabled: false,
        service: "exercise-mailer.service",
        status: "inactive",
        detail: "n/a",
      })
    }
    return jsonResponse(200, {})
  })

  submitLogin(dom)

  await waitFor(() => {
    assert.equal(dom.window.document.getElementById("app").classList.contains("hidden"), false)
  })

  const document = dom.window.document
  await waitFor(() => {
    const firstRow = document.querySelector("#studentRows tr")
    assert.ok(firstRow)
    firstRow.click()
  })

  await waitFor(() => {
    assert.equal(document.getElementById("f_fullName")?.value, "Seed Student")
  })

  openPage(dom, "settings")
  await waitFor(() => {
    assert.ok(document.getElementById("profileFieldCreateBtn"))
  })

  document.getElementById("profileFieldCreateKey").value = "customAlias"
  document.getElementById("profileFieldCreateLabelVi").value = "Bi danh"
  document.getElementById("profileFieldCreateType").value = "text"
  document.getElementById("profileFieldCreateTab").value = "profile"
  document.getElementById("profileFieldCreateSectionVi").value = "Thong tin"
  document.getElementById("profileFieldCreateSequence").value = "17"
  document.getElementById("profileFieldCreateBtn").click()

  await waitFor(() => {
    const customRow = document.querySelector('#profileFieldLayoutRows tr[data-profile-field-key="customAlias"]')
    assert.ok(customRow)
    assert.equal(
      document.querySelector('#profileFieldLayoutRows tr[data-profile-field-key="custom-alias"]'),
      null
    )
  })

  openPage(dom, "profile")
  await waitFor(() => {
    assert.equal(document.querySelector('.page-section[data-page="profile"]')?.classList.contains("active"), true)
    assert.ok(document.getElementById("f_customAlias"))
    assert.ok(document.getElementById("profileEditorForm"))
    assert.ok(document.getElementById("f_password")?.closest("form"))
    assert.equal(document.getElementById("f_studentNumber")?.value, "1001")
    assert.equal(document.getElementById("f_eaglesId")?.value, "1001")
    assert.equal(document.getElementById("saveBtn")?.disabled, false)
  })

  document.getElementById("f_fullName").value = "Updated Student"
  document.getElementById("f_studentNumber").value = "1225"
  document.getElementById("f_eaglesId").value = "1001"
  document.getElementById("f_studentEmail").value = "updated-student@example.com"
  document.getElementById("f_customAlias").value = "Alias Value"
  assert.equal(typeof dom.window.collectStudentPayload, "function")
  const payload = dom.window.collectStudentPayload()
  assert.equal(payload.studentNumber, 1225)
  assert.equal(payload.eaglesId, "1001")
  assert.equal(payload.email, "seed@example.com")
  assert.equal(payload.profile.fullName, "Updated Student")
  assert.equal(payload.profile.studentEmail, "updated-student@example.com")
  assert.equal(payload.profile.sourceFormId, "admin-manual")
  assert.equal(payload.profile.sourceUrl, "admin/students")
  assert.equal(payload.profile.normalizedFormPayload.customAlias, "Alias Value")
  assert.equal(payload.profile.rawFormPayload.customAlias, "Alias Value")
  assert.equal(Object.prototype.hasOwnProperty.call(payload.profile.normalizedFormPayload, "custom-alias"), false)
  assert.equal(Object.prototype.hasOwnProperty.call(payload.profile.rawFormPayload, "custom-alias"), false)
  assert.equal(payload.profile.normalizedFormPayload.legacyField, "keep-me")
  assert.equal(payload.profile.rawFormPayload.legacyField, "keep-me")

  dom.window.close()
})

test("new profile form hydrates next student number and keeps floor at 100+", async () => {
  let nextStudentNumberCalls = 0
  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const url = String(resource)
    const method = init.method || "GET"

    if (url.includes("/api/admin/auth/me")) return jsonResponse(401, { error: "Unauthorized" })
    if (url.includes("/api/admin/auth/login")) {
      return jsonResponse(200, {
        user: { username: "admin", role: "admin" },
        rolePolicy: {
          role: "admin",
          canRead: true,
          canWrite: true,
          canManageUsers: true,
          canManagePermissions: true,
          startPage: "overview",
          allowedPages: [
            "overview",
            "student-admin",
            "profile",
            "attendance",
            "assignments",
            "parent-tracking",
            "grades",
            "reports",
            "family",
            "users",
            "permissions",
            "settings",
          ],
        },
      })
    }
    if (url.includes("/api/admin/permissions")) {
      return jsonResponse(200, {
        roles: {
          admin: {
            role: "admin",
            canRead: true,
            canWrite: true,
            canManageUsers: true,
            canManagePermissions: true,
            startPage: "overview",
            allowedPages: [
              "overview",
              "student-admin",
              "profile",
              "attendance",
              "assignments",
              "parent-tracking",
              "grades",
              "reports",
              "family",
              "users",
              "permissions",
              "settings",
            ],
          },
        },
      })
    }
    if (url.includes("/api/admin/users")) return jsonResponse(200, { items: [] })
    if (url.includes("/api/admin/filters")) return jsonResponse(200, { levels: ["Pre-A1 Starters"], schools: ["Main Campus"] })
    if (url.includes("/api/admin/students/next-student-number")) {
      nextStudentNumberCalls += 1
      return jsonResponse(200, { startAt: 100, nextStudentNumber: 226 })
    }
    if (method === "GET" && url.includes("/api/admin/students/stu-legacy")) {
      return jsonResponse(200, {
        id: "stu-legacy",
        studentNumber: 225,
        eaglesId: "legacy225",
        email: "legacy@example.com",
        profile: {
          fullName: "Legacy Student",
          currentGrade: "Pre-A1 Starters",
        },
        attendanceRecords: [],
        gradeRecords: [],
        parentReports: [],
      })
    }
    if (method === "GET" && url.includes("/api/admin/students")) {
      return jsonResponse(200, {
        items: [
          {
            id: "stu-legacy",
            studentNumber: 225,
            eaglesId: "legacy225",
            profile: {
              fullName: "Legacy Student",
              currentGrade: "Pre-A1 Starters",
            },
          },
        ],
      })
    }
    if (url.includes("/api/admin/dashboard")) {
      return jsonResponse(200, {
        levelCompletion: [],
        classEnrollmentAttendance: [],
        weeklyAssignmentCompletion: [],
        today: {},
      })
    }
    if (url.includes("/api/admin/notifications/batch-status")) return jsonResponse(200, { items: [], total: 0, hasMore: false })
    if (url.includes("/api/admin/exercise-results/incoming")) return jsonResponse(200, { items: [], total: 0, hasMore: false, statuses: [] })
    if (url.includes("/api/admin/runtime/service-control")) {
      return jsonResponse(200, {
        available: false,
        enabled: false,
        service: "exercise-mailer.service",
        status: "inactive",
        detail: "n/a",
      })
    }
    return jsonResponse(200, {})
  })

  submitLogin(dom)
  await waitFor(() => {
    assert.equal(dom.window.document.getElementById("app").classList.contains("hidden"), false)
  })

  openPage(dom, "profile")
  dom.window.document.getElementById("clearBtn")?.click()

  await waitFor(() => {
    assert.equal(dom.window.document.getElementById("f_studentNumber")?.value, "226")
    assert.equal(dom.window.document.getElementById("f_eaglesId")?.value, "")
  })
  assert.ok(nextStudentNumberCalls >= 1)

  dom.window.close()
})

test("table sort controls and column-click headers reorder grade/performance data", async () => {
  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const url = String(resource)
    const method = init.method || "GET"
    void method

    if (url.includes("/api/admin/auth/me")) return jsonResponse(401, { error: "Unauthorized" })
    if (url.includes("/api/admin/auth/login")) {
      return jsonResponse(200, {
        user: { username: "admin", role: "admin" },
        rolePolicy: {
          role: "admin",
          canRead: true,
          canWrite: true,
          canManageUsers: true,
          canManagePermissions: true,
          startPage: "overview",
          allowedPages: [
            "overview",
            "student-admin",
            "profile",
            "attendance",
            "assignments",
            "parent-tracking",
            "grades",
            "reports",
            "family",
            "users",
            "permissions",
            "settings",
          ],
        },
      })
    }
    if (url.includes("/api/admin/permissions")) {
      return jsonResponse(200, {
        roles: {
          admin: {
            role: "admin",
            canRead: true,
            canWrite: true,
            canManageUsers: true,
            canManagePermissions: true,
            startPage: "overview",
            allowedPages: [
              "overview",
              "student-admin",
              "profile",
              "attendance",
              "assignments",
              "parent-tracking",
              "grades",
              "reports",
              "family",
              "users",
              "permissions",
              "settings",
            ],
          },
        },
      })
    }
    if (url.includes("/api/admin/users")) return jsonResponse(200, { items: [] })
    if (url.includes("/api/admin/filters")) return jsonResponse(200, { levels: ["Pre-A1 Starters"], schools: [] })
    if (url.includes("/api/admin/students/stu-01")) {
      return jsonResponse(200, {
        id: "stu-01",
        eaglesId: "SIS-001",
        profile: { fullName: "Student One", currentGrade: "Pre-A1 Starters" },
        attendanceRecords: [
          {
            id: "att-01",
            attendanceDate: "2026-02-04",
            className: "Class A",
            quarter: "q1",
            status: "present",
            comments: "seed-alpha present",
          },
          {
            id: "att-02",
            attendanceDate: "2026-02-05",
            className: "Class B",
            quarter: "q1",
            status: "absent",
            comments: "seed-beta absent",
          },
        ],
        gradeRecords: [
          {
            id: "grade-01",
            dueAt: "2026-02-11",
            className: "Class B",
            assignmentName: "Essay",
            score: 70,
            maxScore: 100,
          },
          {
            id: "grade-02",
            dueAt: "2026-02-05",
            className: "Class A",
            assignmentName: "Quiz",
            score: 95,
            maxScore: 100,
          },
        ],
        parentReports: [
          {
            id: "rep-01",
            generatedAt: "2026-02-02",
            className: "Pre-A1 Starters",
            quarter: "q1",
            homeworkCompletionRate: 60,
            homeworkOnTimeRate: 50,
            behaviorScore: 7,
            participationScore: 7,
            inClassScore: 75,
            comments: "Needs support",
            level: "Pre-A1 Starters",
          },
          {
            id: "rep-02",
            generatedAt: "2026-02-10",
            className: "Pre-A1 Starters",
            quarter: "q1",
            homeworkCompletionRate: 90,
            homeworkOnTimeRate: 92,
            behaviorScore: 9,
            participationScore: 9,
            inClassScore: 92,
            comments: "Strong progress",
            level: "Pre-A1 Starters",
          },
        ],
      })
    }
    if (url.includes("/api/admin/students")) {
      return jsonResponse(200, {
        items: [
          {
            id: "stu-01",
            eaglesId: "SIS-001",
            profile: { fullName: "Student One", currentGrade: "Pre-A1 Starters" },
            counts: { attendanceRecords: 0 },
          },
        ],
      })
    }
    if (url.includes("/api/admin/dashboard")) {
      return jsonResponse(200, {
        today: { attendance: 0, absences: 0, tardy10PlusPercent: 0, tardy30PlusPercent: 0 },
        assignments: { total: 0, completedOnTime: 0, completedLate: 0, outstanding: 0, outstandingYtd: 0 },
        weeklyAssignmentCompletion: [],
        atRiskWeek: { total: 0, students: [] },
        classEnrollmentAttendance: [],
        levelCompletion: [],
      })
    }
    if (url.includes("/api/admin/exercise-titles")) return jsonResponse(200, { items: [] })
    return jsonResponse(200, {})
  })

  submitLogin(dom, { username: "admin" })
  await waitFor(() => {
    const text = dom.window.document.getElementById("status").textContent
    assert.match(text, /Authenticated as admin/i)
  })

  const document = dom.window.document
  const seededAssignmentTemplates = [
    {
      id: "seed-assignment-01",
      assignmentTitle: "Seed Assignment Alpha",
      level: "Pre-A1 Starters",
      assignedAt: localIsoDate(),
      dueAt: nextSundayIsoDate(localIsoDate()),
      items: [{ title: "Alpha Item", url: "https://seed.example.com/alpha" }],
      updatedAt: "2026-02-11T10:00:00.000Z",
    },
    {
      id: "seed-assignment-02",
      assignmentTitle: "Seed Assignment Beta",
      level: "Pre-A1 Starters",
      assignedAt: "2026-02-01",
      dueAt: "2026-02-07",
      items: [{ title: "Beta Item", url: "https://seed.example.com/beta" }],
      updatedAt: "2026-02-01T10:00:00.000Z",
    },
  ]
  dom.window.localStorage.setItem("sis.admin.assignmentTemplates", JSON.stringify(seededAssignmentTemplates))
  document.getElementById("assignmentReloadTemplatesBtn").click()

  await waitFor(() => {
    assert.ok(document.querySelector("#studentRows tr"))
  })
  document.querySelector("#studentRows tr").click()
  await waitFor(() => {
    assert.equal(document.querySelectorAll("#gradeRows tr").length, 2)
  })

  assert.ok(document.getElementById("attendanceSortField"))
  assert.ok(document.getElementById("assignmentSortField"))
  assert.ok(document.getElementById("gradeSortField"))
  assert.ok(document.getElementById("reportSortField"))
  assert.ok(document.getElementById("attendanceDataSearch"))
  assert.ok(document.getElementById("assignmentDataSearch"))
  assert.ok(document.getElementById("performanceDataSearch"))
  assert.ok(document.getElementById("gradeDataSearch"))
  assert.ok(document.getElementById("reportDataSearch"))
  assert.equal(document.getElementById("attendanceDataSearchBtn"), null)
  assert.equal(document.getElementById("assignmentDataSearchBtn"), null)
  assert.equal(document.getElementById("performanceDataSearchBtn"), null)
  assert.equal(document.getElementById("gradeDataSearchBtn"), null)
  assert.equal(document.getElementById("reportDataSearchBtn"), null)
  assert.ok(document.getElementById("attendanceDataLevel"))
  assert.ok(document.getElementById("assignmentDataLevel"))
  assert.ok(document.getElementById("performanceDataLevel"))
  assert.ok(document.getElementById("gradeDataLevel"))
  assert.ok(document.getElementById("reportDataLevel"))
  assert.ok(document.getElementById("attendanceDataStudent"))
  assert.ok(document.getElementById("assignmentDataStudent"))
  assert.ok(document.getElementById("performanceDataStudent"))
  assert.ok(document.getElementById("gradeDataStudent"))
  assert.ok(document.getElementById("reportDataStudent"))
  assert.ok(document.getElementById("attendanceDataDateFrom"))
  assert.ok(document.getElementById("assignmentDataDateFrom"))
  assert.ok(document.getElementById("performanceDataDateFrom"))
  assert.ok(document.getElementById("gradeDataDateFrom"))
  assert.ok(document.getElementById("reportDataDateFrom"))
  assert.ok(document.getElementById("attendanceDataDateTo"))
  assert.ok(document.getElementById("assignmentDataDateTo"))
  assert.ok(document.getElementById("performanceDataDateTo"))
  assert.ok(document.getElementById("gradeDataDateTo"))
  assert.ok(document.getElementById("reportDataDateTo"))
  assert.ok(document.getElementById("attendanceExportXlsxBtn"))
  assert.ok(document.getElementById("assignmentExportXlsxBtn"))
  assert.ok(document.getElementById("performanceExportXlsxBtn"))
  assert.ok(document.getElementById("gradeExportXlsxBtn"))
  assert.ok(document.getElementById("reportExportXlsxBtn"))
  assert.ok(document.getElementById("assignmentSaveTemplateBtn"))
  assert.ok(document.getElementById("gradeSaveBtn"))
  assert.ok(document.getElementById("reportSaveBtn"))

  openPage(dom, "attendance-admin")
  await waitFor(() => {
    assert.ok(document.querySelectorAll("#attendanceRows tr").length >= 1)
  })
  const attendanceStudentFilter = document.getElementById("attendanceDataStudent")
  const attendanceStudentOption = Array.from(attendanceStudentFilter.options).find((entry) => normalizeText(entry.value))
  if (attendanceStudentOption) {
    attendanceStudentFilter.value = attendanceStudentOption.value
    attendanceStudentFilter.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  }
  const attendanceRowsWithData = () =>
    Array.from(document.querySelectorAll("#attendanceRows tr")).filter(
      (row) => !/No attendance rows match current search\/archive filters\./i.test(normalizeText(row.textContent || ""))
    )
  await waitFor(() => {
    assert.ok(document.querySelectorAll("#attendanceRows tr").length >= 1)
  })
  const attendanceSearch = document.getElementById("attendanceDataSearch")
  const attendanceBaselineRows = attendanceRowsWithData()
  if (attendanceBaselineRows.length) {
    const attendanceBaselineRowCount = attendanceBaselineRows.length
    const firstRowText = normalizeText(attendanceBaselineRows[0].textContent || "")
    const termMatch = firstRowText.match(/[A-Za-z][A-Za-z0-9_-]{2,}/)
    const attendanceSearchTerm = normalizeText(termMatch?.[0] || firstRowText)
    assert.ok(attendanceSearchTerm)
    attendanceSearch.value = attendanceSearchTerm
    attendanceSearch.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
    await waitFor(() => {
      const rows = attendanceRowsWithData()
      assert.ok(rows.length >= 1)
      assert.ok(rows.length <= attendanceBaselineRowCount)
      const visibleText = rows.map((row) => normalizeText(row.textContent || "")).join(" ")
      assert.match(visibleText, new RegExp(attendanceSearchTerm, "i"))
    })
    attendanceSearch.value = ""
    attendanceSearch.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
    await waitFor(() => {
      const rows = attendanceRowsWithData()
      assert.equal(rows.length, attendanceBaselineRowCount)
    })
  } else {
    attendanceSearch.value = "seed"
    attendanceSearch.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
    await waitFor(() => {
      assert.ok(document.querySelectorAll("#attendanceRows tr").length >= 1)
    })
    attendanceSearch.value = ""
    attendanceSearch.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
  }

  openPage(dom, "assignments-data")
  await waitFor(() => {
    const rows = document.querySelectorAll("#assignmentTemplateRows tr")
    assert.equal(rows.length, 2)
  })
  const assignmentSearch = document.getElementById("assignmentDataSearch")
  assignmentSearch.value = "Beta"
  assignmentSearch.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
  await waitFor(() => {
    const rows = document.querySelectorAll("#assignmentTemplateRows tr")
    assert.equal(rows.length, 1)
    assert.match(rows[0].textContent || "", /Seed Assignment Beta/i)
  })
  assignmentSearch.value = ""
  assignmentSearch.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
  await waitFor(() => {
    const rows = document.querySelectorAll("#assignmentTemplateRows tr")
    assert.equal(rows.length, 2)
  })

  await waitFor(() => {
    assert.ok(document.querySelectorAll("#gradeDataLevel option").length > 1)
  })
  const gradeLevelFilter = document.getElementById("gradeDataLevel")
  gradeLevelFilter.value = "Pre-A1 Starters"
  gradeLevelFilter.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  await waitFor(() => {
    const studentOptions = Array.from(document.querySelectorAll("#gradeDataStudent option")).map((entry) => normalizeText(entry.textContent))
    assert.ok(studentOptions.some((value) => value.includes("Student One")))
  })
  gradeLevelFilter.value = ""
  gradeLevelFilter.dispatchEvent(new dom.window.Event("change", { bubbles: true }))

  const gradeBaselineRowCount = document.querySelectorAll("#gradeRows tr").length
  assert.ok(gradeBaselineRowCount >= 1)
  const gradeStudentFilter = document.getElementById("gradeDataStudent")
  const gradeStudentOption =
    Array.from(gradeStudentFilter.options).find(
      (entry) => normalizeText(entry.value) && /Student One/i.test(normalizeText(entry.textContent || ""))
    ) || Array.from(gradeStudentFilter.options).find((entry) => normalizeText(entry.value))
  assert.ok(gradeStudentOption)
  gradeStudentFilter.value = gradeStudentOption.value
  gradeStudentFilter.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  await waitFor(() => {
    const rows = document.querySelectorAll("#gradeRows tr")
    assert.ok(rows.length >= 1)
    assert.ok(rows.length <= gradeBaselineRowCount)
  })
  gradeStudentFilter.value = ""
  gradeStudentFilter.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  await waitFor(() => {
    const rows = document.querySelectorAll("#gradeRows tr")
    assert.equal(rows.length, gradeBaselineRowCount)
  })

  const gradeDateFrom = document.getElementById("gradeDataDateFrom")
  gradeDateFrom.value = "2026-02-06"
  gradeDateFrom.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  await waitFor(() => {
    const rows = document.querySelectorAll("#gradeRows tr")
    assert.ok(rows.length >= 1)
    assert.ok(rows.length <= gradeBaselineRowCount)
  })
  gradeDateFrom.value = ""
  gradeDateFrom.dispatchEvent(new dom.window.Event("change", { bubbles: true }))

  const gradeSortField = document.getElementById("gradeSortField")
  gradeSortField.value = "score"
  gradeSortField.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  await waitFor(() => {
    const firstScore = (document.querySelector("#gradeRows tr td:nth-child(5)")?.textContent || "").trim()
    assert.equal(firstScore, "95/100")
  })
  await waitFor(() => {
    const actionCellText = document.querySelector("#gradeRows tr td:nth-child(10)")?.textContent || ""
    assert.match(actionCellText, /Edit/i)
    assert.match(actionCellText, /Delete/i)
  })

  document.getElementById("gradeSortDirBtn").click()
  await waitFor(() => {
    const firstScore = (document.querySelector("#gradeRows tr td:nth-child(5)")?.textContent || "").trim()
    assert.equal(firstScore, "70/100")
  })

  const gradeScoreHeader = document.querySelector('th[data-table-sort="grades"][data-sort-field="score"]')
  assert.ok(gradeScoreHeader)
  gradeScoreHeader.click()
  await waitFor(() => {
    const firstScore = (document.querySelector("#gradeRows tr td:nth-child(5)")?.textContent || "").trim()
    assert.equal(firstScore, "95/100")
  })

  const gradeSearch = document.getElementById("gradeDataSearch")
  gradeSearch.value = "Quiz"
  gradeSearch.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
  await waitFor(() => {
    const rows = document.querySelectorAll("#gradeRows tr")
    assert.equal(rows.length, 1)
    assert.match(rows[0].textContent || "", /Quiz/i)
  })

  const gradeArchiveBtn = document.querySelector('#gradeRows button[data-archive="grade-02"]')
  assert.ok(gradeArchiveBtn)
  gradeArchiveBtn.click()
  await waitFor(() => {
    const cells = document.querySelectorAll("#gradeRows tr td")
    assert.equal(cells.length, 1)
    assert.match(cells[0].textContent || "", /No grade rows match current search\/archive filters\./i)
  })

  document.getElementById("gradeArchiveToggleBtn").click()
  await waitFor(() => {
    const rows = document.querySelectorAll("#gradeRows tr")
    assert.equal(rows.length, 1)
    assert.match(rows[0].textContent || "", /Quiz/i)
  })

  gradeSearch.value = ""
  gradeSearch.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
  document.getElementById("gradeArchiveToggleBtn").click()
  await waitFor(() => {
    const rows = document.querySelectorAll("#gradeRows tr")
    assert.equal(rows.length, 1)
    assert.match(rows[0].textContent || "", /Essay/i)
  })

  openPage(dom, "parent-tracking")
  await waitFor(() => {
    assert.match(document.querySelector('[data-page="parent-tracking"] h2')?.textContent || "", /Performance reports \[input\]/i)
    assert.ok(document.getElementById("performanceSortField"))
  })
  await waitFor(() => {
    const rows = document.querySelectorAll("#pt_reportRows tr")
    assert.equal(rows.length, 2)
  })

  const performanceHwHeader = document.querySelector(
    'th[data-table-sort="performance"][data-sort-field="homeworkCompletionRate"]'
  )
  assert.ok(performanceHwHeader)
  performanceHwHeader.click()
  await waitFor(() => {
    const firstHw = (document.querySelector("#pt_reportRows tr td:nth-child(5)")?.textContent || "").trim()
    assert.equal(firstHw, "90")
  })
  performanceHwHeader.click()
  await waitFor(() => {
    const firstHw = (document.querySelector("#pt_reportRows tr td:nth-child(5)")?.textContent || "").trim()
    assert.equal(firstHw, "60")
  })

  const performanceSearch = document.getElementById("performanceDataSearch")
  performanceSearch.value = "2026-02-10"
  performanceSearch.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
  await waitFor(() => {
    const rows = document.querySelectorAll("#pt_reportRows tr")
    assert.equal(rows.length, 1)
    assert.match(rows[0].textContent || "", /2026-02-10/i)
  })

  openPage(dom, "reports")
  await waitFor(() => {
    const rows = document.querySelectorAll("#reportRows tr")
    assert.equal(rows.length, 2)
  })
  const reportSearch = document.getElementById("reportDataSearch")
  reportSearch.value = "Needs support"
  reportSearch.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
  await waitFor(() => {
    const rows = document.querySelectorAll("#reportRows tr")
    assert.equal(rows.length, 1)
    assert.match(rows[0].textContent || "", /2026-02-02/i)
  })
  reportSearch.value = ""
  reportSearch.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
  await waitFor(() => {
    const rows = document.querySelectorAll("#reportRows tr")
    assert.equal(rows.length, 2)
  })

  await settleDomAsync(dom)
  dom.window.close()
})

test("school setup profile fields persist and reset from saved values", async () => {
  const dom = await createSchoolSetupAdminDom()
  submitLogin(dom, { username: "admin" })

  await waitFor(() => {
    assert.equal(dom.window.document.getElementById("app").classList.contains("hidden"), false)
  })

  const document = dom.window.document
  openPage(dom, "school-setup")
  await waitFor(() => {
    assert.equal(document.querySelector('.page-section[data-page="school-setup"]')?.classList.contains("active"), true)
  })

  const fieldValuesById = {
    schoolSetupName: "Eagles Learning Hub",
    schoolSetupPhone: "+1-555-0111",
    schoolSetupBilingualVi: "Truong hoc song ngu",
    schoolSetupBilingualEn: "Bilingual school profile",
    schoolSetupMotto: "Learn with purpose",
    schoolSetupMission: "Deliver student outcomes",
    schoolSetupValues: "Respect, effort, consistency",
    schoolSetupAddress: "100 Learning Avenue",
    schoolSetupPublicSite: "https://public.eagles.edu.vn",
    schoolSetupPrivateLessonSite: "https://lessons.eagles.edu.vn",
    schoolSetupWebPresence: "https://web.eagles.edu.vn",
    schoolSetupSocialIm: "zalo:eagles-hub",
    schoolSetupBusinessTaxId: "TAX-7788",
    schoolSetupTimeFormat: "24h",
    schoolSetupTimeZone: "Asia/Ho_Chi_Minh",
  }
  for (const [id, value] of Object.entries(fieldValuesById)) {
    const field = document.getElementById(id)
    assert.ok(field)
    field.value = value
  }
  document.getElementById("schoolSetupStartDate").value = "2026-08-10"
  document.getElementById("schoolSetupEndDate").value = "2027-05-28"
  document.getElementById("schoolSetupSaveBtn").click()

  await waitFor(() => {
    assert.match(document.getElementById("schoolSetupStatus").textContent || "", /School setup saved/i)
    assert.match(document.getElementById("status").textContent || "", /Eagles Learning Hub/i)
  })

  const savedRaw = dom.window.localStorage.getItem("sis.admin.uiSettings")
  assert.ok(savedRaw)
  const saved = JSON.parse(savedRaw)
  assert.equal(saved.schoolSetup.startDate, "2026-08-10")
  assert.equal(saved.schoolSetup.endDate, "2027-05-28")
  assert.equal(saved.schoolProfile.schoolName, fieldValuesById.schoolSetupName)
  assert.equal(saved.schoolProfile.phone, fieldValuesById.schoolSetupPhone)
  assert.equal(saved.schoolProfile.bilingualTextVi, fieldValuesById.schoolSetupBilingualVi)
  assert.equal(saved.schoolProfile.bilingualTextEn, fieldValuesById.schoolSetupBilingualEn)
  assert.equal(saved.schoolProfile.motto, fieldValuesById.schoolSetupMotto)
  assert.equal(saved.schoolProfile.mission, fieldValuesById.schoolSetupMission)
  assert.equal(saved.schoolProfile.values, fieldValuesById.schoolSetupValues)
  assert.equal(saved.schoolProfile.address, fieldValuesById.schoolSetupAddress)
  assert.equal(saved.schoolProfile.publicSite, fieldValuesById.schoolSetupPublicSite)
  assert.equal(saved.schoolProfile.privateLessonSite, fieldValuesById.schoolSetupPrivateLessonSite)
  assert.equal(saved.schoolProfile.webPresence, fieldValuesById.schoolSetupWebPresence)
  assert.equal(saved.schoolProfile.socialIm, fieldValuesById.schoolSetupSocialIm)
  assert.equal(saved.schoolProfile.businessTaxId, fieldValuesById.schoolSetupBusinessTaxId)
  assert.equal(saved.schoolProfile.timeFormat, fieldValuesById.schoolSetupTimeFormat)
  assert.equal(saved.schoolProfile.timeZone, fieldValuesById.schoolSetupTimeZone)

  document.getElementById("schoolSetupName").value = "Unsaved temp name"
  document.getElementById("schoolSetupMission").value = "Unsaved temp mission"
  document.getElementById("schoolSetupStartDate").value = "2026-09-01"
  document.getElementById("schoolSetupEndDate").value = "2027-06-01"
  document.getElementById("schoolSetupResetBtn").click()

  await waitFor(() => {
    assert.equal(document.getElementById("schoolSetupName").value, "Eagles Learning Hub")
    assert.equal(document.getElementById("schoolSetupMission").value, "Deliver student outcomes")
    assert.equal(document.getElementById("schoolSetupStartDate").value, "2026-08-10")
    assert.equal(document.getElementById("schoolSetupEndDate").value, "2027-05-28")
  })

  dom.window.close()
})

test("school setup logo upload validates file type and dimension limit", async () => {
  const dom = await createSchoolSetupAdminDom({
    beforeParse(window) {
      const dimensionsByDataUrl = new Map()
      window.FileReader = class MockFileReader {
        constructor() {
          this.result = null
          this.onload = null
          this.onerror = null
        }

        readAsDataURL(file) {
          const name = String(file?.name || "")
          const type = String(file?.type || "application/octet-stream")
          const match = name.match(/(\d+)x(\d+)/i)
          const width = match ? Number(match[1]) : 500
          const height = match ? Number(match[2]) : 500
          const result = `data:${type};base64,${encodeURIComponent(name || "mock-logo")}`
          dimensionsByDataUrl.set(result, { width, height })
          this.result = result
          setTimeout(() => {
            if (typeof this.onload === "function") this.onload({ target: this })
          }, 0)
        }
      }
      window.Image = class MockImage {
        constructor() {
          this.onload = null
          this.onerror = null
          this.naturalWidth = 0
          this.naturalHeight = 0
          this._src = ""
        }

        set src(value) {
          const key = String(value || "")
          this._src = key
          const dimensions = dimensionsByDataUrl.get(key) || { width: 500, height: 500 }
          this.naturalWidth = dimensions.width
          this.naturalHeight = dimensions.height
          setTimeout(() => {
            if (typeof this.onload === "function") this.onload()
          }, 0)
        }

        get src() {
          return this._src
        }
      }
    },
  })

  submitLogin(dom, { username: "admin" })
  await waitFor(() => {
    assert.equal(dom.window.document.getElementById("app").classList.contains("hidden"), false)
  })

  const document = dom.window.document
  openPage(dom, "school-setup")
  await waitFor(() => {
    assert.ok(document.getElementById("schoolSetupLogoFile"))
  })

  const logoFileInput = document.getElementById("schoolSetupLogoFile")
  const logoDataUrlInput = document.getElementById("schoolSetupLogoDataUrl")
  const logoPreview = document.getElementById("schoolSetupLogoPreview")
  const logoPreviewImage = document.getElementById("schoolSetupLogoPreviewImg")
  const logoPreviewFallback = document.getElementById("schoolSetupLogoPreviewFallback")
  const setUploadFiles = (files) => {
    Object.defineProperty(logoFileInput, "files", { configurable: true, value: files })
  }

  const unsupportedFile = new dom.window.File(["dummy"], "logo.txt", { type: "text/plain" })
  setUploadFiles([unsupportedFile])
  logoFileInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  await waitFor(() => {
    assert.match(document.getElementById("schoolSetupStatus").textContent || "", /one of: svg, jpg, png, webp/i)
  })
  assert.equal(logoDataUrlInput.value, "")
  assert.equal(logoPreview.classList.contains("has-image"), false)

  const validLogoFile = new dom.window.File(["dummy"], "logo-500x500.svg", { type: "image/svg+xml" })
  setUploadFiles([validLogoFile])
  logoFileInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  let uploadedLogoDataUrl = ""
  await waitFor(() => {
    assert.match(document.getElementById("schoolSetupStatus").textContent || "", /Logo ready \(500x500\)/i)
    uploadedLogoDataUrl = logoDataUrlInput.value
    assert.match(uploadedLogoDataUrl, /^data:image\/svg\+xml/i)
    assert.equal(logoPreview.classList.contains("has-image"), true)
    assert.equal(logoPreviewImage.classList.contains("hidden"), false)
    assert.equal(logoPreviewFallback.classList.contains("hidden"), true)
  })

  const oversizedLogoFile = new dom.window.File(["dummy"], "logo-900x900.png", { type: "image/png" })
  setUploadFiles([oversizedLogoFile])
  logoFileInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  await waitFor(() => {
    assert.match(document.getElementById("schoolSetupStatus").textContent || "", /max 650px/i)
  })
  assert.equal(logoDataUrlInput.value, uploadedLogoDataUrl)

  document.getElementById("schoolSetupLogoClearBtn").click()
  await waitFor(() => {
    assert.equal(logoDataUrlInput.value, "")
    assert.equal(logoPreview.classList.contains("has-image"), false)
    assert.equal(logoPreviewImage.classList.contains("hidden"), true)
    assert.equal(logoPreviewFallback.classList.contains("hidden"), false)
  })

  dom.window.close()
})

test("overview queue and homework tables keep mobile scroll wrappers", async () => {
  const dom = await createSchoolSetupAdminDom()
  submitLogin(dom, { username: "admin" })

  await waitFor(() => {
    assert.equal(dom.window.document.getElementById("app").classList.contains("hidden"), false)
  })

  const document = dom.window.document
  openPage(dom, "overview")
  await waitFor(() => {
    assert.equal(document.querySelector('.page-section[data-page="overview"]')?.classList.contains("active"), true)
  })

  assert.ok(document.querySelector("#levelDetailPanel .table-scroll-wrap"))
  assert.ok(document.querySelector("#overviewClassTableWrap.table-scroll-wrap"))
  assert.ok(document.querySelector("#overviewIncomingExerciseDetails .table-scroll-wrap"))
  assert.ok(document.querySelector("#overviewParentQueueDetails .table-scroll-wrap"))
  assert.equal(document.getElementById("schoolSetupLogoPreviewImg")?.getAttribute("src"), "data:,")

  dom.window.close()
})
