import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const scriptPath = path.resolve(process.cwd(), "tools/sync-and-restart-runtimes.sh")
const wrapperPath = path.resolve(process.cwd(), "tools/sync-and-restart-live-runtime.sh")

const script = fs.readFileSync(scriptPath, "utf8")
const wrapper = fs.readFileSync(wrapperPath, "utf8")

test("sync-and-restart-runtimes keeps the live runtime root and port pinned", () => {
  assert.match(script, /LIVE_ROOT="\$\{SIS_LIVE_ROOT:-\/home\/admin\.eagles\.edu\.vn\/sis\}"/)
  assert.match(script, /LIVE_PORT="\$\{SIS_LIVE_PORT:-8787\}"/)
  assert.match(script, /build_admin_assets\(\)/)
  assert.match(script, /npm run build:admin-assets/)
  assert.match(script, /run_ffs\(\)/)
  assert.match(script, /run_ffs "ffs-sis-root" ffs-sis-root --batch/)
  assert.match(script, /run_ffs "ffs-sis-public-root" ffs-sis-public-root --batch/)
  assert.match(script, /if \[\[ "\$status" == "3" \]\]; then/)
  assert.match(script, /refresh_dev_prisma_client\(\)/)
  assert.match(script, /npm run db:migrate:deploy/)
  assert.match(script, /main\(\) \{\s+build_admin_assets\s+run_sync/s)
})

test("sync-and-restart-live-runtime keeps Prisma deploy in the live wrapper contract", () => {
  assert.match(wrapper, /refresh_runtime_prisma_client\(\)/)
  assert.match(wrapper, /refreshing Prisma client and applying migrations in \$\{LIVE_ROOT\}/)
  assert.match(wrapper, /env SIS_ENV_FILE=\.env DOTENV_CONFIG_PATH=\.env NODE_ENV=production npm run db:generate/)
  assert.match(wrapper, /env SIS_ENV_FILE=\.env DOTENV_CONFIG_PATH=\.env NODE_ENV=production npm run db:migrate:deploy/)
  assert.match(wrapper, /npm run db:migrate:deploy/)
})
