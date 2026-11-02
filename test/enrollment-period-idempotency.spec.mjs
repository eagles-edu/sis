import assert from "node:assert/strict"
import test from "node:test"

import { resolveEnrollmentPeriodForStudent } from "../src/modules/admin/enrollment-periods.mjs"

function createPeriod({ id, studentRefId, schoolYear, level, status, startedAt, createdBy, updatedBy }) {
  return {
    id,
    studentRefId,
    schoolYear,
    level,
    status,
    startedAt,
    createdBy,
    updatedBy,
    endedAt: null,
    createdAt: new Date(),
  }
}

function createConcurrentPrismaMock({ onUpsert = null, barrierInitialReads = true } = {}) {
  const periods = []
  let initialReads = 0
  let releaseInitialReads
  const bothInitialReads = new Promise((resolve) => {
    releaseInitialReads = resolve
  })
  return {
    periods,
    student: {
      findUnique: async ({ where }) => ({ id: where.id, profile: { currentGrade: "A1 Movers" } }),
    },
    studentEnrollmentPeriod: {
      findFirst: async ({ where }) => {
        if (where.status === "active" && barrierInitialReads && initialReads < 2) {
          initialReads += 1
          if (initialReads === 2) releaseInitialReads()
          await bothInitialReads
          return null
        }
        if (where.status === "active" && !barrierInitialReads && initialReads === 0) {
          initialReads += 1
          return null
        }
        const matches = periods.filter((period) =>
          period.studentRefId === where.studentRefId
          && period.schoolYear === where.schoolYear
          && (!where.status || period.status === where.status)
          && (where.endedAt === undefined || period.endedAt === where.endedAt)
        )
        if (where.status === "active") return matches[0] || null
        return matches.sort((first, second) => second.startedAt - first.startedAt)[0] || null
      },
      upsert: async ({ where, create }) => {
        if (onUpsert) return onUpsert({ where, create, periods })
        const existing = periods.find((period) => period.id === where.id)
        if (existing) return existing
        const created = { ...create, endedAt: null, createdAt: new Date() }
        periods.push(created)
        return created
      },
    },
  }
}

test("concurrent teacher writes coalesce missing enrollment periods by deterministic ID", async () => {
  const prisma = createConcurrentPrismaMock()
  const options = { schoolYear: "2026-2027", levelHint: "Movers" }
  const [first, second] = await Promise.all([
    resolveEnrollmentPeriodForStudent(prisma, "student-1", options),
    resolveEnrollmentPeriodForStudent(prisma, "student-1", options),
  ])

  assert.equal(first.id, second.id)
  assert.equal(prisma.periods.length, 1)
  assert.equal(first.studentRefId, "student-1")
  assert.equal(first.schoolYear, "2026-2027")
})

test("a legacy composite unique conflict returns the enrollment period created by the racing writer", async () => {
  const racedPeriod = createPeriod({
    id: "legacy-racing-period",
    studentRefId: "student-2",
    schoolYear: "2026-2027",
    level: "A1 Movers",
    status: "active",
    startedAt: new Date(),
    createdBy: null,
    updatedBy: null,
  })
  const prisma = createConcurrentPrismaMock({
    barrierInitialReads: false,
    onUpsert: async ({ periods }) => {
      periods.push(racedPeriod)
      throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" })
    },
  })

  const result = await resolveEnrollmentPeriodForStudent(prisma, "student-2", {
    schoolYear: "2026-2027",
    levelHint: "Movers",
  })

  assert.equal(result.id, racedPeriod.id)
  assert.equal(prisma.periods.length, 1)
})

test("a new active enrollment period gets a new deterministic ID after the prior period ends", async () => {
  const endedPeriod = createPeriod({
    id: "previous-period",
    studentRefId: "student-3",
    schoolYear: "2026-2027",
    level: "A1 Movers",
    status: "active",
    startedAt: new Date("2026-09-01T00:00:00.000Z"),
    createdBy: null,
    updatedBy: null,
  })
  endedPeriod.status = "ended"
  endedPeriod.endedAt = new Date("2026-10-01T00:00:00.000Z")
  const prisma = createConcurrentPrismaMock({ barrierInitialReads: false })
  prisma.periods.push(endedPeriod)

  const nextPeriod = await resolveEnrollmentPeriodForStudent(prisma, "student-3", {
    schoolYear: "2026-2027",
    levelHint: "Movers",
  })

  assert.notEqual(nextPeriod.id, endedPeriod.id)
  assert.equal(nextPeriod.status, "active")
  assert.equal(nextPeriod.endedAt, null)
  assert.equal(prisma.periods.length, 2)
})
