#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

import { getSharedPrismaClient } from "../server/prisma-client-factory.mjs"
import {
  deleteIncomingExerciseResultById,
  resolveIncomingExerciseResultToStudent,
} from "../server/exercise-store.mjs"

const STATUS_QUEUED = "queued"
const STATUS_TEMPORARY = "temporary"
const STATUS_RESOLVED = "resolved"
const STATUS_ARCHIVED = "archived"
const ALL_ACTIVE_STATUSES = Object.freeze([STATUS_QUEUED, STATUS_TEMPORARY])
const DEFAULT_REPORT_DIR = "runtime-data/maintenance-reports"
const DEFAULT_REVIEWED_BY = "system:incoming-vacuum"
const DEFAULT_PURGE_DAYS = 45
const DEFAULT_REPORT_RETENTION_DAYS = 30

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase()
}

function normalizeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseArgs(argv = []) {
  const args = {
    apply: false,
    deleteUnmatched: true,
    deleteMalformed: true,
    purgeResolvedDays: DEFAULT_PURGE_DAYS,
    purgeArchivedDays: DEFAULT_PURGE_DAYS,
    reportRetentionDays: DEFAULT_REPORT_RETENTION_DAYS,
    reportDir: DEFAULT_REPORT_DIR,
    reviewedByUsername: DEFAULT_REVIEWED_BY,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = normalizeText(argv[index])
    if (!token) continue

    if (token === "--apply") {
      args.apply = true
      continue
    }
    if (token === "--delete-unmatched") {
      args.deleteUnmatched = true
      continue
    }
    if (token === "--keep-unmatched") {
      args.deleteUnmatched = false
      continue
    }
    if (token === "--delete-malformed") {
      args.deleteMalformed = true
      continue
    }
    if (token === "--keep-malformed") {
      args.deleteMalformed = false
      continue
    }
    if (token === "--purge-resolved-days") {
      index += 1
      args.purgeResolvedDays = Math.max(0, normalizeInteger(argv[index], DEFAULT_PURGE_DAYS))
      continue
    }
    if (token === "--purge-archived-days") {
      index += 1
      args.purgeArchivedDays = Math.max(0, normalizeInteger(argv[index], DEFAULT_PURGE_DAYS))
      continue
    }
    if (token === "--report-retention-days") {
      index += 1
      args.reportRetentionDays = Math.max(0, normalizeInteger(argv[index], DEFAULT_REPORT_RETENTION_DAYS))
      continue
    }
    if (token === "--report-dir") {
      index += 1
      const dir = normalizeText(argv[index])
      if (!dir) throw new Error("--report-dir requires a value")
      args.reportDir = dir
      continue
    }
    if (token === "--reviewed-by") {
      index += 1
      const reviewer = normalizeText(argv[index])
      if (!reviewer) throw new Error("--reviewed-by requires a value")
      args.reviewedByUsername = reviewer
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
  console.log(`Usage: node tools/vacuum-incoming-exercise-results.mjs [options]

Options:
  --apply                   Execute write actions. Default is dry-run.
  --delete-unmatched        Delete unmatched/ambiguous rows after analysis (default: true)
  --keep-unmatched          Keep unmatched/ambiguous rows for manual disposition
  --delete-malformed        Delete malformed rows after analysis (default: true)
  --keep-malformed          Keep malformed rows for manual disposition
  --purge-resolved-days N   Delete resolved rows older than N days (default: ${DEFAULT_PURGE_DAYS})
  --purge-archived-days N   Delete archived rows older than N days (default: ${DEFAULT_PURGE_DAYS})
  --report-retention-days N Delete report files older than N days (default: ${DEFAULT_REPORT_RETENTION_DAYS}; 0 disables pruning)
  --report-dir PATH         Report directory (default: ${DEFAULT_REPORT_DIR})
  --reviewed-by USERNAME    Metadata username for auto-resolve (default: ${DEFAULT_REVIEWED_BY})
  --help, -h                Show help

Examples:
  node tools/vacuum-incoming-exercise-results.mjs
  node tools/vacuum-incoming-exercise-results.mjs --apply
  node tools/vacuum-incoming-exercise-results.mjs --apply --keep-unmatched
`)
}

function toIso(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.valueOf())) return ""
  return date.toISOString()
}

