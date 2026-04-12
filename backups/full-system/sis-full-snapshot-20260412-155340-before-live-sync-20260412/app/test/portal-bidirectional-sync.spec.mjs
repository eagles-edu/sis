import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const scriptPath = path.resolve(process.cwd(), "tools/sync-portal-bidirectional.sh")
const packageJsonPath = path.resolve(process.cwd(), "package.json")

const scriptSource = fs.readFileSync(scriptPath, "utf8")
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))

test("bidirectional portal sync script supports both sync directions", () => {
  assert.match(scriptSource, /--dev-to-live/)
  assert.match(scriptSource, /--live-to-dev/)
  assert.match(scriptSource, /DIRECTION="dev-to-live"/)
  assert.match(scriptSource, /if \[\[ "\$\{DIRECTION\}" == "dev-to-live" \]\]/)
})

test("bidirectional portal sync script tracks admin parent and student portal files", () => {
  assert.match(scriptSource, /DEV_REL\[admin\]="web-asset\/admin\/student-admin\.html"/)
  assert.match(scriptSource, /DEV_REL\[parent\]="web-asset\/parent\/parent-portal\.html"/)
  assert.match(scriptSource, /DEV_REL\[student\]="web-asset\/student\/student-portal\.html"/)

  assert.match(scriptSource, /PUBLIC_REL\[admin\]="sis-admin\/student-admin\.html"/)
  assert.match(scriptSource, /PUBLIC_REL\[parent\]="sis-parent\/parent-portal\.html"/)
  assert.match(scriptSource, /PUBLIC_REL\[student\]="sis-student\/student-portal\.html"/)
})

test("package scripts expose bidirectional portal sync commands", () => {
  assert.equal(packageJson.scripts["sync:portal:check"], "tools/sync-portal-bidirectional.sh --check-only")
  assert.equal(packageJson.scripts["sync:portal:dev-to-live"], "tools/sync-portal-bidirectional.sh --apply --dev-to-live")
  assert.equal(packageJson.scripts["sync:portal:live-to-dev"], "tools/sync-portal-bidirectional.sh --apply --live-to-dev")
})
