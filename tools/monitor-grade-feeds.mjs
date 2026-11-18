#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { pathToFileURL } from "node:url"
import { closeSharedPrismaClient, getSharedPrismaClient } from "../src/infra/db/prisma-client.mjs"

const DEV_ORIGIN = "http://127.0.0.1:8788"
const METRICS_FILE = path.join(process.cwd(), "runtime-data/prometheus/grade-feeds-dev.prom")
const REQUEST_METRICS_FILE = path.join(process.cwd(), "runtime-data/prometheus/sis-dev-request-metrics.prom")
const CHECK_TIMEOUT_MS = 10000
const SOURCE_KEYS = ["moodle", "google_forms", "other"]

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim()
}

function count(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

function timestampSeconds(value) {
  const date = value instanceof Date ? value : value ? new Date(value) : null
  const timestamp = date?.getTime() || 0
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp / 1000 : 0
}

function sourceKey(value) {
  const normalized = text(value).toLowerCase().replace(/_/g, "-")
  if (normalized === "moodle") return "moodle"
  if (normalized === "google-forms") return "google_forms"
  return "other"
}

function safeMetricNumber(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw new TypeError("Metric values must be finite and non-negative")
  return number.toFixed(6)
}

function escapeLabel(value) {
  return text(value).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"')
}

export function assertDevEnvironment(environment = process.env) {
  if (
    text(environment.NODE_ENV) !== "development" ||
    text(environment.SIS_ENV_FILE) !== ".env.dev" ||
    text(environment.DOTENV_CONFIG_PATH) !== ".env.dev"
  ) throw new Error("Grade feed monitor requires the explicit development environment")
}

export function renderGradeFeedMetrics({
  checkedAt,
  lastSuccessTimestamp,
  success,
  databaseAvailable,
  tableAvailable,
  attendanceReportingAvailable,
  attendanceSchoolSetupValid,
  requestMetricsAvailable,
  exerciseSources,
  gradeSources,
  unmatchedCount,
  queuedCount,
  temporaryCount,
  failedIncomingCount,
  oldestUnmatchedAgeSeconds,
}) {
  const values = [
    ["sis_grade_feed_monitor_success", "Whether the latest development grade and feed monitor completed its database and authenticated table checks.", success ? 1 : 0],
    ["sis_grade_feed_monitor_last_check_timestamp_seconds", "Unix timestamp of the latest development grade and feed monitor run.", checkedAt],
    ["sis_grade_feed_monitor_last_success_timestamp_seconds", "Unix timestamp of the latest successful development grade and feed monitor run.", lastSuccessTimestamp],
    ["sis_grade_feed_database_available", "Whether the development grade and feed database query succeeded against sis_dev.", databaseAvailable ? 1 : 0],
    ["sis_grade_feed_table_available", "Whether the authenticated development admin student table API returned HTTP success.", tableAvailable ? 1 : 0],
    ["sis_attendance_reporting_available", "Whether the authenticated development admin dashboard returned its attendance risk summary.", attendanceReportingAvailable ? 1 : 0],
    ["sis_attendance_school_setup_valid", "Whether the authenticated development SIS config API reports valid attendance school setup.", attendanceSchoolSetupValid ? 1 : 0],
    ["sis_grade_feed_request_metrics_available", "Whether the development request instrumentation textfile exists.", requestMetricsAvailable ? 1 : 0],
    ["sis_grade_feed_incoming_unmatched", "Number of unmatched incoming exercise results in active queued or temporary review states.", unmatchedCount],
    ["sis_grade_feed_incoming_queued", "Number of incoming exercise results in queued state.", queuedCount],
    ["sis_grade_feed_incoming_temporary", "Number of incoming exercise results in temporary state.", temporaryCount],
    ["sis_grade_feed_incoming_failed", "Number of incoming exercise results in failed state.", failedIncomingCount],
    ["sis_grade_feed_incoming_oldest_unmatched_age_seconds", "Age of the oldest unmatched incoming exercise result.", oldestUnmatchedAgeSeconds],
  ]
  const lines = values.flatMap(([name, help, value]) => [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} gauge`,
    `${name}{environment="dev"} ${safeMetricNumber(value)}`,
  ])

  lines.push(
    "# HELP sis_grade_feed_exercise_submission_rows Number of exercise submissions grouped by fixed source category.",
    "# TYPE sis_grade_feed_exercise_submission_rows gauge",
    "# HELP sis_grade_feed_exercise_submission_latest_ingested_timestamp_seconds Latest exercise submission creation time by fixed source category.",
    "# TYPE sis_grade_feed_exercise_submission_latest_ingested_timestamp_seconds gauge",
    "# HELP sis_grade_feed_grade_rows Number of grade rows grouped by fixed source category.",
    "# TYPE sis_grade_feed_grade_rows gauge",
    "# HELP sis_grade_feed_grade_latest_updated_timestamp_seconds Latest grade update time by fixed source category.",
    "# TYPE sis_grade_feed_grade_latest_updated_timestamp_seconds gauge",
    "# HELP sis_grade_feed_exercise_submission_latest_age_seconds Age of the latest exercise submission; omitted when no source rows exist.",
    "# TYPE sis_grade_feed_exercise_submission_latest_age_seconds gauge",
    "# HELP sis_grade_feed_grade_latest_age_seconds Age of the latest grade update; omitted when no source rows exist.",
    "# TYPE sis_grade_feed_grade_latest_age_seconds gauge",
  )

  for (const source of SOURCE_KEYS) {
    const exercise = exerciseSources[source] || { count: 0, latestTimestamp: 0 }
    const grades = gradeSources[source] || { count: 0, latestTimestamp: 0 }
    lines.push(
      `sis_grade_feed_exercise_submission_rows{environment="dev",source="${source}"} ${safeMetricNumber(exercise.count)}`,
      `sis_grade_feed_exercise_submission_latest_ingested_timestamp_seconds{environment="dev",source="${source}"} ${safeMetricNumber(exercise.latestTimestamp)}`,
      `sis_grade_feed_grade_rows{environment="dev",source="${source}"} ${safeMetricNumber(grades.count)}`,
      `sis_grade_feed_grade_latest_updated_timestamp_seconds{environment="dev",source="${source}"} ${safeMetricNumber(grades.latestTimestamp)}`,
    )
    if (exercise.latestTimestamp > 0) {
      lines.push(`sis_grade_feed_exercise_submission_latest_age_seconds{environment="dev",source="${source}"} ${safeMetricNumber(Math.max(0, checkedAt - exercise.latestTimestamp))}`)
    }
    if (grades.latestTimestamp > 0) {
      lines.push(`sis_grade_feed_grade_latest_age_seconds{environment="dev",source="${source}"} ${safeMetricNumber(Math.max(0, checkedAt - grades.latestTimestamp))}`)
    }
  }
  return `${lines.join("\n")}\n`
}

function readLastSuccessTimestamp(metricsFile) {
  if (!fs.existsSync(metricsFile)) return 0
  const contents = fs.readFileSync(metricsFile, "utf8")
  const match = contents.match(/^sis_grade_feed_monitor_last_success_timestamp_seconds\{environment="dev"\} ([0-9]+(?:\.[0-9]+)?)$/mu)
  return match ? Number(match[1]) : 0
}

export function writeMetricsAtomically(metricsFile, contents) {
  const directory = path.dirname(metricsFile)
  fs.mkdirSync(directory, { recursive: true, mode: 0o750 })
  const temporaryFile = `${metricsFile}.${process.pid}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporaryFile, contents, { encoding: "utf8", flag: "wx", mode: 0o640 })
    fs.renameSync(temporaryFile, metricsFile)
  } catch (error) {
    fs.rmSync(temporaryFile, { force: true })
    throw error
  }
}

