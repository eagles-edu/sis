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

test("sync-and-restart-test-runtime skips Prisma refresh in public mode only", () => {
  assert.match(script, /should_refresh_prisma\(\) \{\s+\[\[ "\$MODE" == "full" \|\| "\$MODE" == "restart-only" \]\]/)
  assert.match(script, /if should_refresh_prisma; then\s+refresh_test_prisma\s+else\s+log "skip Prisma refresh for mode=\$\{MODE\}"/)
  assert.match(script, /public\)\s+log "running ffs-sis-public-root-test --batch"/)
})
