import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import vm from "node:vm"

const scriptPath = path.resolve(process.cwd(), "web-asset/shared/portal-preferences.js")
const scriptSource = fs.readFileSync(scriptPath, "utf8")

function createSandbox(authState = "unauthenticated") {
  const calls = []
  const storage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    key: () => null,
    length: 0,
  }
  const sandbox = {
    document: { documentElement: { dataset: { parentAuthState: authState }, style: {} } },
    localStorage: storage,
    sessionStorage: storage,
    window: null,
    __SIS_PARENT_PREFERENCES_PATH: "/api/parent/preferences",
    fetch: async (...args) => {
      calls.push(args)
      return { ok: true, json: async () => ({}) }
    },
  }
  sandbox.window = sandbox
  vm.runInNewContext(scriptSource, sandbox, { filename: scriptPath })
  return { calls, preferences: sandbox.SIS_PORTAL_PREFERENCES }
}

test("does not write preferences before parent authentication", async () => {
  const { calls, preferences } = createSandbox()
  const saved = await preferences.save("sis-theme", "dark")

  assert.equal(saved, false)
  assert.equal(calls.length, 0)
  assert.equal(preferences.get("sis-theme"), "dark")
})

test("writes preferences after parent authentication", async () => {
  const { calls, preferences } = createSandbox("authenticated")
  const saved = await preferences.save("sis-theme", "dark")

  assert.equal(saved, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], "/api/parent/preferences")
  assert.equal(calls[0][1].method, "PUT")
})
