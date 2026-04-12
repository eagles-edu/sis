import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const scriptPath = path.resolve(process.cwd(), "tools/restore-test-db-from-live-dump.sh")
const script = fs.readFileSync(scriptPath, "utf8")

test("restore-test-db helper keeps explicit safety gates", () => {
  assert.match(script, /--verify-only/)
  assert.match(script, /Refusing restore without --yes/)
  assert.match(script, /--clean/)
  assert.match(script, /--single-transaction/)
})

test("restore-test-db helper targets test runtime contracts", () => {
  assert.match(script, /TEST_ROOT="\$\{SIS_TEST_ROOT:-\/home\/test\.eagles\.edu\.vn\/sis\}"/)
  assert.match(script, /HEALTH_URL="\$\{SIS_TEST_HEALTH_URL:-http:\/\/127\.0\.0\.1:8786\/healthz\}"/)
  assert.match(script, /expected canonical test db: sis-test/)
  assert.match(
    script,
    /env SIS_ENV_FILE=.env\.test DOTENV_CONFIG_PATH=.env\.test NODE_ENV=test npm run db:generate/
  )
  assert.match(
    script,
    /env SIS_ENV_FILE=.env\.test DOTENV_CONFIG_PATH=.env\.test NODE_ENV=test npm run db:migrate:deploy/
  )
})
