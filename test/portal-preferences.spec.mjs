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
  const { preferences, sandbox, store } = createSandbox("unauthenticated", {
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
