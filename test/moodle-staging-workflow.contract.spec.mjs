import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const repoRoot = process.cwd()
const script = fs.readFileSync(path.join(repoRoot, "tools/moodle-staging-workflow.sh"), "utf8")
const workflowDoc = fs.readFileSync(path.join(repoRoot, "docs/moodle-staging.md"), "utf8")
const deployStart = script.indexOf("deploy_stage() {")
const deployEnd = script.indexOf("\npromote_preflight() {", deployStart)
const deployFunction = script.slice(deployStart, deployEnd)

test("stage deployment is pinned to the current staged.git main commit", () => {
  assert.match(script, /STAGED_REPO=https:\/\/github\.com\/eagles-edu\/staged\.git/)
  assert.match(script, /deploy-stage MAIN_COMMIT --dry-run/)
  assert.match(script, /deploy-stage MAIN_COMMIT --apply/)
  assert.match(deployFunction, /\[\[ "\$commit" =~ \^\[A-Fa-f0-9\]\{40\}\$ \]\]/)
  assert.match(deployFunction, /commit must equal the current eagles-edu\/staged main head/)
  assert.match(deployFunction, /codeload\.github\.com\/eagles-edu\/staged\/tar\.gz\/\$commit/)
  assert.match(deployFunction, /gzip -t "\$archive"/)
  assert.match(deployFunction, /staged release archive contains an unsafe path/)
  assert.match(deployFunction, /staged release archive contains an unsafe symbolic link/)
})

test("stage deployment snapshots before upgrade and preserves stage-owned configuration and files", () => {
  const snapshotIndex = deployFunction.indexOf('snapshot_current_stage "$snapshot" "$stage_db" "$stage_cnf"')
  const syncIndex = deployFunction.indexOf('rsync -a --numeric-ids --chown=stage8567:stage8567www --exclude=/config.php')
  const upgradeIndex = deployFunction.indexOf('"$PHP" "$STAGE_APP/admin/cli/upgrade.php"')

  assert.ok(snapshotIndex >= 0, "deployment must take a complete staging snapshot")
  assert.ok(syncIndex > snapshotIndex, "deployment must snapshot before copying code")
  assert.ok(upgradeIndex > syncIndex, "deployment must upgrade after copying code")
  assert.doesNotMatch(deployFunction, /rsync[^\\n]*--delete/)
  assert.match(deployFunction, /--exclude=\/config\.php/)
  assert.match(deployFunction, /staging-only files and config\.php preserved/)
  assert.doesNotMatch(deployFunction, /SOURCE_APP|production|moodle\.eagles\.edu\.vn/)
})

test("identical staged source records its SHA without creating an unnecessary snapshot or touching Moodle data", () => {
  const identicalSource = deployFunction.indexOf('if [[ "$changed_files" == 0 ]]; then')
  const snapshotIndex = deployFunction.indexOf('snapshot_current_stage "$snapshot" "$stage_db" "$stage_cnf"')
  const markerIndex = deployFunction.indexOf('backup=none-no-runtime-change')

  assert.ok(identicalSource >= 0)
  assert.ok(markerIndex > identicalSource && markerIndex < snapshotIndex)
  assert.match(deployFunction, /staging safety settings are not enabled; no release marker was written/)
  assert.match(deployFunction, /SHA recorded without copying files, snapshotting, or running Moodle upgrade/)
})

test("stage deployment re-enforces safety and records the deployed source SHA", () => {
  assert.match(deployFunction, /sanitize_staging/)
  assert.match(deployFunction, /"\$dryrun" == 1/)
  assert.match(deployFunction, /Task disabled/)
  assert.match(deployFunction, /STAGE_HOME\/\.moodle-release/)
  assert.match(script, /recorded_staged_commit=%s/)
  assert.match(script, /deploy-stage\)\s+\[\[ \$# -eq 3 \]\]/)
  assert.match(workflowDoc, /deploy-stage FULL_MAIN_SHA --dry-run/)
  assert.match(workflowDoc, /deploy-stage FULL_MAIN_SHA --apply/)
})
