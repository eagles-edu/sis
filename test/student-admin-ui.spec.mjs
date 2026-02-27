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

  dom.window.close()
})