async function checkAdminTableApi(environment, origin = DEV_ORIGIN) {
  const username = text(environment.STUDENT_ADMIN_USER)
  const password = text(environment.STUDENT_ADMIN_PASS)
  if (!username || !password) return false
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
  try {
    const login = await fetch(`${origin}/api/admin/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
      signal: controller.signal,
    })
    if (!login.ok) return false
    const cookie = text(login.headers.get("set-cookie")).split(";", 1)[0]
    if (!cookie) return false
    const response = await fetch(`${origin}/api/admin/students?take=1`, {
      headers: { cookie, accept: "application/json" },
      signal: controller.signal,
    })
    if (!response.ok || !String(response.headers.get("content-type") || "").includes("application/json")) return false
    const payload = await response.json()
    return Boolean(payload && typeof payload === "object" && !Array.isArray(payload))
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

async function checkAttendanceApi(environment, origin = DEV_ORIGIN) {
  const username = text(environment.STUDENT_ADMIN_USER)
  const password = text(environment.STUDENT_ADMIN_PASS)
  if (!username || !password) return { reportingAvailable: false, schoolSetupValid: false }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
  try {
    const login = await fetch(`${origin}/api/admin/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
      signal: controller.signal,
    })
    if (!login.ok) return { reportingAvailable: false, schoolSetupValid: false }
    const cookie = text(login.headers.get("set-cookie")).split(";", 1)[0]
    if (!cookie) return { reportingAvailable: false, schoolSetupValid: false }

    const [settingsResponse, dashboardResponse] = await Promise.all([
      fetch(`${origin}/api/admin/settings/ui`, {
        headers: { cookie, accept: "application/json" },
        signal: controller.signal,
      }),
      fetch(`${origin}/api/admin/dashboard`, {
        headers: { cookie, accept: "application/json" },
        signal: controller.signal,
      }),
    ])
    const [settings, dashboard] = await Promise.all([
      settingsResponse.ok ? settingsResponse.json() : null,
      dashboardResponse.ok ? dashboardResponse.json() : null,
    ])
    const schoolSetupValid = Boolean(
      settings?.uiSettings?.schoolSetup
      && typeof settings.uiSettings.schoolSetup === "object"
      && settings?.meta?.schoolSetupState === "ok"
      && settings?.meta?.schoolSetupHasIssues === false
    )
    const attendanceRiskWeek = dashboard?.attendanceRiskWeek
    const reportingAvailable = Boolean(
      attendanceRiskWeek
      && Number.isSafeInteger(attendanceRiskWeek.total)
      && attendanceRiskWeek.total >= 0
      && Array.isArray(attendanceRiskWeek.students)
    )
    return {
      reportingAvailable: dashboardResponse.ok && reportingAvailable,
      schoolSetupValid: settingsResponse.ok && schoolSetupValid,
    }
  } catch {
    return { reportingAvailable: false, schoolSetupValid: false }
  } finally {
    clearTimeout(timeout)
  }
}

