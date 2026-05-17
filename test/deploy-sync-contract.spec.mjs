import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const deployScriptPath = path.resolve(process.cwd(), "tools/deploy-api-safe.sh")
const runtimeResyncScriptPath = path.resolve(process.cwd(), "tools/sis-runtime-resync.sh")
const moodleDeployScriptPath = path.resolve(process.cwd(), "tools/deploy-moodle-plugin.sh")
const testRuntimeSyncScriptPath = path.resolve(process.cwd(), "tools/sync-and-restart-test-runtime.sh")
const testNginxConfigPath = path.resolve(process.cwd(), "deploy/nginx/test.eagles.edu.vn.conf")

const deployScript = fs.readFileSync(deployScriptPath, "utf8")
const runtimeResyncScript = fs.readFileSync(runtimeResyncScriptPath, "utf8")
const moodleDeployScript = fs.readFileSync(moodleDeployScriptPath, "utf8")
const testRuntimeSyncScript = fs.readFileSync(testRuntimeSyncScriptPath, "utf8")
const testNginxConfig = fs.readFileSync(testNginxConfigPath, "utf8")

test("deploy-api-safe mirrors runtime and public portal assets with delete semantics", () => {
  assert.match(deployScript, /PUBLIC_ADMIN_DIR=\"\$\{PUBLIC_ADMIN_DIR:-\$\{PUBLIC_ROOT\}\/sis-admin\}\"/)
  assert.match(deployScript, /PUBLIC_PARENT_DIR=\"\$\{PUBLIC_PARENT_DIR:-\$\{PUBLIC_ROOT\}\/sis-parent\}\"/)
  assert.match(deployScript, /PUBLIC_STUDENT_DIR=\"\$\{PUBLIC_STUDENT_DIR:-\$\{PUBLIC_ROOT\}\/sis-student\}\"/)
  assert.match(deployScript, /PUBLIC_SHARED_DIR=\"\$\{PUBLIC_SHARED_DIR:-\$\{PUBLIC_ROOT\}\/web-asset\/shared\}\"/)

  assert.match(deployScript, /collect_public_dir_drift \"\$\{SOURCE_ROOT\}\/web-asset\/admin\" \"\$\{PUBLIC_ADMIN_DIR\}\" \"public-admin-assets\"/)
  assert.match(deployScript, /collect_public_dir_drift \"\$\{SOURCE_ROOT\}\/web-asset\/parent\" \"\$\{PUBLIC_PARENT_DIR\}\" \"public-parent-assets\"/)
  assert.match(deployScript, /collect_public_dir_drift \"\$\{SOURCE_ROOT\}\/web-asset\/student\" \"\$\{PUBLIC_STUDENT_DIR\}\" \"public-student-assets\"/)
  assert.match(deployScript, /collect_public_dir_drift \"\$\{SOURCE_ROOT\}\/web-asset\/shared\" \"\$\{PUBLIC_SHARED_DIR\}\" \"public-shared-assets\"/)

  assert.match(deployScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{SOURCE_ROOT\}\/server\/\" \"\$\{RUNTIME_ROOT\}\/server\/\"/)
  assert.match(deployScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{SOURCE_ROOT\}\/schemas\/\" \"\$\{RUNTIME_ROOT\}\/schemas\/\"/)
  assert.match(deployScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{SOURCE_ROOT\}\/web-asset\/admin\/\" \"\$\{RUNTIME_ROOT\}\/web-asset\/admin\/\"/)
  assert.match(deployScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{SOURCE_ROOT\}\/web-asset\/parent\/\" \"\$\{RUNTIME_ROOT\}\/web-asset\/parent\/\"/)
  assert.match(deployScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{SOURCE_ROOT\}\/web-asset\/student\/\" \"\$\{RUNTIME_ROOT\}\/web-asset\/student\/\"/)
  assert.match(deployScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{SOURCE_ROOT\}\/web-asset\/shared\/\" \"\$\{RUNTIME_ROOT\}\/web-asset\/shared\/\"/)
  assert.match(deployScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{SOURCE_ROOT\}\/web-asset\/vendor\/\" \"\$\{RUNTIME_ROOT\}\/web-asset\/vendor\/\"/)
  assert.match(deployScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{SOURCE_ROOT\}\/web-asset\/images\/\" \"\$\{RUNTIME_ROOT\}\/web-asset\/images\/\"/)
  assert.match(deployScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{SOURCE_ROOT\}\/web-asset\/icons\/\" \"\$\{RUNTIME_ROOT\}\/web-asset\/icons\/\"/)

  assert.match(deployScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{SOURCE_ROOT\}\/web-asset\/admin\/\" \"\$\{PUBLIC_ADMIN_DIR\}\/\"/)
  assert.match(deployScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{SOURCE_ROOT\}\/web-asset\/parent\/\" \"\$\{PUBLIC_PARENT_DIR\}\/\"/)
  assert.match(deployScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{SOURCE_ROOT\}\/web-asset\/student\/\" \"\$\{PUBLIC_STUDENT_DIR\}\/\"/)
  assert.match(deployScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{SOURCE_ROOT\}\/web-asset\/shared\/\" \"\$\{PUBLIC_SHARED_DIR\}\/\"/)
})

test("deploy-api-safe route matrices include admin/tabulator and parent/student routes", () => {
  assert.match(deployScript, /PINNED_MAILER_PORT=\"8787\"/)
  assert.doesNotMatch(deployScript, /MAILER_PORT=\"\$\{MAILER_PORT:-/)

  assert.match(deployScript, /LOCAL_ROUTE_CHECK_MATRIX=.*\/api\/admin\/auth\/me\|401/)
  assert.match(deployScript, /LOCAL_ROUTE_CHECK_MATRIX=.*\/api\/parent\/auth\/me\|401/)
  assert.match(deployScript, /LOCAL_ROUTE_CHECK_MATRIX=.*\/api\/student\/auth\/me\|401/)
  assert.match(deployScript, /LOCAL_ROUTE_CHECK_MATRIX=.*\/admin\?page=grades-data\|200/)
  assert.match(deployScript, /LOCAL_ROUTE_CHECK_MATRIX=.*\/web-asset\/admin\/grades-tabulator\.html\|200/)
  assert.match(deployScript, /LOCAL_ROUTE_CHECK_MATRIX=.*\/parent\|200/)
  assert.match(deployScript, /LOCAL_ROUTE_CHECK_MATRIX=.*\/student\|200/)

  assert.match(deployScript, /EDGE_HTTPS_CHECK_MATRIX=.*\/admin\?page=grades-data\|200/)
  assert.match(deployScript, /EDGE_HTTPS_CHECK_MATRIX=.*\/web-asset\/admin\/grades-tabulator\.html\|200/)
  assert.match(deployScript, /EDGE_HTTPS_CHECK_MATRIX=.*\/parent\|200/)
  assert.match(deployScript, /EDGE_HTTPS_CHECK_MATRIX=.*\/student\|200/)
})

test("deploy-api-safe runs blocking modal chip and portal parity gates after sync", () => {
  assert.match(deployScript, /run_blocking_portal_contract_gates\(\)/)
  assert.match(deployScript, /node --test test\/portal-chip-contract\.spec\.mjs/)
  assert.match(deployScript, /tools\/verify-portal-sync-proof\.sh/)
  assert.match(
    deployScript,
    /perform_sync\s+refresh_runtime_prisma_client\s+restart_if_requested\s+run_blocking_portal_contract_gates\s+run_health_checks/
  )
  assert.match(deployScript, /collect_prisma_drift\(\)/)
  assert.match(deployScript, /refresh_runtime_prisma_client\(\)/)
  assert.match(deployScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{SOURCE_ROOT\}\/prisma\/\" \"\$\{RUNTIME_ROOT\}\/prisma\/\"/)
  assert.match(deployScript, /rsync -a --delete \"\$\{SOURCE_ROOT\}\/prisma\.config\.ts\" \"\$\{RUNTIME_ROOT\}\/\"/)
  assert.match(deployScript, /npm run db:generate/)
  assert.match(deployScript, /note=DB unchanged \(no migrate, no restore\)/)
  assert.doesNotMatch(deployScript, /boot-prep/)
  assert.doesNotMatch(deployScript, /db:migrate:deploy/)
  assert.doesNotMatch(deployScript, /db:restore/)
})

test("sis-runtime-resync uses delete-sync rsync and route matrices for all portals", () => {
  assert.match(runtimeResyncScript, /PINNED_MAILER_PORT=\"8787\"/)
  assert.doesNotMatch(runtimeResyncScript, /MAILER_PORT=\"\$\{MAILER_PORT:-/)
  assert.doesNotMatch(runtimeResyncScript, /--mailer-port/)

  assert.match(runtimeResyncScript, /LOCAL_ROUTE_CHECK_MATRIX=.*\/api\/parent\/auth\/me\|401/)
  assert.match(runtimeResyncScript, /LOCAL_ROUTE_CHECK_MATRIX=.*\/api\/student\/auth\/me\|401/)
  assert.match(runtimeResyncScript, /LOCAL_ROUTE_CHECK_MATRIX=.*\/admin\?page=grades-data\|200/)
  assert.match(runtimeResyncScript, /LOCAL_ROUTE_CHECK_MATRIX=.*\/web-asset\/admin\/grades-tabulator\.html\|200/)
  assert.match(runtimeResyncScript, /LOCAL_ROUTE_CHECK_MATRIX=.*\/parent\|200/)
  assert.match(runtimeResyncScript, /LOCAL_ROUTE_CHECK_MATRIX=.*\/student\|200/)
  assert.match(runtimeResyncScript, /collect_dir_drift \"\$\{REPO_ROOT\}\/web-asset\/shared\/\" \"\$\{RUNTIME_ROOT\}\/web-asset\/shared\/\" \"shared-assets\"/)
  assert.match(runtimeResyncScript, /collect_dir_drift \"\$\{REPO_ROOT\}\/web-asset\/icons\/\" \"\$\{RUNTIME_ROOT\}\/web-asset\/icons\/\" \"icons-assets\"/)

  assert.match(runtimeResyncScript, /EDGE_HTTPS_CHECK_MATRIX=.*\/admin\?page=grades-data\|200/)
  assert.match(runtimeResyncScript, /EDGE_HTTPS_CHECK_MATRIX=.*\/web-asset\/admin\/grades-tabulator\.html\|200/)
  assert.match(runtimeResyncScript, /EDGE_HTTPS_CHECK_MATRIX=.*\/parent\|200/)
  assert.match(runtimeResyncScript, /EDGE_HTTPS_CHECK_MATRIX=.*\/student\|200/)

  assert.match(runtimeResyncScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{REPO_ROOT\}\/server\/\" \"\$\{RUNTIME_ROOT\}\/server\/\"/)
  assert.match(runtimeResyncScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{REPO_ROOT\}\/schemas\/\" \"\$\{RUNTIME_ROOT\}\/schemas\/\"/)
  assert.match(runtimeResyncScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{REPO_ROOT\}\/web-asset\/parent\/\" \"\$\{RUNTIME_ROOT\}\/web-asset\/parent\/\"/)
  assert.match(runtimeResyncScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{REPO_ROOT\}\/web-asset\/student\/\" \"\$\{RUNTIME_ROOT\}\/web-asset\/student\/\"/)
  assert.match(runtimeResyncScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{REPO_ROOT\}\/web-asset\/shared\/\" \"\$\{RUNTIME_ROOT\}\/web-asset\/shared\/\"/)
  assert.match(runtimeResyncScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{REPO_ROOT\}\/web-asset\/vendor\/\" \"\$\{RUNTIME_ROOT\}\/web-asset\/vendor\/\"/)
  assert.match(runtimeResyncScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{REPO_ROOT\}\/web-asset\/images\/\" \"\$\{RUNTIME_ROOT\}\/web-asset\/images\/\"/)
  assert.match(runtimeResyncScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{REPO_ROOT\}\/web-asset\/icons\/\" \"\$\{RUNTIME_ROOT\}\/web-asset\/icons\/\"/)
  assert.match(runtimeResyncScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{REPO_ROOT\}\/web-asset\/admin\/\" \"\$\{RUNTIME_ROOT\}\/web-asset\/admin\/\"/)
  assert.match(runtimeResyncScript, /collect_prisma_drift\(\)/)
  assert.match(runtimeResyncScript, /refresh_runtime_prisma_client\(\)/)
  assert.match(runtimeResyncScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{REPO_ROOT\}\/prisma\/\" \"\$\{RUNTIME_ROOT\}\/prisma\/\"/)
  assert.match(runtimeResyncScript, /rsync -a --delete \"\$\{REPO_ROOT\}\/prisma\.config\.ts\" \"\$\{RUNTIME_ROOT\}\/\"/)
  assert.match(runtimeResyncScript, /note=DB unchanged \(no migrate, no restore\)/)
  assert.doesNotMatch(runtimeResyncScript, /boot-prep/)
  assert.doesNotMatch(runtimeResyncScript, /db:migrate:deploy/)
})

test("deploy-moodle-plugin mirrors the plugin into live Moodle and runs upgrade plus cache purge", () => {
  assert.match(moodleDeployScript, /PHP_BIN="\$\{PHP_BIN:-\/usr\/local\/lsws\/lsphp82\/bin\/php8\.2\}"/)
  assert.match(moodleDeployScript, /PLUGIN_SOURCE="\$\{PLUGIN_SOURCE:-\$\{SOURCE_ROOT\}\/integrations\/moodle\/local\/sisquizsync\/\}"/)
  assert.match(moodleDeployScript, /PLUGIN_TARGET="\$\{PLUGIN_TARGET:-\$\{MOODLE_ROOT\}\/local\/sisquizsync\/\}"/)
  assert.match(moodleDeployScript, /rsync -a --delete "\$\{PLUGIN_SOURCE\}" "\$\{PLUGIN_TARGET\}"/)
  assert.match(moodleDeployScript, /sudo -u www-data "\$\{PHP_BIN\}" admin\/cli\/upgrade\.php --non-interactive/)
  assert.match(moodleDeployScript, /sudo -u www-data "\$\{PHP_BIN\}" admin\/cli\/purge_caches\.php/)
})

test("sync-and-restart-test-runtime pins the test env contract and mirrors the portal hub safely", () => {
  assert.match(testRuntimeSyncScript, /case "\$MODE" in\s+full\|public\|restart-only\|boot-prep\)/s)
  assert.match(testRuntimeSyncScript, /TEST_ENV_DEV_MIRROR_KEYS=\(/)
  assert.match(testRuntimeSyncScript, /"STUDENT_ADMIN_USER"/)
  assert.match(testRuntimeSyncScript, /"STUDENT_ADMIN_PASS"/)
  assert.match(testRuntimeSyncScript, /"STUDENT_ADMIN_STORE_ENABLED"/)
  assert.match(testRuntimeSyncScript, /"SMTP_HOST"/)
  assert.match(testRuntimeSyncScript, /"SMTP_PASS"/)
  assert.match(testRuntimeSyncScript, /"MOODLE_QUIZ_SYNC_SHARED_SECRET"/)
  assert.match(testRuntimeSyncScript, /"STUDENT_TEACHER_ACCOUNTS_JSON"/)
  assert.match(testRuntimeSyncScript, /"STUDENT_PARENT_PORTAL_ACCOUNTS_JSON"/)
  assert.match(testRuntimeSyncScript, /"STUDENT_STUDENT_PORTAL_ACCOUNTS_JSON"/)
  assert.match(testRuntimeSyncScript, /align_test_env_from_dev_source\(\)/)
  assert.match(testRuntimeSyncScript, /sync_test_runtime_assets\(\)/)
  assert.match(testRuntimeSyncScript, /sync_test_public_assets\(\)/)
  assert.match(testRuntimeSyncScript, /sync_env_keys_between_files "\$source_env_path" "\$test_env_path" "\$\{TEST_ENV_DEV_MIRROR_KEYS\[@\]\}"/)
  assert.match(testRuntimeSyncScript, /log "aligned \$\{mirrored\} env keys from \$\(basename "\$source_env_path"\) to \$\(basename "\$target_env_path"\)"/)
  assert.match(testRuntimeSyncScript, /TEST_PRIMARY_ORIGIN="\$\{SIS_TEST_PRIMARY_ORIGIN:-https:\/\/test\.eagles\.edu\.vn\}"/)
  assert.match(testRuntimeSyncScript, /LIVE_ROOT_CANONICAL="\$\{SIS_LIVE_ROOT_CANONICAL:-\/home\/admin\.eagles\.edu\.vn\/sis\}"/)
  assert.match(testRuntimeSyncScript, /DEV_ROOT_CANONICAL="\$\{SIS_DEV_ROOT_CANONICAL:-\/home\/eagles\/dockerz\/sis\}"/)
  assert.match(testRuntimeSyncScript, /ensure_test_runtime_env_contract\(\)/)
  assert.match(testRuntimeSyncScript, /should_refresh_prisma\(\) \{\s+\[\[ "\$MODE" == "full" \|\| "\$MODE" == "restart-only" \|\| "\$MODE" == "boot-prep" \]\]/s)
  assert.match(testRuntimeSyncScript, /should_restart_runtime\(\) \{\s+\[\[ "\$MODE" != "boot-prep" \]\]/s)
  assert.match(testRuntimeSyncScript, /log "skip runtime restart and route probes for mode=\$\{MODE\}"/)
  assert.match(testRuntimeSyncScript, /upsert_env_value "\$test_env_path" "EXERCISE_MAILER_HOST" "127\.0\.0\.1"/)
  assert.match(testRuntimeSyncScript, /upsert_env_value "\$test_env_path" "EXERCISE_MAILER_PORT" "\$TEST_PORT"/)
  assert.match(testRuntimeSyncScript, /upsert_env_value "\$test_env_path" "EXERCISE_MAILER_ORIGIN" "\$TEST_PRIMARY_ORIGIN"/)
  assert.match(testRuntimeSyncScript, /upsert_env_value "\$test_env_path" "NODE_ENV" "test"/)
  assert.match(testRuntimeSyncScript, /upsert_env_value "\$test_env_path" "SIS_LIVE_ROOT" "\$LIVE_ROOT_CANONICAL"/)
  assert.match(testRuntimeSyncScript, /upsert_env_value "\$test_env_path" "SIS_DEV_ROOT" "\$test_dev_roots"/)
  assert.match(testRuntimeSyncScript, /upsert_env_value "\$test_env_path" "SIS_RUNTIME_SELF_HEAL_ENABLED" "false"/)
  assert.match(testRuntimeSyncScript, /upsert_env_value "\$default_env_path" "SIS_LIVE_ROOT" "\$LIVE_ROOT_CANONICAL"/)
  assert.match(testRuntimeSyncScript, /upsert_env_value "\$default_env_path" "SIS_DEV_ROOT" "\$test_dev_roots"/)
  assert.match(testRuntimeSyncScript, /sync_test_public_html_index\(\)/)
  assert.match(testRuntimeSyncScript, /sync_file_map "\$REPO_ROOT" "\$TEST_ROOT" TEST_RUNTIME_WEBFILE_MAP/)
  assert.match(testRuntimeSyncScript, /sync_file_map "\$REPO_ROOT" "\$TEST_PUBLIC_ROOT" TEST_PUBLIC_WEBFILE_MAP/)
})

test("sync-and-restart-test-runtime copies persisted admin UI settings into the test runtime", () => {
  assert.match(testRuntimeSyncScript, /TEST_RUNTIME_DATA_FILES=\(/)
  assert.match(testRuntimeSyncScript, /"runtime-data\/admin-ui-settings\.json"/)
  assert.match(testRuntimeSyncScript, /sync_runtime_data_files "\$TEST_ROOT"/)
})

test("test nginx enables strong gzip compression for HTML and static assets", () => {
  assert.match(testNginxConfig, /gzip on;/)
  assert.match(testNginxConfig, /gzip_static on;/)
  assert.match(testNginxConfig, /gzip_min_length 128;/)
  assert.match(testNginxConfig, /gzip_comp_level 9;/)
  assert.match(testNginxConfig, /gzip_proxied any;/)
  assert.match(
    testNginxConfig,
    /gzip_types[\s\S]*text\/javascript[\s\S]*application\/xml\+rss[\s\S]*application\/manifest\+json/,
  )
  assert.doesNotMatch(testNginxConfig, /gzip_types[\s\S]*text\/html/)
  assert.doesNotMatch(testNginxConfig, /gzip_comp_level 5;/)
})

test("test nginx enables brotli compression at maximum quality", () => {
  assert.match(testNginxConfig, /brotli on;/)
  assert.match(testNginxConfig, /brotli_static on;/)
  assert.match(testNginxConfig, /brotli_comp_level 11;/)
  assert.match(
    testNginxConfig,
    /brotli_types[\s\S]*text\/javascript[\s\S]*application\/xml\+rss[\s\S]*application\/manifest\+json/,
  )
  assert.doesNotMatch(testNginxConfig, /brotli_types[\s\S]*text\/html/)
  assert.doesNotMatch(testNginxConfig, /brotli_comp_level 5;/)
})

test("admin asset payloads stay below the Lighthouse reduction gates", () => {
  const adminJsStat = fs.statSync(path.resolve(process.cwd(), "web-asset/admin/student-admin.min.js"))
  const adminCssStat = fs.statSync(path.resolve(process.cwd(), "web-asset/admin/student-admin.min.css"))

  assert.ok(adminJsStat.size < 600_000, `student-admin.min.js should stay below 600 KB, got ${adminJsStat.size}`)
  assert.ok(adminCssStat.size < 81_000, `student-admin.min.css should stay below 81 KB, got ${adminCssStat.size}`)
})