function incomingFingerprint(row = {}) {
  return [
    normalizeLower(row.submittedEaglesId),
    normalizeLower(row.submittedEmail),
    normalizeLower(row.pageTitle),
    toIso(row.completedAt),
  ].join("|")
}

export function isIncomingMalformed(row = {}) {
  const submittedEaglesId = normalizeText(row.submittedEaglesId)
  const submittedEmail = normalizeText(row.submittedEmail)
  const pageTitle = normalizeText(row.pageTitle)
  const completedAtIso = toIso(row.completedAt)
  const totalQuestions = Number(row.totalQuestions)
  const correctCount = Number(row.correctCount)
  const pendingCount = Number(row.pendingCount)
  const incorrectCount = Number(row.incorrectCount)

  if (!submittedEaglesId && !submittedEmail) return true
  if (!pageTitle) return true
  if (!completedAtIso) return true
  if (!Number.isFinite(totalQuestions) || totalQuestions < 0) return true
  if (!Number.isFinite(correctCount) || !Number.isFinite(pendingCount) || !Number.isFinite(incorrectCount)) return true
  if (correctCount < 0 || pendingCount < 0 || incorrectCount < 0) return true
  if (totalQuestions !== correctCount + pendingCount + incorrectCount) return true
  return false
}

async function resolveStudentCandidate(prisma, row = {}) {
  const submittedEaglesId = normalizeText(row.submittedEaglesId)
  const submittedEmail = normalizeLower(row.submittedEmail)

  if (submittedEaglesId) {
    const matchedById = await prisma.student.findFirst({
      where: {
        eaglesId: {
          equals: submittedEaglesId,
          mode: "insensitive",
        },
      },
      select: {
        id: true,
        eaglesId: true,
      },
    })
    if (matchedById) {
      return {
        student: matchedById,
        reason: "matched-by-eaglesId",
      }
    }
  }

  if (!submittedEmail) {
    return {
      student: null,
      reason: "no-student-match",
    }
  }

  const matchedByEmail = await prisma.student.findMany({
    where: {
      OR: [
        {
          email: {
            equals: submittedEmail,
            mode: "insensitive",
          },
        },
        {
          profile: {
            is: {
              OR: [
                {
                  studentEmail: {
                    equals: submittedEmail,
                    mode: "insensitive",
                  },
                },
                {
                  motherEmail: {
                    equals: submittedEmail,
                    mode: "insensitive",
                  },
                },
                {
                  fatherEmail: {
                    equals: submittedEmail,
                    mode: "insensitive",
                  },
                },
                {
                  signatureEmail: {
                    equals: submittedEmail,
                    mode: "insensitive",
                  },
                },
              ],
            },
          },
        },
      ],
    },
    select: {
      id: true,
      eaglesId: true,
    },
    take: 3,
  })

  if (matchedByEmail.length === 1) {
    return {
      student: matchedByEmail[0],
      reason: "matched-by-email",
    }
  }

  if (matchedByEmail.length > 1) {
    return {
      student: null,
      reason: "ambiguous-student-match",
    }
  }

  return {
    student: null,
    reason: "no-student-match",
  }
}

function resultSnapshot(row = {}) {
  return {
    id: normalizeText(row.id),
    status: normalizeText(row.status),
    submittedEaglesId: normalizeText(row.submittedEaglesId),
    submittedEmail: normalizeText(row.submittedEmail),
    pageTitle: normalizeText(row.pageTitle),
    completedAt: toIso(row.completedAt),
    totalQuestions: Number(row.totalQuestions || 0),
    correctCount: Number(row.correctCount || 0),
    pendingCount: Number(row.pendingCount || 0),
    incorrectCount: Number(row.incorrectCount || 0),
    createdAt: toIso(row.createdAt),
  }
}

