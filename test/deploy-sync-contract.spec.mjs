import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const deployScriptPath = path.resolve(process.cwd(), "tools/deploy-api-safe.sh")
const runtimeResyncScriptPath = path.resolve(process.cwd(), "tools/sis-runtime-resync.sh")

const deployScript = fs.readFileSync(deployScriptPath, "utf8")
const runtimeResyncScript = fs.readFileSync(runtimeResyncScriptPath, "utf8")

test("deploy-api-safe mirrors runtime and public portal assets with delete semantics", () => {
  assert.match(deployScript, /PUBLIC_ADMIN_DIR=\"\$\{PUBLIC_ADMIN_DIR:-\$\{PUBLIC_ROOT\}\/sis-admin\}\"/)
  assert.match(deployScript, /PUBLIC_PARENT_DIR=\"\$\{PUBLIC_PARENT_DIR:-\$\{PUBLIC_ROOT\}\/sis-parent\}\"/)
  assert.match(deployScript, /PUBLIC_STUDENT_DIR=\"\$\{PUBLIC_STUDENT_DIR:-\$\{PUBLIC_ROOT\}\/sis-student\}\"/)

  assert.match(deployScript, /collect_public_dir_drift \"\$\{SOURCE_ROOT\}\/web-asset\/admin\" \"\$\{PUBLIC_ADMIN_DIR\}\" \"public-admin-assets\"/)
  assert.match(deployScript, /collect_public_dir_drift \"\$\{SOURCE_ROOT\}\/web-asset\/parent\" \"\$\{PUBLIC_PARENT_DIR\}\" \"public-parent-assets\"/)
  assert.match(deployScript, /collect_public_dir_drift \"\$\{SOURCE_ROOT\}\/web-asset\/student\" \"\$\{PUBLIC_STUDENT_DIR\}\" \"public-student-assets\"/)

  assert.match(deployScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{SOURCE_ROOT\}\/server\/\" \"\$\{RUNTIME_ROOT\}\/server\/\"/)
  assert.match(deployScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{SOURCE_ROOT\}\/schemas\/\" \"\$\{RUNTIME_ROOT\}\/schemas\/\"/)
  assert.match(deployScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{SOURCE_ROOT\}\/web-asset\/admin\/\" \"\$\{RUNTIME_ROOT\}\/web-asset\/admin\/\"/)
  assert.match(deployScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{SOURCE_ROOT\}\/web-asset\/parent\/\" \"\$\{RUNTIME_ROOT\}\/web-asset\/parent\/\"/)
  assert.match(deployScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{SOURCE_ROOT\}\/web-asset\/student\/\" \"\$\{RUNTIME_ROOT\}\/web-asset\/student\/\"/)
  assert.match(deployScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{SOURCE_ROOT\}\/web-asset\/vendor\/\" \"\$\{RUNTIME_ROOT\}\/web-asset\/vendor\/\"/)
  assert.match(deployScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{SOURCE_ROOT\}\/web-asset\/images\/\" \"\$\{RUNTIME_ROOT\}\/web-asset\/images\/\"/)

  assert.match(deployScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{SOURCE_ROOT\}\/web-asset\/admin\/\" \"\$\{PUBLIC_ADMIN_DIR\}\/\"/)
  assert.match(deployScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{SOURCE_ROOT\}\/web-asset\/parent\/\" \"\$\{PUBLIC_PARENT_DIR\}\/\"/)
  assert.match(deployScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{SOURCE_ROOT\}\/web-asset\/student\/\" \"\$\{PUBLIC_STUDENT_DIR\}\/\"/)
})

test("deploy-api-safe route matrices include admin/tabulator and parent/student routes", () => {
  assert.match(deployScript, /LOCAL_ROUTE_CHECK_MATRIX=.*\/api\/admin\/auth\/me\|401/)
  assert.match(deployScript, /LOCAL_ROUTE_CHECK_MATRIX=.*\/api\/parent\/auth\/me\|401/)
  assert.match(deployScript, /LOCAL_ROUTE_CHECK_MATRIX=.*\/api\/student\/auth\/me\|401/)
  assert.match(deployScript, /LOCAL_ROUTE_CHECK_MATRIX=.*\/admin\/students\?page=grades-data\|200/)
  assert.match(deployScript, /LOCAL_ROUTE_CHECK_MATRIX=.*\/web-asset\/admin\/grades-tabulator\.html\|200/)
  assert.match(deployScript, /LOCAL_ROUTE_CHECK_MATRIX=.*\/parent\/portal\|200/)
  assert.match(deployScript, /LOCAL_ROUTE_CHECK_MATRIX=.*\/student\/portal\|200/)

  assert.match(deployScript, /EDGE_HTTPS_CHECK_MATRIX=.*\/admin\/students\?page=grades-data\|200/)
  assert.match(deployScript, /EDGE_HTTPS_CHECK_MATRIX=.*\/web-asset\/admin\/grades-tabulator\.html\|200/)
  assert.match(deployScript, /EDGE_HTTPS_CHECK_MATRIX=.*\/parent\/portal\|200/)
  assert.match(deployScript, /EDGE_HTTPS_CHECK_MATRIX=.*\/student\/portal\|200/)
})

test("sis-runtime-resync uses delete-sync rsync and route matrices for all portals", () => {
  assert.match(runtimeResyncScript, /LOCAL_ROUTE_CHECK_MATRIX=.*\/api\/parent\/auth\/me\|401/)
  assert.match(runtimeResyncScript, /LOCAL_ROUTE_CHECK_MATRIX=.*\/api\/student\/auth\/me\|401/)
  assert.match(runtimeResyncScript, /LOCAL_ROUTE_CHECK_MATRIX=.*\/admin\/students\?page=grades-data\|200/)
  assert.match(runtimeResyncScript, /LOCAL_ROUTE_CHECK_MATRIX=.*\/web-asset\/admin\/grades-tabulator\.html\|200/)
  assert.match(runtimeResyncScript, /LOCAL_ROUTE_CHECK_MATRIX=.*\/parent\/portal\|200/)
  assert.match(runtimeResyncScript, /LOCAL_ROUTE_CHECK_MATRIX=.*\/student\/portal\|200/)

  assert.match(runtimeResyncScript, /EDGE_HTTPS_CHECK_MATRIX=.*\/admin\/students\?page=grades-data\|200/)
  assert.match(runtimeResyncScript, /EDGE_HTTPS_CHECK_MATRIX=.*\/web-asset\/admin\/grades-tabulator\.html\|200/)
  assert.match(runtimeResyncScript, /EDGE_HTTPS_CHECK_MATRIX=.*\/parent\/portal\|200/)
  assert.match(runtimeResyncScript, /EDGE_HTTPS_CHECK_MATRIX=.*\/student\/portal\|200/)

  assert.match(runtimeResyncScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{REPO_ROOT\}\/server\/\" \"\$\{RUNTIME_ROOT\}\/server\/\"/)
  assert.match(runtimeResyncScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{REPO_ROOT\}\/schemas\/\" \"\$\{RUNTIME_ROOT\}\/schemas\/\"/)
  assert.match(runtimeResyncScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{REPO_ROOT\}\/web-asset\/parent\/\" \"\$\{RUNTIME_ROOT\}\/web-asset\/parent\/\"/)
  assert.match(runtimeResyncScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{REPO_ROOT\}\/web-asset\/student\/\" \"\$\{RUNTIME_ROOT\}\/web-asset\/student\/\"/)
  assert.match(runtimeResyncScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{REPO_ROOT\}\/web-asset\/vendor\/\" \"\$\{RUNTIME_ROOT\}\/web-asset\/vendor\/\"/)
  assert.match(runtimeResyncScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{REPO_ROOT\}\/web-asset\/images\/\" \"\$\{RUNTIME_ROOT\}\/web-asset\/images\/\"/)
  assert.match(runtimeResyncScript, /rsync -a --delete \"\$\{RSYNC_EXCLUDES\[@\]\}\" \"\$\{REPO_ROOT\}\/web-asset\/admin\/\" \"\$\{RUNTIME_ROOT\}\/web-asset\/admin\/\"/)
})
