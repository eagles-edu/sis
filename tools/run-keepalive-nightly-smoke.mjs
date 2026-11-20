import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const ROOT = process.cwd()
const METRICS_FILE = path.join(ROOT, "runtime-data/prometheus/keepalive-nightly-smoke-test.prom")
const SUITE_TIMEOUT_MS = 5 * 60 * 60 * 1000

export function assertTestEnvironment(environment = process.env) {
  if (
    String(environment.NODE_ENV || "").trim() !== "test" ||
    String(environment.SIS_ENV_FILE || "").trim() !== ".env.test" ||
    String(environment.DOTENV_CONFIG_PATH || "").trim() !== ".env.test"
  ) throw new Error("Keep-alive nightly smoke requires the explicit test environment")
}

function metricNumber(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw new TypeError("Metric values must be finite non-negative numbers")
  return number.toFixed(6)
}

function previousLastSuccess(metricsFile) {
  if (!fs.existsSync(metricsFile)) return 0
  const contents = fs.readFileSync(metricsFile, "utf8")
  const match = contents.match(/^sis_keepalive_nightly_smoke_last_success_timestamp_seconds\{environment="test"\} ([0-9]+(?:\.[0-9]+)?)$/mu)
  return match ? Number(match[1]) : 0
}

export function renderNightlySmokeMetrics({ checkedAt, durationSeconds, success, lastSuccessTimestamp, failureCode, failedFile = "" }) {
  const normalizedFailureCode = success ? "none" : String(failureCode || "suite_failed")
  if (!new Set(["none", "suite_failed", "dependency_unavailable", "configuration_invalid", "timeout"]).has(normalizedFailureCode)) {
    throw new TypeError("Nightly smoke failure code is not in the bounded vocabulary")
  }
  const failedFileName = String(failedFile || "")
  if (failedFileName && !/^[A-Za-z0-9][A-Za-z0-9._-]*\.spec\.mjs$/u.test(failedFileName)) {
    throw new TypeError("Nightly smoke failed file must be a test spec basename")
  }
  const labels = 'environment="test"'
  const failureLabels = `${labels},code="${normalizedFailureCode}"`
  return [
    "# HELP sis_keepalive_nightly_smoke_success Whether the latest full test-mirror smoke suite passed.",
    "# TYPE sis_keepalive_nightly_smoke_success gauge",
    `sis_keepalive_nightly_smoke_success{${labels}} ${success ? 1 : 0}`,
    "# HELP sis_keepalive_nightly_smoke_last_check_timestamp_seconds Unix timestamp of the latest full test-mirror smoke suite.",
    "# TYPE sis_keepalive_nightly_smoke_last_check_timestamp_seconds gauge",
    `sis_keepalive_nightly_smoke_last_check_timestamp_seconds{${labels}} ${metricNumber(checkedAt)}`,
    "# HELP sis_keepalive_nightly_smoke_last_success_timestamp_seconds Unix timestamp of the latest successful full test-mirror smoke suite.",
    "# TYPE sis_keepalive_nightly_smoke_last_success_timestamp_seconds gauge",
    `sis_keepalive_nightly_smoke_last_success_timestamp_seconds{${labels}} ${metricNumber(lastSuccessTimestamp)}`,
    "# HELP sis_keepalive_nightly_smoke_duration_seconds Duration of the latest full test-mirror smoke suite.",
    "# TYPE sis_keepalive_nightly_smoke_duration_seconds gauge",
    `sis_keepalive_nightly_smoke_duration_seconds{${labels}} ${metricNumber(durationSeconds)}`,
    "# HELP sis_keepalive_nightly_smoke_failure_info Bounded failure category for the latest full test-mirror smoke suite.",
    "# TYPE sis_keepalive_nightly_smoke_failure_info gauge",
    `sis_keepalive_nightly_smoke_failure_info{${failureLabels}} 1`,
    "# HELP sis_keepalive_nightly_smoke_failed_file_info Basename of the spec file that stopped the latest full test-mirror smoke suite.",
    "# TYPE sis_keepalive_nightly_smoke_failed_file_info gauge",
    ...(failedFileName ? [`sis_keepalive_nightly_smoke_failed_file_info{${labels},file="${failedFileName}"} 1`] : []),
    "",
  ].join("\n")
}

