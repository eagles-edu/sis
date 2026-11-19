import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

const guard = fs.readFileSync(new URL("../ops/systemd/keepalive-test-restart-guard.conf", import.meta.url), "utf8")
const installer = fs.readFileSync(new URL("../tools/install-test-restart-guards.sh", import.meta.url), "utf8")

test("test-mirror restarts have a cooldown and finite rolling start limit", () => {
  assert.match(guard, /^StartLimitIntervalSec=15min$/mu)
  assert.match(guard, /^StartLimitBurst=4$/mu)
  assert.match(guard, /^StartLimitAction=none$/mu)
  assert.match(guard, /^Restart=on-failure$/mu)
  assert.match(guard, /^RestartSec=30s$/mu)
})

test("restart-guard installer is restricted to exact test units and test-owned roots", () => {
  for (const unit of ["exercise-mailer-test.service", "sis-web-test.service", "sis-async-side-effects-test.service"]) {
    assert.ok(installer.includes(unit), `${unit} must be allowlisted`)
  }
  assert.match(installer, /\/home\/test\.eagles\.edu\.vn\//u)
  assert.match(installer, /\/home\/admin\.eagles\.edu\.vn\//u)
  assert.match(installer, /systemctl daemon-reload/u)
  assert.match(installer, /BACKUP_DIR/u)
  assert.doesNotMatch(installer, /exercise-mailer\.service(?!.+test)/u)
  assert.doesNotMatch(installer, /\/home\/admin\.eagles\.edu\.vn\/sis\/\.env/u)
})
