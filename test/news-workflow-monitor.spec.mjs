import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  assertNewsMonitorDevEnvironment,
  renderNewsWorkflowMetrics,
  writeNewsMetricsAtomically,
} from "../tools/monitor-news-workflow.mjs"

const devEnvironment = {
  NODE_ENV: "development",
  SIS_ENV_FILE: ".env.dev",
  DOTENV_CONFIG_PATH: ".env.dev",
}

function metrics(overrides = {}) {
  return renderNewsWorkflowMetrics({
    checkedAt: 200,
    durationSeconds: 15,
    checkDurationSeconds: 6.5,
    checkSuccess: true,
    languageToolAvailable: true,
    dictionaryAvailable: true,
    submissionSuccess: true,
    submissionHttpStatus: 200,
    cleanupSuccess: true,
    apiAvailable: true,
    databaseAvailable: true,
    openReviewCount: 3,
    oldestOpenReviewAgeSeconds: 7200,
    lastSuccessTimestamp: 200,
    ...overrides,
  })
}

test("News workflow monitor requires the explicit dev-owned environment", () => {
  assert.doesNotThrow(() => assertNewsMonitorDevEnvironment(devEnvironment))
  assert.throws(() => assertNewsMonitorDevEnvironment({ NODE_ENV: "test", SIS_ENV_FILE: ".env.test", DOTENV_CONFIG_PATH: ".env.test" }), /explicit development environment/u)
  assert.throws(() => assertNewsMonitorDevEnvironment({ NODE_ENV: "development", SIS_ENV_FILE: ".env", DOTENV_CONFIG_PATH: ".env" }), /explicit development environment/u)
  assert.throws(() => assertNewsMonitorDevEnvironment({ ...devEnvironment, DOTENV_CONFIG_PATH: ".env.test" }), /explicit development environment/u)
})

test("News metrics capture Check latency, provider availability, submission failure, and review age without sensitive labels", () => {
  const output = metrics({
    checkSuccess: false,
    languageToolAvailable: false,
    dictionaryAvailable: false,
    submissionSuccess: false,
    cleanupSuccess: false,
    openReviewCount: 1,
    oldestOpenReviewAgeSeconds: 86401,
  })
  assert.match(output, /sis_news_check_duration_seconds\{environment="dev"\} 6\.500000/u)
  assert.match(output, /sis_news_language_tool_available\{environment="dev"\} 0\.000000/u)
  assert.match(output, /sis_news_dictionary_available\{environment="dev"\} 0\.000000/u)
  assert.match(output, /sis_news_submission_failure\{environment="dev"\} 1\.000000/u)
  assert.match(output, /sis_news_submission_http_status\{environment="dev"\} 200\.000000/u)
  assert.match(output, /sis_news_oldest_open_review_age_seconds\{environment="dev"\} 86401\.000000/u)
  assert.doesNotMatch(output, /mark001|studentRefId|reportId|cookie|password|@[a-z0-9.-]+/iu)
  assert.equal(output.split("\n").filter((line) => line.startsWith("sis_news_") && !line.includes('{environment="dev"}')).length, 0)
  assert.throws(() => metrics({ openReviewCount: -1 }), /finite non-negative/u)
})

test("News metric values are atomically generated without leaving a temporary file", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sis-news-monitor-"))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const metricsFile = path.join(directory, "news-workflow.prom")
  writeNewsMetricsAtomically(metricsFile, metrics())
  const saved = fs.readFileSync(metricsFile, "utf8")
  assert.match(saved, /sis_news_workflow_check_success\{environment="dev"\} 1\.000000/u)
  assert.deepEqual(fs.readdirSync(directory), ["news-workflow.prom"])
})
