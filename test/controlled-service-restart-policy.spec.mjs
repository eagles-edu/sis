import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

const guard = fs.readFileSync(new URL("../ops/systemd/keepalive-test-restart-guard.conf", import.meta.url), "utf8")
const staticServer = fs.readFileSync(new URL("../ops/systemd/keepalive-test-static-server.conf", import.meta.url), "utf8")
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

test("restart-guard installer backs up and removes the legacy automatic test boot-prep", () => {
  const backupCommand = 'install -D -m 0600 "${LEGACY_BOOT_PREP_DROPIN}" "${LEGACY_BOOT_PREP_BACKUP}"'
  const removeCommand = 'rm -- "${LEGACY_BOOT_PREP_DROPIN}"'
  assert.match(installer, /LEGACY_BOOT_PREP_DROPIN="\/etc\/systemd\/system\/exercise-mailer-test\.service\.d\/10-boot-prep\.conf"/u)
  assert.match(installer, /tools\/sync-and-restart-test-runtime\.sh boot-prep/u)
  assert.ok(installer.indexOf(backupCommand) >= 0, "the exact legacy drop-in must be backed up")
  assert.ok(installer.indexOf(removeCommand) > installer.indexOf(backupCommand), "the drop-in must be removed only after backup")
  assert.match(installer, /--property=ExecStartPre --property=ExecStart/u)
  assert.match(installer, /automatic start path contains deployment or database work/u)
  assert.match(installer, /automatic starts contain no sync, package-manager, or migration step/u)
  assert.match(installer, /keepalive-test-static-server\.conf/u)
  assert.ok(installer.includes("(npx|npm)([[:space:]]|;|$)"), "automatic start validation must reject package runners")
})

test("test static server starts its installed binary directly without npx", () => {
  assert.match(staticServer, /^ExecStart=$/mu)
  assert.match(staticServer, /^ExecStart=\/home\/test\.eagles\.edu\.vn\/sis\/node_modules\/\.bin\/serve -s \/home\/test\.eagles\.edu\.vn\/public_html -l 8086 --no-clipboard$/mu)
  assert.doesNotMatch(staticServer, /(?:^|\s)(?:npx|npm)(?:\s|$)/imu)
})
