import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import vm from "node:vm"

const rootDir = process.cwd()
const scriptPath = path.resolve(rootDir, "web-asset/shared/portal-theme-state.js")
const scriptSource = fs.readFileSync(scriptPath, "utf8")

function createSandbox(initialStorage = {}) {
  const store = new Map(Object.entries(initialStorage))
  const document = {
    documentElement: {
      dataset: {},
      style: {},
    },
  }
  const localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(key, String(value))
    },
    removeItem(key) {
      store.delete(key)
    },
  }
  const sandbox = {
    document,
    localStorage,
    globalThis: null,
  }
  sandbox.globalThis = sandbox
  vm.runInNewContext(scriptSource, sandbox, { filename: scriptPath })
  return { document, localStorage, store, theme: sandbox.SIS_PORTAL_THEME }
}

test("portal theme state migrates legacy keys to the canonical sis-theme key", () => {
  const { document, store, theme } = createSandbox({
    "sis-theme-admin": "dark",
    "sis-theme-parent": "light",
    "sis-theme-student": "light",
  })

  const resolved = theme.initTheme("light")

  assert.equal(resolved, "dark")
  assert.equal(document.documentElement.dataset.theme, "dark")
  assert.equal(document.documentElement.style.colorScheme, "dark")
  assert.equal(store.get("sis-theme"), "dark")
  assert.equal(store.has("sis-theme-admin"), false)
  assert.equal(store.has("sis-theme-parent"), false)
  assert.equal(store.has("sis-theme-student"), false)
})

test("portal theme state toggles and reads the canonical key", () => {
  const { document, store, theme } = createSandbox({
    "sis-theme": "light",
  })

  assert.equal(theme.initTheme("dark"), "light")
  assert.equal(theme.getTheme("dark"), "light")
  assert.equal(theme.toggleTheme("dark"), "dark")
  assert.equal(document.documentElement.dataset.theme, "dark")
  assert.equal(document.documentElement.style.colorScheme, "dark")
  assert.equal(store.get("sis-theme"), "dark")
})

test("portal theme state applies the cached theme before async preferences load", () => {
  const { document, theme } = createSandbox({ "sis-theme": "dark" })

  assert.equal(theme.initTheme("light"), "dark")
  assert.equal(document.documentElement.dataset.theme, "dark")
  assert.equal(document.documentElement.style.colorScheme, "dark")
})

test("portal consent preferences persist explicit choices across reads", () => {
  const { document, store, theme } = createSandbox()

  const saved = theme.writeConsentPreferences("granted", "denied")

  assert.equal(saved.version, 1)
  assert.equal(saved.supportChat, "granted")
  assert.equal(saved.analytics, "denied")
  assert.deepEqual(theme.readConsentPreferences(), saved)
  assert.equal(JSON.parse(store.get("sis-consent-preferences")).analytics, "denied")
  assert.equal(document.documentElement.dataset.sisSupportChatConsent, undefined)
})

test("portal consent preferences expire after the review period", () => {
  const expired = JSON.stringify({
    version: 1,
    supportChat: "granted",
    analytics: "granted",
    updatedAt: new Date(Date.now() - 366 * 24 * 60 * 60 * 1000).toISOString(),
  })
  const { theme } = createSandbox({ "sis-consent-preferences": expired })

  assert.equal(theme.readConsentPreferences(), null)
})
