#!/usr/bin/env node
// @ts-check

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

import { getSharedPrismaClient } from "../server/prisma-client-factory.mjs"

const DEFAULT_OUTPUT_PATH = "runtime-data/maintenance/db-health-status.json"
const DEFAULT_BACKUP_LATEST_PATH = "/home/eagles/dockerz/backups/postgres/latest.json"
const DEFAULT_VACUUM_REPORT_DIR = "runtime-data/maintenance-reports"
const DEFAULT_BACKUP_STALE_MINUTES = 26 * 60
const DEFAULT_MAX_QUERY_LATENCY_MS = 500
const DEFAULT_MAX_INCOMING_UNMATCHED = 0
const DEFAULT_MAX_ORPHAN_COUNT = 0
const DEFAULT_METRICS_ENVIRONMENT = "unknown"

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

/**
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
function normalizeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function safeIsoDate(value) {
  const text = normalizeText(value)
  if (!text) return ""
  const time = Date.parse(text)
  if (!Number.isFinite(time)) return ""
  const date = new Date(time)
  return date.toISOString()
}

/**
 * @param {string} filePath
 * @returns {Record<string, unknown> | null}
 */
function readJsonFileSafe(filePath) {
  const resolvedPath = normalizeText(filePath)
  if (!resolvedPath || !fs.existsSync(resolvedPath)) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8"))
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

/**
 * @param {Record<string, unknown>} [backupPayload]
 * @param {string} [backupPath]
 * @returns {string}
 */
function resolveBackupTimestamp(backupPayload = {}, backupPath = "") {
  return (
    safeIsoDate(
      backupPayload?.createdAt
      || backupPayload?.created_at
      || backupPayload?.finishedAt
      || backupPayload?.completedAt
      || backupPayload?.updatedAt
    )
    || safeIsoDate(backupPayload?.backupTimestamp)
    || safeIsoDate(backupPayload?.timestamp)
    || safeIsoDate(backupPayload?.backupAt)
    || safeIsoDate(backupPayload?.backupTime)
    || safeIsoDate((() => {
      if (!normalizeText(backupPath)) return null
      try {
        return fs.statSync(backupPath).mtime
      } catch {
        return null
      }
    })())
  )
}

/**
 * @param {string[]} [argv]
 * @returns {{
 *   outputPath: string,
 *   backupLatestPath: string,
 *   vacuumReportDir: string,
 *   backupStaleMinutes: number,
 *   maxQueryLatencyMs: number,
 *   maxIncomingUnmatched: number,
 *   maxOrphanCount: number,
 *   expectedDatabase: string,
 *   metricsOutputPath: string,
 *   metricsEnvironment: string,
 *   help: boolean,
 * }}
 */
function parseArgs(argv = []) {
  const args = {
    outputPath: DEFAULT_OUTPUT_PATH,
    backupLatestPath: DEFAULT_BACKUP_LATEST_PATH,
    vacuumReportDir: DEFAULT_VACUUM_REPORT_DIR,
    backupStaleMinutes: DEFAULT_BACKUP_STALE_MINUTES,
    maxQueryLatencyMs: DEFAULT_MAX_QUERY_LATENCY_MS,
    maxIncomingUnmatched: DEFAULT_MAX_INCOMING_UNMATCHED,
    maxOrphanCount: DEFAULT_MAX_ORPHAN_COUNT,
    expectedDatabase: "",
    metricsOutputPath: "",
    metricsEnvironment: DEFAULT_METRICS_ENVIRONMENT,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = normalizeText(argv[index])
    if (!token) continue
    if (token === "--output") {
      index += 1
      args.outputPath = normalizeText(argv[index]) || DEFAULT_OUTPUT_PATH
      continue
    }
    if (token === "--backup-latest") {
      index += 1
      args.backupLatestPath = normalizeText(argv[index]) || DEFAULT_BACKUP_LATEST_PATH
      continue
    }
    if (token === "--vacuum-report-dir") {
      index += 1
      args.vacuumReportDir = normalizeText(argv[index]) || DEFAULT_VACUUM_REPORT_DIR
      continue
    }
    if (token === "--backup-stale-minutes") {
      index += 1
      args.backupStaleMinutes = Math.max(1, normalizeInteger(argv[index], DEFAULT_BACKUP_STALE_MINUTES))
      continue
    }
    if (token === "--max-query-latency-ms") {
      index += 1
      args.maxQueryLatencyMs = Math.max(1, normalizeInteger(argv[index], DEFAULT_MAX_QUERY_LATENCY_MS))
      continue
    }
    if (token === "--max-incoming-unmatched") {
      index += 1
      args.maxIncomingUnmatched = Math.max(0, normalizeInteger(argv[index], DEFAULT_MAX_INCOMING_UNMATCHED))
      continue
    }
    if (token === "--max-orphan-count") {
      index += 1
      args.maxOrphanCount = Math.max(0, normalizeInteger(argv[index], DEFAULT_MAX_ORPHAN_COUNT))
      continue
    }
    if (token === "--expected-database") {
      index += 1
      args.expectedDatabase = normalizeText(argv[index])
      if (!args.expectedDatabase) throw new Error("--expected-database requires a value")
      continue
    }
    if (token === "--metrics-output") {
      index += 1
      args.metricsOutputPath = normalizeText(argv[index])
      if (!args.metricsOutputPath) throw new Error("--metrics-output requires a value")
      continue
    }
    if (token === "--metrics-environment") {
      index += 1
      args.metricsEnvironment = normalizeText(argv[index]) || DEFAULT_METRICS_ENVIRONMENT
      if (!/^[a-z][a-z0-9_]{0,31}$/u.test(args.metricsEnvironment)) {
        throw new Error("--metrics-environment must be a lowercase metric label")
      }
      continue
    }
    if (token === "--help" || token === "-h") {
      args.help = true
      continue
    }
    throw new Error(`Unknown argument: ${token}`)
  }

  return args
}

function printHelp() {
  console.log(`Usage: node tools/db-health-check.mjs [options]

Options:
  --output PATH                 Write JSON health report (default: ${DEFAULT_OUTPUT_PATH})
  --backup-latest PATH          latest.json path (default: ${DEFAULT_BACKUP_LATEST_PATH})
  --vacuum-report-dir PATH      incoming vacuum report directory (default: ${DEFAULT_VACUUM_REPORT_DIR})
  --backup-stale-minutes N      backup freshness threshold minutes (default: ${DEFAULT_BACKUP_STALE_MINUTES})
  --max-query-latency-ms N      max query latency before warning (default: ${DEFAULT_MAX_QUERY_LATENCY_MS})
  --max-incoming-unmatched N    max unmatched incoming rows before warning (default: ${DEFAULT_MAX_INCOMING_UNMATCHED})
  --max-orphan-count N          max orphan rows before error (default: ${DEFAULT_MAX_ORPHAN_COUNT})
  --expected-database NAME      require PostgreSQL to report this database name
  --metrics-output PATH         atomically write low-cardinality Prometheus metrics
  --metrics-environment NAME    environment metric label (default: ${DEFAULT_METRICS_ENVIRONMENT})
  --help, -h                    Show help
`)
}

/**
 * @param {unknown} rows
 * @returns {number}
 */
function normalizeCountRow(rows) {
  if (!Array.isArray(rows) || !rows[0] || typeof rows[0] !== "object") return 0
  const firstRow = /** @type {Record<string, unknown>} */ (rows[0])
  return Number.parseInt(String(firstRow.count || 0), 10) || 0
}

/**
 * @param {string} reportDirPath
 * @returns {{
 *   reportPath: string,
 *   lastIncomingVacuumAt: string,
 *   manualReviewCount: number,
 * }}
 */
function readLatestIncomingVacuumSummary(reportDirPath) {
  const reportDir = path.resolve(process.cwd(), normalizeText(reportDirPath) || DEFAULT_VACUUM_REPORT_DIR)
  let latestReportPath = ""
  try {
    const names = fs.readdirSync(reportDir)
      .filter((entry) => /^incoming-vacuum-[0-9]{8}-[0-9]{6}Z\.json$/u.test(entry))
      .sort((left, right) => right.localeCompare(left))
    if (names.length) latestReportPath = path.join(reportDir, names[0])
  } catch {
    return {
      reportPath: "",
      lastIncomingVacuumAt: "",
      manualReviewCount: 0,
    }
  }

  const report = latestReportPath ? readJsonFileSafe(latestReportPath) : null
  const reportData = report && typeof report === "object" ? /** @type {Record<string, unknown>} */ (report) : null
  if (!reportData) {
    return {
      reportPath: latestReportPath,
      lastIncomingVacuumAt: "",
      manualReviewCount: 0,
    }
  }

  const manualReviewCount = Number.isFinite(Number(reportData.manualReviewCount))
    ? Number(reportData.manualReviewCount)
    : Array.isArray(reportData.manualReview)
      ? reportData.manualReview.length
      : 0
  return {
    reportPath: latestReportPath,
    lastIncomingVacuumAt: safeIsoDate(reportData.runStartedAt || reportData.checkedAt || reportData.createdAt),
    manualReviewCount: Math.max(0, Number.parseInt(String(manualReviewCount), 10) || 0),
  }
}

/**
 * @param {string} outputPath
 * @param {unknown} payload
 * @returns {string}
 */
function writeOutputFile(outputPath, payload) {
  const resolved = path.resolve(process.cwd(), outputPath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  writeAtomicFile(resolved, `${JSON.stringify(payload, null, 2)}\n`)
  return resolved
}

/**
 * @param {string} filePath
 * @param {string} contents
 * @returns {void}
 */
function writeAtomicFile(filePath, contents) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(temporaryPath, contents, { encoding: "utf8", mode: 0o644, flag: "wx" })
    fs.renameSync(temporaryPath, filePath)
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }) } catch {}
    throw error
  }
}

