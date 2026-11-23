import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { parse as parseDotenv } from "dotenv"
import {
  resolveStandardParentCredentials,
  resolveStandardStudentCredentials,
} from "../test/helpers/standard-portal-credentials.mjs"

const ROOT = process.cwd()
const METRICS_FILE = path.join(ROOT, "runtime-data/prometheus/keepalive-nightly-smoke-test.prom")
const SUITE_TIMEOUT_MS = 5 * 60 * 60 * 1000
export const OUTBOUND_MESSAGE_ENV_KEYS = Object.freeze([
  "EMAIL_PROVIDER",
  "BREVO_API_KEY",
  "BREVO_API_URL",
  "BREVO_API_BASE_URL",
  "BREVO_FROM_EMAIL",
  "BREVO_FROM_NAME",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_AUTH",
  "SMTP_AUTH_MODE",
  "SMTP_FROM",
  "SMTP_USER",
  "SMTP_PASS",
])

export function assertTestEnvironment(environment = process.env) {
  if (
    String(environment.NODE_ENV || "").trim() !== "test" ||
    String(environment.SIS_ENV_FILE || "").trim() !== ".env.test" ||
    String(environment.DOTENV_CONFIG_PATH || "").trim() !== ".env.test" ||
    String(environment.SIS_KEEPALIVE_NO_EXTERNAL_MESSAGES || "").trim() !== "1"
  ) throw new Error("Keep-alive nightly smoke requires the explicit test environment")
}

function isExecutableFile(filePath) {
  if (!filePath) return false
  try {
    fs.accessSync(filePath, fs.constants.X_OK)
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

export function resolveChromiumExecutablePath(environment = process.env) {
  const candidates = [
    environment.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    environment.CHROME_PATH,
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ]
  return candidates.find(isExecutableFile) || ""
}

export function assertAuthenticatedSmokePrerequisites(environment = process.env, options = {}) {
  const envFile = String(environment.SIS_ENV_FILE || "").trim()
  let fileValues = options.environmentFileValues
  if (!fileValues) {
    try {
      fileValues = parseDotenv(fs.readFileSync(envFile, "utf8"))
    } catch {
      fileValues = {}
    }
  }
  const values = { ...fileValues, ...environment }
  const student = resolveStandardStudentCredentials(values)
  const parent = resolveStandardParentCredentials(values)
  const adminConfigured = Boolean(
    String(values.STUDENT_ADMIN_USER || "").trim() && String(values.STUDENT_ADMIN_PASS || "").trim(),
  )
  const chromiumPath = options.chromiumCandidates
    ? options.chromiumCandidates.find(isExecutableFile) || ""
    : resolveChromiumExecutablePath(values)
  const chromiumAvailable = typeof options.chromiumAvailable === "boolean"
    ? options.chromiumAvailable
    : Boolean(chromiumPath)
  if (!student.user || !student.pass || !parent.user || !parent.pass || !adminConfigured || !chromiumAvailable) {
    throw Object.assign(
      new Error("Nightly authenticated smoke prerequisites are incomplete"),
      { failureCode: "configuration_invalid" },
    )
  }
  return true
}

export function buildNoExternalMessageTestEnvironment(environment = process.env) {
  const result = { ...environment }
  for (const key of OUTBOUND_MESSAGE_ENV_KEYS) delete result[key]
  const chromiumPath = resolveChromiumExecutablePath(environment)
  if (chromiumPath) result.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = chromiumPath
  return {
    ...result,
    SIS_ENV_FILE: ".env.test",
    DOTENV_CONFIG_PATH: ".env.test",
    NODE_ENV: "test",
    SIS_KEEPALIVE_NO_EXTERNAL_MESSAGES: "1",
    EMAIL_PROVIDER: "smtp",
    BREVO_API_URL: "http://127.0.0.1:1/v3/smtp/email",
    BREVO_API_BASE_URL: "http://127.0.0.1:1/v3",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "1",
    SMTP_SECURE: "false",
    SMTP_AUTH_MODE: "none",
    SMTP_FROM: "nightly-no-send@example.invalid",
  }
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

export function renderNightlySmokeMetrics({ checkedAt, durationSeconds, success, lastSuccessTimestamp, failureCode, failedFile = "", noExternalMessagesVerified = false }) {
  const normalizedFailureCode = success ? "none" : String(failureCode || "suite_failed")
  if (!new Set(["none", "suite_failed", "dependency_unavailable", "configuration_invalid", "message_state_changed", "timeout"]).has(normalizedFailureCode)) {
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
    "# HELP sis_keepalive_nightly_smoke_no_external_message_proof Whether outbound email credentials were removed, SMTP/Brevo endpoints were pinned to loopback, and message-delivery state remained unchanged.",
    "# TYPE sis_keepalive_nightly_smoke_no_external_message_proof gauge",
    `sis_keepalive_nightly_smoke_no_external_message_proof{${labels}} ${noExternalMessagesVerified ? 1 : 0}`,
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
    const [jobs, queues, deliveries] = await Promise.all([
      prisma.$queryRawUnsafe(`
        SELECT "jobType", "status", count(*)::int AS count
        FROM "AsyncSideEffectJob"
        WHERE "jobType" IN ('announcement-email', 'parent-profile-invitation')
        GROUP BY "jobType", "status"
        ORDER BY "jobType", "status"
      `),
      prisma.$queryRawUnsafe(`
        SELECT "queueType", "status", count(*)::int AS count
        FROM "AdminNotificationQueue"
        GROUP BY "queueType", "status"
        ORDER BY "queueType", "status"
      `),
      prisma.$queryRawUnsafe(`
        SELECT "status", count(*)::int AS count, max("sentAt") AS latest_sent_at
        FROM "BrevoEmailDelivery"
        GROUP BY "status"
        ORDER BY "status"
      `),
    ])
    return JSON.stringify({ jobs, queues, deliveries })
  } finally {
    await prisma.$disconnect()
  }
}

function runSuite(environment = process.env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, "tools/test-suite.mjs"), "all", "--summary"], {
      cwd: ROOT,
      env: {
        ...buildNoExternalMessageTestEnvironment(environment),
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
    assertAuthenticatedSmokePrerequisites(environment)
    const deliveryStateBefore = await assertTestDatabase()
    result = await runSuite(environment)
    const deliveryStateAfter = await assertTestDatabase()
    const noExternalMessagesVerified = deliveryStateBefore === deliveryStateAfter
    if (!noExternalMessagesVerified) {
      result = { ...result, success: false, failureCode: "message_state_changed", noExternalMessagesVerified }
    } else {
      result = { ...result, noExternalMessagesVerified }
    }
  } catch (error) {
    const failureCode = error?.failureCode === "configuration_invalid" ? "configuration_invalid" : "dependency_unavailable"
    result = { success: false, failureCode, noExternalMessagesVerified: false }
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
    noExternalMessagesVerified: result.noExternalMessagesVerified,
  }))
  process.stdout.write(`test-mirror nightly smoke ${result.success ? "passed" : `failed (${result.failureCode}${result.failedFile ? ` at ${result.failedFile}` : ""})`}; no-external-message-proof=${result.noExternalMessagesVerified ? "verified" : "failed"} in ${durationSeconds.toFixed(1)}s\n`)
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
