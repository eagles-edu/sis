import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const scriptPath = path.resolve(process.cwd(), "tools/restart-dev-runtime.sh")
const script = fs.readFileSync(scriptPath, "utf8")

test("restart-dev-runtime rebuilds assets, refreshes Prisma, and relaunches dev workers", () => {
  assert.match(script, /build_admin_assets\(\)/)
  assert.match(script, /npm run build:admin-assets/)
  assert.match(script, /refresh_runtime_prisma_client\(\)/)
  assert.match(script, /SIS_ENV_FILE=.env\.dev DOTENV_CONFIG_PATH=.env\.dev NODE_ENV=development npm run db:generate/)
  assert.match(script, /SIS_ENV_FILE=.env\.dev DOTENV_CONFIG_PATH=.env\.dev NODE_ENV=development npm run db:migrate:deploy/)
  assert.match(script, /main\(\) \{\s+build_admin_assets\s+stop_worker\s+stop_runtime\s+refresh_runtime_prisma_client\s+start_runtime\s+start_worker/s)
})
