import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const unitPath = path.resolve(process.cwd(), "ops/systemd/user/sis-dev-api.service")
const installerPath = path.resolve(process.cwd(), "tools/install-dev-api-restart-guard.sh")
const unit = fs.readFileSync(unitPath, "utf8")
const installer = fs.readFileSync(installerPath, "utf8")

test("dev API unit is bound to the development runtime with bounded restarts", () => {
  assert.match(unit, /^WorkingDirectory=\/home\/eagles\/dockerz\/sis$/m)
  assert.match(unit, /^Environment=NODE_ENV=development$/m)
  assert.match(unit, /^Environment=SIS_ENV_FILE=\.env\.dev$/m)
  assert.match(unit, /^Environment=DOTENV_CONFIG_PATH=\.env\.dev$/m)
  assert.match(unit, /^ExecStart=\/home\/eagles\/\.nvm\/versions\/node\/v22\.22\.1\/bin\/node server\/exercise-mailer\.mjs$/m)
  assert.match(unit, /^Restart=on-failure$/m)
  assert.match(unit, /^RestartSec=30s$/m)
  assert.match(unit, /^StartLimitBurst=4$/m)
  assert.match(unit, /^StartLimitIntervalSec=15min$/m)
  assert.match(unit, /^StartLimitAction=none$/m)
  assert.doesNotMatch(unit, /\/home\/admin\.eagles\.edu\.vn|EnvironmentFile=.*\.env(?:\s|$)|\bnpm\b|\bnpx\b|\bprisma\b|db:migrate|sync-and-restart/)
})

test("dev installer validates environment ownership and leaves the active process alone", () => {
  assert.match(installer, /\[\[ \"\$\{EUID\}\" -ne 0 \]\]/)
  assert.match(installer, /\[\[ \"\$\{HOME\}\" == \"\/home\/eagles\" \]\]/)
  assert.match(installer, /grep -Fq 'Environment=SIS_ENV_FILE=\.env\.dev'/)
  assert.match(installer, /grep -Fq 'Environment=DOTENV_CONFIG_PATH=\.env\.dev'/)
  assert.match(installer, /systemctl --user enable/)
  assert.doesNotMatch(installer, /systemctl --user (?:start|restart) \"\$\{?UNIT_NAME/)
  assert.match(installer, /active API was not restarted/)
  assert.match(installer, /\/home\/admin\\\.eagles\\\.edu\\\.vn/)
})
