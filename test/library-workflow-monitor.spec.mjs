import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  assertDevEnvironment,
  readLastSuccessTimestamp,
  renderLibraryMetrics,
  writeMetricsAtomically,
} from "../tools/monitor-library-workflow.mjs"

function devEnvironment() {
  return { NODE_ENV: "development", SIS_ENV_FILE: ".env.dev", DOTENV_CONFIG_PATH: ".env.dev" }
}

function monitorMetrics(overrides = {}) {
  return renderLibraryMetrics({
    checkedAt: 200,
    durationSeconds: 2.5,
    success: true,
    lastSuccessTimestamp: 200,
    apiAvailable: true,
    databaseAvailable: true,
    redisAvailable: true,
    cmuDictionaryAvailable: true,
    collegiateKeyConfigured: true,
    learnersKeyConfigured: true,
    studentAccessAvailable: true,
    adminAccessAvailable: true,
    saveCheckSuccess: true,
    reviewCheckSuccess: true,
    cleanupSuccess: true,
    openReviewCount: 4,
    oldestOpenReviewAgeSeconds: 3600,
    ...overrides,
  })
}

test("Library workflow monitor requires the explicit dev-owned environment", () => {
  assert.doesNotThrow(() => assertDevEnvironment(devEnvironment()))
  assert.throws(() => assertDevEnvironment({ NODE_ENV: "test", SIS_ENV_FILE: ".env.test", DOTENV_CONFIG_PATH: ".env.test" }), /explicit development environment/u)
  assert.throws(() => assertDevEnvironment({ NODE_ENV: "development", SIS_ENV_FILE: ".env", DOTENV_CONFIG_PATH: ".env" }), /explicit development environment/u)
  assert.throws(() => assertDevEnvironment({ NODE_ENV: "development", SIS_ENV_FILE: ".env.dev", DOTENV_CONFIG_PATH: ".env.test" }), /explicit development environment/u)
})

test("Library metrics expose access, save, review, queue-age, and dependency results without identity labels", () => {
  const metrics = monitorMetrics({
    studentAccessAvailable: false,
    saveCheckSuccess: false,
    reviewCheckSuccess: false,
    redisAvailable: false,
    openReviewCount: 2,
    oldestOpenReviewAgeSeconds: 7200,
  })
  assert.match(metrics, /sis_library_student_access_available\{environment="dev"\} 0\.000000/u)
  assert.match(metrics, /sis_library_save_check_success\{environment="dev"\} 0\.000000/u)
  assert.match(metrics, /sis_library_review_check_success\{environment="dev"\} 0\.000000/u)
  assert.match(metrics, /sis_library_oldest_open_review_age_seconds\{environment="dev"\} 7200\.000000/u)
  assert.match(metrics, /sis_library_redis_available\{environment="dev"\} 0\.000000/u)
  assert.doesNotMatch(metrics, /environment="(?:test|production)"|cookie|password|@[a-z0-9.-]+/iu)
  assert.equal(metrics.split("\n").filter((line) => line.startsWith("sis_library_") && !line.includes('{environment="dev"}')).length, 0)
  assert.throws(() => monitorMetrics({ openReviewCount: -1 }), /finite non-negative/u)
})

test("Library monitor metrics write atomically and carry forward the previous success timestamp", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sis-library-monitor-"))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const metricsFile = path.join(directory, "library-workflow.prom")
  writeMetricsAtomically(metricsFile, monitorMetrics())
  assert.equal(readLastSuccessTimestamp(metricsFile), 200)
  writeMetricsAtomically(metricsFile, monitorMetrics({ success: false, lastSuccessTimestamp: readLastSuccessTimestamp(metricsFile), checkedAt: 300 }))
  const saved = fs.readFileSync(metricsFile, "utf8")
  assert.match(saved, /sis_library_workflow_check_success\{environment="dev"\} 0\.000000/u)
  assert.match(saved, /sis_library_workflow_last_success_timestamp_seconds\{environment="dev"\} 200\.000000/u)
  assert.deepEqual(fs.readdirSync(directory), ["library-workflow.prom"])
})
