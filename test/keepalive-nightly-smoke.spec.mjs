import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  assertTestEnvironment,
  renderNightlySmokeMetrics,
  writeMetricsAtomically,
} from "../tools/run-keepalive-nightly-smoke.mjs"

const TEST_ENVIRONMENT = {
  NODE_ENV: "test",
  SIS_ENV_FILE: ".env.test",
  DOTENV_CONFIG_PATH: ".env.test",
}

test("nightly smoke requires the exact test environment tuple", () => {
  assert.doesNotThrow(() => assertTestEnvironment(TEST_ENVIRONMENT))
  assert.throws(() => assertTestEnvironment({ ...TEST_ENVIRONMENT, SIS_ENV_FILE: ".env.dev" }), /explicit test environment/u)
  assert.throws(() => assertTestEnvironment({ ...TEST_ENVIRONMENT, DOTENV_CONFIG_PATH: ".env" }), /explicit test environment/u)
  assert.throws(() => assertTestEnvironment({ ...TEST_ENVIRONMENT, NODE_ENV: "production" }), /explicit test environment/u)
})

test("nightly smoke exports bounded status and retains the last successful time after failure", () => {
  const contents = renderNightlySmokeMetrics({
    checkedAt: 200,
    durationSeconds: 3.5,
    success: false,
    lastSuccessTimestamp: 100,
    failureCode: "suite_failed",
  })
  assert.match(contents, /sis_keepalive_nightly_smoke_success\{environment="test"\} 0/u)
  assert.match(contents, /sis_keepalive_nightly_smoke_last_check_timestamp_seconds\{environment="test"\} 200\.000000/u)
  assert.match(contents, /sis_keepalive_nightly_smoke_last_success_timestamp_seconds\{environment="test"\} 100\.000000/u)
  assert.match(contents, /sis_keepalive_nightly_smoke_failure_info\{environment="test",code="suite_failed"\} 1/u)
  assert.doesNotMatch(contents, /^sis_keepalive_nightly_smoke_failed_file_info\{/mu)
  assert.throws(() => renderNightlySmokeMetrics({ checkedAt: 1, durationSeconds: 0, success: false, lastSuccessTimestamp: 0, failureCode: "raw student error" }), /bounded vocabulary/u)
  assert.throws(() => renderNightlySmokeMetrics({ checkedAt: 1, durationSeconds: 0, success: false, lastSuccessTimestamp: 0, failureCode: "suite_failed", failedFile: "student-private-marker" }), /test spec basename/u)
  assert.match(renderNightlySmokeMetrics({ checkedAt: 1, durationSeconds: 0, success: false, lastSuccessTimestamp: 0, failureCode: "suite_failed", failedFile: "student-admin.spec.mjs" }), /sis_keepalive_nightly_smoke_failed_file_info\{environment="test",file="student-admin\.spec\.mjs"\} 1/u)
})

test("nightly smoke metrics replace their prior snapshot atomically", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sis-keepalive-nightly-"))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const file = path.join(directory, "nightly.prom")
  writeMetricsAtomically(file, "first\n")
  writeMetricsAtomically(file, "second\n")
  assert.equal(fs.readFileSync(file, "utf8"), "second\n")
  assert.deepEqual(fs.readdirSync(directory), ["nightly.prom"])
})
