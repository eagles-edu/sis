#!/usr/bin/env node

import process from "node:process"

import { getSharedPrismaClient } from "../server/prisma-client-factory.mjs"

const AUTO_IMPORTED_EXERCISE_COMMENT_PREFIX = "auto-imported exercise score"

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function parseArgs(argv = []) {
  const args = {
    apply: false,
    deleteDuplicates: false,
    deleteAllAutoImport: false,
    limit: 0,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = normalizeText(argv[index])
    if (!token) continue

    if (token === "--apply") {
      args.apply = true
      continue
    }
    if (token === "--delete-duplicates") {
      args.deleteDuplicates = true
      continue
    }
    if (token === "--delete-all-auto-import") {
      args.deleteAllAutoImport = true
      continue
    }
    if (token === "--limit") {
      const raw = normalizeText(argv[index + 1])
      index += 1
      const parsed = Number.parseInt(raw, 10)
      if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid --limit value: ${raw || "(empty)"}`)
      args.limit = parsed
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
  console.log(`Usage: node tools/cleanup-auto-import-exercise-titles.mjs [options]

Options:
  --apply                   Execute updates/deletes. Without this flag, dry-run only.
  --delete-duplicates       When applying, delete duplicate auto-import rows after canonicalization.
  --delete-all-auto-import  When applying, delete all matching auto-import rows from StudentGradeRecord.
  --limit <n>               Max rows to process (0 means all, default: 0)
  --help, -h                Show help

Examples:
  node tools/cleanup-auto-import-exercise-titles.mjs
  node tools/cleanup-auto-import-exercise-titles.mjs --apply
  node tools/cleanup-auto-import-exercise-titles.mjs --apply --delete-duplicates
  node tools/cleanup-auto-import-exercise-titles.mjs --apply --delete-all-auto-import
`)
}

function canonicalizeExerciseTitle(value) {
  let title = normalizeText(value)
  if (!title) return ""

  try {
    if (/%[0-9a-f]{2}/iu.test(title)) {
      const decoded = decodeURIComponent(title)
      if (normalizeText(decoded)) title = normalizeText(decoded)
    }
  } catch {
    // keep original title when URI decode fails
  }

  if (/^https?:\/\//iu.test(title)) {
    try {
      const parsed = new URL(title)
      const segments = parsed.pathname
        .split("/")
        .map((entry) => normalizeText(entry))
        .filter(Boolean)
      const lastSegment = segments.length ? segments[segments.length - 1] : ""
      if (lastSegment) title = lastSegment
    } catch {
      // keep original title when URL parse fails
    }
  }

  title = title
    .replace(/[?#].*$/u, "")
    .replace(/\.(?:html?|php|aspx?)$/iu, "")
    .replace(/[-_]+/gu, " ")
    .replace(/\s+\|\s+(?:id|sid|ref|session|attempt|timestamp|time|date)\s*[:=#-].*$/iu, "")
    .replace(/\s+/gu, " ")
    .trim()

  return normalizeText(title)
}

function isoKey(value) {
  if (!(value instanceof Date)) {
    const parsed = new Date(value)
    if (!Number.isFinite(parsed.valueOf())) return ""
    return parsed.toISOString()
  }
  if (!Number.isFinite(value.valueOf())) return ""
  return value.toISOString()
}

function recordGroupKey(row, canonicalName) {
  return [
    normalizeText(row?.studentRefId),
    normalizeText(canonicalName),
    normalizeText(row?.schoolYear),
    normalizeText(row?.quarter),
    isoKey(row?.dueAt),
    isoKey(row?.submittedAt),
  ].join("|")
}

function scoreRecordRank(row) {
  const score = Number(row?.score)
  const maxScore = Number(row?.maxScore)
  const completed = row?.homeworkCompleted === true ? 1 : 0
  const onTime = row?.homeworkOnTime === true ? 1 : 0
  const submittedAtMs = Number.isFinite(new Date(row?.submittedAt).valueOf()) ? new Date(row.submittedAt).valueOf() : 0
  const updatedAtMs = Number.isFinite(new Date(row?.updatedAt).valueOf()) ? new Date(row.updatedAt).valueOf() : 0
  const createdAtMs = Number.isFinite(new Date(row?.createdAt).valueOf()) ? new Date(row.createdAt).valueOf() : 0
  const commentsLen = normalizeText(row?.comments).length

  return [
    Number.isFinite(score) ? 1 : 0,
    Number.isFinite(score) ? score : -1,
    Number.isFinite(maxScore) ? maxScore : -1,
    completed,
    onTime,
    submittedAtMs,
    updatedAtMs,
    createdAtMs,
    commentsLen,
  ]
}

function compareRanksDesc(leftRow, rightRow) {
  const left = scoreRecordRank(leftRow)
  const right = scoreRecordRank(rightRow)
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === right[index]) continue
    return right[index] - left[index]
  }
  return normalizeText(rightRow?.id).localeCompare(normalizeText(leftRow?.id))
}

function selectDuplicateDeletes(rows = []) {
  const groups = new Map()
  rows.forEach((row) => {
    const canonicalName = canonicalizeExerciseTitle(normalizeText(row?.assignmentName) || normalizeText(row?.className)) || "Untitled exercise"
    const key = recordGroupKey(row, canonicalName)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  })

  const deleteIds = []
  groups.forEach((items) => {
    if (!Array.isArray(items) || items.length <= 1) return
    const sorted = [...items].sort(compareRanksDesc)
    sorted.slice(1).forEach((row) => {
      const id = normalizeText(row?.id)
      if (id) deleteIds.push(id)
    })
  })

  return deleteIds
}

async function run() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  const prisma = await getSharedPrismaClient()

  const rows = await prisma.studentGradeRecord.findMany({
    where: {
      comments: {
        startsWith: "Auto-imported exercise score",
        mode: "insensitive",
      },
    },
    orderBy: [{ createdAt: "asc" }],
    take: args.limit > 0 ? args.limit : undefined,
    select: {
      id: true,
      studentRefId: true,
      schoolYear: true,
      quarter: true,
      assignmentName: true,
      className: true,
      dueAt: true,
      submittedAt: true,
      score: true,
      maxScore: true,
      homeworkCompleted: true,
      homeworkOnTime: true,
      comments: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  const updates = []
  rows.forEach((row) => {
    const originalAssignment = normalizeText(row?.assignmentName)
    const originalClass = normalizeText(row?.className)
    const fallback = originalAssignment || originalClass || "Untitled exercise"
    const canonical = canonicalizeExerciseTitle(fallback) || "Untitled exercise"

    const needsAssignmentUpdate = originalAssignment !== canonical
    const needsClassUpdate = originalClass !== canonical
    if (needsAssignmentUpdate || needsClassUpdate) {
      updates.push({
        id: normalizeText(row?.id),
        assignmentName: canonical,
        className: canonical,
        beforeAssignment: originalAssignment,
        beforeClass: originalClass,
      })
    }
  })

  const duplicateDeletes = selectDuplicateDeletes(rows)

  const summary = {
    mode: args.apply ? "apply" : "dry-run",
    processedRows: rows.length,
    noisyRows: updates.length,
    duplicateCandidates: duplicateDeletes.length,
    deleteDuplicates: args.deleteDuplicates,
    deleteAllAutoImport: args.deleteAllAutoImport,
    sampleUpdates: updates.slice(0, 20),
    sampleDeleteIds: duplicateDeletes.slice(0, 20),
  }

  if (!args.apply) {
    console.log(JSON.stringify(summary, null, 2))
    await prisma.$disconnect()
    return
  }

  let updatedCount = 0
  for (let index = 0; index < updates.length; index += 1) {
    const update = updates[index]
    if (!update.id) continue
    await prisma.studentGradeRecord.update({
      where: { id: update.id },
      data: {
        assignmentName: update.assignmentName,
        className: update.className,
      },
    })
    updatedCount += 1
  }

  let deletedCount = 0
  if (args.deleteAllAutoImport) {
    const idsToDelete = rows
      .map((row) => normalizeText(row?.id))
      .filter(Boolean)
    for (let index = 0; index < idsToDelete.length; index += 1) {
      await prisma.studentGradeRecord.delete({ where: { id: idsToDelete[index] } })
      deletedCount += 1
    }
  } else if (args.deleteDuplicates) {
    for (let index = 0; index < duplicateDeletes.length; index += 1) {
      const id = normalizeText(duplicateDeletes[index])
      if (!id) continue
      await prisma.studentGradeRecord.delete({ where: { id } })
      deletedCount += 1
    }
  }

  console.log(
    JSON.stringify(
      {
        ...summary,
        applied: {
          updatedRows: updatedCount,
          deletedRows: deletedCount,
        },
      },
      null,
      2,
    ),
  )

  await prisma.$disconnect()
}

run().catch((error) => {
  const message = normalizeText(error?.message) || "Unknown error"
  console.error(`[cleanup-auto-import] ${message}`)
  process.exitCode = 1
})
