import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const root = process.cwd()
const service = fs.readFileSync(path.join(root, "ops/systemd/user/sis-db-health-dev.service"), "utf8")
const timer = fs.readFileSync(path.join(root, "ops/systemd/user/sis-db-health-dev.timer"), "utf8")
const installer = fs.readFileSync(path.join(root, "tools/install-dev-db-health-timer.sh"), "utf8")

test("dev database health service is isolated to development and verifies sis_dev", () => {
  assert.match(service, /^WorkingDirectory=\/home\/eagles\/dockerz\/sis$/mu)
  assert.match(service, /^Environment=NODE_ENV=development$/mu)
  assert.match(service, /^Environment=SIS_ENV_FILE=\.env\.dev$/mu)
  assert.match(service, /^Environment=DOTENV_CONFIG_PATH=\.env\.dev$/mu)
  assert.match(service, /--import dotenv\/config .*--expected-database sis_dev/u)
  assert.ok(service.includes("--backup-latest /home/eagles/dockerz/backups/postgres-dev/latest.json"))
  assert.match(service, /db-health-dev\.prom --metrics-environment dev/u)
  assert.match(service, /^Type=oneshot$/mu)
  assert.doesNotMatch(service, /\/home\/(?:admin|test)\.eagles\.edu\.vn|prisma|migration|sync-and-restart/u)
})

test("dev database health timer runs every fifteen minutes and installer only touches user units", () => {
  assert.match(timer, /^OnBootSec=2min$/mu)
  assert.match(timer, /^OnUnitActiveSec=15min$/mu)
  assert.match(timer, /^Unit=sis-db-health-dev\.service$/mu)
  assert.match(installer, /systemctl --user daemon-reload/u)
  assert.match(installer, /systemctl --user enable --now/u)
  assert.doesNotMatch(installer, /sudo|systemctl restart exercise-mailer|systemctl enable sis-db-health/u)
})
