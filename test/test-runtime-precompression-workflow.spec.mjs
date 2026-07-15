import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const rootDir = process.cwd()
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"))
const workflow = fs.readFileSync(
  path.join(rootDir, "tools/sync-and-precompress-test-runtime.sh"),
  "utf8",
)

test("test runtime workflow exposes full sync with precompression", () => {
  assert.equal(packageJson.scripts["test:runtime:sync-restart:precompress"], "tools/sync-and-precompress-test-runtime.sh")
  assert.match(workflow, /sync-and-restart-test-runtime\.sh" full/)
  assert.match(workflow, /precompress-web-assets\.sh" test/)
})