function classifyAction(row, context = {}) {
  const malformed = isIncomingMalformed(row)
  if (context.isDuplicate) {
    return {
      action: "delete",
      reason: "duplicate-incoming",
      malformed,
    }
  }
  if (malformed) {
    return {
      action: context.deleteMalformed ? "delete" : "manual",
      reason: "malformed-incoming",
      malformed: true,
    }
  }
  if (context.studentCandidate) {
    return {
      action: "resolve",
      reason: context.candidateReason || "matched",
      malformed: false,
    }
  }
  if (context.deleteUnmatched) {
    return {
      action: "delete",
      reason: context.candidateReason || "no-student-match",
      malformed: false,
    }
  }
  return {
    action: "manual",
    reason: context.candidateReason || "no-student-match",
    malformed: false,
  }
}

function timestampLabel() {
  const date = new Date()
  const pad2 = (value) => String(value).padStart(2, "0")
  return [
    date.getUTCFullYear(),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate()),
    "-",
    pad2(date.getUTCHours()),
    pad2(date.getUTCMinutes()),
    pad2(date.getUTCSeconds()),
    "Z",
  ].join("")
}

function ensureDirectory(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true })
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function sortRowsById(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .slice()
    .sort((left, right) => normalizeText(left?.id).localeCompare(normalizeText(right?.id)))
}

function pruneOldReports(reportDir, retentionDays, keepFilePath = "") {
  const days = Math.max(0, Number.parseInt(String(retentionDays), 10) || 0)
  if (days < 1) return 0
  const thresholdMs = Date.now() - days * 24 * 60 * 60 * 1000
  let deleted = 0
  const keepPath = normalizeText(keepFilePath)
  const keepResolved = keepPath ? path.resolve(keepPath) : ""
  let entries
  try {
    entries = fs.readdirSync(reportDir)
  } catch {
    return 0
  }
  entries
    .filter((entry) => /^incoming-vacuum-[0-9]{8}-[0-9]{6}Z\.json$/u.test(entry))
    .forEach((entry) => {
      const fullPath = path.resolve(reportDir, entry)
      if (keepResolved && fullPath === keepResolved) return
      let stat
      try {
        stat = fs.statSync(fullPath)
      } catch {
        return
      }
      const mtimeMs = Number.isFinite(stat?.mtimeMs) ? stat.mtimeMs : 0
      if (mtimeMs <= 0 || mtimeMs >= thresholdMs) return
      try {
        fs.unlinkSync(fullPath)
        deleted += 1
      } catch {
        // keep file when delete fails
      }
    })
  return deleted
}

async function collectOrphanSignals(prisma) {
  const [
    danglingSubmissionStudent,
    danglingSubmissionExercise,
    danglingGradeStudent,
  ] = await Promise.all([
    prisma.$queryRaw`SELECT id FROM "ExerciseSubmission" es LEFT JOIN "Student" s ON s.id = es."studentRefId" WHERE s.id IS NULL LIMIT 20`,
    prisma.$queryRaw`SELECT id FROM "ExerciseSubmission" es LEFT JOIN "Exercise" e ON e.id = es."exerciseRefId" WHERE e.id IS NULL LIMIT 20`,
    prisma.$queryRaw`SELECT id FROM "StudentGradeRecord" g LEFT JOIN "Student" s ON s.id = g."studentRefId" WHERE s.id IS NULL LIMIT 20`,
  ])

  return {
    danglingExerciseSubmissionStudentRefIds: Array.isArray(danglingSubmissionStudent)
      ? danglingSubmissionStudent.map((entry) => normalizeText(entry?.id)).filter(Boolean)
      : [],
    danglingExerciseSubmissionExerciseRefIds: Array.isArray(danglingSubmissionExercise)
      ? danglingSubmissionExercise.map((entry) => normalizeText(entry?.id)).filter(Boolean)
      : [],
    danglingGradeRecordStudentRefIds: Array.isArray(danglingGradeStudent)
      ? danglingGradeStudent.map((entry) => normalizeText(entry?.id)).filter(Boolean)
      : [],
  }
}

