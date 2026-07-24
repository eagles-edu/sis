import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const scriptPath = path.resolve(process.cwd(), "tools/sync-and-restart-test-runtime.sh")
const script = fs.readFileSync(scriptPath, "utf8")

test("sync-and-restart-test-runtime defaults to loopback health and split env exports", () => {
  assert.match(script, /TEST_HEALTH_URL="\$\{SIS_TEST_HEALTH_URL:-http:\/\/127\.0\.0\.1:\$\{TEST_PORT\}\/healthz\}"/)
  assert.match(
    script,
    /TEST_VERBOSE_ENV=\("SIS_ENV_FILE=.env\.test" "DOTENV_CONFIG_PATH=.env\.test" "NODE_ENV=test"\)/
  )
})

test("full test-mirror sync creates a restorable database backup without purging the database", () => {
  assert.match(script, /TEST_BACKUP_BUNDLE_DIR=""/)
  assert.match(script, /TEST_DATABASE_BACKUP_DIR=""/)
  assert.match(script, /backup_test_database\(\)/)
  assert.match(script, /if \[\[ -f "\$\{TEST_ROOT\}\/\.env\.test" \]\]; then/)
  assert.match(script, /if \[\[ "\$\{MODE\}" == "full" \]\]; then\s+backup_test_database/s)
  assert.match(script, /tools\/db-backup-smart\.sh/)
  assert.match(script, /--runtime-env "\$\{test_env_path\}"/)
  assert.match(script, /"databaseBackupRequired": \$\(\[\[ "\$\{MODE\}" == "full" \]\]/)
  assert.match(script, /"mirrorPurgeLeavesDatabaseUntouched": true/)
  assert.doesNotMatch(script, /dropdb|DROP DATABASE|TRUNCATE|pg_restore/)
})

test("sync-and-restart-test-runtime skips Prisma refresh in public mode only", () => {
  assert.match(
    script,
    /should_refresh_prisma\(\) \{\s+\[\[ "\$MODE" == "full" \|\| "\$MODE" == "restart-only" \|\| "\$MODE" == "boot-prep" \]\]/
  )
  assert.match(script, /if should_refresh_prisma; then\s+refresh_test_prisma\s+else\s+log "skip Prisma refresh for mode=\$\{MODE\}"/)
  assert.match(script, /build_admin_assets\(\)/)
  assert.match(script, /verify_favicon_mobile_contract repo/)
  assert.match(script, /npm run build:admin-assets/)
  assert.match(script, /wipe_target_contents\(\)/)
  assert.match(script, /wipe_test_target_contents\(\)/)
  assert.match(script, /backup_test_state\(\)/)
  assert.match(script, /verify_test_preserved_runtime_files\(\)/)
  assert.match(script, /log "emptying \$\{target_root\}"/)
  assert.match(script, /sync_test_runtime_assets\(\)/)
  assert.match(script, /sync_test_public_assets\(\)/)
  assert.match(script, /web-asset\/admin\/portal-hub\.html\|index\.html/)
  assert.match(script, /TEST_PRESERVED_RUNTIME_FILES=\(/)
  assert.match(script, /"SIS_CONFIG\.json"/)
  assert.match(script, /web-asset\/admin\/report-card\.html\|web-asset\/admin\/report-card\.html/)
  assert.match(script, /npm run db:migrate:deploy/)
  assert.match(script, /refresh_test_prisma\(\)/)
  assert.match(script, /restart_test_runtime\(\)/)
  assert.match(script, /log "syncing test runtime web assets into \$\{TEST_ROOT\}"/)
  assert.match(script, /log "syncing test public mirror into \$\{TEST_PUBLIC_ROOT\}"/)
  assert.match(
    script,
    /main\(\) \{\s+log "file mirror sync; full mode includes a restorable test DB backup; git commit matching is not part of the contract"\s+build_admin_assets\s+verify_favicon_mobile_contract repo\s+backup_test_state\s+wipe_test_target_contents\s+verify_test_preserved_runtime_files\s+wipe_target_contents "\$TEST_PUBLIC_ROOT"\s+run_sync/s,
  )
})
