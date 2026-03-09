import { getSharedPrismaClient } from "../server/prisma-client-factory.mjs"

const DUPLICATE_WINDOW_MS = 1500
const AUTO_IMPORTED_EXERCISE_COMMENT_PREFIX = "Auto-imported exercise score"

function normalizeText(value) {
  if (value === undefined || value === null) return ""
  return String(value).trim()
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase()
}

function toDate(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) return null
  return parsed
}

function parseArgs(argv = []) {
  return {
    apply: argv.includes("--apply"),
  }
}

function isAutoImportFingerprintRow(row) {
  const assignmentName = normalizeLower(row?.assignmentName)
  const className = normalizeLower(row?.className)
  if (!assignmentName || !className) return false
  if (assignmentName !== className) return false

  const dueAt = toDate(row?.dueAt)
  const submittedAt = toDate(row?.submittedAt)
  if (!dueAt || !submittedAt) return false
  if (Math.abs(dueAt.valueOf() - submittedAt.valueOf()) > DUPLICATE_WINDOW_MS) return false

  const completed = row?.homeworkCompleted === true
  const maxScore = Number(row?.maxScore)
  if (!completed || !Number.isFinite(maxScore) || maxScore <= 0) return false

  const comments = normalizeLower(row?.comments)
  return comments.startsWith(normalizeLower(AUTO_IMPORTED_EXERCISE_COMMENT_PREFIX))
}

function compareRowsByQuality(left, right) {
  const leftScore = Number.isFinite(Number(left?.score)) ? Number(left.score) : -1
  const rightScore = Number.isFinite(Number(right?.score)) ? Number(right.score) : -1
  if (leftScore !== rightScore) return rightScore - leftScore

  const leftMaxScore = Number.isFinite(Number(left?.maxScore)) ? Number(left.maxScore) : -1
  const rightMaxScore = Number.isFinite(Number(right?.maxScore)) ? Number(right.maxScore) : -1
  if (leftMaxScore !== rightMaxScore) return rightMaxScore - leftMaxScore

  const leftCreatedAt = toDate(left?.createdAt)?.valueOf() || 0
  const rightCreatedAt = toDate(right?.createdAt)?.valueOf() || 0
  if (leftCreatedAt !== rightCreatedAt) return rightCreatedAt - leftCreatedAt

  return normalizeText(right?.id).localeCompare(normalizeText(left?.id))
}

function splitByDuplicateWindow(rows = []) {
  const sorted = [...rows].sort((left, right) => {
    const leftDueAt = toDate(left?.dueAt)?.valueOf() || 0
    const rightDueAt = toDate(right?.dueAt)?.valueOf() || 0
    if (leftDueAt !== rightDueAt) return leftDueAt - rightDueAt

    const leftCreatedAt = toDate(left?.createdAt)?.valueOf() || 0
    const rightCreatedAt = toDate(right?.createdAt)?.valueOf() || 0
    if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt - rightCreatedAt

    return normalizeText(left?.id).localeCompare(normalizeText(right?.id))
  })

  const groups = []
  let currentGroup = []
  for (const row of sorted) {
    const dueAt = toDate(row?.dueAt)
    if (!dueAt) continue

    if (!currentGroup.length) {
      currentGroup.push(row)
      continue
    }

    const previous = currentGroup[currentGroup.length - 1]
    const previousDueAt = toDate(previous?.dueAt)
    const delta = previousDueAt ? Math.abs(dueAt.valueOf() - previousDueAt.valueOf()) : Number.MAX_SAFE_INTEGER
    if (delta <= DUPLICATE_WINDOW_MS) {
      currentGroup.push(row)
      continue
    }

    groups.push(currentGroup)
    currentGroup = [row]
  }

  if (currentGroup.length) groups.push(currentGroup)
  return groups
}

async function main() {
  const { apply } = parseArgs(process.argv.slice(2))
  const prisma = await getSharedPrismaClient()
  try {
    const rows = await prisma.studentGradeRecord.findMany({
      where: {
        dueAt: { not: null },
        submittedAt: { not: null },
        homeworkCompleted: true,
        maxScore: { gt: 0 },
        comments: {
          startsWith: AUTO_IMPORTED_EXERCISE_COMMENT_PREFIX,
          mode: "insensitive",
        },
      },
      select: {
        id: true,
        studentRefId: true,
        className: true,
        assignmentName: true,
        dueAt: true,
        submittedAt: true,
        score: true,
        maxScore: true,
        homeworkCompleted: true,
        comments: true,
        createdAt: true,
      },
      orderBy: [
        { studentRefId: "asc" },
        { assignmentName: "asc" },
        { className: "asc" },
        { dueAt: "asc" },
        { createdAt: "asc" },
        { id: "asc" },
      ],
    })

    const fingerprintRows = rows.filter((row) => isAutoImportFingerprintRow(row))
    const grouped = new Map()
    for (const row of fingerprintRows) {
      const key = [
        normalizeText(row.studentRefId),
        normalizeLower(row.assignmentName),
        normalizeLower(row.className),
      ].join("|")
      const list = grouped.get(key) || []
      list.push(row)
      grouped.set(key, list)
    }

    const winnerIds = new Set()
    const loserIds = new Set()
    const sample = []
    let duplicateGroups = 0
    for (const rowsByKey of grouped.values()) {
      const windows = splitByDuplicateWindow(rowsByKey)
      for (const windowRows of windows) {
        if (windowRows.length < 2) continue
        duplicateGroups += 1
        const ranked = [...windowRows].sort(compareRowsByQuality)
        const winner = ranked[0]
        winnerIds.add(winner.id)
        for (let index = 1; index < ranked.length; index += 1) {
          loserIds.add(ranked[index].id)
        }
        if (sample.length < 20) {
          sample.push({
            studentRefId: winner.studentRefId,
            assignmentName: winner.assignmentName,
            className: winner.className,
            dueAt: toDate(winner.dueAt)?.toISOString() || "",
            kept: `${winner.id} (${winner.score ?? ""}/${winner.maxScore ?? ""})`,
            removed: ranked
              .slice(1)
              .map((entry) => `${entry.id} (${entry.score ?? ""}/${entry.maxScore ?? ""})`),
          })
        }
      }
    }

    const loserIdList = Array.from(loserIds)
    let deletedCount = 0
    if (apply && loserIdList.length > 0) {
      const deleted = await prisma.studentGradeRecord.deleteMany({
        where: {
          id: {
            in: loserIdList,
          },
        },
      })
      deletedCount = Number(deleted?.count || 0)
    }

    console.log(
      JSON.stringify(
        {
          mode: apply ? "apply" : "dry-run",
          duplicateWindowMs: DUPLICATE_WINDOW_MS,
          totalCandidateRows: rows.length,
          fingerprintRows: fingerprintRows.length,
          duplicateGroups,
          keepCount: winnerIds.size,
          deleteCountPlanned: loserIdList.length,
          deleteCountApplied: deletedCount,
          sample,
        },
        null,
        2
      )
    )
  } finally {
    await prisma.$disconnect()
  }
}

main()