/**
 * @param {Record<string, unknown>} payload
 * @param {string} environment
 * @returns {string}
 */
function formatPrometheusMetrics(payload, environment) {
  const db = /** @type {Record<string, unknown>} */ (payload.db || {})
  const backup = /** @type {Record<string, unknown>} */ (payload.backup || {})
  const incoming = /** @type {Record<string, unknown>} */ (payload.incoming || {})
  const orphans = /** @type {Record<string, unknown>} */ (payload.orphans || {})
  const labels = `environment="${environment}"`
  const checkedAt = Date.parse(String(payload.checkedAt || ""))
  const lastRun = Number.isFinite(checkedAt) ? checkedAt / 1000 : Date.now() / 1000
  const successful = payload.status === "error" ? 0 : 1
  const lines = [
    "# HELP sis_db_health_check_success Whether the database snapshot passed connection, identity, and orphan-count checks.",
    "# TYPE sis_db_health_check_success gauge",
    `sis_db_health_check_success{${labels}} ${successful}`,
    "# HELP sis_db_health_check_last_run_timestamp_seconds Unix timestamp of the latest database health check.",
    "# TYPE sis_db_health_check_last_run_timestamp_seconds gauge",
    `sis_db_health_check_last_run_timestamp_seconds{${labels}} ${lastRun}`,
    "# HELP sis_db_health_check_query_latency_ms Database health query latency in milliseconds, or -1 when unavailable.",
    "# TYPE sis_db_health_check_query_latency_ms gauge",
    `sis_db_health_check_query_latency_ms{${labels}} ${db.queryLatencyMs !== null && db.queryLatencyMs !== undefined && Number.isFinite(Number(db.queryLatencyMs)) ? Number(db.queryLatencyMs) : -1}`,
    "# HELP sis_db_health_backup_stale Whether the environment-owned backup metadata is missing or stale.",
    "# TYPE sis_db_health_backup_stale gauge",
    `sis_db_health_backup_stale{${labels}} ${backup.isStale ? 1 : 0}`,
    "# HELP sis_db_health_incoming_unmatched_count Number of unmatched incoming exercise results.",
    "# TYPE sis_db_health_incoming_unmatched_count gauge",
    `sis_db_health_incoming_unmatched_count{${labels}} ${Number(incoming.unmatchedCount || 0)}`,
    "# HELP sis_db_health_orphan_count Number of detected orphan database rows.",
    "# TYPE sis_db_health_orphan_count gauge",
    `sis_db_health_orphan_count{${labels}} ${Number(orphans.total || 0)}`,
  ]
  return `${lines.join("\n")}\n`
}

