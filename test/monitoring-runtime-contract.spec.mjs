import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

const installer = fs.readFileSync(new URL("../tools/install-sis-config-cron.sh", import.meta.url), "utf8")
const syncer = fs.readFileSync(new URL("../tools/sync-and-restart-test-runtime.sh", import.meta.url), "utf8")

test("config-repair cron rejects Node releases older than 22", () => {
  assert.match(installer, /NODE_MAJOR < 22/)
})

test("test sync preserves executable cron-runner permissions", () => {
  assert.match(syncer, /\[\[ -x "\$source_path" \]\]/)
  assert.match(syncer, /install -D -m "\$install_mode"/)
  assert.match(syncer, /tools\/run-sis-config-repair-cron\.sh/)
})
