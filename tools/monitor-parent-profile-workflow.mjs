import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { renderKeepaliveCheckMetrics } from "../src/infra/observability/keepalive-check-metrics.mjs"
import { resolveKeepaliveMonitorEnvironment } from "./keepalive-monitor-environment.mjs"

const WORKFLOW_TEST = "test/parent-profile-invitation-approval.e2e.playwright.spec.mjs"
const METRICS_DIRECTORY = path.join(process.cwd(), "runtime-data/prometheus")
const TEST_TIMEOUT_MS = 120000

function parseCount(output, name) {
  const match = String(output || "").match(new RegExp(`^# ${name} (\\d+)$`, "mu"))
  return match ? Number(match[1]) : 0
}

export function assertMonitorEnvironment(environment = process.env) {
  return resolveKeepaliveMonitorEnvironment(environment)
}

export function parseTestReport(output) {
  const tests = parseCount(output, "tests")
  const passed = parseCount(output, "pass")
  const failed = parseCount(output, "fail")
  const skipped = parseCount(output, "skipped")
  const cancelled = parseCount(output, "cancelled")
  return {
    tests,
    passed,
    failed,
    skipped,
    cancelled,
    success: tests === 1 && passed === 1 && failed === 0 && skipped === 0 && cancelled === 0,
  }
}

function safeMetricNumber(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw new TypeError("Metric values must be finite non-negative numbers")
  return number.toFixed(6)
}

export function renderMonitorMetrics({ environment = "dev", success, checkedAt, durationSeconds, lastSuccessTimestamp }) {
  const result = success ? 1 : 0
  return [
    "# HELP sis_parent_profile_workflow_check_success Whether the latest synthetic parent profile workflow passed.",
    "# TYPE sis_parent_profile_workflow_check_success gauge",
    `sis_parent_profile_workflow_check_success{environment="${environment}"} ${result}`,
    "# HELP sis_parent_profile_workflow_check_duration_seconds Duration of the latest synthetic parent profile workflow check.",
    "# TYPE sis_parent_profile_workflow_check_duration_seconds gauge",
    `sis_parent_profile_workflow_check_duration_seconds{environment="${environment}"} ${safeMetricNumber(durationSeconds)}`,
    "# HELP sis_parent_profile_workflow_last_check_timestamp_seconds Unix timestamp of the latest synthetic parent profile workflow check.",
    "# TYPE sis_parent_profile_workflow_last_check_timestamp_seconds gauge",
    `sis_parent_profile_workflow_last_check_timestamp_seconds{environment="${environment}"} ${safeMetricNumber(checkedAt)}`,
    "# HELP sis_parent_profile_workflow_last_success_timestamp_seconds Unix timestamp of the latest successful synthetic parent profile workflow check.",
    "# TYPE sis_parent_profile_workflow_last_success_timestamp_seconds gauge",
    `sis_parent_profile_workflow_last_success_timestamp_seconds{environment="${environment}"} ${safeMetricNumber(lastSuccessTimestamp)}`,
    "",
  ].join("\n")
}

export function readLastSuccessTimestamp(metricsFile, environment = "dev") {
  if (!fs.existsSync(metricsFile)) return 0
  const contents = fs.readFileSync(metricsFile, "utf8")
  const match = contents.match(new RegExp(`^sis_parent_profile_workflow_last_success_timestamp_seconds\\{environment="${environment}"\\} ([0-9]+(?:\\.[0-9]+)?)$`, "mu"))
  return match ? Number(match[1]) : 0
}

export function writeMetricsAtomically(metricsFile, contents) {
  const directory = path.dirname(metricsFile)
  fs.mkdirSync(directory, { recursive: true, mode: 0o750 })
  const temporaryFile = `${metricsFile}.${process.pid}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporaryFile, contents, { encoding: "utf8", flag: "wx", mode: 0o644 })
    fs.renameSync(temporaryFile, metricsFile)
  } catch (error) {
    fs.rmSync(temporaryFile, { force: true })
    throw error
  }
}

export function runParentProfileWorkflowMonitor({ environment = process.env, metricsFile = "" } = {}) {
  const context = assertMonitorEnvironment(environment)
  metricsFile ||= path.join(METRICS_DIRECTORY, `parent-profile-workflow-${context.label}.prom`)
  const startedAt = performance.now()
  const result = spawnSync(process.execPath, ["--test", WORKFLOW_TEST], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...environment,
      NODE_ENV: context.label === "dev" ? "development" : "test",
      SIS_ENV_FILE: context.label === "dev" ? ".env.dev" : ".env.test",
      DOTENV_CONFIG_PATH: context.label === "dev" ? ".env.dev" : ".env.test",
      PARENT_PROFILE_E2E_ORIGIN: context.origin,
    },
    maxBuffer: 4 * 1024 * 1024,
    timeout: TEST_TIMEOUT_MS,
  })
  const durationSeconds = (performance.now() - startedAt) / 1000
  const checkedAt = Date.now() / 1000
  const report = parseTestReport(`${result.stdout || ""}\n${result.stderr || ""}`)
  const success = !result.error && result.status === 0 && report.success
  const previousSuccess = readLastSuccessTimestamp(metricsFile, context.label)
  const lastSuccessTimestamp = success ? checkedAt : previousSuccess
  const previousMetrics = fs.existsSync(metricsFile) ? fs.readFileSync(metricsFile, "utf8") : ""
  const metrics = renderMonitorMetrics({ environment: context.label, success, checkedAt, durationSeconds, lastSuccessTimestamp }) + renderKeepaliveCheckMetrics({
    environment: context.label,
    checkedAt,
    previousMetrics,
    results: {
      parent_profile: {
        success,
        durationSeconds,
        failureCode: "workflow_failed",
      },
    },
  })
  writeMetricsAtomically(metricsFile, metrics)
  process.stdout.write(`parent_profile_workflow_monitor environment=${context.label} result=${success ? "pass" : "fail"} duration_seconds=${durationSeconds.toFixed(3)}\n`)
  return success
}

function main() {
  try {
    process.exitCode = runParentProfileWorkflowMonitor() ? 0 : 1
  } catch {
    process.stderr.write("parent_profile_workflow_monitor result=fail reason=configuration_or_metrics_error\n")
    process.exitCode = 1
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main()
