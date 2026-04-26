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
  assert.match(script, /main\(\) \{\s+build_admin_assets\s+run_sync/s)
})

test("sync-and-restart-live-runtime delegates to the live sync wrapper", () => {
  assert.match(wrapper, /exec "\$\{SCRIPT_DIR\}\/sync-and-restart-runtimes\.sh" "\$MODE"/)
})
