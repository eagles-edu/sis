import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const WORKFLOW_TEST = "test/parent-profile-invitation-approval.e2e.playwright.spec.mjs"
const METRICS_FILE = path.join(process.cwd(), "runtime-data/prometheus/parent-profile-workflow.prom")
const DEV_ORIGIN = "http://127.0.0.1:8788"
const TEST_TIMEOUT_MS = 120000

function parseCount(output, name) {
  const match = String(output || "").match(new RegExp(`^# ${name} (\\d+)$`, "mu"))
  return match ? Number(match[1]) : 0
}

export function assertDevEnvironment(environment) {
  if (
    String(environment?.NODE_ENV || "").trim() !== "development" ||
    String(environment?.SIS_ENV_FILE || "").trim() !== ".env.dev" ||
    String(environment?.DOTENV_CONFIG_PATH || "").trim() !== ".env.dev"
  ) {
    throw new Error("Parent profile workflow monitor requires the explicit development environment")
  }
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

export function renderMonitorMetrics({ success, checkedAt, durationSeconds, lastSuccessTimestamp }) {
  const result = success ? 1 : 0
  return [
    "# HELP sis_parent_profile_workflow_check_success Whether the latest synthetic parent profile workflow passed.",
    "# TYPE sis_parent_profile_workflow_check_success gauge",
    `sis_parent_profile_workflow_check_success{environment="dev"} ${result}`,
    "# HELP sis_parent_profile_workflow_check_duration_seconds Duration of the latest synthetic parent profile workflow check.",
    "# TYPE sis_parent_profile_workflow_check_duration_seconds gauge",
    `sis_parent_profile_workflow_check_duration_seconds{environment="dev"} ${safeMetricNumber(durationSeconds)}`,
    "# HELP sis_parent_profile_workflow_last_check_timestamp_seconds Unix timestamp of the latest synthetic parent profile workflow check.",
    "# TYPE sis_parent_profile_workflow_last_check_timestamp_seconds gauge",
    `sis_parent_profile_workflow_last_check_timestamp_seconds{environment="dev"} ${safeMetricNumber(checkedAt)}`,
    "# HELP sis_parent_profile_workflow_last_success_timestamp_seconds Unix timestamp of the latest successful synthetic parent profile workflow check.",
    "# TYPE sis_parent_profile_workflow_last_success_timestamp_seconds gauge",
    `sis_parent_profile_workflow_last_success_timestamp_seconds{environment="dev"} ${safeMetricNumber(lastSuccessTimestamp)}`,
    "",
  ].join("\n")
}

export function readLastSuccessTimestamp(metricsFile) {
  if (!fs.existsSync(metricsFile)) return 0
  const contents = fs.readFileSync(metricsFile, "utf8")
  const match = contents.match(/^sis_parent_profile_workflow_last_success_timestamp_seconds\{environment="dev"\} ([0-9]+(?:\.[0-9]+)?)$/mu)
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

export function runParentProfileWorkflowMonitor({ environment = process.env, metricsFile = METRICS_FILE } = {}) {
  assertDevEnvironment(environment)
  const startedAt = performance.now()
  const result = spawnSync(process.execPath, ["--test", WORKFLOW_TEST], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...environment,
      NODE_ENV: "development",
      SIS_ENV_FILE: ".env.dev",
      DOTENV_CONFIG_PATH: ".env.dev",
      PARENT_PROFILE_E2E_ORIGIN: DEV_ORIGIN,
    },
    maxBuffer: 4 * 1024 * 1024,
    timeout: TEST_TIMEOUT_MS,
  })
  const durationSeconds = (performance.now() - startedAt) / 1000
  const checkedAt = Date.now() / 1000
  const report = parseTestReport(`${result.stdout || ""}\n${result.stderr || ""}`)
  const success = !result.error && result.status === 0 && report.success
  const previousSuccess = readLastSuccessTimestamp(metricsFile)
  const lastSuccessTimestamp = success ? checkedAt : previousSuccess
  writeMetricsAtomically(metricsFile, renderMonitorMetrics({ success, checkedAt, durationSeconds, lastSuccessTimestamp }))
  process.stdout.write(`parent_profile_workflow_monitor environment=dev result=${success ? "pass" : "fail"} duration_seconds=${durationSeconds.toFixed(3)}\n`)
  return success
}

function main() {
  try {
    process.exitCode = runParentProfileWorkflowMonitor() ? 0 : 1
  } catch {
    process.stderr.write("parent_profile_workflow_monitor environment=dev result=fail reason=configuration_or_metrics_error\n")
    process.exitCode = 1
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main()
