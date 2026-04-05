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
  "news-reports",
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

test("admin ui preserves queue-hub deep link after login bootstrap", async () => {
  const rolePolicy = {
    role: "admin",
    canRead: true,
    canWrite: true,
    canManageUsers: true,
    canManagePermissions: true,
    startPage: "overview",
    allowedPages: [
      "overview",
      "queue-hub",
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
  }

  const dom = await createAdminUiDom(
    async (resource, init = {}) => {
      const url = String(resource)
      void init

      if (url.includes("/api/admin/auth/me")) return jsonResponse(401, { error: "Unauthorized" })
      if (url.includes("/api/admin/auth/login")) return jsonResponse(200, { user: { username: "admin", role: "admin" }, rolePolicy })
      if (url.includes("/api/admin/permissions")) {
        return jsonResponse(200, {
          roles: {
            admin: rolePolicy,
          },
        })
      }
      if (url.includes("/api/admin/users")) return jsonResponse(200, { items: [] })
      if (url.includes("/api/admin/filters")) return jsonResponse(200, { levels: [], schools: [] })
      if (url.includes("/api/admin/students")) return jsonResponse(200, { items: [] })
      if (url.includes("/api/admin/dashboard")) {
        return jsonResponse(200, {
          levelCompletion: [],
          classEnrollmentAttendance: [],
          weeklyAssignmentCompletion: [],
          today: {},
        })
      }
      if (url.includes("/api/admin/queue-hub")) return jsonResponse(200, { generatedAt: "", panelOrder: [], panels: [] })
      if (url.includes("/api/admin/notifications/batch-status")) return jsonResponse(200, { items: [], total: 0, hasMore: false })
      if (url.includes("/api/admin/exercise-results/incoming")) {
        return jsonResponse(200, { items: [], total: 0, hasMore: false, statuses: [] })
      }
      if (url.includes("/api/admin/exercise-titles")) return jsonResponse(200, { items: [] })
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
    },
    "http://127.0.0.1/admin/students/queue-hub"
  )

  submitLogin(dom)

  await waitFor(() => {
    assert.equal(dom.window.location.pathname, "/admin/students/queue-hub")
    const active = dom.window.document.querySelector(".page-section.active")
    assert.equal(active?.getAttribute("data-page"), "queue-hub")
  })

  await settleDomAsync(dom)
  dom.window.close()
})

test("admin ui resolves query deep link and keeps ?page routing after login bootstrap", async () => {
  const rolePolicy = {
    role: "admin",
    canRead: true,
    canWrite: true,
    canManageUsers: true,
    canManagePermissions: true,
    startPage: "overview",
    allowedPages: [
      "overview",
      "queue-hub",
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
  }

  const dom = await createAdminUiDom(
    async (resource, init = {}) => {
      const url = String(resource)
      void init

      if (url.includes("/api/admin/auth/me")) return jsonResponse(401, { error: "Unauthorized" })
      if (url.includes("/api/admin/auth/login")) return jsonResponse(200, { user: { username: "admin", role: "admin" }, rolePolicy })
      if (url.includes("/api/admin/permissions")) {
        return jsonResponse(200, {
          roles: {
            admin: rolePolicy,
          },
        })
      }
      if (url.includes("/api/admin/users")) return jsonResponse(200, { items: [] })
      if (url.includes("/api/admin/filters")) return jsonResponse(200, { levels: [], schools: [] })
      if (url.includes("/api/admin/students")) return jsonResponse(200, { items: [] })
      if (url.includes("/api/admin/dashboard")) {
        return jsonResponse(200, {
          levelCompletion: [],
          classEnrollmentAttendance: [],
          weeklyAssignmentCompletion: [],
          today: {},
        })
      }
      if (url.includes("/api/admin/queue-hub")) return jsonResponse(200, { generatedAt: "", panelOrder: [], panels: [] })
      if (url.includes("/api/admin/notifications/batch-status")) return jsonResponse(200, { items: [], total: 0, hasMore: false })
      if (url.includes("/api/admin/exercise-results/incoming")) {
        return jsonResponse(200, { items: [], total: 0, hasMore: false, statuses: [] })
      }
      if (url.includes("/api/admin/exercise-titles")) return jsonResponse(200, { items: [] })
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
    },
    "http://127.0.0.1/admin/students?page=grades-data"
  )

  submitLogin(dom)

  await waitFor(() => {
    assert.equal(dom.window.location.pathname, "/admin/students")
    assert.equal(dom.window.location.search, "?page=grades-data")
    const active = dom.window.document.querySelector(".page-section.active")
    assert.equal(active?.getAttribute("data-page"), "grades-data")
  })

  await settleDomAsync(dom)
  dom.window.close()
})

test("news review modal supports student-scoped navigation and modal review actions", async () => {
  const rolePolicy = {
    role: "admin",
    canRead: true,
    canWrite: true,
    canManageUsers: true,
    canManagePermissions: true,
    startPage: "overview",
    allowedPages: [...SCHOOL_SETUP_ADMIN_ALLOWED_PAGES],
  }
  let authenticated = false
  let latestQueryString = ""
  const requestLog = []
  const newsItems = Array.from({ length: 7 }, (_, index) => {
    const day = String(9 + index).padStart(2, "0")
    const reportDate = `2026-03-${day}`
    return {
      id: `news-00${index + 1}`,
      reportDate,
      sourceLink: `https://example.com/news/week-${index + 1}`,
      articleTitle: index === 6 ? "Market week wrap-up" : `Week article ${index + 1}`,
      leadSynopsis: `Summary ${index + 1}`,
      actionActor: "City leaders",
      actionAffected: "Families",
      actionWhere: "HCMC",
      actionWhat: `Policy update ${index + 1}`,
      actionWhy: "Public safety",
      submittedAt: `${reportDate}T08:00:00.000Z`,
      student: {
        studentRefId: "student-001",
        eaglesId: "vi001",
        studentNumber: 101,
        fullName: "Student One",
        englishName: "Student One",
        level: "Pre-A1 Starters",
      },
      reviewStatus: index === 6 ? "revision-requested" : "submitted",
      reviewNote: "",
      reviewedByUsername: "",
      reviewedAt: "",
    }
  })

  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const urlText = String(resource)
    const method = String(init.method || "GET").toUpperCase()
    const parsed = new URL(urlText, "http://127.0.0.1")
    const pathname = parsed.pathname

    if (pathname === "/api/admin/auth/me" && method === "GET") {
      if (!authenticated) return jsonResponse(401, { error: "Unauthorized" })
      return jsonResponse(200, {
        authenticated: true,
        user: { username: "admin", role: "admin" },
        rolePolicy,
      })
    }

    if (pathname === "/api/admin/auth/login" && method === "POST") {
      authenticated = true
      return jsonResponse(200, {
        user: { username: "admin", role: "admin" },
        rolePolicy,
      })
    }

    if (pathname === "/api/admin/permissions" && method === "GET") {
      return jsonResponse(200, {
        roles: {
          admin: { ...rolePolicy, allowedPages: [...rolePolicy.allowedPages] },
        },
      })
    }

    if (pathname === "/api/admin/users" && method === "GET") return jsonResponse(200, { items: [] })
    if (pathname === "/api/admin/filters" && method === "GET") {
      return jsonResponse(200, { levels: ["Pre-A1 Starters"], schools: ["Main"] })
    }
    if (pathname === "/api/admin/students" && method === "GET") {
      return jsonResponse(200, {
        items: [
          {
            id: "student-001",
            eaglesId: "vi001",
            studentNumber: 101,
            profile: { fullName: "Student One", englishName: "Student One", currentGrade: "Pre-A1 Starters" },
          },
        ],
      })
    }
    if (pathname === "/api/admin/dashboard" && method === "GET") {
      return jsonResponse(200, {
        levelCompletion: [],
        classEnrollmentAttendance: [],
        weeklyAssignmentCompletion: [],
        today: {},
      })
    }
    if (pathname === "/api/admin/queue-hub" && method === "GET") {
      return jsonResponse(200, { generatedAt: "", panelOrder: [], panels: [] })
    }
    if (pathname === "/api/admin/notifications/batch-status" && method === "GET") {
      return jsonResponse(200, { items: [], total: 0, hasMore: false })
    }
    if (pathname === "/api/admin/exercise-results/incoming" && method === "GET") {
      return jsonResponse(200, { items: [], total: 0, hasMore: false, statuses: [] })
    }
    if (pathname === "/api/admin/exercise-titles" && method === "GET") return jsonResponse(200, { items: [] })
    if (pathname === "/api/admin/runtime/service-control" && method === "GET") {
      return jsonResponse(200, {
        available: false,
        enabled: false,
        service: "exercise-mailer.service",
        status: "inactive",
        detail: "n/a",
      })
    }

    if (pathname === "/api/admin/news-reports" && method === "GET") {
      latestQueryString = parsed.search
      const status = parsed.searchParams.get("status") || "submitted"
      const query = String(parsed.searchParams.get("q") || "").toLowerCase().trim()
      const items = newsItems.filter((item) => {
        if (status !== "all" && String(item.reviewStatus || "").toLowerCase() !== status.toLowerCase()) return false
        if (query && !`${item.articleTitle} ${item.sourceLink} ${item.student?.fullName || ""}`.toLowerCase().includes(query)) {
          return false
        }
        return true
      })
      return jsonResponse(200, {
        total: items.length,
        hasMore: false,
        filters: {
          status,
          level: parsed.searchParams.get("level") || "",
          studentRefId: parsed.searchParams.get("studentRefId") || "",
          dateFrom: parsed.searchParams.get("dateFrom") || "",
          dateTo: parsed.searchParams.get("dateTo") || "",
          query: parsed.searchParams.get("q") || "",
          take: 200,
        },
        statusSummary: {
          submitted: items.filter((item) => item.reviewStatus === "submitted").length,
          approved: items.filter((item) => item.reviewStatus === "approved").length,
          revisionRequested: items.filter((item) => item.reviewStatus === "revision-requested").length,
        },
        items,
      })
    }

    if (pathname.startsWith("/api/admin/news-reports/") && method === "POST") {
      const reportId = pathname.split("/").pop() || ""
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      requestLog.push({
        method,
        pathname,
        body,
      })
      const targetIndex = newsItems.findIndex((item) => item.id === reportId)
      if (targetIndex >= 0) {
        newsItems[targetIndex] = {
          ...newsItems[targetIndex],
          reviewStatus: String(body.action || "") === "approve" ? "approved" : "revision-requested",
          reviewNote: String(body.reviewNote || ""),
          reviewedByUsername: "admin",
          reviewedAt: "2026-03-14T09:00:00.000Z",
        }
      }
      return jsonResponse(200, {
        ok: true,
        item: targetIndex >= 0 ? newsItems[targetIndex] : null,
      })
    }

    return jsonResponse(200, {})
  })

  submitLogin(dom)

  await waitFor(() => {
    const app = dom.window.document.getElementById("app")
    assert.equal(app.classList.contains("hidden"), false)
  })

  openPage(dom, "news-reports")

  assert.equal(
    dom.window.document.querySelector('#newsReviewStatusFilter option[value="revise"]'),
    null,
  )
  assert.equal(
    normalizeText(
      dom.window.document.querySelector('#newsReviewCheckFilter option[value="unapproved"]')?.textContent,
    ),
    "Unapproved",
  )

  await waitFor(() => {
    const rows = dom.window.document.querySelectorAll("#newsReviewRows tr")
    assert.equal(rows.length, 1)
    assert.match(rows[0].textContent || "", /2026-03-09 to 2026-03-15/i)
    assert.match(rows[0].textContent || "", /Waiting/i)
    assert.match(rows[0].textContent || "", /Unapproved-6/i)
  })

  const document = dom.window.document
  const firstRow = document.querySelector('#newsReviewRows tr[data-news-review-week-set-id]')
  firstRow.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))

  await waitFor(() => {
    const viewer = document.getElementById("newsReviewViewerModal")
    assert.equal(viewer.classList.contains("hidden"), false)
    assert.match(normalizeText(document.getElementById("newsReviewViewerBody").textContent), /Week article|Market week wrap-up/i)
    assert.match(normalizeText(document.getElementById("newsReviewViewerBody").textContent), /Revise|Submitted/i)
    assert.match(normalizeText(document.getElementById("newsReviewViewerStatus").textContent), /Opened week set/i)
    assert.equal(normalizeText(document.getElementById("newsReviewViewerIndex").textContent), "1 / 7")
  })
  const firstBodyText = normalizeText(document.getElementById("newsReviewViewerBody").textContent)
  document.getElementById("newsReviewViewerNextBtn").click()

  await waitFor(() => {
    assert.equal(normalizeText(document.getElementById("newsReviewViewerIndex").textContent), "2 / 7")
    assert.notEqual(normalizeText(document.getElementById("newsReviewViewerBody").textContent), firstBodyText)
  })

  const queryInput = document.getElementById("newsReviewQueryFilter")
  queryInput.value = "market"
  queryInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }))

  await waitFor(() => {
    assert.match(latestQueryString, /status=all/i)
  })

  const modalNote = document.getElementById("newsReviewViewerNote")
  modalNote.value = "Needs one more source citation."
  const approveBtn = document.getElementById("newsReviewViewerApproveBtn")
  approveBtn.click()

  await waitFor(() => {
    const post = requestLog.find((entry) => entry.method === "POST" && entry.pathname.startsWith("/api/admin/news-reports/news-"))
    assert.ok(post)
    assert.equal(post.body.action, "approve")
    assert.equal(post.body.reviewNote, "Needs one more source citation.")
  })
  await waitFor(() => {
    const statusText = normalizeText(document.getElementById("status").textContent)
    assert.match(statusText, /News report .* approved/i)
  })

  const statusSelect = document.getElementById("newsReviewStatusFilter")
  statusSelect.value = "approved"
  statusSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }))

  await waitFor(() => {
    assert.match(latestQueryString, /status=all/i)
    const rows = Array.from(document.querySelectorAll("#newsReviewRows tr"))
    assert.equal(rows.length, 1)
    assert.match(rows[0].textContent || "", /No student week sets/i)
  })

  await settleDomAsync(dom)
  dom.window.close()
})

