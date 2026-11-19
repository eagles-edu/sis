import assert from "node:assert/strict"
import test from "node:test"
import {
  renderWorkerHeartbeat,
  resolveWorkerMonitoringEnvironment,
} from "../tools/async-side-effects-worker.mjs"

test("async side-effects worker accepts only matching dev and test environment ownership", () => {
  assert.equal(resolveWorkerMonitoringEnvironment({
    NODE_ENV: "development",
    SIS_ENV_FILE: ".env.dev",
    DOTENV_CONFIG_PATH: ".env.dev",
  }), "dev")
  assert.equal(resolveWorkerMonitoringEnvironment({
    NODE_ENV: "test",
    SIS_ENV_FILE: ".env.test",
    DOTENV_CONFIG_PATH: ".env.test",
  }), "test")
  assert.equal(resolveWorkerMonitoringEnvironment({
    NODE_ENV: "test",
    SIS_ENV_FILE: ".env.test",
    DOTENV_CONFIG_PATH: ".env.dev",
  }), "")
})

test("test worker heartbeat has isolated test labels and no request or account data", () => {
  const devMetrics = renderWorkerHeartbeat({
    environmentLabel: "dev",
    success: true,
    checkedAt: 123.5,
    lastSuccessfulPollTimestamp: 120,
  })
  const metrics = renderWorkerHeartbeat({
    environmentLabel: "test",
    success: true,
    checkedAt: 123.5,
    lastSuccessfulPollTimestamp: 120,
  })
  assert.match(metrics, /sis_async_side_effects_worker_last_poll_timestamp_seconds\{environment="test"\} 123\.500000/u)
  assert.match(metrics, /sis_async_side_effects_worker_last_poll_success\{environment="test"\} 1/u)
  assert.match(metrics, /sis_async_side_effects_worker_last_success_timestamp_seconds\{environment="test"\} 120\.000000/u)
  assert.deepEqual(
    metrics.split("\n").filter((line) => line.startsWith("# HELP ")),
    devMetrics.split("\n").filter((line) => line.startsWith("# HELP ")),
  )
  assert.doesNotMatch(metrics, /environment="dev"|student|recipient|password|cookie|session|job_id|[\w.+-]+@[\w.-]+/iu)
  assert.throws(() => renderWorkerHeartbeat({ environmentLabel: "production", success: true }), /explicit dev or test/u)
})