async function runVacuum(args) {
  const prisma = await getSharedPrismaClient()
  const now = new Date()
  const reportItems = []
  const manualReview = []
  const resolvedItems = []
  const deletedItems = []
  let mode = "dry-run"
  let purgedResolvedCount = 0
  let purgedArchivedCount = 0
  let orphanSignals

  try {
    const activeRows = await prisma.incomingExerciseResult.findMany({
      where: {
        status: {
          in: ALL_ACTIVE_STATUSES,
        },
        matchedStudentRefId: null,
      },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        status: true,
        submittedEaglesId: true,
        submittedEmail: true,
        pageTitle: true,
        completedAt: true,
        totalQuestions: true,
        correctCount: true,
        pendingCount: true,
        incorrectCount: true,
        createdAt: true,
      },
    })

    const keepByFingerprint = new Map()
    const duplicateIds = new Set()
    for (let index = 0; index < activeRows.length; index += 1) {
      const row = activeRows[index]
      const key = incomingFingerprint(row)
      if (!keepByFingerprint.has(key)) {
        keepByFingerprint.set(key, row.id)
      } else {
        duplicateIds.add(normalizeText(row.id))
      }
    }

    for (let index = 0; index < activeRows.length; index += 1) {
      const row = activeRows[index]
      const id = normalizeText(row.id)
      const isDuplicate = duplicateIds.has(id)
      const candidate = isDuplicate ? { student: null, reason: "duplicate-incoming" } : await resolveStudentCandidate(prisma, row)
      const studentCandidate = candidate?.student || null
      const actionPlan = classifyAction(row, {
        isDuplicate,
        studentCandidate,
        candidateReason: candidate?.reason,
        deleteUnmatched: args.deleteUnmatched,
        deleteMalformed: args.deleteMalformed,
      })

      reportItems.push({
        ...resultSnapshot(row),
        action: actionPlan.action,
        reason: actionPlan.reason,
        malformed: actionPlan.malformed,
        studentCandidate: studentCandidate
          ? {
              id: normalizeText(studentCandidate.id),
              eaglesId: normalizeText(studentCandidate.eaglesId),
            }
          : null,
      })
    }

    for (let index = 0; index < reportItems.length; index += 1) {
      const item = reportItems[index]
      if (item.action === "manual") {
        manualReview.push(item)
      }
    }

    if (args.apply) {
      mode = "apply"
      for (let index = 0; index < reportItems.length; index += 1) {
        const item = reportItems[index]
        if (item.action === "resolve" && item.studentCandidate) {
          try {
            const resolved = await resolveIncomingExerciseResultToStudent(
              item.id,
              item.studentCandidate.id,
              {
                prisma,
                reviewedByUsername: args.reviewedByUsername,
                notes: `Auto-resolved by incoming vacuum on ${now.toISOString()}`,
              },
            )
            resolvedItems.push({
              id: item.id,
              studentRefId: normalizeText(resolved?.studentRefId),
              eaglesId: normalizeText(resolved?.eaglesId),
              reason: item.reason,
            })
          } catch (error) {
            manualReview.push({
              ...item,
              action: "manual",
              reason: `resolve-failed:${normalizeText(error?.message) || "unknown-error"}`,
            })
          }
          continue
        }
        if (item.action === "delete") {
          await deleteIncomingExerciseResultById(item.id, { prisma })
          deletedItems.push({
            id: item.id,
            reason: item.reason,
          })
        }
      }

      const resolvedThreshold = new Date(now.getTime() - args.purgeResolvedDays * 24 * 60 * 60 * 1000)
      const archivedThreshold = new Date(now.getTime() - args.purgeArchivedDays * 24 * 60 * 60 * 1000)
      const [purgedResolved, purgedArchived] = await Promise.all([
        prisma.incomingExerciseResult.deleteMany({
          where: {
            status: STATUS_RESOLVED,
            resolvedAt: {
              lt: resolvedThreshold,
            },
          },
        }),
        prisma.incomingExerciseResult.deleteMany({
          where: {
            status: STATUS_ARCHIVED,
            updatedAt: {
              lt: archivedThreshold,
            },
          },
        }),
      ])

      purgedResolvedCount = Number(purgedResolved?.count || 0)
      purgedArchivedCount = Number(purgedArchived?.count || 0)
    }
  } finally {
    orphanSignals = await collectOrphanSignals(prisma).catch(() => ({
      danglingExerciseSubmissionStudentRefIds: [],
      danglingExerciseSubmissionExerciseRefIds: [],
      danglingGradeRecordStudentRefIds: [],
    }))
    await prisma.$disconnect()
  }

  return {
    runStartedAt: now.toISOString(),
    mode,
    options: {
      deleteUnmatched: args.deleteUnmatched,
      deleteMalformed: args.deleteMalformed,
      purgeResolvedDays: args.purgeResolvedDays,
      purgeArchivedDays: args.purgeArchivedDays,
    },
    purgedResolvedCount,
    purgedArchivedCount,
    manualReview: sortRowsById(manualReview),
    reportItems: sortRowsById(reportItems),
    resolvedItems: sortRowsById(resolvedItems),
    deletedItems: sortRowsById(deletedItems),
    orphanSignals: orphanSignals || {
      danglingExerciseSubmissionStudentRefIds: [],
      danglingExerciseSubmissionExerciseRefIds: [],
      danglingGradeRecordStudentRefIds: [],
    },
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  const reportDir = path.resolve(process.cwd(), normalizeText(args.reportDir) || DEFAULT_REPORT_DIR)
  ensureDirectory(reportDir)

  const header = {
    runStartedAt: new Date().toISOString(),
    mode: args.apply ? "apply" : "dry-run",
    options: {
      deleteUnmatched: args.deleteUnmatched,
      deleteMalformed: args.deleteMalformed,
      purgeResolvedDays: args.purgeResolvedDays,
      purgeArchivedDays: args.purgeArchivedDays,
      reportRetentionDays: args.reportRetentionDays,
      reviewedByUsername: args.reviewedByUsername,
    },
  }

  const execution = await runVacuum(args)
  const report = {
    ...header,
    ...execution,
  }

  const fileName = `incoming-vacuum-${timestampLabel()}.json`
  const reportPath = path.join(reportDir, fileName)
  writeJsonFile(reportPath, report)
  const prunedReportCount = pruneOldReports(reportDir, args.reportRetentionDays, reportPath)

  const summary = {
    mode: report.mode,
    reportPath,
    reportPrunedCount: prunedReportCount,
    unresolvedQueueScanned: Array.isArray(report.reportItems) ? report.reportItems.length : 0,
    resolvedCount: Array.isArray(report.resolvedItems) ? report.resolvedItems.length : 0,
    deletedCount: Array.isArray(report.deletedItems) ? report.deletedItems.length : 0,
    manualReviewCount: Array.isArray(report.manualReview) ? report.manualReview.length : 0,
    purgedResolvedCount: Number(report.purgedResolvedCount || 0),
    purgedArchivedCount: Number(report.purgedArchivedCount || 0),
    orphanSignals: report.orphanSignals,
  }

  console.log(JSON.stringify(summary, null, 2))
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isDirectRun) {
  run().catch((error) => {
    const message = normalizeText(error?.message) || "Unknown error"
    console.error(`[incoming-vacuum] ${message}`)
    process.exitCode = 1
  })
}

export {
  classifyAction,
  incomingFingerprint,
  parseArgs,
}