test("news review queue includes incomplete student week sets and marks status", async () => {
  const rolePolicy = {
    role: "admin",
    canRead: true,
    canWrite: true,
    canManageUsers: true,
    canManagePermissions: true,
    startPage: "overview",
    allowedPages: [...SCHOOL_SETUP_ADMIN_ALLOWED_PAGES],
  }
  let authenticated = false
  let latestQueryString = ""
  const newsItems = Array.from({ length: 5 }, (_, index) => {
    const day = String(9 + index).padStart(2, "0")
    const reportDate = `2026-03-${day}`
    return {
      id: `news-incomplete-00${index + 1}`,
      reportDate,
      sourceLink: `https://example.com/news/incomplete-${index + 1}`,
      articleTitle: `Incomplete week article ${index + 1}`,
      leadSynopsis: `Incomplete summary ${index + 1}`,
      actionActor: "City leaders",
      actionAffected: "Families",
      actionWhere: "HCMC",
      actionWhat: `Policy update ${index + 1}`,
      actionWhy: "Public safety",
      submittedAt: `${reportDate}T08:00:00.000Z`,
      student: {
        studentRefId: "student-001",
        eaglesId: "vi001",
        studentNumber: 101,
        fullName: "Student One",
        englishName: "Student One",
        level: "Pre-A1 Starters",
      },
      reviewStatus: "revision-requested",
      reviewNote: "",
      reviewedByUsername: "",
      reviewedAt: "",
    }
  })

  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const urlText = String(resource)
    const method = String(init.method || "GET").toUpperCase()
    const parsed = new URL(urlText, "http://127.0.0.1")
    const pathname = parsed.pathname

    if (pathname === "/api/admin/auth/me" && method === "GET") {
      if (!authenticated) return jsonResponse(401, { error: "Unauthorized" })
      return jsonResponse(200, {
        authenticated: true,
        user: { username: "admin", role: "admin" },
        rolePolicy,
      })
    }
    if (pathname === "/api/admin/auth/login" && method === "POST") {
      authenticated = true
      return jsonResponse(200, {
        user: { username: "admin", role: "admin" },
        rolePolicy,
      })
    }
    if (pathname === "/api/admin/permissions" && method === "GET") {
      return jsonResponse(200, {
        roles: {
          admin: { ...rolePolicy, allowedPages: [...rolePolicy.allowedPages] },
        },
      })
    }
    if (pathname === "/api/admin/users" && method === "GET") return jsonResponse(200, { items: [] })
    if (pathname === "/api/admin/filters" && method === "GET") {
      return jsonResponse(200, { levels: ["Pre-A1 Starters"], schools: ["Main"] })
    }
    if (pathname === "/api/admin/students" && method === "GET") {
      return jsonResponse(200, {
        items: [
          {
            id: "student-001",
            eaglesId: "vi001",
            studentNumber: 101,
            profile: { fullName: "Student One", englishName: "Student One", currentGrade: "Pre-A1 Starters" },
          },
        ],
      })
    }
    if (pathname === "/api/admin/dashboard" && method === "GET") {
      return jsonResponse(200, {
        levelCompletion: [],
        classEnrollmentAttendance: [],
        weeklyAssignmentCompletion: [],
        today: {},
      })
    }
    if (pathname === "/api/admin/queue-hub" && method === "GET") return jsonResponse(200, { generatedAt: "", panelOrder: [], panels: [] })
    if (pathname === "/api/admin/notifications/batch-status" && method === "GET") {
      return jsonResponse(200, { items: [], total: 0, hasMore: false })
    }
    if (pathname === "/api/admin/exercise-results/incoming" && method === "GET") {
      return jsonResponse(200, { items: [], total: 0, hasMore: false, statuses: [] })
    }
    if (pathname === "/api/admin/exercise-titles" && method === "GET") return jsonResponse(200, { items: [] })
    if (pathname === "/api/admin/runtime/service-control" && method === "GET") {
      return jsonResponse(200, {
        available: false,
        enabled: false,
        service: "exercise-mailer.service",
        status: "inactive",
        detail: "n/a",
      })
    }
    if (pathname === "/api/admin/news-reports" && method === "GET") {
      latestQueryString = parsed.search
      return jsonResponse(200, {
        total: newsItems.length,
        hasMore: false,
        filters: {
          status: parsed.searchParams.get("status") || "all",
          level: parsed.searchParams.get("level") || "",
          studentRefId: parsed.searchParams.get("studentRefId") || "",
          dateFrom: parsed.searchParams.get("dateFrom") || "",
          dateTo: parsed.searchParams.get("dateTo") || "",
          query: parsed.searchParams.get("q") || "",
          take: 200,
        },
        statusSummary: {
          submitted: newsItems.length,
          approved: 0,
          revisionRequested: 0,
        },
        items: newsItems,
      })
    }
    return jsonResponse(200, {})
  })

  submitLogin(dom)
  await waitFor(() => {
    const app = dom.window.document.getElementById("app")
    assert.equal(app.classList.contains("hidden"), false)
  })

  openPage(dom, "news-reports")
  await waitFor(() => {
    assert.match(latestQueryString, /status=all/i)
    const row = dom.window.document.querySelector("#newsReviewRows tr[data-news-review-week-set-id]")
    assert.ok(row)
    assert.match(row.textContent || "", /5\/7/i)
    assert.match(row.textContent || "", /Waiting/i)
    assert.match(row.textContent || "", /Incomplete/i)
    const summaryText = normalizeText(dom.window.document.getElementById("newsReviewSummary").textContent)
    assert.match(summaryText, /incomplete=1/i)
    assert.match(summaryText, /unapproved=0/i)
    assert.match(summaryText, /waiting=1/i)
    assert.match(summaryText, /checked=0/i)
    assert.doesNotMatch(summaryText, /submitted=/i)
  })

  const reviewCheckSelect = dom.window.document.getElementById("newsReviewCheckFilter")
  reviewCheckSelect.value = "completed"
  reviewCheckSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }))

  await waitFor(() => {
    const rows = Array.from(dom.window.document.querySelectorAll("#newsReviewRows tr"))
    assert.equal(rows.length, 1)
    assert.match(rows[0].textContent || "", /No student week sets/i)
  })

  await settleDomAsync(dom)
  dom.window.close()
})

