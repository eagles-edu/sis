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

async function createAdminUiDom(fetchHandler, url = "http://127.0.0.1/admin/students") {
  const dom = new JSDOM(ADMIN_HTML, {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    url,
    beforeParse(window) {
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
          studentId: "SIS-001",
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
              studentId: "SIS-001",
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
        studentId: "SIS-001",
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
            studentId: "SIS-001",
            profile: { fullName: "Student One", currentGrade: "Pre-A1 Starters" },
            counts: { attendanceRecords: 0 },
          },
          {
            id: "stu-02",
            studentId: "steve001",
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
    assert.equal(dom.window.document.getElementById("topControlsPanel").classList.contains("hidden"), false)
    assert.equal(dom.window.document.getElementById("studentListPanel").classList.contains("hidden"), true)
  })

  dom.window.document.querySelector('[data-page-link="student-admin"]').click()
  await waitFor(() => {
    assert.equal(dom.window.document.getElementById("topControlsPanel").classList.contains("hidden"), false)
    assert.equal(dom.window.document.getElementById("studentListPanel").classList.contains("hidden"), false)
  })

  dom.window.document.getElementById("logoutBtn").click()
  await waitFor(() => {
    assert.equal(dom.window.document.getElementById("authPanel").classList.contains("hidden"), false)
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
            studentId: "SIS-001",
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
            studentId: "SIS-002",
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
      studentId: "SIS-001",
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
      studentId: "SIS-002",
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
            studentId: "SIS-001",
            email: "starter@example.com",
            profile: { fullName: "Starter Student", currentGrade: "Pre-A1 Starters", studentEmail: "starter@example.com" },
          },
          {
            id: "stu-02",
            studentId: "SIS-002",
            email: "mover@example.com",
            profile: { fullName: "Mover Student", currentGrade: "Pre-A1 Starters", studentEmail: "mover@example.com" },
          },
        ],
      })
    }
    if (method === "POST" && url.includes("/api/admin/students/") && url.includes("/reports")) {
      const payload = typeof init.body === "string" ? JSON.parse(init.body || "{}") : init.body || {}
      savedReportPayloads.push(payload)
      const studentId = url.includes("/stu-02/") ? "stu-02" : "stu-01"
      return jsonResponse(200, { report: { id: `rep-${savedReportPayloads.length}` }, student: detailById[studentId] })
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
    const studentSelect = document.getElementById("pt_studentId")
    assert.ok(studentSelect)
    assert.ok(studentSelect.querySelector('option[value="stu-01"]'))
  })

  const selectedDate = "2026-09-15"
  document.getElementById("pt_classDate").value = selectedDate
  document.getElementById("pt_classDate").dispatchEvent(new dom.window.Event("change", { bubbles: true }))

  document.getElementById("pt_lessonSummary").value = "Reviewed Unit 3 grammar and reading strategy."
  document.getElementById("pt_lessonSummary").dispatchEvent(new dom.window.Event("input", { bubbles: true }))

  document.getElementById("pt_studentId").value = "stu-01"
  document.getElementById("pt_studentId").dispatchEvent(new dom.window.Event("change", { bubbles: true }))

  await waitFor(() => {
    const recipients = document.getElementById("pt_recipients").value
    assert.match(recipients, /starter@example\.com/i)
    assert.match(recipients, /mom@example\.com/i)
    assert.match(document.getElementById("pt_outstandingRows").textContent || "", /Homework Past Due/i)
    const hwCompletion = Number.parseFloat(document.getElementById("pt_homeworkCompletionRate").value || "0")
    assert.ok(hwCompletion > 0)
  })

  document.getElementById("pt_studentId").value = "stu-02"
  document.getElementById("pt_studentId").dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  await waitFor(() => {
    assert.equal(
      document.getElementById("pt_lessonSummary").value,
      "Reviewed Unit 3 grammar and reading strategy."
    )
  })

  document.getElementById("pt_studentId").value = "stu-01"
  document.getElementById("pt_studentId").dispatchEvent(new dom.window.Event("change", { bubbles: true }))
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
            studentId: "SIS-001",
            profile: { fullName: "Starter Student", currentGrade: "Pre-A1 Starters" },
            counts: { attendanceRecords: 0 },
          },
          {
            id: "stu-02",
            studentId: "SIS-002",
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
                studentId: "SIS-001",
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

    return jsonResponse(200, {})
  })

  submitLogin(dom)

  await waitFor(() => {
    const document = dom.window.document
    assert.equal(document.getElementById("authPanel").classList.contains("hidden"), true)
    assert.equal(document.getElementById("app").classList.contains("hidden"), false)
  })

  await waitFor(() => {
    const document = dom.window.document
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
    const document = dom.window.document
    const panel = document.getElementById("levelDetailPanel")
    assert.equal(panel.classList.contains("hidden"), false)
    assert.equal(panel.style.getPropertyValue("--level-panel-accent"), "#FCAB15")
    assert.match(document.getElementById("levelDetailTitle").textContent, /Pre-A1 Starters/i)
    const studentCells = document.querySelectorAll("#levelDetailRows tr td")
    assert.ok(studentCells.length >= 5)
    assert.match(document.getElementById("levelDetailRows")?.textContent || "", /Starter Student/i)
  })

  await waitFor(() => {
    const document = dom.window.document
    const moversBtn = Array.from(document.querySelectorAll("#overviewBarDetailActions button")).find((button) =>
      /A1 Movers/i.test(button.textContent || "")
    )
    assert.ok(moversBtn)
    moversBtn.click()
  })

  await waitFor(() => {
    const document = dom.window.document
    assert.match(document.getElementById("levelDetailTitle").textContent || "", /A1 Movers/i)
    const rowText = document.querySelector("#levelDetailRows tr td")?.textContent || ""
    assert.match(rowText, /No uncompleted students/i)
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
        studentId: "SIS-001",
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
            studentId: "SIS-001",
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
  assert.equal(document.getElementById("a_schoolYear").value, "")
  assert.equal(document.getElementById("a_quarter").value, "q1")
  assert.equal(document.getElementById("a_date").value, "")
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
        studentId: "SIS-001",
        profile: { fullName: "Student One", currentGrade: "Pre-A1 Starters" },
        attendanceRecords: [],
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
            studentId: "SIS-001",
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
  assert.ok(document.getElementById("attendanceDataLevel"))
  assert.ok(document.getElementById("assignmentDataLevel"))
  assert.ok(document.getElementById("performanceDataLevel"))
  assert.ok(document.getElementById("gradeDataLevel"))
  assert.ok(document.getElementById("reportDataLevel"))
  assert.ok(document.getElementById("attendanceDataStudentName"))
  assert.ok(document.getElementById("assignmentDataStudentName"))
  assert.ok(document.getElementById("performanceDataStudentName"))
  assert.ok(document.getElementById("gradeDataStudentName"))
  assert.ok(document.getElementById("reportDataStudentName"))
  assert.ok(document.getElementById("attendanceDataStudentId"))
  assert.ok(document.getElementById("assignmentDataStudentId"))
  assert.ok(document.getElementById("performanceDataStudentId"))
  assert.ok(document.getElementById("gradeDataStudentId"))
  assert.ok(document.getElementById("reportDataStudentId"))
  assert.ok(document.getElementById("attendanceExportXlsxBtn"))
  assert.ok(document.getElementById("assignmentExportXlsxBtn"))
  assert.ok(document.getElementById("performanceExportXlsxBtn"))
  assert.ok(document.getElementById("gradeExportXlsxBtn"))
  assert.ok(document.getElementById("reportExportXlsxBtn"))
  assert.ok(document.getElementById("assignmentSaveTemplateBtn"))
  assert.ok(document.getElementById("gradeSaveBtn"))
  assert.ok(document.getElementById("reportSaveBtn"))

  await waitFor(() => {
    assert.ok(document.querySelectorAll("#gradeDataLevel option").length > 1)
  })
  const gradeLevelFilter = document.getElementById("gradeDataLevel")
  gradeLevelFilter.value = "Pre-A1 Starters"
  gradeLevelFilter.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  await waitFor(() => {
    const nameOptions = Array.from(document.querySelectorAll("#gradeDataStudentNameList option")).map((entry) => entry.value)
    assert.ok(nameOptions.includes("Student One"))
    assert.equal(nameOptions.includes("Steve Tester"), false)
  })
  gradeLevelFilter.value = ""
  gradeLevelFilter.dispatchEvent(new dom.window.Event("change", { bubbles: true }))

  const gradeNameFilter = document.getElementById("gradeDataStudentName")
  gradeNameFilter.value = "custom student search"
  gradeNameFilter.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
  assert.equal(gradeNameFilter.value, "custom student search")
  gradeNameFilter.value = ""
  gradeNameFilter.dispatchEvent(new dom.window.Event("input", { bubbles: true }))

  const gradeStudentIdFilter = document.getElementById("gradeDataStudentId")
  gradeStudentIdFilter.value = "STEVE001"
  gradeStudentIdFilter.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
  assert.equal(gradeStudentIdFilter.value, "steve001")
  assert.equal(gradeStudentIdFilter.validationMessage, "")
  gradeStudentIdFilter.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  await waitFor(() => {
    const idOptions = Array.from(document.querySelectorAll("#gradeDataStudentIdList option")).map((entry) => entry.value)
    assert.ok(idOptions.includes("steve001"))
  })
  gradeStudentIdFilter.value = "invalid12"
  gradeStudentIdFilter.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
  assert.match(gradeStudentIdFilter.validationMessage || "", /lowercase/i)
  gradeStudentIdFilter.value = ""
  gradeStudentIdFilter.dispatchEvent(new dom.window.Event("input", { bubbles: true }))

  const gradeSortField = document.getElementById("gradeSortField")
  gradeSortField.value = "score"
  gradeSortField.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  await waitFor(() => {
    const firstScore = (document.querySelector("#gradeRows tr td:nth-child(4)")?.textContent || "").trim()
    assert.equal(firstScore, "95/100")
  })
  await waitFor(() => {
    const actionCellText = document.querySelector("#gradeRows tr td:nth-child(9)")?.textContent || ""
    assert.match(actionCellText, /Edit/i)
    assert.match(actionCellText, /Delete/i)
  })

  document.getElementById("gradeSortDirBtn").click()
  await waitFor(() => {
    const firstScore = (document.querySelector("#gradeRows tr td:nth-child(4)")?.textContent || "").trim()
    assert.equal(firstScore, "70/100")
  })

  const gradeScoreHeader = document.querySelector('th[data-table-sort="grades"][data-sort-field="score"]')
  assert.ok(gradeScoreHeader)
  gradeScoreHeader.click()
  await waitFor(() => {
    const firstScore = (document.querySelector("#gradeRows tr td:nth-child(4)")?.textContent || "").trim()
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
    const firstHw = (document.querySelector("#pt_reportRows tr td:nth-child(4)")?.textContent || "").trim()
    assert.equal(firstHw, "90")
  })
  performanceHwHeader.click()
  await waitFor(() => {
    const firstHw = (document.querySelector("#pt_reportRows tr td:nth-child(4)")?.textContent || "").trim()
    assert.equal(firstHw, "60")
  })

  dom.window.close()
})
