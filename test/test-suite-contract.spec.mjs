import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const scriptPath = path.resolve(process.cwd(), "tools/test-suite.mjs")
const script = fs.readFileSync(scriptPath, "utf8")

test("test suite runner gives portal-site-review a longer per-file timeout", () => {
  assert.match(script, /const DEFAULT_FILE_TIMEOUT_MS = 300000/)
  assert.match(
    script,
    /\["test\/portal-site-review\.playwright\.spec\.mjs", 900000\]/
  )
  assert.match(script, /function resolveFileTimeoutMs\(filePath\) \{/)
  assert.match(script, /return FILE_TIMEOUT_OVERRIDES.get\(filePath\) \|\| DEFAULT_FILE_TIMEOUT_MS/)
})

test("test suite runner supports resuming from a numbered file", () => {
  assert.match(script, /--from <number>/)
  assert.match(script, /const fromPosition = fromText \? Number\.parseInt\(fromText, 10\) : 1/)
  assert.match(script, /const files = allFiles\.slice\(fromPosition - 1\)/)
  assert.match(script, /\$\{index \+ fromPosition\}\/\$\{allFiles\.length\}/)
})