test("news review week-set table headers sort all visible columns", async () => {
  const rolePolicy = {
    role: "admin",
    canRead: true,
    canWrite: true,
    canManageUsers: true,
    canManagePermissions: true,
    startPage: "overview",
    allowedPages: [...SCHOOL_SETUP_ADMIN_ALLOWED_PAGES],
  }
  let authenticated = false

  const shiftDays = (value, offset) => {
    const date = new Date(value.getTime())
    date.setDate(date.getDate() + offset)
    return date
  }
  const weekStartForOffset = (offsetWeeks = 0) => {
    const today = new Date()
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const day = monday.getDay()
    const diffToMonday = (day + 6) % 7
    monday.setDate(monday.getDate() - diffToMonday + (offsetWeeks * 7))
    return monday
  }
  const buildWeekReports = ({ idPrefix, student, weekStart, reportCount, reviewStatus = "submitted" }) =>
    Array.from({ length: reportCount }, (_, index) => {
      const reportDate = localIsoDate(shiftDays(weekStart, index))
      return {
        id: `${idPrefix}-${String(index + 1).padStart(2, "0")}`,
        reportDate,
        sourceLink: `https://example.com/news/${idPrefix}-${index + 1}`,
        articleTitle: `${student.fullName} article ${index + 1}`,
        leadSynopsis: `${student.fullName} summary ${index + 1}`,
        actionActor: "City leaders",
        actionAffected: "Families",
        actionWhere: "HCMC",
        actionWhat: `Policy update ${index + 1}`,
        actionWhy: "Public safety",
        submittedAt: `${reportDate}T08:00:00.000Z`,
        student: { ...student },
        reviewStatus,
        reviewNote: "",
        reviewedByUsername: "",
        reviewedAt: "",
      }
    })

  const oldestWeekStart = weekStartForOffset(-3)
  const middleWeekStart = weekStartForOffset(-2)
  const newestWeekStart = weekStartForOffset(-1)
  const newsItems = [
    ...buildWeekReports({
      idPrefix: "alpha",
      student: {
        studentRefId: "student-alpha",
        eaglesId: "alpha001",
        studentNumber: 101,
        fullName: "Alpha Student",
        englishName: "Alpha Student",
        level: "A2 KET",
      },
      weekStart: oldestWeekStart,
      reportCount: 5,
      reviewStatus: "submitted",
    }),
    ...buildWeekReports({
      idPrefix: "bravo",
      student: {
        studentRefId: "student-bravo",
        eaglesId: "bravo001",
        studentNumber: 102,
        fullName: "Bravo Student",
        englishName: "Bravo Student",
        level: "A1 Movers",
      },
      weekStart: middleWeekStart,
      reportCount: 7,
      reviewStatus: "approved",
    }),
    ...buildWeekReports({
      idPrefix: "charlie",
      student: {
        studentRefId: "student-charlie",
        eaglesId: "charlie001",
        studentNumber: 103,
        fullName: "Charlie Student",
        englishName: "Charlie Student",
        level: "Pre-A1 Starters",
      },
      weekStart: newestWeekStart,
      reportCount: 6,
      reviewStatus: "submitted",
    }),
  ]

  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const urlText = String(resource)
    const method = String(init.method || "GET").toUpperCase()
    const parsed = new URL(urlText, "http://127.0.0.1")
    const pathname = parsed.pathname

    if (pathname === "/api/admin/auth/me" && method === "GET") {
      if (!authenticated) return jsonResponse(401, { error: "Unauthorized" })
      return jsonResponse(200, {
        authenticated: true,
        user: { username: "admin", role: "admin" },
        rolePolicy,
      })
    }
    if (pathname === "/api/admin/auth/login" && method === "POST") {
      authenticated = true
      return jsonResponse(200, {
        user: { username: "admin", role: "admin" },
        rolePolicy,
      })
    }
    if (pathname === "/api/admin/permissions" && method === "GET") {
      return jsonResponse(200, {
        roles: {
          admin: { ...rolePolicy, allowedPages: [...rolePolicy.allowedPages] },
        },
      })
    }
    if (pathname === "/api/admin/users" && method === "GET") return jsonResponse(200, { items: [] })
    if (pathname === "/api/admin/filters" && method === "GET") {
      return jsonResponse(200, { levels: ["Pre-A1 Starters", "A1 Movers", "A2 KET"], schools: ["Main"] })
    }
    if (pathname === "/api/admin/students" && method === "GET") {
      return jsonResponse(200, {
        items: [
          {
            id: "student-alpha",
            eaglesId: "alpha001",
            studentNumber: 101,
            profile: { fullName: "Alpha Student", englishName: "Alpha Student", currentGrade: "A2 KET" },
          },
          {
            id: "student-bravo",
            eaglesId: "bravo001",
            studentNumber: 102,
            profile: { fullName: "Bravo Student", englishName: "Bravo Student", currentGrade: "A1 Movers" },
          },
          {
            id: "student-charlie",
            eaglesId: "charlie001",
            studentNumber: 103,
            profile: { fullName: "Charlie Student", englishName: "Charlie Student", currentGrade: "Pre-A1 Starters" },
          },
        ],
      })
    }
    if (pathname === "/api/admin/dashboard" && method === "GET") {
      return jsonResponse(200, {
        levelCompletion: [],
        classEnrollmentAttendance: [],
        weeklyAssignmentCompletion: [],
        today: {},
      })
    }
    if (pathname === "/api/admin/queue-hub" && method === "GET") return jsonResponse(200, { generatedAt: "", panelOrder: [], panels: [] })
    if (pathname === "/api/admin/notifications/batch-status" && method === "GET") {
      return jsonResponse(200, { items: [], total: 0, hasMore: false })
    }
    if (pathname === "/api/admin/exercise-results/incoming" && method === "GET") {
      return jsonResponse(200, { items: [], total: 0, hasMore: false, statuses: [] })
    }
    if (pathname === "/api/admin/exercise-titles" && method === "GET") return jsonResponse(200, { items: [] })
    if (pathname === "/api/admin/runtime/service-control" && method === "GET") {
      return jsonResponse(200, {
        available: false,
        enabled: false,
        service: "exercise-mailer.service",
        status: "inactive",
        detail: "n/a",
      })
    }
    if (pathname === "/api/admin/news-reports" && method === "GET") {
      return jsonResponse(200, {
        total: newsItems.length,
        hasMore: false,
        filters: {
          status: parsed.searchParams.get("status") || "all",
          level: parsed.searchParams.get("level") || "",
          studentRefId: parsed.searchParams.get("studentRefId") || "",
          dateFrom: parsed.searchParams.get("dateFrom") || "",
          dateTo: parsed.searchParams.get("dateTo") || "",
          query: parsed.searchParams.get("q") || "",
          take: 200,
        },
        statusSummary: {
          submitted: 11,
          approved: 7,
          revisionRequested: 0,
        },
        items: newsItems,
      })
    }
    return jsonResponse(200, {})
  })

  submitLogin(dom)
  await waitFor(() => {
    const app = dom.window.document.getElementById("app")
    assert.equal(app.classList.contains("hidden"), false)
  })

  openPage(dom, "news-reports")
  const document = dom.window.document
  const getRows = () => Array.from(document.querySelectorAll("#newsReviewRows tr[data-news-review-week-set-id]"))

  await waitFor(() => {
    assert.equal(getRows().length, 3)
  })

  const sortableFields = ["weekSet", "student", "level", "reports", "setAction", "setStatus", "latestSubmittedAt"]
  sortableFields.forEach((field) => {
    const header = document.querySelector(`th[data-table-sort=\"newsReview\"][data-sort-field=\"${field}\"]`)
    assert.ok(header)
    assert.equal(header.getAttribute("tabindex"), "0")
  })

  const weekSetHeader = document.querySelector('th[data-table-sort="newsReview"][data-sort-field="weekSet"]')
  assert.ok(weekSetHeader)
  weekSetHeader.click()
  await waitFor(() => {
    assert.equal(weekSetHeader.getAttribute("aria-sort"), "ascending")
    const firstWeekSetCell = normalizeText(getRows()[0]?.querySelector("td:nth-child(1)")?.textContent)
    assert.match(firstWeekSetCell, new RegExp(`^${localIsoDate(oldestWeekStart)}`))
  })

  const reportsHeader = document.querySelector('th[data-table-sort="newsReview"][data-sort-field="reports"]')
  assert.ok(reportsHeader)
  reportsHeader.click()
  await waitFor(() => {
    assert.equal(reportsHeader.getAttribute("aria-sort"), "descending")
    const firstReportsCell = normalizeText(getRows()[0]?.querySelector("td:nth-child(4)")?.textContent)
    assert.equal(firstReportsCell, "7/7")
  })
  reportsHeader.click()
  await waitFor(() => {
    assert.equal(reportsHeader.getAttribute("aria-sort"), "ascending")
    const firstReportsCell = normalizeText(getRows()[0]?.querySelector("td:nth-child(4)")?.textContent)
    assert.equal(firstReportsCell, "5/7")
  })

  const statusHeader = document.querySelector('th[data-table-sort="newsReview"][data-sort-field="setStatus"]')
  assert.ok(statusHeader)
  statusHeader.click()
  await waitFor(() => {
    assert.equal(statusHeader.getAttribute("aria-sort"), "descending")
    const firstStatusCell = normalizeText(getRows()[0]?.querySelector("td:nth-child(6)")?.textContent)
    assert.equal(firstStatusCell, "Waiting")
  })
  statusHeader.click()
  await waitFor(() => {
    assert.equal(statusHeader.getAttribute("aria-sort"), "ascending")
    const firstStatusCell = normalizeText(getRows()[0]?.querySelector("td:nth-child(6)")?.textContent)
    assert.equal(firstStatusCell, "Approved")
  })

  const setActionHeader = document.querySelector('th[data-table-sort="newsReview"][data-sort-field="setAction"]')
  assert.ok(setActionHeader)
  setActionHeader.click()
  await waitFor(() => {
    assert.equal(setActionHeader.getAttribute("aria-sort"), "descending")
    const firstActionCell = normalizeText(getRows()[0]?.querySelector("td:nth-child(5)")?.textContent)
    assert.equal(firstActionCell, "Unapproved-6")
  })
  setActionHeader.click()
  await waitFor(() => {
    assert.equal(setActionHeader.getAttribute("aria-sort"), "ascending")
    const firstActionCell = normalizeText(getRows()[0]?.querySelector("td:nth-child(5)")?.textContent)
    assert.equal(firstActionCell, "Completed")
  })

  const latestHeader = document.querySelector('th[data-table-sort="newsReview"][data-sort-field="latestSubmittedAt"]')
  assert.ok(latestHeader)
  latestHeader.click()
  await waitFor(() => {
    assert.equal(latestHeader.getAttribute("aria-sort"), "descending")
    const firstStudentCell = normalizeText(getRows()[0]?.querySelector("td:nth-child(2)")?.textContent)
    assert.match(firstStudentCell, /Charlie Student/i)
  })

  const studentHeader = document.querySelector('th[data-table-sort="newsReview"][data-sort-field="student"]')
  assert.ok(studentHeader)
  studentHeader.click()
  studentHeader.click()
  await waitFor(() => {
    assert.equal(studentHeader.getAttribute("aria-sort"), "ascending")
    const firstStudentCell = normalizeText(getRows()[0]?.querySelector("td:nth-child(2)")?.textContent)
    assert.match(firstStudentCell, /Alpha Student/i)
  })

  await settleDomAsync(dom)
  dom.window.close()
})

