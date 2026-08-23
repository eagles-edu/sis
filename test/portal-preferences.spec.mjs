import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import vm from "node:vm"

const scriptPath = path.resolve(process.cwd(), "web-asset/shared/portal-preferences.js")
const scriptSource = fs.readFileSync(scriptPath, "utf8")

function createSandbox(authState = "unauthenticated", { initialStorage = {}, serverPreferences = {} } = {}) {
  const calls = []
  const store = new Map(Object.entries(initialStorage))
  const storage = {
    getItem: (key) => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    key: (index) => [...store.keys()][index] || null,
    get length() { return store.size },
  }
  const sandbox = {
    document: { documentElement: { dataset: { parentAuthState: authState }, style: {} }, getElementById: () => null },
    localStorage: storage,
    sessionStorage: storage,
    window: null,
    __SIS_PARENT_PREFERENCES_PATH: "/api/parent/preferences",
    fetch: async (...args) => {
      calls.push(args)
      return { ok: true, json: async () => ({ preferences: serverPreferences }) }
    },
    SIS_PORTAL_THEME: {
      CONSENT_VERSION: 1,
      CONSENT_STORAGE_KEY: "sis-consent-preferences",
      writeConsentPreferences: (supportChat, analytics) => {
        const saved = {
          version: 1,
          supportChat,
          analytics,
          updatedAt: new Date().toISOString(),
        }
        store.set("sis-consent-preferences", JSON.stringify(saved))
        return saved
      },
      applyConsentPreferences: () => {},
    },
  }
  sandbox.window = sandbox
  vm.runInNewContext(scriptSource, sandbox, { filename: scriptPath })
  return { calls, preferences: sandbox.SIS_PORTAL_PREFERENCES, sandbox, store }
}

test("does not write preferences before parent authentication", async () => {
  const { calls, preferences } = createSandbox()
  const saved = await preferences.save("sis-theme", "dark")

  assert.equal(saved, true)
  assert.equal(calls.length, 0)
  assert.equal(preferences.get("sis-theme"), "dark")
})

test("writes non-theme preferences after parent authentication", async () => {
  const { calls, preferences } = createSandbox("authenticated")
  const saved = await preferences.save("sis.admin.textZoom", "1.1")

  assert.equal(saved, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], "/api/parent/preferences")
  assert.equal(calls[0][1].method, "PUT")
})

test("marks a Settings privacy update so the server can create an admin alert for an opt-out", async () => {
  const { calls, preferences } = createSandbox("authenticated")

  await preferences.save("sis-consent-preferences", {
    version: 1,
    supportChat: "denied",
    analytics: "denied",
    updatedAt: new Date().toISOString(),
  }, { privacyPreferenceSource: "settings" })

  const body = JSON.parse(calls[0][1].body)
  assert.equal(body.privacyPreferenceSource, "settings")
})

test("keeps theme local and ignores a deferred server theme", async () => {
  const { calls, preferences, sandbox, store } = createSandbox("authenticated", {
    initialStorage: { "sis-theme": "dark" },
    serverPreferences: { "sis-theme": "light" },
  })
  sandbox.document.documentElement.dataset.theme = "dark"

  await preferences.load()

  assert.equal(calls.length, 1)
  assert.equal(sandbox.document.documentElement.dataset.theme, "dark")
  assert.equal(store.get("sis-theme"), "dark")
})

test("hydrates consent preferences from the Redis-backed portal preference response", async () => {
  const { preferences, sandbox, store } = createSandbox("authenticated", {
    serverPreferences: {
      "sis-consent-preferences": {
        version: 1,
        supportChat: "granted",
        analytics: "denied",
        updatedAt: new Date().toISOString(),
      },
    },
  })

  await preferences.load()

  assert.equal(preferences.get("sis-consent-preferences").supportChat, "granted")
  assert.equal(JSON.parse(store.get("sis-consent-preferences")).analytics, "denied")
})

test("reusing the preference script keeps one shared in-flight hydration request", async () => {
  const { calls, preferences, sandbox } = createSandbox("authenticated")
  const firstLoad = preferences.load()
  vm.runInNewContext(scriptSource, sandbox, { filename: scriptPath })
  await Promise.all([firstLoad, sandbox.SIS_PORTAL_PREFERENCES.load()])

  assert.equal(sandbox.SIS_PORTAL_PREFERENCES, preferences)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], "/api/parent/preferences")
})

test("keeps the member notice visible when a prior preference has not acknowledged it", async () => {
  let removed = false
  const { preferences, sandbox } = createSandbox("authenticated", {
    serverPreferences: {
      "sis-consent-preferences": {
        version: 1,
        supportChat: "denied",
        analytics: "denied",
        updatedAt: new Date().toISOString(),
      },
    },
  })
  sandbox.document.getElementById = () => ({ remove: () => { removed = true } })

  await preferences.load()

  assert.equal(removed, false)
})

test("defers server preference hydration during the authentication transition", async () => {
  const { calls, preferences, sandbox } = createSandbox("booting", {
    serverPreferences: { "sis.student.textZoom": "1.1" },
  })

  await preferences.load()
  assert.equal(calls.length, 0)

  sandbox.document.documentElement.dataset.parentAuthState = "authenticated"
  await preferences.migrate()

  assert.equal(calls.length, 1)
  assert.equal(preferences.get("sis.student.textZoom"), "1.1")
})

test("migration never uploads or removes canonical and legacy theme keys", async () => {
  const { calls, preferences, store } = createSandbox("authenticated", {
    initialStorage: { "sis-theme": "dark", "sis-theme-admin": "light", "sis.admin.textZoom": "1.1" },
  })

  await preferences.migrate()

  const put = calls.find((entry) => entry[1]?.method === "PUT")
  assert.ok(put)
  const body = JSON.parse(put[1].body)
  assert.deepEqual(Object.keys(body.preferences), ["sis.admin.textZoom"])
  assert.equal(store.get("sis-theme"), "dark")
  assert.equal(store.get("sis-theme-admin"), "light")
  assert.equal(store.has("sis.admin.textZoom"), false)
})
