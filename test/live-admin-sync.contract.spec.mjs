import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const rootDir = process.cwd()
const liveScript = fs.readFileSync(path.join(rootDir, "tools/sync-and-restart-live-runtime.sh"), "utf8")
const testScript = fs.readFileSync(path.join(rootDir, "tools/sync-and-restart-test-runtime.sh"), "utf8")
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"))
const liveLinksDoc = fs.readFileSync(path.join(rootDir, "docs/Live portal links.md"), "utf8")
const liveNginxConf = fs.readFileSync(path.join(rootDir, "deploy/nginx/admin.eagles.edu.vn.conf"), "utf8")

function extractMapSources(script, mapName) {
  const match = script.match(new RegExp(`${mapName}=\\(([^]*?)\\n\\)`, "m"))
  assert.ok(match, `missing ${mapName}`)
  return match[1]
    .split(/\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("\""))
    .map((line) => line.replace(/^"|"$/g, ""))
    .map((entry) => entry.split("|")[0])
    .sort()
}

test("live admin sync wrapper is pinned to the live admin host and avoids prisma migrations", () => {
  assert.match(liveScript, /\/home\/admin\.eagles\.edu\.vn\/sis/)
  assert.match(liveScript, /\/home\/admin\.eagles\.edu\.vn\/public_html/)
  assert.match(liveScript, /https:\/\/admin\.eagles\.edu\.vn/)
  assert.match(liveScript, /backup-only/)
  assert.match(liveScript, /check-only/)
  assert.match(liveScript, /full/)
  assert.match(liveScript, /maintenance\.svg/)
  assert.match(liveScript, /emptying live runtime root/)
  assert.match(liveScript, /emptying live public root/)
  assert.match(liveScript, /verify_live_roots_cleared/)
  assert.match(liveScript, /verify_live_sync_whitelist/)
  assert.match(liveScript, /npm ci --no-audit --no-fund/)
  assert.doesNotMatch(liveScript, /prisma migrate deploy/i)
})

test("package scripts expose the live admin sync entrypoints", () => {
  assert.equal(packageJson.scripts["sync:live:admin:check"], "tools/sync-and-restart-live-runtime.sh check-only")
  assert.equal(packageJson.scripts["sync:live:admin:backup"], "tools/sync-and-restart-live-runtime.sh backup-only")
  assert.equal(packageJson.scripts["sync:live:admin:full"], "tools/sync-and-restart-live-runtime.sh full")
  assert.equal(
    packageJson.scripts["sync:full:admin-root:restart-runtimes"],
    "tools/sync-and-restart-live-runtime.sh full",
  )
})

test("live portal docs advertise the backup bundle and admin origin", () => {
  assert.match(liveLinksDoc, /\/home\/eagles\/dockerz\/backups\/live-admin\//)
  assert.match(liveLinksDoc, /https:\/\/admin\.eagles\.edu\.vn/)
  assert.match(liveLinksDoc, /does not run `prisma migrate deploy`/i)
})

test("live nginx config mirrors the test parent route shape", () => {
  assert.match(liveNginxConf, /location = \/parent \{/)
  assert.match(liveNginxConf, /proxy_pass http:\/\/sis_api_upstream\/parent;/)
  assert.match(liveNginxConf, /location = \/parent\/portal \{\s+return 308 \/parent;/s)
})

test("test and live sync wrappers share the same strict whitelist sources", () => {
  assert.deepEqual(
    extractMapSources(testScript, "TEST_RUNTIME_WEBFILE_MAP"),
    extractMapSources(liveScript, "LIVE_RUNTIME_WEBFILE_MAP"),
  )
  assert.deepEqual(
    extractMapSources(testScript, "TEST_PUBLIC_WEBFILE_MAP"),
    extractMapSources(liveScript, "LIVE_PUBLIC_WEBFILE_MAP"),
  )
})