test("queue hub news panel opens news-reports viewer for clicked row", async () => {
  const rolePolicy = {
    role: "admin",
    canRead: true,
    canWrite: true,
    canManageUsers: true,
    canManagePermissions: true,
    startPage: "overview",
    allowedPages: [...SCHOOL_SETUP_ADMIN_ALLOWED_PAGES, "queue-hub"],
  }
  let authenticated = false
  let latestNewsReportsSearch = ""

  const queuePayload = {
    generatedAt: "2026-03-15T01:45:00.000Z",
    panelOrder: [
      "news-report-review",
      "queued-performance-reports",
      "unmatched-exercise-submissions",
      "current-assignments-pending",
      "overdue-homework",
      "attendance-risk",
      "pending-profile-submissions",
    ],
    panels: [
      {
        id: "news-report-review",
        title: "News Report Week Sets",
        total: 1,
        items: [
          {
            id: "news-week-set:student-001:2026-03-09",
            studentRefId: "student-001",
            eaglesId: "vi001",
            studentNumber: 101,
            fullName: "Student One",
            englishName: "Student One",
            level: "Pre-A1 Starters",
            weekStart: "2026-03-09",
            weekEnd: "2026-03-15",
            reportCount: 7,
            submittedCount: 7,
            approvedCount: 0,
            revisionRequestedCount: 0,
            setStatus: "submitted",
            setAction: "unapproved-7",
            setActionColor: "turquoise",
            latestReportId: "news-007",
            latestReportDate: "2026-03-15",
            latestSubmittedAt: "2026-03-15T08:00:00.000Z",
            latestReviewStatus: "submitted",
            latestArticleTitle: "Market week wrap-up",
            latestSourceLink: "https://example.com/news/week-7",
          },
        ],
      },
    ],
  }

  const newsItems = Array.from({ length: 7 }, (_, index) => {
    const day = String(9 + index).padStart(2, "0")
    const reportDate = `2026-03-${day}`
    return {
      id: `news-00${index + 1}`,
      studentRefId: "student-001",
      reportDate,
      sourceLink: `https://example.com/news/week-${index + 1}`,
      articleTitle: index === 6 ? "Market week wrap-up" : `Week article ${index + 1}`,
      leadSynopsis: `Summary ${index + 1}`,
      actionActor: "City leaders",
      actionAffected: "Families",
      actionWhere: "HCMC",
      actionWhat: `Policy update ${index + 1}`,
      actionWhy: "Public safety",
      submittedAt: `${reportDate}T08:00:00.000Z`,
      reviewStatus: "submitted",
      reviewNote: "",
      reviewedByUsername: "",
      reviewedAt: "",
      student: {
        studentRefId: "student-001",
        eaglesId: "vi001",
        studentNumber: 101,
        fullName: "Student One",
        englishName: "Student One",
        level: "Pre-A1 Starters",
      },
    }
  })

  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const urlText = String(resource)
    const method = String(init.method || "GET").toUpperCase()
    const parsed = new URL(urlText, "http://127.0.0.1")
    const pathname = parsed.pathname

    if (pathname === "/api/admin/auth/me" && method === "GET") {
      if (!authenticated) return jsonResponse(401, { error: "Unauthorized" })
      return jsonResponse(200, {
        authenticated: true,
        user: { username: "admin", role: "admin" },
        rolePolicy,
      })
    }
    if (pathname === "/api/admin/auth/login" && method === "POST") {
      authenticated = true
      return jsonResponse(200, {
        user: { username: "admin", role: "admin" },
        rolePolicy,
      })
    }
    if (pathname === "/api/admin/permissions" && method === "GET") {
      return jsonResponse(200, {
        roles: {
          admin: { ...rolePolicy, allowedPages: [...rolePolicy.allowedPages] },
        },
      })
    }
    if (pathname === "/api/admin/users" && method === "GET") return jsonResponse(200, { items: [] })
    if (pathname === "/api/admin/filters" && method === "GET") {
      return jsonResponse(200, { levels: ["Pre-A1 Starters"], schools: ["Main"] })
    }
    if (pathname === "/api/admin/students" && method === "GET") {
      return jsonResponse(200, {
        items: [
          {
            id: "student-001",
            eaglesId: "vi001",
            studentNumber: 101,
            profile: { fullName: "Student One", englishName: "Student One", currentGrade: "Pre-A1 Starters" },
          },
        ],
      })
    }
    if (pathname === "/api/admin/dashboard" && method === "GET") {
      return jsonResponse(200, {
        levelCompletion: [],
        classEnrollmentAttendance: [],
        weeklyAssignmentCompletion: [],
        today: {},
      })
    }
    if (pathname === "/api/admin/queue-hub" && method === "GET") return jsonResponse(200, queuePayload)
    if (pathname === "/api/admin/notifications/batch-status" && method === "GET") {
      return jsonResponse(200, { items: [], total: 0, hasMore: false })
    }
    if (pathname === "/api/admin/exercise-results/incoming" && method === "GET") {
      return jsonResponse(200, { items: [], total: 0, hasMore: false, statuses: [] })
    }
    if (pathname === "/api/admin/exercise-titles" && method === "GET") return jsonResponse(200, { items: [] })
    if (pathname === "/api/admin/runtime/service-control" && method === "GET") {
      return jsonResponse(200, {
        available: false,
        enabled: false,
        service: "exercise-mailer.service",
        status: "inactive",
        detail: "n/a",
      })
    }
    if (pathname === "/api/admin/news-reports" && method === "GET") {
      latestNewsReportsSearch = parsed.search
      return jsonResponse(200, {
        total: newsItems.length,
        hasMore: false,
        filters: {
          status: parsed.searchParams.get("status") || "submitted",
          level: parsed.searchParams.get("level") || "",
          studentRefId: parsed.searchParams.get("studentRefId") || "",
          dateFrom: parsed.searchParams.get("dateFrom") || "",
          dateTo: parsed.searchParams.get("dateTo") || "",
          query: parsed.searchParams.get("q") || "",
          take: Number.parseInt(String(parsed.searchParams.get("take") || "200"), 10) || 200,
        },
        statusSummary: {
          submitted: 1,
          approved: 0,
          revisionRequested: 0,
        },
        items: newsItems,
      })
    }
    return jsonResponse(200, {})
  })

  submitLogin(dom)

  await waitFor(() => {
    const app = dom.window.document.getElementById("app")
    assert.equal(app.classList.contains("hidden"), false)
  })

  openPage(dom, "queue-hub")

  await waitFor(() => {
    const openBtn = dom.window.document.querySelector(
      'button[data-queue-hub-open-panel="news-report-review"][data-queue-hub-open-index="0"]'
    )
    assert.ok(openBtn)
    const newsPanel = openBtn.closest(".queue-hub-panel")
    assert.match(normalizeText(newsPanel?.textContent), /Action/i)
    assert.match(normalizeText(newsPanel?.textContent), /Unapproved-7/i)
    assert.match(normalizeText(newsPanel?.textContent), /Waiting/i)
  })

  dom.window.document
    .querySelector('button[data-queue-hub-open-panel="news-report-review"][data-queue-hub-open-index="0"]')
    .click()

  await waitFor(() => {
    assert.equal(dom.window.location.pathname, "/admin/students/news-reports")
    const active = dom.window.document.querySelector(".page-section.active")
    assert.equal(active?.getAttribute("data-page"), "news-reports")
    assert.match(latestNewsReportsSearch, /status=all/i)
    assert.match(latestNewsReportsSearch, /studentRefId=student-001/i)
    assert.equal(dom.window.document.getElementById("newsReviewViewerModal").classList.contains("hidden"), false)
    assert.match(
      normalizeText(dom.window.document.getElementById("newsReviewViewerBody").textContent),
      /Market week wrap-up|Week article/i
    )
    assert.equal(normalizeText(dom.window.document.getElementById("newsReviewViewerIndex").textContent), "1 / 7")
  })

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
    assert.match(options[0].value, /^SIS-002$/i)
  })

  openPage(dom, "assignments")
  await waitFor(() => {
    const studentOptions = Array.from(document.querySelectorAll("#assignStudent option"))
    const optionText = studentOptions.map((option) => normalizeText(option.textContent || ""))
    assert.equal(optionText.some((text) => /\bSIS-002\b/i.test(text)), true)
    assert.equal(optionText.some((text) => /\bSIS-001\b/i.test(text)), false)
  })

  openPage(dom, "attendance")
  await waitFor(() => {
    const starterTile = document.querySelector(
      '#attendanceLevelTiles .attendance-level-tile[data-level="Pre-A1 Starters"]'
    )
    assert.ok(starterTile)
    starterTile.click()
  })
  await waitFor(() => {
    const attendanceText = normalizeText(document.getElementById("attendanceLandingRows")?.textContent || "")
    assert.match(attendanceText, /Starter Student/i)
    assert.match(attendanceText, /\bSIS-001\b/i)
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

test("top search option value stays canonical eaglesId when fullName is missing", async () => {
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
    assert.match(normalizeText(options[0].value), /^anna002$/i)
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

test("student rows missing identity keys are excluded from lists", async () => {
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
      return jsonResponse(200, {
        items: [
          {
            id: "invalid-1",
            eaglesId: "",
            studentNumber: 100,
            profile: { fullName: "Broken Identity", englishName: "Broken", currentGrade: "A1 Movers" },
            counts: { attendanceRecords: 0 },
          },
          {
            id: "invalid-2",
            eaglesId: "SIS-000",
            studentNumber: null,
            profile: { fullName: "Missing Number", englishName: "Missing Number", currentGrade: "A1 Movers" },
            counts: { attendanceRecords: 0 },
          },
          {
            id: "valid-1",
            eaglesId: "SIS-001",
            studentNumber: 101,
            profile: { fullName: "Valid Student", englishName: "Valid", currentGrade: "A1 Movers" },
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
    const rows = dom.window.document.querySelectorAll("#studentRows tr")
    assert.equal(rows.length, 1)
    assert.equal(normalizeText(rows[0].querySelector("td:nth-child(1)")?.textContent), "SIS-001")
  })

  await waitFor(() => {
    const options = Array.from(dom.window.document.querySelectorAll("#searchStudentOptions option"))
    assert.ok(options.length >= 1)
    const values = options.map((entry) => normalizeText(entry.value))
    assert.equal(values.some((value) => /SIS-001/i.test(value)), true)
    assert.equal(values.some((value) => /Broken Identity/i.test(value)), false)
    assert.equal(values.some((value) => /Missing Number/i.test(value)), false)
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
        attendanceRiskWeek: {
          total: 2,
          students: [
            {
              studentRefId: "stu-01",
              eaglesId: "SIS-001",
              fullName: "Student One",
              level: "Pre-A1 Starters",
              absences: 2,
              late30Plus: 0,
              outstandingWeek: 0,
            },
            {
              studentRefId: "stu-99",
              eaglesId: "SIS-099",
              fullName: "Other Level Student",
              level: "A1 Movers",
              absences: 0,
              late30Plus: 1,
              outstandingWeek: 0,
            },
          ],
        },
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

  const nameHeader = document.querySelector('th[data-top-search-sort="fullName"]')
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
    const firstLevelText = normalizeText(document.querySelector("#topSearchRows tr td:nth-child(4)")?.textContent)
    assert.match(firstLevelText, /EggChic|Starters/i)
    assert.equal(levelHeader.getAttribute("aria-sort"), "ascending")
  })

  dom.window.close()
})

test("static preview path over http requires explicit apiOrigin", async () => {
  const calls = []
  const dom = await createAdminUiDom(
    async (resource, init = {}) => {
      const url = String(resource)
      const method = init.method || "GET"
      calls.push(`${method} ${url}`)

      if (url.includes("/healthz")) return jsonResponse(200, { status: "ok", lastVerifyOk: true })

      if (url.includes("/api/admin/auth/me")) return jsonResponse(401, { error: "Unauthorized" })
      if (url.includes("/api/admin/auth/login")) return jsonResponse(200, { user: { username: "admin", role: "admin" } })
      return jsonResponse(200, {})
    },
    "http://127.0.0.1:46145/web-asset/admin/student-admin.html"
  )

  const document = dom.window.document
  await waitFor(() => {
    assert.match(document.getElementById("status").textContent, /Static preview mode requires \?apiOrigin=/i)
  })

  submitLogin(dom)

  await waitFor(() => {
    assert.match(document.getElementById("status").textContent, /Static preview mode requires \?apiOrigin=/i)
  })

  assert.ok(!calls.some((entry) => entry.includes("/healthz")))
  assert.ok(!calls.some((entry) => entry.includes("/api/admin/auth/me")))
  assert.ok(!calls.some((entry) => entry.includes("/api/admin/auth/login")))
  assert.equal(document.getElementById("authPanel").classList.contains("hidden"), false)
  assert.equal(document.getElementById("app").classList.contains("hidden"), true)

  dom.window.close()
})

test("static preview path over http supports login when apiOrigin is explicit", async () => {
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
    "http://127.0.0.1:46145/web-asset/admin/student-admin.html?apiOrigin=http://127.0.0.1:8788"
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
    assert.ok(calls.some((entry) => entry === "POST http://127.0.0.1:8788/api/admin/auth/login"))
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
              lastError: "transient timeout",
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
    const pipeline = dom.window.document.querySelector('[data-system-key="pipeline"]')
    assert.ok(adminRuntime?.classList.contains("ok"))
    assert.ok(sessionStore?.classList.contains("ok"))
    assert.ok(filterCache?.classList.contains("warn"))
    assert.equal(filterCache?.classList.contains("error"), false)
    assert.ok(selfHeal?.classList.contains("ok"))
    assert.ok(pipeline?.classList.contains("ok"))
    assert.match(adminRuntime?.textContent || "", /page=\/admin\/students/i)
    assert.match(sessionStore?.textContent || "", /driver=redis/i)
    assert.match(filterCache?.textContent || "", /backend=redis/i)
    assert.match(selfHeal?.textContent || "", /result=in-sync/i)
    assert.match(pipeline?.textContent || "", /exercise=ok/i)
  })

  assert.ok(calls.some((entry) => entry.includes("/api/sis-admin/runtime/health")))

  dom.window.close()
})

test("recent pipeline check is pending when runtime flags are n/a", async () => {
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
    async (resource) => {
      const url = String(resource)

      if (url.includes("/healthz")) return jsonResponse(403, { error: "Forbidden" })
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
          studentAdminRuntime: {
            pagePath: "/admin/students",
            apiPrefix: "/api/sis-admin",
            sessionDriver: "redis",
            sessionTtlSeconds: 28800,
            filterCache: {
              backend: "redis",
              hits: 93,
              misses: 26,
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
        return jsonResponse(200, { role: "admin", roles: { admin: adminRolePolicy } })
      }
      if (url.includes("/api/sis-admin/users")) return jsonResponse(200, { items: [] })
      if (url.includes("/api/sis-admin/filters")) return jsonResponse(200, { levels: [], schools: [] })
      if (url.includes("/api/sis-admin/students")) return jsonResponse(200, { items: [] })
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
        return jsonResponse(200, { total: 0, hasMore: false, statuses: [], items: [] })
      }
      if (url.includes("/api/sis-admin/exercise-titles")) return jsonResponse(200, { items: [] })
      if (url.includes("/api/sis-admin/notifications/batch-status")) {
        return jsonResponse(200, { ok: true, queueType: "parent-report", total: 0, hasMore: false, items: [] })
      }

      return jsonResponse(200, {})
    },
    "https://admin.eagles.edu.vn/sis-admin/student-admin.html"
  )

  await waitFor(() => {
    const pipeline = dom.window.document.querySelector('[data-system-key="pipeline"]')
    assert.ok(pipeline?.classList.contains("pending"))
    assert.match(pipeline?.textContent || "", /exercise=n\/a/i)
    assert.match(pipeline?.textContent || "", /intake=n\/a/i)
    assert.match(pipeline?.textContent || "", /send=n\/a/i)
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
        attendanceRiskWeek: {
          total: 2,
          students: [
            {
              studentRefId: "stu-01",
              eaglesId: "SIS-001",
              fullName: "Student One",
              level: "Pre-A1 Starters",
              absences: 2,
              late30Plus: 0,
              outstandingWeek: 0,
            },
            {
              studentRefId: "stu-99",
              eaglesId: "SIS-099",
              fullName: "Other Level Student",
              level: "A1 Movers",
              absences: 0,
              late30Plus: 1,
              outstandingWeek: 0,
            },
          ],
        },
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
    const behaviorField = document.getElementById("pt_behaviorScore")
    assert.equal(behaviorField?.tagName, "INPUT")
    assert.equal(behaviorField?.readOnly, true)
    const rubricScoreField = document.querySelector('input[type="hidden"][name="pt_skill_questions"]')
    assert.equal(rubricScoreField?.tagName, "INPUT")
    const rubricScoreRadios = Array.from(
      document.querySelectorAll('input[type="radio"][data-pt-score-name="pt_skill_questions"]')
    )
    assert.equal(rubricScoreRadios.length, 6)
    const scoreValues = rubricScoreRadios.map((entry) => entry.value)
    assert.ok(scoreValues.includes("0"))
    assert.ok(scoreValues.includes("5"))
    const scoreZeroRadio = rubricScoreRadios.find((entry) => normalizeText(entry.value) === "0")
    const scoreFiveRadio = rubricScoreRadios.find((entry) => normalizeText(entry.value) === "5")
    assert.equal(
      normalizeText(scoreZeroRadio?.getAttribute("title")),
      "0 = hiện không áp dụng cho học sinh."
    )
    assert.equal(
      normalizeText(scoreFiveRadio?.getAttribute("title")),
      "5 = thể hiện hành vi một cách độc lập"
    )
  })
  const scoreLegendBtn = document.querySelector('[data-pt-score-legend-toggle]')
  assert.ok(scoreLegendBtn)
  scoreLegendBtn.click()
  await waitFor(() => {
    const visiblePopover = Array.from(document.querySelectorAll('[data-pt-score-legend-popover]'))
      .find((entry) => !entry.classList.contains("hidden"))
    assert.ok(visiblePopover)
    const legendText = normalizeText(visiblePopover.textContent || "")
    assert.match(legendText, /Thang điểm 0-5/i)
    assert.match(legendText, /0 = hiện không áp dụng cho học sinh\./i)
    assert.match(legendText, /5 = thể hiện hành vi một cách độc lập/i)
  })
  scoreLegendBtn.click()
  await waitFor(() => {
    const visiblePopover = Array.from(document.querySelectorAll('[data-pt-score-legend-popover]'))
      .find((entry) => !entry.classList.contains("hidden"))
    assert.equal(Boolean(visiblePopover), false)
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
  const visionStatusNeedsCheck = document.querySelector('input[name="pt_visionStatus"][value="needs-check"]')
  assert.ok(visionStatusNeedsCheck)
  visionStatusNeedsCheck.checked = true
  visionStatusNeedsCheck.dispatchEvent(new dom.window.Event("change", { bubbles: true }))

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

  await waitFor(() => {
    ;["internationalNews", "readingEnglishEnjoyment", "vocabularyLookup"].forEach((fieldSuffix) => {
      const scoreField = document.querySelector(`input[type="hidden"][name="pt_skill_${fieldSuffix}"]`)
      const recommendationField = document.querySelector(`textarea[name="pt_rec_${fieldSuffix}"]`)
      const scoreRadios = Array.from(
        document.querySelectorAll(`input[type="radio"][data-pt-score-name="pt_skill_${fieldSuffix}"]`)
      )
      assert.ok(scoreField)
      assert.ok(scoreRadios.length > 0)
      assert.ok(recommendationField)
      assert.equal(scoreField.disabled, true)
      assert.equal(scoreRadios.every((entry) => entry.disabled), true)
      assert.equal(recommendationField.disabled, true)
      assert.equal(scoreField.closest("tr")?.classList.contains("progress-report-rubric-row-disabled"), true)
    })
    assert.equal(document.querySelector('input[type="hidden"][name="pt_skill_noteTaking"]')?.disabled, false)
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
  const skillRubricA = document.querySelector('input[type="hidden"][name="pt_skill_questions"]')
  const skillRubricB = document.querySelector('input[type="hidden"][name="pt_skill_logic"]')
  const conductRubricA = document.querySelector('input[type="hidden"][name="pt_conduct_focus"]')
  const conductRubricB = document.querySelector('input[type="hidden"][name="pt_conduct_maturity"]')
  assert.ok(skillRubricA)
  assert.ok(skillRubricB)
  assert.ok(conductRubricA)
  assert.ok(conductRubricB)

  const setRubricScore = (fieldName, score) => {
    const radio = document.querySelector(
      `input[type="radio"][data-pt-score-name="${fieldName}"][value="${String(score)}"]`
    )
    assert.ok(radio)
    radio.checked = true
    radio.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  }

  setRubricScore("pt_skill_questions", 3)
  setRubricScore("pt_skill_logic", 3)
  setRubricScore("pt_conduct_focus", 2)
  setRubricScore("pt_conduct_maturity", 2)

  await waitFor(() => {
    assert.equal(document.getElementById("pt_behaviorScore").value, "2")
    assert.equal(document.getElementById("pt_participationScore").value, "3")
    assert.equal(document.getElementById("pt_academicScore").value, "5")
  })

  document.getElementById("pt_comments").value = "Parent should review vocabulary notebook daily."
  document.getElementById("pt_comments").dispatchEvent(new dom.window.Event("input", { bubbles: true }))
  document.getElementById("pt_saveBtn").click()
  await waitFor(() => {
    const saveNoticeText = normalizeText(document.getElementById("pt_saveNotice").textContent || "")
    assert.match(saveNoticeText, /saved performance report/i)
    assert.match(saveNoticeText, /save for admin review/i)
  })
  document.getElementById("pt_queueSendBtn").click()

  await waitFor(() => {
    assert.equal(savedReportPayloads.length >= 1, true)
    assert.equal(queuedEmailPayloads.length, 1)
    assert.equal(queuedEmailPayloads[0].deliveryMode, "weekend-batch")
    assert.ok(Array.isArray(queuedEmailPayloads[0].recipients))
    assert.ok(queuedEmailPayloads[0].recipients.includes("starter@example.com"))
    assert.ok(queuedEmailPayloads[0].recipients.includes("mom@example.com"))
    assert.match(queuedEmailPayloads[0].message || "", /Homework Past Due/i)
    assert.match(queuedEmailPayloads[0].message || "", /Parent should review vocabulary notebook daily/i)
  })

  await waitFor(() => {
    const latestPayload = savedReportPayloads[savedReportPayloads.length - 1] || {}
    assert.equal(latestPayload.behaviorScore, "2")
    assert.equal(latestPayload.participationScore, "3")
    assert.equal(latestPayload.inClassScore, "5")
    assert.equal(latestPayload.comments, "Parent should review vocabulary notebook daily.")
    assert.equal(latestPayload.rubricPayload?.skillScores?.pt_skill_questions, "3")
    assert.equal(latestPayload.rubricPayload?.skillScores?.pt_skill_logic, "3")
    assert.equal(latestPayload.rubricPayload?.conductScores?.pt_conduct_focus, "2")
    assert.equal(latestPayload.rubricPayload?.conductScores?.pt_conduct_maturity, "2")
    assert.equal(latestPayload.metaPayload?.classDate, selectedDate)
    assert.equal(latestPayload.metaPayload?.classDay, "Tuesday")
    assert.equal(
      latestPayload.metaPayload?.lessonSummary,
      "Reviewed Unit 3 grammar and reading strategy."
    )
    assert.equal(latestPayload.metaPayload?.visionStatus, "needs-check")
    assert.match(latestPayload.metaPayload?.homeworkAnnouncement || "", /Homework Past Due|No overdue/i)
    assert.match(latestPayload.metaPayload?.currentHomeworkSummary || "", /Homework|bài tập/i)
    assert.equal(latestPayload.metaPayload?.pastDueHomeworkCount, "1")
    assert.ok(Array.isArray(latestPayload.metaPayload?.recipients))
    assert.ok(latestPayload.metaPayload?.recipients?.includes("starter@example.com"))
    assert.ok(latestPayload.metaPayload?.recipients?.includes("mom@example.com"))
    assert.equal(Array.isArray(latestPayload.metaPayload?.outstandingAssignments), true)
    assert.equal(latestPayload.metaPayload?.outstandingAssignments?.length, 1)
    assert.match(
      latestPayload.metaPayload?.outstandingAssignments?.[0]?.assignmentName || "",
      /Homework Past Due/i
    )
  })

  await waitFor(() => {
    const statusText = document.getElementById("pt_status").textContent || ""
    assert.match(statusText, /Queued for weekend batch/i)
  })

  setRubricScore("pt_skill_questions", 5)
  setRubricScore("pt_skill_logic", 4)
  setRubricScore("pt_conduct_focus", 4)
  setRubricScore("pt_conduct_maturity", 3)

  document.getElementById("pt_comments").value = ""
  document.getElementById("pt_comments").dispatchEvent(new dom.window.Event("input", { bubbles: true }))
  recField.value = "Rubric fallback comment token."
  recField.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
  document.getElementById("pt_saveBtn").click()

  await waitFor(() => {
    const latestPayload = savedReportPayloads[savedReportPayloads.length - 1] || {}
    assert.equal(latestPayload.behaviorScore, "4")
    assert.equal(latestPayload.participationScore, "5")
    assert.match(latestPayload.comments || "", /Rubric fallback comment token/i)
    assert.equal(latestPayload.rubricPayload?.skillScores?.pt_skill_questions, "5")
    assert.equal(latestPayload.rubricPayload?.skillScores?.pt_skill_logic, "4")
    assert.equal(latestPayload.rubricPayload?.conductScores?.pt_conduct_focus, "4")
    assert.equal(latestPayload.rubricPayload?.conductScores?.pt_conduct_maturity, "3")
    assert.match(
      latestPayload.rubricPayload?.recommendations?.pt_rec_listening || "",
      /Rubric fallback comment token/i
    )
  })

  dom.window.close()
})

test("overview queue summary shows saved-report hint when queue is empty", async () => {
  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const url = String(resource)

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
    if (url.includes("/api/admin/students?")) return jsonResponse(200, { items: [] })
    if (url.includes("/api/admin/exercise-titles")) return jsonResponse(200, { items: [] })
    if (url.includes("/api/admin/notifications/batch-status")) {
      return jsonResponse(200, { ok: true, queueType: "parent-report", total: 0, hasMore: false, items: [] })
    }
    if (url.includes("/api/admin/dashboard")) {
      return jsonResponse(200, {
        today: { attendance: 0, absences: 0, tardy10PlusPercent: 0, tardy30PlusPercent: 0 },
        assignments: { total: 0, completedOnTime: 0, completedLate: 0, outstanding: 0, outstandingYtd: 0 },
        weeklyAssignmentCompletion: [],
        atRiskWeek: { total: 0, students: [] },
        classEnrollmentAttendance: [],
        levelCompletion: [],
        parentReports: { total: 2 },
        parentReportQueue: { total: 0, hasMore: false, items: [] },
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
  await waitFor(() => {
    const summary = normalizeText(document.getElementById("performanceStagedSummary")?.textContent || "")
    const rowsText = normalizeText(document.getElementById("performanceStagedRows")?.textContent || "")
    assert.match(summary, /saved reports=2/i)
    assert.match(rowsText, /not queued yet/i)
  })

  dom.window.close()
})

test("performance queued parent reports list opens modal and supports hold/edit/requeue/send-all actions", async () => {
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
    const section = document.getElementById("performanceQueueSection")
    assert.ok(section)
    assert.equal(section.classList.contains("hidden"), false)
    assert.match(document.getElementById("performanceQueueRows").textContent || "", /Starter Student class report/i)
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

test("performance staged reports panel queues a staged report via approve action", async () => {
  const queuedEmailPayloads = []
  let queueItems = []

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
    if (url.includes("/api/admin/users")) return jsonResponse(200, { items: [] })
    if (url.includes("/api/admin/filters")) return jsonResponse(200, { levels: ["Pre-A1 Starters"], schools: [] })
    if (url.includes("/api/admin/exercise-titles")) return jsonResponse(200, { items: [] })
    if (method === "GET" && url.includes("/api/admin/students?")) {
      return jsonResponse(200, {
        items: [
          {
            id: "stu-01",
            eaglesId: "starter001",
            studentNumber: 301,
            profile: { fullName: "Starter Student", currentGrade: "Pre-A1 Starters" },
            counts: { parentReports: 1, attendanceRecords: 0, gradeRecords: 0 },
          },
        ],
      })
    }
    if (method === "GET" && url.includes("/api/admin/students/stu-01")) {
      return jsonResponse(200, {
        id: "stu-01",
        eaglesId: "starter001",
        studentNumber: 301,
        profile: {
          fullName: "Starter Student",
          currentGrade: "Pre-A1 Starters",
          motherEmail: "mom@example.com",
          studentEmail: "starter@example.com",
        },
        parentReports: [
          {
            id: "rep-01",
            className: "Pre-A1 Starters",
            schoolYear: "2026-2027",
            quarter: "q1",
            generatedAt: "2026-09-15T11:00:00.000Z",
            behaviorScore: 7,
            participationScore: 8,
            inClassScore: 9,
            homeworkOnTimeRate: 88,
            homeworkCompletionRate: 92,
            comments: "Great effort this week.",
          },
        ],
        attendanceRecords: [],
        gradeRecords: [],
      })
    }
    if (method === "GET" && url.includes("/api/admin/dashboard")) {
      return jsonResponse(200, {
        today: { attendance: 0, absences: 0, tardy10PlusPercent: 0, tardy30PlusPercent: 0 },
        assignments: { total: 0, completedOnTime: 0, completedLate: 0, outstanding: 0, outstandingYtd: 0 },
        weeklyAssignmentCompletion: [],
        atRiskWeek: { total: 0, students: [] },
        classEnrollmentAttendance: [],
        levelCompletion: [],
        parentReports: { total: 1 },
        parentReportQueue: { total: queueItems.length, hasMore: false, items: queueItems },
      })
    }
    if (method === "GET" && url.includes("/api/admin/notifications/batch-status")) {
      return jsonResponse(200, {
        ok: true,
        queueType: "parent-report",
        total: queueItems.length,
        hasMore: false,
        items: queueItems,
      })
    }
    if (method === "POST" && url.includes("/api/admin/notifications/email")) {
      const payload = typeof init.body === "string" ? JSON.parse(init.body || "{}") : init.body || {}
      queuedEmailPayloads.push(payload)
      queueItems = [
        {
          id: "queue-approval-01",
          queueType: "parent-report",
          status: "queued",
          assignmentTitle: payload.assignmentTitle,
          exerciseTitle: payload.exerciseTitle,
          level: payload.level,
          dueAt: payload.dueAt,
          message: payload.message,
          recipients: payload.recipients || [],
          queuedByUsername: "admin",
          queuedAt: "2026-09-15T12:00:00.000Z",
          scheduledFor: "2026-09-15T18:00:00.000Z",
          attempts: 0,
          lastError: "",
          payloadJson: payload,
        },
      ]
      return jsonResponse(200, {
        ok: true,
        queued: true,
        queueType: "parent-report",
        queueSize: queueItems.length,
        scheduledFor: "2026-09-15T18:00:00.000Z",
      })
    }

    return jsonResponse(200, {})
  })

  submitLogin(dom)
  await waitFor(() => {
    assert.equal(dom.window.document.getElementById("authPanel").classList.contains("hidden"), true)
    assert.equal(dom.window.document.getElementById("app").classList.contains("hidden"), false)
  })

  openPage(dom, "performance-data")
  const document = dom.window.document
  await waitFor(() => {
    assert.ok(document.querySelector('[data-stage-report-id="rep-01"]'))
  }, 2500)

  document.querySelector('[data-stage-report-id="rep-01"]').click()
  await waitFor(() => {
    assert.equal(queuedEmailPayloads.length, 1)
    assert.equal(queuedEmailPayloads[0].reportId, "rep-01")
    assert.equal(queuedEmailPayloads[0].studentRefId, "stu-01")
    assert.ok(Array.isArray(queuedEmailPayloads[0].recipients))
    assert.ok(queuedEmailPayloads[0].recipients.includes("starter@example.com"))
  }, 2500)

  await waitFor(() => {
    const stagedRowsText = normalizeText(document.getElementById("performanceStagedRows")?.textContent || "")
    assert.match(stagedRowsText, /no staged performance reports/i)
    const queueRowsText = normalizeText(document.getElementById("performanceQueueRows")?.textContent || "")
    assert.match(queueRowsText, /starter student class report/i)
  }, 2500)

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
      submittedEaglesId: "anon001",
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
      submittedEaglesId: "anon002",
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
      submittedEaglesId: "anon003",
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

test("overview assignment line chart renders zero baseline when no homework exists in current week", async () => {
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
    assert.equal(/No active not-yet-due assignments/i.test(text), false)
    const points = dom.window.document.querySelectorAll("#overviewLineChart circle")
    const expectedPointCount = Math.min(7, ((new Date().getDay() + 6) % 7) + 1)
    assert.equal(points.length, expectedPointCount)
    Array.from(points).forEach((point) => {
      assert.equal(point.getAttribute("cy"), "228")
    })
  })

  dom.window.close()
})

test("overview bar chart keeps enrolled vs completed(0) bars when no active assignments exist", async () => {
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
    if (url.includes("/api/admin/filters")) return jsonResponse(200, { levels: ["Pre-A1 Starters", "A2 KET"], schools: [] })
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
        classEnrollmentAttendance: [
          { level: "Pre-A1 Starters", enrolled: 12, attendanceToday: 0 },
          { level: "A2 KET", enrolled: 9, attendanceToday: 0 },
        ],
        levelCompletion: [],
      })
    }

    if (url.includes("/api/admin/exercise-titles")) return jsonResponse(200, { items: [] })
    return jsonResponse(200, {})
  })

  submitLogin(dom)

  await waitFor(() => {
    const labels = Array.from(dom.window.document.querySelectorAll("#overviewBarDetailActions button")).map((btn) =>
      normalizeText(btn.textContent)
    )
    assert.deepEqual(labels, ["Pre-A1 Starters", "A2 KET"])
  })

  await waitFor(() => {
    const text = dom.window.document.querySelector("#overviewBarChart")?.textContent || ""
    assert.equal(/No level completion data available/i.test(text), false)
  })

  await waitFor(() => {
    const rows = Array.from(dom.window.document.querySelectorAll("#overviewAssignmentRows tr"))
    const metrics = new Map(
      rows.map((row) => {
        const cells = row.querySelectorAll("td")
        return [normalizeText(cells[0]?.textContent), normalizeText(cells[1]?.textContent)]
      })
    )
    assert.equal(metrics.get("Active class levels"), "2")
    assert.equal(metrics.get("Targeted students"), "0")
    assert.equal(metrics.get("Completed now"), "0")
    assert.equal(metrics.get("Pending reminders"), "0")
  })

  dom.window.close()
})

test("overview assignment charts fall back to current templates when dashboard levelCompletion is empty", async () => {
  const dueSoon = localIsoDate(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000))
  const pastDue = localIsoDate(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000))

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
    if (url.includes("/api/admin/filters")) return jsonResponse(200, { levels: ["A2 KET", "A1 Movers"], schools: [] })
    if (url.includes("/api/admin/students")) {
      return jsonResponse(200, {
        items: [
          {
            id: "stu-ket-1",
            eaglesId: "ket001",
            studentNumber: 1,
            profile: { fullName: "KET One", currentGrade: "A2 KET", studentEmail: "ket1@example.com" },
            counts: { attendanceRecords: 0, gradeRecords: 0, parentReports: 0 },
          },
          {
            id: "stu-ket-2",
            eaglesId: "ket002",
            studentNumber: 2,
            profile: { fullName: "KET Two", currentGrade: "A2 KET", studentEmail: "ket2@example.com" },
            counts: { attendanceRecords: 0, gradeRecords: 0, parentReports: 0 },
          },
          {
            id: "stu-ket-3",
            eaglesId: "ket003",
            studentNumber: 3,
            profile: { fullName: "KET Three", currentGrade: "A2 KET", studentEmail: "ket3@example.com" },
            counts: { attendanceRecords: 0, gradeRecords: 0, parentReports: 0 },
          },
          {
            id: "stu-mov-1",
            eaglesId: "mov001",
            studentNumber: 4,
            profile: { fullName: "Mover One", currentGrade: "A1 Movers", studentEmail: "mov1@example.com" },
            counts: { attendanceRecords: 0, gradeRecords: 0, parentReports: 0 },
          },
        ],
      })
    }

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
  }, "http://127.0.0.1/admin/students", {
    beforeParse(window) {
      window.localStorage.setItem(
        "sis.admin.assignmentTemplates",
        JSON.stringify([
          {
            id: "ket-current",
            assignmentTitle: "KET Current Homework",
            level: "A2 KET",
            assignedAt: localIsoDate(),
            dueAt: dueSoon,
            items: [{ title: "Nouns Practice", url: "https://exercise.example.com/nouns" }],
          },
          {
            id: "movers-old",
            assignmentTitle: "Movers Past Homework",
            level: "A1 Movers",
            assignedAt: localIsoDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
            dueAt: pastDue,
            items: [{ title: "Old Movers Practice", url: "https://exercise.example.com/movers-old" }],
          },
        ])
      )
    },
  })

  submitLogin(dom)

  await waitFor(() => {
    const labels = Array.from(dom.window.document.querySelectorAll("#overviewBarDetailActions button")).map((btn) =>
      normalizeText(btn.textContent)
    )
    assert.deepEqual(labels, ["A2 KET"])
  })

  await waitFor(() => {
    const rows = Array.from(dom.window.document.querySelectorAll("#overviewAssignmentRows tr"))
    const metrics = new Map(
      rows.map((row) => {
        const cells = row.querySelectorAll("td")
        return [normalizeText(cells[0]?.textContent), normalizeText(cells[1]?.textContent)]
      })
    )
    assert.equal(metrics.get("Active class levels"), "1")
    assert.equal(metrics.get("Targeted students"), "3")
    assert.equal(metrics.get("Completed now"), "0")
    assert.equal(metrics.get("Pending reminders"), "3")
  })

  await waitFor(() => {
    const chartText = normalizeText(dom.window.document.getElementById("overviewBarChart")?.textContent || "")
    assert.equal(/No level completion data available/i.test(chartText), false)
    assert.ok(dom.window.document.querySelectorAll("#overviewLineChart circle").length >= 1)
  })

  const detailBtn = Array.from(dom.window.document.querySelectorAll("#overviewBarDetailActions button")).find((button) =>
    /A2 KET/i.test(button.textContent || "")
  )
  assert.ok(detailBtn)
  detailBtn.click()

  await waitFor(() => {
    const detailText = normalizeText(dom.window.document.getElementById("levelDetailRows")?.textContent || "")
    assert.match(detailText, /KET One/i)
    assert.match(detailText, /KET Two/i)
    assert.match(detailText, /KET Three/i)
  })

  await settleDomAsync(dom)
  dom.window.close()
})

test("overview level detail autofills assignment and announcement link from current dashboard assignment", async () => {
  const dueSoon = localIsoDate(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000))
  const previewCreatePayloads = []

  const dom = await createAdminUiDom(async (resource, init = {}) => {
    const url = String(resource)
    const method = String(init.method || "GET").toUpperCase()

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
    if (url.includes("/api/admin/filters")) return jsonResponse(200, { levels: ["A2 KET"], schools: [] })
    if (url.includes("/api/admin/students")) return jsonResponse(200, { items: [] })

    if (url.includes("/api/admin/dashboard")) {
      return jsonResponse(200, {
        today: { attendance: 0, absences: 0, tardy10PlusPercent: 0, tardy30PlusPercent: 0 },
        assignments: { total: 0, completedOnTime: 0, completedLate: 0, outstanding: 0, outstandingYtd: 0 },
        weeklyAssignmentCompletion: [],
        atRiskWeek: { total: 0, students: [] },
        attendanceRiskWeek: { total: 0, students: [] },
        classEnrollmentAttendance: [{ level: "A2 KET", enrolled: 3, present: 2, absent: 1, tardy10: 0, tardy30: 0 }],
        levelCompletion: [
          {
            level: "A2 KET",
            enrolledStudents: 3,
            totalAssignments: 3,
            completedAssignments: 1,
            outstandingAssignments: 2,
            completedStudents: 1,
            completionPercent: 33.3,
            assignmentName: "KET Unit 7 Homework",
            dueAt: dueSoon,
            daysUntilDue: 3,
            uncompletedStudents: [
              {
                studentRefId: "stu-01",
                eaglesId: "ket001",
                studentNumber: 1,
                fullName: "KET One",
                emails: ["ket1@example.com"],
                outstandingCount: 1,
                assignmentNames: ["KET Unit 7 Homework"],
                nextDueAt: dueSoon,
              },
              {
                studentRefId: "stu-02",
                eaglesId: "ket002",
                studentNumber: 2,
                fullName: "KET Two",
                emails: ["ket2@example.com"],
                outstandingCount: 1,
                assignmentNames: ["KET Unit 7 Homework"],
                nextDueAt: dueSoon,
              },
            ],
          },
        ],
      })
    }

    if (url.includes("/api/admin/exercise-titles")) return jsonResponse(200, { items: [] })

    if (method === "POST" && url.includes("/api/admin/assignment-announcements/volatile")) {
      previewCreatePayloads.push(init.body ? JSON.parse(init.body) : {})
      return jsonResponse(200, {
        ok: true,
        url: "https://preview.example.com/current-ket",
        ttlMinutes: 480,
        expiresAt: "2026-03-01T08:00:00.000Z",
      })
    }

    return jsonResponse(200, {})
  }, "http://127.0.0.1/admin/students", {
    beforeParse(window) {
      window.localStorage.setItem("sis.admin.assignmentTemplates", "[]")
    },
  })

  submitLogin(dom)

  await waitFor(() => {
    const ketBtn = Array.from(dom.window.document.querySelectorAll("#overviewBarDetailActions button")).find((button) =>
      /A2 KET/i.test(button.textContent || "")
    )
    assert.ok(ketBtn)
    ketBtn.click()
  })

  await waitFor(() => {
    assert.equal(dom.window.document.getElementById("levelReminderAssignment")?.value, "KET Unit 7 Homework")
    assert.equal(dom.window.document.getElementById("levelReminderDueAt")?.value, dueSoon)
    assert.equal(
      dom.window.document.getElementById("levelReminderLink")?.value,
      "https://preview.example.com/current-ket"
    )
    assert.equal(previewCreatePayloads.length, 1)
    assert.equal(previewCreatePayloads[0]?.assignmentTitle, "KET Unit 7 Homework")
    assert.equal(previewCreatePayloads[0]?.level, "A2 KET")
    assert.equal(previewCreatePayloads[0]?.dueAt, dueSoon)
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
    assert.match(document.getElementById("levelDetailTitle").textContent, /Current assignment progress - Pre-A1 Starters/i)
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
    assert.match(document.getElementById("levelDetailTitle").textContent || "", /Current assignment progress - A1 Movers/i)
    const rowText = document.querySelector("#levelDetailRows tr td")?.textContent || ""
    assert.match(rowText, /No not-completed-yet students/i)
    assert.ok(scrollCalls >= 1)
  })

  dom.window.close()
})