async function collectDatabaseMetrics(prisma, now) {
  const database = await prisma.$queryRaw`SELECT current_database() AS name`
  if (database[0]?.name !== "sis_dev") throw new Error("Grade feed monitor connected to an unexpected database")

  const [exerciseRows, gradeRows, unmatchedCount, queuedCount, temporaryCount, failedIncomingCount, oldestUnmatched] = await Promise.all([
    prisma.exerciseSubmission.groupBy({
      by: ["sourceSystem"],
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    prisma.studentGradeRecord.groupBy({
      by: ["sourceSystem"],
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
    prisma.incomingExerciseResult.count({
      where: { matchedStudentRefId: null, status: { in: ["queued", "temporary"] } },
    }),
    prisma.incomingExerciseResult.count({ where: { status: "queued" } }),
    prisma.incomingExerciseResult.count({ where: { status: "temporary" } }),
    prisma.incomingExerciseResult.count({ where: { status: "failed" } }),
    prisma.incomingExerciseResult.findFirst({
      where: { matchedStudentRefId: null, status: { in: ["queued", "temporary"] } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ])

  const exerciseSources = Object.fromEntries(SOURCE_KEYS.map((key) => [key, { count: 0, latestTimestamp: 0 }]))
  const gradeSources = Object.fromEntries(SOURCE_KEYS.map((key) => [key, { count: 0, latestTimestamp: 0 }]))
  for (const row of exerciseRows) {
    const key = sourceKey(row.sourceSystem)
    exerciseSources[key].count += count(row._count?._all)
    exerciseSources[key].latestTimestamp = Math.max(
      exerciseSources[key].latestTimestamp,
      timestampSeconds(row._max?.createdAt),
    )
  }
  for (const row of gradeRows) {
    const key = sourceKey(row.sourceSystem)
    gradeSources[key].count += count(row._count?._all)
    gradeSources[key].latestTimestamp = Math.max(
      gradeSources[key].latestTimestamp,
      timestampSeconds(row._max?.updatedAt),
    )
  }
  const oldestTimestamp = timestampSeconds(oldestUnmatched?.createdAt)
  return {
    exerciseSources,
    gradeSources,
    unmatchedCount: count(unmatchedCount),
    queuedCount: count(queuedCount),
    temporaryCount: count(temporaryCount),
    failedIncomingCount: count(failedIncomingCount),
    oldestUnmatchedAgeSeconds: oldestTimestamp ? Math.max(0, now / 1000 - oldestTimestamp) : 0,
  }
}

export async function runGradeFeedMonitor({
  environment = process.env,
  metricsFile = METRICS_FILE,
  requestMetricsFile = REQUEST_METRICS_FILE,
  prismaClient = null,
  tableApiCheck = checkAdminTableApi,
  attendanceApiCheck = checkAttendanceApi,
  clock = () => Date.now(),
} = {}) {
  assertDevEnvironment(environment)
  const started = clock()
  const prisma = prismaClient || await getSharedPrismaClient()
  let databaseAvailable = false
  let tableAvailable = false
  let attendanceReportingAvailable = false
  let attendanceSchoolSetupValid = false
  let observed = {
    exerciseSources: Object.fromEntries(SOURCE_KEYS.map((key) => [key, { count: 0, latestTimestamp: 0 }])),
    gradeSources: Object.fromEntries(SOURCE_KEYS.map((key) => [key, { count: 0, latestTimestamp: 0 }])),
    unmatchedCount: 0,
    queuedCount: 0,
    temporaryCount: 0,
    failedIncomingCount: 0,
    oldestUnmatchedAgeSeconds: 0,
  }

  try {
    observed = await collectDatabaseMetrics(prisma, clock())
    databaseAvailable = true
  } catch {
    databaseAvailable = false
  }
  try {
    tableAvailable = Boolean(await tableApiCheck(environment))
  } catch {
    tableAvailable = false
  }
  try {
    const attendanceStatus = await attendanceApiCheck(environment)
    attendanceReportingAvailable = Boolean(attendanceStatus?.reportingAvailable)
    attendanceSchoolSetupValid = Boolean(attendanceStatus?.schoolSetupValid)
  } catch {
    attendanceReportingAvailable = false
    attendanceSchoolSetupValid = false
  }

  const checkedAt = clock() / 1000
  const success = databaseAvailable && tableAvailable && attendanceReportingAvailable && attendanceSchoolSetupValid
  const previousSuccess = readLastSuccessTimestamp(metricsFile)
  const metrics = renderGradeFeedMetrics({
    checkedAt,
    lastSuccessTimestamp: success ? checkedAt : previousSuccess,
    success,
    databaseAvailable,
    tableAvailable,
    attendanceReportingAvailable,
    attendanceSchoolSetupValid,
    requestMetricsAvailable: fs.existsSync(requestMetricsFile),
    ...observed,
  })
  try {
    writeMetricsAtomically(metricsFile, metrics)
  } finally {
    if (!prismaClient) await closeSharedPrismaClient()
  }
  process.stdout.write(`grade_feed_monitor environment=dev result=${success ? "pass" : "fail"} database=${databaseAvailable ? "up" : "down"} table=${tableAvailable ? "up" : "down"} attendance_setup=${attendanceSchoolSetupValid ? "ok" : "invalid"} attendance_reporting=${attendanceReportingAvailable ? "up" : "down"} unmatched=${observed.unmatchedCount} queued=${observed.queuedCount} write_metrics=${fs.existsSync(requestMetricsFile) ? "available" : "missing"} duration_ms=${Math.max(0, clock() - started)}\n`)
  return success
}

function main() {
  runGradeFeedMonitor().then((success) => {
    process.exitCode = success ? 0 : 1
  }).catch(() => {
    process.stderr.write("grade_feed_monitor environment=dev result=fail reason=configuration_or_monitor_error\n")
    process.exitCode = 1
  })
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main()
