#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

import { getSharedPrismaClient } from "../server/prisma-client-factory.mjs"

const DEFAULT_OUTPUT_PATH = "runtime-data/maintenance/db-health-status.json"
const DEFAULT_BACKUP_LATEST_PATH = "backups/postgres/latest.json"
const DEFAULT_VACUUM_REPORT_DIR = "runtime-data/maintenance-reports"
const DEFAULT_BACKUP_STALE_MINUTES = 26 * 60
const DEFAULT_MAX_QUERY_LATENCY_MS = 500
const DEFAULT_MAX_INCOMING_UNMATCHED = 0
const DEFAULT_MAX_ORPHAN_COUNT = 0

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function normalizeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function safeIsoDate(value) {
  if (value === undefined || value === null || value === "") return ""
  const date = new Date(value)
  if (!Number.isFinite(date.valueOf())) return ""
  return date.toISOString()
}

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

function parseArgs(argv = []) {
  const args = {
    outputPath: DEFAULT_OUTPUT_PATH,
    backupLatestPath: DEFAULT_BACKUP_LATEST_PATH,
    vacuumReportDir: DEFAULT_VACUUM_REPORT_DIR,
    backupStaleMinutes: DEFAULT_BACKUP_STALE_MINUTES,
    maxQueryLatencyMs: DEFAULT_MAX_QUERY_LATENCY_MS,
    maxIncomingUnmatched: DEFAULT_MAX_INCOMING_UNMATCHED,
    maxOrphanCount: DEFAULT_MAX_ORPHAN_COUNT,
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
  --help, -h                    Show help
`)
}

function normalizeCountRow(rows) {
  if (!Array.isArray(rows) || !rows[0]) return 0
  return Number.parseInt(String(rows[0].count || 0), 10) || 0
}

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
  const manualReviewCount = Number.isFinite(Number(report?.manualReviewCount))
    ? Number(report.manualReviewCount)
    : Array.isArray(report?.manualReview)
      ? report.manualReview.length
      : 0
  return {
    reportPath: latestReportPath,
    lastIncomingVacuumAt: safeIsoDate(report?.runStartedAt || report?.checkedAt || report?.createdAt),
    manualReviewCount: Math.max(0, Number.parseInt(String(manualReviewCount), 10) || 0),
  }
}

function writeOutputFile(outputPath, payload) {
  const resolved = path.resolve(process.cwd(), outputPath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  return resolved
}

async function runHealthCheck(args) {
  const prisma = await getSharedPrismaClient()
  const checkedAt = new Date().toISOString()
  const thresholds = {
    backupStaleMinutes: args.backupStaleMinutes,
    maxQueryLatencyMs: args.maxQueryLatencyMs,
    maxIncomingUnmatched: args.maxIncomingUnmatched,
    maxOrphanCount: args.maxOrphanCount,
  }

  let dbConnected = false
  let dbError = ""
  let queryLatencyMs = -1
  let incomingCounts = {
    queued: 0,
    temporary: 0,
    unmatched: 0,
  }
  let orphanCounts = {
    exerciseSubmissionMissingStudent: 0,
    exerciseSubmissionMissingExercise: 0,
    studentGradeRecordMissingStudent: 0,
  }

  try {
    const queryStartedAt = Date.now()
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
  } catch (error) {
    dbError = normalizeText(error?.message) || "db-health-check-failed"
  } finally {
    await prisma.$disconnect()
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

  const dbStatus = !dbConnected
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

async function run() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }
  const payload = await runHealthCheck(args)
  const outputPath = writeOutputFile(args.outputPath, payload)
  console.log(JSON.stringify({ ...payload, outputPath }, null, 2))
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isDirectRun) {
  run().catch((error) => {
    const message = normalizeText(error?.message) || "Unknown error"
    console.error(`[db-health-check] ${message}`)
    process.exitCode = 1
  })
}

export {
  parseArgs,
  runHealthCheck,
}
