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
const TEST_ONLY_SYNC_SOURCES = new Set()

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

function extractQuotedEntries(script, listName) {
  const match = script.match(new RegExp(`${listName}=\\(([^]*?)\\n\\)`, "m"))
  assert.ok(match, `missing ${listName}`)
  return match[1]
    .split(/\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("\""))
    .map((line) => line.replace(/^"|"$/g, ""))
}

test("live admin sync wrapper is pinned to the live admin host and refreshes Prisma", () => {
  assert.match(liveScript, /\/home\/admin\.eagles\.edu\.vn\/sis/)
  assert.match(liveScript, /\/home\/admin\.eagles\.edu\.vn\/public_html/)
  assert.match(liveScript, /https:\/\/admin\.eagles\.edu\.vn/)
  assert.match(liveScript, /LIVE_RUNTIME_ENV=.*production/)
  assert.match(liveScript, /backup-only/)
  assert.match(liveScript, /check-only/)
  assert.match(liveScript, /full\|public\|restart-only\|boot-prep\|backup-only\|check-only/)
  assert.match(liveScript, /full/)
  assert.match(liveScript, /https:\/\/admin\.eagles\.edu\.vn\/\|200\|Cổng Thông Tin Sinh Viên\|/)
  assert.match(liveScript, /maintenance\.svg/)
  assert.match(liveScript, /web-asset\/images\/caret-down\.svg\|web-asset\/images\/caret-down\.svg/)
  assert.match(testScript, /web-asset\/images\/caret-down\.svg\|web-asset\/images\/caret-down\.svg/)
  assert.match(liveScript, /emptying live runtime root/)
  assert.match(liveScript, /emptying live public root/)
  assert.match(liveScript, /verify_live_roots_cleared/)
  assert.match(liveScript, /verify_live_sync_whitelist/)
  assert.match(liveScript, /tools\/db-backup-failsafe\.mjs/)
  assert.match(liveScript, /backing up postgres into/)
  assert.match(liveScript, /"vhostSnapshotDir": "\$\{vhost_snapshot_dir\}"/)
  assert.match(liveScript, /"databaseBackupDir": "\$\{LIVE_DATABASE_BACKUP_DIR\}"/)
  assert.match(liveScript, /LIVE_NGINX_ENABLED_VHOST/)
  assert.match(liveScript, /LIVE_LITESPEED_VHOST/)
  assert.match(liveScript, /sync_live_runtime_data_files\(\)/)
  assert.match(liveScript, /LIVE_LOCAL_UI_RUNTIME_PARITY_MAP=\(/)
  assert.match(liveScript, /verify_local_ui_live_parity\(\)/)
  assert.match(liveScript, /local UI live parity mismatch/)
  assert.match(liveScript, /sync_live_public_html_index\(\)/)
  assert.match(liveScript, /verify_live_public_html_index\(\)/)
  assert.match(liveScript, /target_rel\}" == "index\.html"/)
  assert.match(liveScript, /window\.__SIS_RUNTIME_ENV=.*window\.__SIS_ADMIN_PAGE_PATH=.*window\.__SIS_PARENT_PORTAL_PAGE_PATH=.*window\.__SIS_STUDENT_PORTAL_PAGE_PATH=/s)
  assert.match(liveScript, /runtime-data\/admin-ui-settings\.json/)
  assert.match(liveScript, /LIVE_PRESERVED_RUNTIME_FILES=\([\s\S]*"runtime-data\/admin-ui-settings\.json"/)
  assert.match(liveScript, /npm ci --no-audit --no-fund/)
  assert.match(liveScript, /refresh_runtime_prisma_client\(\)/)
  assert.match(liveScript, /npm run db:migrate:deploy/)
  assert.match(liveScript, /immutable restore mismatch: \.env/)
  assert.match(liveScript, /preserved immutable hash verified: \$\{rel_path\}/)
  assert.match(liveScript, /allowed_runtime_paths.*runtime-data/s)
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
  assert.match(liveLinksDoc, /refreshes Prisma[\s\S]*`db:generate`[\s\S]*`db:migrate:deploy`/i)
})

test("live nginx config mirrors the test parent route shape", () => {
  assert.match(liveNginxConf, /location = \/parent \{/)
  assert.match(liveNginxConf, /proxy_pass http:\/\/sis_api_upstream\/parent;/)
  assert.match(liveNginxConf, /location = \/parent\/portal \{\s+return 308 \/parent;/s)
})

test("test and live sync wrappers share the same strict whitelist sources except test-only assets", () => {
  assert.match(testScript, /web-asset\/admin\/report-card\.html\|web-asset\/admin\/report-card\.html/)
  assert.match(liveScript, /web-asset\/admin\/report-card\.html\|web-asset\/admin\/report-card\.html/)
  assert.match(testScript, /web-asset\/admin\/portal-hub\.html\|index\.html/)
  assert.match(liveScript, /web-asset\/admin\/portal-hub\.html\|index\.html/)
  assert.deepEqual(
    extractMapSources(testScript, "TEST_RUNTIME_WEBFILE_MAP").filter((source) => !TEST_ONLY_SYNC_SOURCES.has(source)),
    extractMapSources(liveScript, "LIVE_RUNTIME_WEBFILE_MAP"),
  )
  assert.deepEqual(
    extractMapSources(testScript, "TEST_PUBLIC_WEBFILE_MAP").filter((source) => !TEST_ONLY_SYNC_SOURCES.has(source)),
    extractMapSources(liveScript, "LIVE_PUBLIC_WEBFILE_MAP"),
  )
  assert.deepEqual(
    extractQuotedEntries(testScript, "TEST_RUNTIME_WEBFILE_MAP").filter((entry) => !TEST_ONLY_SYNC_SOURCES.has(entry.split("|")[0])).sort(),
    extractQuotedEntries(liveScript, "LIVE_RUNTIME_WEBFILE_MAP").sort(),
  )
  assert.deepEqual(
    extractQuotedEntries(testScript, "TEST_PUBLIC_WEBFILE_MAP").filter((entry) => !TEST_ONLY_SYNC_SOURCES.has(entry.split("|")[0])).sort(),
    extractQuotedEntries(liveScript, "LIVE_PUBLIC_WEBFILE_MAP").sort(),
  )
  assert.deepEqual(
    extractQuotedEntries(testScript, "TEST_RUNTIME_CODE_DIRS"),
    extractQuotedEntries(liveScript, "LIVE_RUNTIME_CODE_DIRS"),
  )
  assert.deepEqual(
    extractQuotedEntries(testScript, "TEST_RUNTIME_CODE_FILES"),
    extractQuotedEntries(liveScript, "LIVE_RUNTIME_CODE_FILES"),
  )
  assert.deepEqual(
    extractMapSources(testScript, "TEST_LOCAL_UI_RUNTIME_PARITY_MAP"),
    extractMapSources(liveScript, "LIVE_LOCAL_UI_RUNTIME_PARITY_MAP"),
  )
  assert.deepEqual(
    extractQuotedEntries(testScript, "TEST_LOCAL_UI_RUNTIME_PARITY_MAP").sort(),
    extractQuotedEntries(liveScript, "LIVE_LOCAL_UI_RUNTIME_PARITY_MAP").sort(),
  )
})

test("test and live sync wrappers keep immutable runtime files separate from mirrored runtime data", () => {
  assert.deepEqual(extractQuotedEntries(testScript, "TEST_RUNTIME_DATA_FILES"), [])
  assert.deepEqual(extractQuotedEntries(liveScript, "LIVE_RUNTIME_DATA_FILES"), [])
  assert.match(testScript, /TEST_PRESERVED_RUNTIME_FILES=\([\s\S]*"runtime-data\/admin-ui-settings\.json"/)
  assert.match(liveScript, /LIVE_PRESERVED_RUNTIME_FILES=\([\s\S]*"runtime-data\/admin-ui-settings\.json"/)
})

test("test and live sync wrappers preserve their expected immutable runtime files", () => {
  assert.deepEqual(extractQuotedEntries(testScript, "TEST_PRESERVED_RUNTIME_FILES"), [
    "SIS_CONFIG.json",
    "runtime-data/admin-ui-settings.json",
  ])
  assert.deepEqual(extractQuotedEntries(liveScript, "LIVE_PRESERVED_RUNTIME_FILES"), [
    "SIS_CONFIG.json",
    "runtime-data/admin-ui-settings.json",
  ])
})
