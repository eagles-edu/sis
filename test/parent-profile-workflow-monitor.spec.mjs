import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  assertMonitorEnvironment,
  parseTestReport,
  readLastSuccessTimestamp,
  renderMonitorMetrics,
  writeMetricsAtomically,
} from "../tools/monitor-parent-profile-workflow.mjs"

test("parent workflow monitor accepts only exact owned dev and test tuples", () => {
  assert.equal(assertMonitorEnvironment({
    NODE_ENV: "development",
    SIS_ENV_FILE: ".env.dev",
    DOTENV_CONFIG_PATH: ".env.dev",
  }).label, "dev")
  assert.equal(assertMonitorEnvironment({ NODE_ENV: "test", SIS_ENV_FILE: ".env.test", DOTENV_CONFIG_PATH: ".env.test" }).label, "test")
  assert.throws(() => assertMonitorEnvironment({ NODE_ENV: "development", SIS_ENV_FILE: ".env", DOTENV_CONFIG_PATH: ".env" }), /matching explicit dev or test/u)
})

test("parent workflow monitor accepts only one completed, unskipped end-to-end test", () => {
  const passing = ["# tests 1", "# pass 1", "# fail 0", "# cancelled 0", "# skipped 0"].join("\n")
  const skipped = ["# tests 1", "# pass 0", "# fail 0", "# cancelled 0", "# skipped 1"].join("\n")
  const failed = ["# tests 1", "# pass 0", "# fail 1", "# cancelled 0", "# skipped 0"].join("\n")
  assert.equal(parseTestReport(passing).success, true)
  assert.equal(parseTestReport(skipped).success, false)
  assert.equal(parseTestReport(failed).success, false)
  assert.equal(parseTestReport("").success, false)
})

test("parent workflow monitor writes low-cardinality metrics atomically and preserves last success", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sis-parent-monitor-"))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const metricsFile = path.join(directory, "parent-profile.prom")
  const first = renderMonitorMetrics({ environment: "dev", success: true, checkedAt: 100, durationSeconds: 12.5, lastSuccessTimestamp: 100 })
  writeMetricsAtomically(metricsFile, first)
  assert.equal(readLastSuccessTimestamp(metricsFile), 100)
  const failedRun = renderMonitorMetrics({ environment: "dev", success: false, checkedAt: 140, durationSeconds: 9, lastSuccessTimestamp: readLastSuccessTimestamp(metricsFile, "dev") })
  writeMetricsAtomically(metricsFile, failedRun)
  const saved = fs.readFileSync(metricsFile, "utf8")
  assert.match(saved, /sis_parent_profile_workflow_check_success\{environment="dev"\} 0/u)
  assert.match(saved, /sis_parent_profile_workflow_last_check_timestamp_seconds\{environment="dev"\} 140\.000000/u)
  assert.match(saved, /sis_parent_profile_workflow_last_success_timestamp_seconds\{environment="dev"\} 100\.000000/u)
  assert.doesNotMatch(saved, /student|parentId|email|cookie|password/iu)
  assert.deepEqual(fs.readdirSync(directory), ["parent-profile.prom"])
})

test("test parent profile metrics use test labels and independent last-success lookup", () => {
  const metrics = renderMonitorMetrics({ environment: "test", success: true, checkedAt: 200, durationSeconds: 9, lastSuccessTimestamp: 200 })
  assert.match(metrics, /sis_parent_profile_workflow_check_success\{environment="test"\} 1/u)
  assert.doesNotMatch(metrics, /environment="dev"/u)
})
