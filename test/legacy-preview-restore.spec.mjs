import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

const restoreScript = fs.readFileSync("tools/restore-test-db-from-live-dump.sh", "utf8")
const liveLinksDoc = fs.readFileSync("docs/Live portal links.md", "utf8")

test("legacy preview restore is staged around the guarded uniqueness migration", () => {
  assert.match(restoreScript, /--legacy-pre-cutover/)
  assert.match(restoreScript, /--legacy-post-cutover/)
  assert.match(restoreScript, /MIGRATION_PHASE="pre-cutover"/)
  assert.match(restoreScript, /MIGRATION_PHASE="post-cutover"/)
  assert.match(restoreScript, /apply_stage1_migration\(\)/)
  assert.match(restoreScript, /migrate resolve --applied/)
  assert.match(restoreScript, /Stage-2 uniqueness migration is already applied/)
  assert.match(restoreScript, /Refusing legacy migration phase against non-test database/)
  assert.match(restoreScript, /SIS_LEGACY_PRE_CUTOVER/)
  assert.match(restoreScript, /setting one-shot test boot flag/)
  assert.match(restoreScript, /if \[\[ "\$MIGRATION_PHASE" != "post-cutover" \]\]/)
  assert.match(restoreScript, /if \[\[ "\$MIGRATION_PHASE" == "pre-cutover" \]\]/)
})

test("legacy preview restore instructions require a unique run key and stage-2 pause", () => {
  assert.match(liveLinksDoc, /--legacy-pre-cutover/)
  assert.match(liveLinksDoc, /--legacy-post-cutover/)
  assert.match(liveLinksDoc, /live-data-preview-YYYYMMDD/)
  assert.match(liveLinksDoc, /guarded canonical uniqueness migration/)
})