test("attendance main defaults to absent and admin child shows per-student stats", async () => {
  let dashboardCalls = 0
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
        studentNumber: 1001,
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
      dashboardCalls += 1
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
    const riskText = normalizeText(dom.window.document.getElementById("overviewRiskStudents")?.textContent)
    assert.match(riskText, /No pending students for current not-yet-due assignments/i)
  }, 3000)

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
  await waitFor(() => {
    const summaryText = normalizeText(dom.window.document.getElementById("attendanceLandingSummary")?.textContent)
    assert.match(summaryText, /students=1/i)
    assert.match(summaryText, /present=0 \(0\.0%\)/i)
    assert.match(summaryText, /absent=1/i)
    assert.match(summaryText, /totalTardy=0 \(0\.0%\)/i)
  })
  await waitFor(() => {
    const tardy10Input = dom.window.document.querySelector(
      '#attendanceLandingRows input[type="radio"][value="tardy10"]'
    )
    assert.ok(tardy10Input)
    tardy10Input.click()
  })
  await waitFor(() => {
    const summaryText = normalizeText(dom.window.document.getElementById("attendanceLandingSummary")?.textContent)
    assert.match(summaryText, /students=1/i)
    assert.match(summaryText, /present=1 \(100\.0%\)/i)
    assert.match(summaryText, /absent=0/i)
    assert.match(summaryText, /tardy10=1/i)
    assert.match(summaryText, /totalTardy=1 \(100\.0%\)/i)
  })
  const dashboardCallsBeforeSave = dashboardCalls
  dom.window.document.getElementById("attendanceLandingSaveAllBtn")?.click()
  await waitFor(() => {
    const statusText = normalizeText(dom.window.document.getElementById("status")?.textContent)
    assert.match(statusText, /Attendance saved for Pre-A1 Starters/i)
    assert.ok(dashboardCalls > dashboardCallsBeforeSave)
  })

  dom.window.document.querySelector('[data-page-link="attendance-admin"]').click()
  await waitFor(() => {
    const adminSection = dom.window.document.querySelector('[data-page="attendance-admin"]')
    assert.ok(adminSection)
    assert.equal(adminSection.classList.contains("active"), true)
    const row = dom.window.document.querySelector("#attendanceAdminRows tr")
    assert.ok(row)
    const cells = row.querySelectorAll("td")
    assert.equal(cells.length, 7)
    assert.equal((cells[1].textContent || "").trim(), "2")
    assert.equal((cells[2].textContent || "").trim(), "1")
    assert.equal((cells[3].textContent || "").trim(), "1")
    assert.equal((cells[4].textContent || "").trim(), "0")
    assert.equal((cells[5].textContent || "").trim(), "66.7%")
    assert.equal((cells[6].textContent || "").trim(), "33.3%")
  })
  await waitFor(() => {
    const summaryText = normalizeText(dom.window.document.getElementById("attendanceAdminSummary")?.textContent)
    assert.match(summaryText, /students=1/i)
    assert.match(summaryText, /present=2 \(66\.7%\)/i)
    assert.match(summaryText, /absent=1/i)
    assert.match(summaryText, /tardy10=1/i)
    assert.match(summaryText, /totalTardy=1 \(33\.3%\)/i)
  })
  await waitFor(() => {
    const riskSummary = normalizeText(dom.window.document.getElementById("attendanceAdminRiskSummary")?.textContent)
    const riskLines = normalizeText(dom.window.document.getElementById("attendanceAdminRiskStudents")?.textContent)
    assert.match(riskSummary, /attendanceRisk=\d+ \(week\)/i)
    assert.ok(riskLines.length > 0)
  })
  await waitFor(() => {
    const optionsMenu = dom.window.document.querySelector("#attendanceRows tr .row-options-menu")
    assert.ok(optionsMenu)
    const trigger = optionsMenu.querySelector(".row-options-trigger")
    assert.ok(trigger)
    assert.equal(normalizeText(trigger.textContent), "Options")
    const labels = Array.from(optionsMenu.querySelectorAll(".row-options-dropdown button")).map((button) =>
      normalizeText(button.textContent)
    )
    assert.deepEqual(labels, ["Edit", "Archive", "Delete"])
  })
  await waitFor(() => {
    const historyTable = dom.window.document.getElementById("attendanceRows")?.closest("table")
    assert.ok(historyTable)
    const firstHeader = normalizeText(historyTable.querySelector("thead th")?.textContent)
    assert.equal(firstHeader, "#")
    const fullNameHeader = historyTable.querySelector('th[data-attendance-col="fullName"]')
    const englishNameHeader = historyTable.querySelector('th[data-attendance-col="englishName"]')
    assert.ok(fullNameHeader?.classList.contains("attendance-col-hidden"))
    assert.ok(englishNameHeader?.classList.contains("attendance-col-hidden"))
    const fullNameToggle = dom.window.document.querySelector('[data-attendance-col-toggle="fullName"]')
    const englishNameToggle = dom.window.document.querySelector('[data-attendance-col-toggle="englishName"]')
    assert.equal(Boolean(fullNameToggle?.checked), false)
    assert.equal(Boolean(englishNameToggle?.checked), false)
  })
  await waitFor(() => {
    const globalZoomLabel = dom.window.document.getElementById("globalTextZoomLabel")
    assert.equal(normalizeText(globalZoomLabel?.textContent), "100%")
    assert.equal(dom.window.document.querySelectorAll(".page-text-zoom-controls").length, 0)
    const globalIncreaseBtn = dom.window.document.getElementById("globalTextZoomUpBtn")
    assert.ok(globalIncreaseBtn)
    globalIncreaseBtn.click()
  })
  await waitFor(() => {
    assert.equal(dom.window.document.documentElement.style.getPropertyValue("--sis-global-text-zoom"), "1.05")
    assert.equal(normalizeText(dom.window.document.getElementById("globalTextZoomLabel")?.textContent), "105%")
    assert.equal(normalizeText(dom.window.localStorage.getItem("sis.admin.globalTextZoomPercent.v1")), "105")
  })
  dom.window.document.getElementById("globalTextZoomResetBtn")?.click()
  await waitFor(() => {
    assert.equal(dom.window.document.documentElement.style.getPropertyValue("--sis-global-text-zoom"), "1")
    assert.equal(normalizeText(dom.window.document.getElementById("globalTextZoomLabel")?.textContent), "100%")
    assert.equal(normalizeText(dom.window.localStorage.getItem("sis.admin.globalTextZoomPercent.v1")), "100")
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

test("profile info display emphasizes student summary and clusters empty fields", async () => {
  const studentDetail = {
    id: "stu-01",
    studentNumber: 1088,
    eaglesId: "EGL-1088",
    email: "learner@example.com",
    profile: {
      fullName: "Nguyen Bao Anh",
      englishName: "Anna Nguyen",
      currentGrade: "A1 Movers",
      schoolName: "Eagles Main",
      studentPhone: "0900000001",
      motherName: "Tran Mai",
      motherPhone: "0900000002",
      fatherName: "",
      fatherPhone: "",
      normalizedFormPayload: {},
      rawFormPayload: {},
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
    if (url.includes("/api/admin/filters")) return jsonResponse(200, { levels: ["A1 Movers"], schools: ["Eagles Main"] })
    if (method === "GET" && url.includes("/api/admin/students/stu-01")) return jsonResponse(200, studentDetail)
    if (method === "GET" && url.includes("/api/admin/students")) {
      return jsonResponse(200, {
        items: [
          {
            id: "stu-01",
            studentNumber: 1088,
            eaglesId: "EGL-1088",
            profile: {
              fullName: "Nguyen Bao Anh",
              englishName: "Anna Nguyen",
              currentGrade: "A1 Movers",
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
  const document = dom.window.document

  await waitFor(() => {
    assert.equal(document.getElementById("app").classList.contains("hidden"), false)
  })
  await waitFor(() => {
    const firstRow = document.querySelector("#studentRows tr")
    assert.ok(firstRow)
    firstRow.click()
  })

  openPage(dom, "profile")
  await waitFor(() => {
    const summaryText = normalizeText(document.getElementById("profileInfoDataSummary")?.textContent || "")
    assert.match(summaryText, /Nguyen Bao Anh/i)
    assert.match(summaryText, /Eagles ID: EGL-1088/i)
    assert.match(summaryText, /Class Level/i)
    assert.match(summaryText, /Primary Contact/i)
  })

  await waitFor(() => {
    const activePanel = document.querySelector('#profileInfoPanels .profile-info-panel.active')
    assert.ok(activePanel)
    assert.ok(activePanel.querySelector(".profile-info-group"))
    assert.ok(activePanel.querySelector(".profile-info-item[data-priority='primary']"))
    const emptyStack = activePanel.querySelector("details.profile-info-empty-stack")
    assert.ok(emptyStack)
    assert.match(normalizeText(emptyStack.querySelector("summary")?.textContent || ""), /Show .* empty fields/i)
  })

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
  const xlsxExportPayloads = []
  const xlsxExportUrls = []
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
        studentNumber: 1001,
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
            studentNumber: 1001,
            profile: { fullName: "Student One", currentGrade: "Pre-A1 Starters" },
            counts: { attendanceRecords: 2, gradeRecords: 2, parentReports: 2 },
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
    if (url.includes("/exports/xlsx") && normalizeText(method).toUpperCase() === "POST") {
      const parsed = JSON.parse(normalizeText(init?.body || "{}") || "{}")
      xlsxExportUrls.push(url)
      xlsxExportPayloads.push(parsed)
      return {
        status: 200,
        ok: true,
        headers: {
          get(name) {
            if (normalizeText(name).toLowerCase() === "content-disposition") {
              return 'attachment; filename="attendance-export.xlsx"'
            }
            return ""
          },
        },
        async blob() {
          return new Blob(["xlsx-bytes"], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          })
        },
      }
    }
    return jsonResponse(200, {})
  })

  submitLogin(dom, { username: "admin" })
  await waitFor(() => {
    const text = dom.window.document.getElementById("status").textContent
    assert.match(text, /Authenticated as admin/i)
  })

  const document = dom.window.document
  const anchorDownloads = []
  const originalAnchorClick = dom.window.HTMLAnchorElement.prototype.click
  dom.window.URL.createObjectURL = () => "blob:mock-export"
  dom.window.URL.revokeObjectURL = () => {}
  dom.window.HTMLAnchorElement.prototype.click = function click() {
    if (normalizeText(this.download)) {
      anchorDownloads.push(normalizeText(this.download))
      return
    }
    return originalAnchorClick.call(this)
  }
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
  assert.ok(document.getElementById("assignmentColumnControls"))
  assert.ok(document.getElementById("performanceColumnControls"))
  assert.ok(document.getElementById("gradeColumnControls"))
  assert.ok(document.getElementById("reportColumnControls"))
  assert.ok(document.getElementById("assignmentSaveTemplateBtn"))
  assert.ok(document.getElementById("gradeSaveBtn"))
  assert.ok(document.getElementById("reportSaveBtn"))

  openPage(dom, "attendance-admin")
  await waitFor(() => {
    assert.equal(document.querySelector(".page-section.active")?.getAttribute("data-page"), "attendance-admin")
  })
  await waitFor(() => {
    assert.ok(document.querySelectorAll("#attendanceRows tr").length >= 1)
  })
  await waitFor(() => {
    const fullNameHeader = document.querySelector('th[data-attendance-col="fullName"]')
    const englishNameHeader = document.querySelector('th[data-attendance-col="englishName"]')
    assert.ok(fullNameHeader?.classList.contains("attendance-col-hidden"))
    assert.ok(englishNameHeader?.classList.contains("attendance-col-hidden"))
    const fullNameToggle = document.querySelector('[data-attendance-col-toggle="fullName"]')
    assert.ok(fullNameToggle)
    assert.equal(Boolean(fullNameToggle.checked), false)
    fullNameToggle.click()
  })
  await waitFor(() => {
    const fullNameHeader = document.querySelector('th[data-attendance-col="fullName"]')
    assert.equal(fullNameHeader?.classList.contains("attendance-col-hidden"), false)
    assert.equal(
      normalizeText(dom.window.localStorage.getItem("sis.admin.attendance.columnVisibility.v1")).includes("\"fullName\":true"),
      true
    )
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
  await waitFor(() => {
    assert.equal(attendanceRowsWithData().length >= 1, true)
  }, 5000)
  const attendanceSearch = document.getElementById("attendanceDataSearch")
  const attendanceBaselineRows = attendanceRowsWithData()
  if (attendanceBaselineRows.length) {
    await waitFor(() => {
      const firstStudentNumber = normalizeText(attendanceBaselineRows[0].querySelector("td:nth-child(1)")?.textContent)
      const firstId = normalizeText(attendanceBaselineRows[0].querySelector("td:nth-child(2)")?.textContent)
      const firstFullName = normalizeText(attendanceBaselineRows[0].querySelector("td:nth-child(3)")?.textContent)
      const firstEnglishName = normalizeText(attendanceBaselineRows[0].querySelector("td:nth-child(4)")?.textContent)
      assert.equal(firstStudentNumber, "1001")
      assert.equal(firstId, "SIS-001")
      assert.equal(firstFullName, "Student One")
      assert.equal(firstEnglishName, "")
    })
  }
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

  document.getElementById("attendanceExportXlsxBtn").click()
  await waitFor(() => {
    assert.equal(xlsxExportPayloads.length, 1)
  })
  assert.equal(xlsxExportUrls.length, 1)
  assert.match(xlsxExportUrls[0], /\/exports\/xlsx/i)
  const attendanceExportPayload = xlsxExportPayloads[0]
  assert.equal(normalizeText(attendanceExportPayload.sheetName), "Attendance")
  assert.ok(normalizeText(attendanceExportPayload.filename).toLowerCase().includes("attendance"))
  assert.deepEqual(
    (attendanceExportPayload.columns || []).map((entry) => [entry.key, entry.label]),
    [
      ["eaglesId", "Eagles ID"],
      ["studentNumber", "Student Number"],
      ["fullName", "Full Name"],
      ["englishName", "English Name"],
      ["date", "Date"],
      ["className", "Class"],
      ["quarter", "Quarter"],
      ["status", "Status"],
      ["comments", "Comments"],
    ]
  )
  const attendanceExportRows = Array.isArray(attendanceExportPayload.rows) ? attendanceExportPayload.rows : []
  assert.equal(attendanceExportRows.length >= 1, true)
  const attendanceAllowedKeys = new Set(
    attendanceExportPayload.columns.map((entry) => normalizeText(entry?.key)).filter(Boolean)
  )
  attendanceExportRows.forEach((row) => {
    assert.equal(normalizeText(row.eaglesId), "SIS-001")
    assert.equal(Number(row.studentNumber), 1001)
    assert.equal(normalizeText(row.fullName), "Student One")
    assert.equal(normalizeText(row.englishName), "")
    assert.ok(normalizeText(row.date))
    assert.deepEqual(Object.keys(row).sort(), [...attendanceAllowedKeys].sort())
    assert.equal(normalizeText(row.fullName).includes("SIS-001"), false)
  })
  await waitFor(() => {
    assert.equal(anchorDownloads.length >= 1, true)
  })
  assert.equal(anchorDownloads.some((value) => /attendance-export\.xlsx/i.test(value)), true)

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
    assert.ok(studentOptions.some((value) => value.includes("SIS-001")))
  })
  await waitFor(() => {
    const fullNameHeader = document.querySelector('th[data-grades-col="fullName"]')
    const englishNameHeader = document.querySelector('th[data-grades-col="englishName"]')
    assert.ok(fullNameHeader?.classList.contains("attendance-col-hidden"))
    assert.ok(englishNameHeader?.classList.contains("attendance-col-hidden"))
    assert.equal(Boolean(document.querySelector('[data-grades-col-toggle="fullName"]')?.checked), false)
    assert.equal(Boolean(document.querySelector('[data-grades-col-toggle="englishName"]')?.checked), false)
  })
  gradeLevelFilter.value = ""
  gradeLevelFilter.dispatchEvent(new dom.window.Event("change", { bubbles: true }))

  const gradeBaselineRowCount = document.querySelectorAll("#gradeRows tr").length
  assert.ok(gradeBaselineRowCount >= 1)
  assert.ok(document.getElementById("gradeChartGroupBy"))
  assert.ok(document.getElementById("gradeChartQuarter"))
  assert.ok(document.getElementById("gradeChartSchoolYear"))
  assert.ok(document.getElementById("gradeChartCustomFrom"))
  assert.ok(document.getElementById("gradeChartCustomTo"))
  assert.ok(document.querySelector('#gradeChartPeriods [data-grade-chart-period="qtd"]'))
  assert.equal(
    document.querySelector('#gradeChartPeriods [data-grade-chart-period="archive"]'),
    null,
  )
  await waitFor(() => {
    const lanes = document.querySelectorAll("#gradeChartLanes .grade-chart-lane")
    assert.equal(lanes.length >= 1, true)
  })
  await waitFor(() => {
    const laneLegendText = normalizeText(document.querySelector("#gradeChartLanes .grade-chart-lane-legend")?.textContent || "")
    assert.match(laneLegendText, /Trend/i)
  })
  const gradeChartSchoolYear = document.getElementById("gradeChartSchoolYear")
  assert.ok(gradeChartSchoolYear)
  const gradeChartSchoolYearOptions = Array.from(gradeChartSchoolYear.options || []).map(
    (entry) => normalizeText(entry.value).toLowerCase(),
  )
  assert.equal(gradeChartSchoolYearOptions.includes("all"), false)
  await waitFor(() => {
    assert.notEqual(normalizeText(gradeChartSchoolYear.value).toLowerCase(), "all")
  })
  const gradeChartGroupBy = document.getElementById("gradeChartGroupBy")
  gradeChartGroupBy.value = "student"
  gradeChartGroupBy.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  await waitFor(() => {
    const laneText = normalizeText(document.getElementById("gradeChartLanes")?.textContent || "")
    assert.match(laneText, /Student One/i)
  })
  document.querySelector('#gradeChartLanes button[data-grade-chart-open]')?.click()
  await waitFor(() => {
    const modal = document.getElementById("gradeChartModal")
    assert.ok(modal)
    assert.equal(modal.classList.contains("hidden"), false)
    assert.ok(document.querySelector("#gradeChartModalSvgWrap .grade-chart-svg"))
    const modalMeta = normalizeText(document.getElementById("gradeChartModalMeta")?.textContent || "")
    assert.match(modalMeta, /Trend/i)
    const rowMatch = modalMeta.match(/Rows:\s*(\d+)/i)
    const rowCount = rowMatch ? Number.parseInt(rowMatch[1], 10) : 0
    if (rowCount >= 2) {
      assert.ok(document.querySelector("#gradeChartModalSvgWrap .grade-chart-svg .grade-chart-trend"))
    }
  })
  document.getElementById("gradeChartModalCloseBtn")?.click()
  await waitFor(() => {
    const modal = document.getElementById("gradeChartModal")
    assert.ok(modal)
    assert.equal(modal.classList.contains("hidden"), true)
  })
  gradeChartGroupBy.value = "class"
  gradeChartGroupBy.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  document.querySelector('#gradeChartPeriods [data-grade-chart-period="custom"]')?.click()
  const gradeChartCustomFrom = document.getElementById("gradeChartCustomFrom")
  const gradeChartCustomTo = document.getElementById("gradeChartCustomTo")
  gradeChartCustomFrom.value = "2026-02-06"
  gradeChartCustomFrom.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  gradeChartCustomTo.value = "2026-02-12"
  gradeChartCustomTo.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
  await waitFor(() => {
    const summary = normalizeText(document.getElementById("gradeChartSummary")?.textContent || "")
    assert.match(summary, /Rows: 1/i)
    assert.match(summary, /2026-02-06 to 2026-02-12/i)
    const laneText = normalizeText(document.getElementById("gradeChartLanes")?.textContent || "")
    assert.match(laneText, /Class B/i)
  })
  const gradeStudentFilter = document.getElementById("gradeDataStudent")
  const gradeStudentOption =
    Array.from(gradeStudentFilter.options).find(
      (entry) => normalizeText(entry.value) && /SIS-001/i.test(normalizeText(entry.textContent || ""))
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
    const firstScore = (document.querySelector("#gradeRows tr td:nth-child(8)")?.textContent || "").trim()
    assert.equal(firstScore, "95/100")
  })
  await waitFor(() => {
    const actionCellText = document.querySelector("#gradeRows tr td:nth-child(13)")?.textContent || ""
    assert.match(actionCellText, /Options/i)
  })

  document.getElementById("gradeSortDirBtn").click()
  await waitFor(() => {
    const firstScore = (document.querySelector("#gradeRows tr td:nth-child(8)")?.textContent || "").trim()
    assert.equal(firstScore, "70/100")
  })

  const gradeScoreHeader = document.querySelector('th[data-table-sort="grades"][data-sort-field="score"]')
  assert.ok(gradeScoreHeader)
  gradeScoreHeader.click()
  await waitFor(() => {
    const firstScore = (document.querySelector("#gradeRows tr td:nth-child(8)")?.textContent || "").trim()
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
  await waitFor(() => {
    const fullNameHeader = document.querySelector('th[data-performance-col="fullName"]')
    const englishNameHeader = document.querySelector('th[data-performance-col="englishName"]')
    assert.ok(fullNameHeader?.classList.contains("attendance-col-hidden"))
    assert.ok(englishNameHeader?.classList.contains("attendance-col-hidden"))
    assert.equal(Boolean(document.querySelector('[data-performance-col-toggle="fullName"]')?.checked), false)
    assert.equal(Boolean(document.querySelector('[data-performance-col-toggle="englishName"]')?.checked), false)
  })

  const performanceHwHeader = document.querySelector(
    'th[data-table-sort="performance"][data-sort-field="homeworkCompletionRate"]'
  )
  assert.ok(performanceHwHeader)
  performanceHwHeader.click()
  await waitFor(() => {
    const firstHw = (document.querySelector("#pt_reportRows tr td:nth-child(8)")?.textContent || "").trim()
    assert.equal(firstHw, "90")
  })
  performanceHwHeader.click()
  await waitFor(() => {
    const firstHw = (document.querySelector("#pt_reportRows tr td:nth-child(8)")?.textContent || "").trim()
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
  await waitFor(() => {
    const fullNameHeader = document.querySelector('th[data-reports-col="fullName"]')
    const englishNameHeader = document.querySelector('th[data-reports-col="englishName"]')
    assert.ok(fullNameHeader?.classList.contains("attendance-col-hidden"))
    assert.ok(englishNameHeader?.classList.contains("attendance-col-hidden"))
    assert.equal(Boolean(document.querySelector('[data-reports-col-toggle="fullName"]')?.checked), false)
    assert.equal(Boolean(document.querySelector('[data-reports-col-toggle="englishName"]')?.checked), false)
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
    schoolSetupLetterGradeRanges: "A:92-100\nB:84-91.99\nC:76-83.99\nD:60-75.99\nF:0-59.99",
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
  assert.equal(saved.schoolSetup.letterGradeRanges[0].letter, "A")
  assert.equal(saved.schoolSetup.letterGradeRanges[0].minPercent, 92)
  assert.equal(saved.schoolSetup.letterGradeRanges[4].letter, "F")
  assert.equal(saved.schoolSetup.letterGradeRanges[4].maxPercent, 59.99)
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
  document.getElementById("schoolSetupLetterGradeRanges").value = "A:95-100\nB:90-94.99"
  document.getElementById("schoolSetupResetBtn").click()

  await waitFor(() => {
    assert.equal(document.getElementById("schoolSetupName").value, "Eagles Learning Hub")
    assert.equal(document.getElementById("schoolSetupMission").value, "Deliver student outcomes")
    assert.equal(document.getElementById("schoolSetupStartDate").value, "2026-08-10")
    assert.equal(document.getElementById("schoolSetupEndDate").value, "2027-05-28")
    assert.equal(
      document.getElementById("schoolSetupLetterGradeRanges").value,
      fieldValuesById.schoolSetupLetterGradeRanges
    )
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
  assert.ok(document.querySelector("#performanceQueueDetails .table-scroll-wrap"))
  assert.equal(document.getElementById("schoolSetupLogoPreviewImg")?.getAttribute("src"), "data:,")

  dom.window.close()
})