export function writeMetricsAtomically(metricsFile, contents) {
  const directory = path.dirname(metricsFile)
  fs.mkdirSync(directory, { recursive: true, mode: 0o750 })
  const temporaryFile = `${metricsFile}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(temporaryFile, contents, { encoding: "utf8", flag: "wx", mode: 0o644 })
    fs.renameSync(temporaryFile, metricsFile)
  } catch (error) {
    fs.rmSync(temporaryFile, { force: true })
    throw error
  }
}

async function assertTestDatabase() {
  const { getSharedPrismaClient } = await import("../src/infra/db/prisma-client.mjs")
  const prisma = await getSharedPrismaClient()
  try {
    const rows = await prisma.$queryRawUnsafe("SELECT current_database() AS name")
    if (String(rows?.[0]?.name || "") !== "sis-test") throw new Error("Nightly smoke database identity mismatch")
  } finally {
    await prisma.$disconnect()
  }
}

function runSuite() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, "tools/test-suite.mjs"), "all", "--summary"], {
      cwd: ROOT,
      env: {
        ...process.env,
        SIS_ENV_FILE: ".env.test",
        DOTENV_CONFIG_PATH: ".env.test",
        NODE_ENV: "test",
        CI: "1",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    })
    let settled = false
    let pendingOutput = ""
    let failedFile = ""
    const observeOutput = (chunk) => {
      pendingOutput += chunk.toString("utf8")
      const lines = pendingOutput.split(/\r?\n/u)
      pendingOutput = lines.pop() || ""
      for (const line of lines) {
        const match = line.match(/^\[test-suite:all:summary\]\s+\d+\/\d+\s+(?:failed|timed out after \d+ms)\s+test\/([A-Za-z0-9._/-]+\.spec\.mjs)(?:\s|$)/u)
        if (match) failedFile = path.posix.basename(match[1])
      }
    }
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", observeOutput)
    child.stderr.on("data", observeOutput)
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({ ...result, failedFile })
    }
    const timeout = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGTERM")
      } catch {}
      const killTimer = setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL")
        } catch {}
      }, 5000)
      killTimer.unref()
      finish({ success: false, failureCode: "timeout" })
    }, SUITE_TIMEOUT_MS)
    child.once("error", () => finish({ success: false, failureCode: "suite_failed" }))
    child.once("close", (code, signal) => finish({
      success: code === 0,
      failureCode: code === 0 ? "none" : signal === "SIGTERM" ? "timeout" : "suite_failed",
      failedFile,
    }))
  })
}

export async function runNightlySmoke({ environment = process.env, metricsFile = METRICS_FILE, now = () => Date.now() } = {}) {
  assertTestEnvironment(environment)
  const startedAt = performance.now()
  const checkedAt = now() / 1000
  let result
  try {
    await assertTestDatabase()
    result = await runSuite()
  } catch {
    result = { success: false, failureCode: "dependency_unavailable" }
  }
  const durationSeconds = Math.max(0, (performance.now() - startedAt) / 1000)
  const lastSuccessTimestamp = result.success ? checkedAt : previousLastSuccess(metricsFile)
  writeMetricsAtomically(metricsFile, renderNightlySmokeMetrics({
    checkedAt,
    durationSeconds,
    success: result.success,
    lastSuccessTimestamp,
    failureCode: result.failureCode,
    failedFile: result.failedFile,
  }))
  process.stdout.write(`test-mirror nightly smoke ${result.success ? "passed" : `failed (${result.failureCode}${result.failedFile ? ` at ${result.failedFile}` : ""})`} in ${durationSeconds.toFixed(1)}s\n`)
  return result.success
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = await runNightlySmoke() ? 0 : 1
  } catch {
    process.stderr.write("test-mirror nightly smoke refused: environment configuration invalid\n")
    process.exitCode = 2
  }
}