/**
 * @param {{
 *   outputPath: string,
 *   backupLatestPath: string,
 *   vacuumReportDir: string,
 *   backupStaleMinutes: number,
 *   maxQueryLatencyMs: number,
 *   maxIncomingUnmatched: number,
 *   maxOrphanCount: number,
 *   expectedDatabase: string,
 *   metricsOutputPath: string,
 *   metricsEnvironment: string,
 *   help: boolean,
 * }} args
 * @returns {Promise<Record<string, unknown>>}
 */
async function runHealthCheck(args) {
  const checkedAt = new Date().toISOString()
  let prisma = null
  const thresholds = {
    backupStaleMinutes: args.backupStaleMinutes,
    maxQueryLatencyMs: args.maxQueryLatencyMs,
    maxIncomingUnmatched: args.maxIncomingUnmatched,
    maxOrphanCount: args.maxOrphanCount,
  }

  let dbConnected = false
  let checkCompleted = false
  let dbError = ""
  let databaseName = ""
  let queryLatencyMs = -1
  /** @type {{ queued: number, temporary: number, unmatched: number }} */
  let incomingCounts = {
    queued: 0,
    temporary: 0,
    unmatched: 0,
  }
  /** @type {{ exerciseSubmissionMissingStudent: number, exerciseSubmissionMissingExercise: number, studentGradeRecordMissingStudent: number }} */
  let orphanCounts = {
    exerciseSubmissionMissingStudent: 0,
    exerciseSubmissionMissingExercise: 0,
    studentGradeRecordMissingStudent: 0,
  }

  try {
    prisma = await getSharedPrismaClient()
    const queryStartedAt = Date.now()
    const identityRows = await prisma.$queryRaw`SELECT current_database() AS database_name`
    databaseName = normalizeText(Array.isArray(identityRows) ? identityRows[0]?.database_name : "")
    if (args.expectedDatabase && databaseName !== args.expectedDatabase) {
      dbError = "database_identity_mismatch"
      throw new Error("database_identity_mismatch")
    }
    await prisma.$queryRaw`SELECT 1 AS ok`
    queryLatencyMs = Date.now() - queryStartedAt
    dbConnected = true

    const [queuedCount, temporaryCount, unmatchedCount, orphanSubmissionStudent, orphanSubmissionExercise, orphanGradeStudent] = await Promise.all([
      prisma.incomingExerciseResult.count({ where: { status: "queued" } }),
      prisma.incomingExerciseResult.count({ where: { status: "temporary" } }),
      prisma.incomingExerciseResult.count({ where: { matchedStudentRefId: null } }),
      prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "ExerciseSubmission" es LEFT JOIN "Student" s ON s.id = es."studentRefId" WHERE s.id IS NULL`,
      prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "ExerciseSubmission" es LEFT JOIN "Exercise" e ON e.id = es."exerciseRefId" WHERE e.id IS NULL`,
      prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "StudentGradeRecord" g LEFT JOIN "Student" s ON s.id = g."studentRefId" WHERE s.id IS NULL`,
    ])

    incomingCounts = {
      queued: Number(queuedCount || 0),
      temporary: Number(temporaryCount || 0),
      unmatched: Number(unmatchedCount || 0),
    }
    orphanCounts = {
      exerciseSubmissionMissingStudent: normalizeCountRow(orphanSubmissionStudent),
      exerciseSubmissionMissingExercise: normalizeCountRow(orphanSubmissionExercise),
      studentGradeRecordMissingStudent: normalizeCountRow(orphanGradeStudent),
    }
    checkCompleted = true
  } catch (error) {
    if (!dbError) dbError = error instanceof Error && error.message === "database_identity_mismatch"
      ? "database_identity_mismatch"
      : "database_check_failed"
  } finally {
    if (prisma) {
      try { await prisma.$disconnect() } catch {}
    }
  }

  const backupLatestPath = path.resolve(process.cwd(), normalizeText(args.backupLatestPath) || DEFAULT_BACKUP_LATEST_PATH)
  const backupLatest = readJsonFileSafe(backupLatestPath)
  const backupPathValue = normalizeText(backupLatest?.backupPath || backupLatest?.backupFile || "")
  const backupPath = backupPathValue ? path.resolve(process.cwd(), backupPathValue) : ""
  const lastBackupAt = resolveBackupTimestamp(backupLatest || {}, backupPath)
  const backupAgeMinutes = lastBackupAt
    ? Math.max(0, Math.round((Date.now() - Date.parse(lastBackupAt)) / 60000))
    : -1
  const backupIsStale = backupAgeMinutes < 0 || backupAgeMinutes > args.backupStaleMinutes

  const latestVacuum = readLatestIncomingVacuumSummary(args.vacuumReportDir)

  const dbStatus = !checkCompleted
    ? "error"
    : queryLatencyMs > args.maxQueryLatencyMs
      ? "warn"
      : "ok"
  const orphanTotal = orphanCounts.exerciseSubmissionMissingStudent
    + orphanCounts.exerciseSubmissionMissingExercise
    + orphanCounts.studentGradeRecordMissingStudent
  const orphanStatus = orphanTotal > args.maxOrphanCount ? "error" : "ok"
  const incomingStatus = incomingCounts.unmatched > args.maxIncomingUnmatched ? "warn" : "ok"
  const backupStatus = backupIsStale ? "warn" : "ok"

  let status = "ok"
  if (dbStatus === "error" || orphanStatus === "error") status = "error"
  else if (dbStatus === "warn" || incomingStatus === "warn" || backupStatus === "warn") status = "warn"

  return {
    status,
    checkedAt,
    thresholds,
    db: {
      status: dbStatus,
      connected: dbConnected,
      checkCompleted,
      database: databaseName,
      queryLatencyMs: queryLatencyMs >= 0 ? queryLatencyMs : null,
      error: dbError,
    },
    backup: {
      status: backupStatus,
      latestMetadataPath: backupLatestPath,
      latestBackupPath: backupPath || "",
      lastBackupAt,
      ageMinutes: backupAgeMinutes,
      staleThresholdMinutes: args.backupStaleMinutes,
      isStale: backupIsStale,
    },
    incoming: {
      status: incomingStatus,
      queuedCount: incomingCounts.queued,
      temporaryCount: incomingCounts.temporary,
      unmatchedCount: incomingCounts.unmatched,
      latestVacuumReportPath: latestVacuum.reportPath,
      lastIncomingVacuumAt: latestVacuum.lastIncomingVacuumAt,
      manualReviewCount: latestVacuum.manualReviewCount,
    },
    orphans: {
      status: orphanStatus,
      exerciseSubmissionMissingStudent: orphanCounts.exerciseSubmissionMissingStudent,
      exerciseSubmissionMissingExercise: orphanCounts.exerciseSubmissionMissingExercise,
      studentGradeRecordMissingStudent: orphanCounts.studentGradeRecordMissingStudent,
      total: orphanTotal,
    },
  }
}

/**
 * @returns {Promise<void>}
 */
async function run() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }
  const payload = await runHealthCheck(args)
  const outputPath = writeOutputFile(args.outputPath, payload)
  if (args.metricsOutputPath) {
    const metricsPath = path.resolve(process.cwd(), args.metricsOutputPath)
    fs.mkdirSync(path.dirname(metricsPath), { recursive: true })
    writeAtomicFile(metricsPath, formatPrometheusMetrics(payload, args.metricsEnvironment))
  }
  console.log(JSON.stringify({ ...payload, outputPath }, null, 2))
  if (payload.status === "error") process.exitCode = 1
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isDirectRun) {
  run().catch((error) => {
    const message = error instanceof Error ? normalizeText(error.message) || "Unknown error" : "Unknown error"
    console.error(`[db-health-check] ${message}`)
    process.exitCode = 1
  })
}

export {
  parseArgs,
  runHealthCheck,
  formatPrometheusMetrics,
}
