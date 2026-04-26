import { getSharedPrismaClient } from "../server/prisma-client-factory.mjs"

function normalizePositiveInteger(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10)
  if (!Number.isFinite(parsed) || parsed < 1) return null
  return parsed
}

const STUDENT_NUMBER_START = Math.max(
  100,
  normalizePositiveInteger(process.env.STUDENT_NUMBER_START) || 100
)

function parseArgs(argv = []) {
  return {
    dryRun: argv.includes("--dry-run"),
  }
}

async function main() {
  const { dryRun } = parseArgs(process.argv.slice(2))
  const prisma = await getSharedPrismaClient()
  try {
    const [existingRows, missingRows] = await Promise.all([
      prisma.student.findMany({
        where: {
          studentNumber: {
            gte: 1,
          },
        },
        select: {
          studentNumber: true,
        },
      }),
      prisma.student.findMany({
        where: {
          OR: [{ studentNumber: null }, { studentNumber: { lt: 1 } }],
        },
        select: {
          id: true,
          eaglesId: true,
          studentNumber: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    ])

    const usedNumbers = new Set(
      existingRows
        .map((row) => normalizePositiveInteger(row.studentNumber))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
    let nextNumber = usedNumbers.size ? Math.max(...usedNumbers) + 1 : STUDENT_NUMBER_START
    if (nextNumber < STUDENT_NUMBER_START) nextNumber = STUDENT_NUMBER_START

    const planned = missingRows.map((row) => {
      while (usedNumbers.has(nextNumber)) nextNumber += 1
      const assigned = nextNumber
      usedNumbers.add(assigned)
      nextNumber += 1
      return {
        id: row.id,
        eaglesId: row.eaglesId,
        assignedStudentNumber: assigned,
      }
    })

    if (!dryRun && planned.length > 0) {
      await prisma.$transaction(
        planned.map((entry) =>
          prisma.student.update({
            where: { id: entry.id },
            data: { studentNumber: entry.assignedStudentNumber },
          })
        )
      )
    }

    const afterCount = await prisma.student.count({
      where: {
        studentNumber: {
          gte: 1,
        },
      },
    })

    console.log(
      JSON.stringify(
        {
          mode: dryRun ? "dry-run" : "apply",
          studentNumberStart: STUDENT_NUMBER_START,
          existingNumberCountBefore: existingRows.length,
          missingCountBefore: missingRows.length,
          assignedCount: planned.length,
          withStudentNumberAfter: afterCount,
          sampleAssigned: planned.slice(0, 25),
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
