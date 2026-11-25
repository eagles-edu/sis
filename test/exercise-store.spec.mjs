import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  INCOMING_EXERCISE_RESULT_STATUS_QUEUED,
  persistExerciseSubmission,
  queueIncompleteExerciseSubmission,
  resolveIncomingExerciseResultToStudent,
} from "../src/modules/exercises/exercise-store.mjs"

function toDateMs(value) {
  const parsed = new Date(value)
  const ms = parsed.valueOf()
  return Number.isFinite(ms) ? ms : Number.NaN
}

function matchesDateRange(value, range) {
  if (!range || typeof range !== "object") return true
  const valueMs = toDateMs(value)
  if (!Number.isFinite(valueMs)) return false
  if (range.gte !== undefined && valueMs < toDateMs(range.gte)) return false
  if (range.gt !== undefined && valueMs <= toDateMs(range.gt)) return false
  if (range.lte !== undefined && valueMs > toDateMs(range.lte)) return false
  if (range.lt !== undefined && valueMs >= toDateMs(range.lt)) return false
  return true
}

function selectNewestByCreatedAt(rows = []) {
  return [...rows].sort((left, right) => {
    const leftCreatedAt = Number.isFinite(toDateMs(left?.createdAt)) ? toDateMs(left.createdAt) : 0
    const rightCreatedAt = Number.isFinite(toDateMs(right?.createdAt)) ? toDateMs(right.createdAt) : 0
    if (leftCreatedAt !== rightCreatedAt) return rightCreatedAt - leftCreatedAt
    return String(right?.id || "").localeCompare(String(left?.id || ""))
  })[0] || null
}

function makePersistPrisma({
  matchedStudent = null,
  matchedEmailStudents = null,
  matchedSubmissionRows = [],
  matchedGradeRows = [],
} = {}) {
  const state = {
    studentFindFirstCalls: [],
    studentFindManyCalls: [],
    incomingFindFirstCalls: [],
    queueCreateCalls: [],
    incomingUpdateCalls: [],
    exerciseUpsertCalls: [],
    submissionFindFirstCalls: [],
    submissionCreateCalls: [],
    submissionUpdateCalls: [],
    gradeRecordFindFirstCalls: [],
    gradeRecordCreateCalls: [],
    gradeRecordUpdateCalls: [],
    queueRows: [],
    matchedSubmissionRows: Array.isArray(matchedSubmissionRows) ? [...matchedSubmissionRows] : [],
    matchedGradeRows: Array.isArray(matchedGradeRows) ? [...matchedGradeRows] : [],
  }

  const tx = {
    exercise: {
      async upsert(args) {
        state.exerciseUpsertCalls.push(args)
        return { id: "exercise-1" }
      },
    },
    exerciseSubmission: {
      async findUnique(args) {
        const where = args?.where || {}
        const identity = where?.sourceSystem_sourceAttemptId
        if (!identity) return null
        return (
          state.matchedSubmissionRows.find(
            (row) =>
              row?.sourceSystem === identity.sourceSystem &&
              row?.sourceAttemptId === identity.sourceAttemptId
          ) || null
        )
      },
      async findFirst(args) {
        state.submissionFindFirstCalls.push(args)
        const where = args?.where || {}
        const matches = state.matchedSubmissionRows.filter((row) => {
          if (where.studentRefId !== undefined && row?.studentRefId !== where.studentRefId) return false
          if (where.exerciseRefId !== undefined && row?.exerciseRefId !== where.exerciseRefId) return false
          if (where.submittedEaglesId !== undefined && row?.submittedEaglesId !== where.submittedEaglesId) return false
          if (where.submittedEmail !== undefined && row?.submittedEmail !== where.submittedEmail) return false
          if (where.completedAt && !matchesDateRange(row?.completedAt, where.completedAt)) return false
          if (where.createdAt && !matchesDateRange(row?.createdAt, where.createdAt)) return false
          return true
        })
        return selectNewestByCreatedAt(matches)
      },
      async create(args) {
        state.submissionCreateCalls.push(args)
        return { id: "submission-1", ...args.data }
      },
      async update(args) {
        state.submissionUpdateCalls.push(args)
        const index = state.matchedSubmissionRows.findIndex((row) => row.id === args?.where?.id)
        if (index < 0) throw new Error("Matched submission row not found in mock state")
        const updated = {
          ...state.matchedSubmissionRows[index],
          ...args.data,
        }
        state.matchedSubmissionRows[index] = updated
        return updated
      },
    },
    studentGradeRecord: {
      async findUnique(args) {
        const where = args?.where || {}
        const identity = where?.sourceSystem_sourceAttemptId
        if (!identity) return null
        return (
          state.matchedGradeRows.find(
            (row) =>
              row?.sourceSystem === identity.sourceSystem &&
              row?.sourceAttemptId === identity.sourceAttemptId
          ) || null
        )
      },
      async findFirst(args) {
        state.gradeRecordFindFirstCalls.push(args)
        const where = args?.where || {}
        const startsWith = String(where?.comments?.startsWith || "").toLowerCase()
        const matches = state.matchedGradeRows.filter((row) => {
          if (where.studentRefId !== undefined && row?.studentRefId !== where.studentRefId) return false
          if (where.className !== undefined && row?.className !== where.className) return false
          if (where.assignmentName !== undefined && row?.assignmentName !== where.assignmentName) return false
          if (where.dueAt && !matchesDateRange(row?.dueAt, where.dueAt)) return false
          if (where.submittedAt && !matchesDateRange(row?.submittedAt, where.submittedAt)) return false
          if (startsWith && !String(row?.comments || "").toLowerCase().startsWith(startsWith)) return false
          if (where.createdAt && !matchesDateRange(row?.createdAt, where.createdAt)) return false
          return true
        })
        return selectNewestByCreatedAt(matches)
      },
      async create(args) {
        state.gradeRecordCreateCalls.push(args)
        return { id: "grade-1", ...args.data }
      },
      async update(args) {
        state.gradeRecordUpdateCalls.push(args)
        const index = state.matchedGradeRows.findIndex((row) => row.id === args?.where?.id)
        if (index < 0) throw new Error("Matched grade row not found in mock state")
        const updated = {
          ...state.matchedGradeRows[index],
          ...args.data,
        }
        state.matchedGradeRows[index] = updated
        return updated
      },
    },
  }

  const prisma = {
    state,
    student: {
      async findFirst(args) {
        state.studentFindFirstCalls.push(args)
        return args?.where?.eaglesId
          ? matchedStudent
          : Array.isArray(matchedEmailStudents)
            ? matchedEmailStudents[0] || null
            : matchedStudent
      },
      async findMany(args) {
        state.studentFindManyCalls.push(args)
        return Array.isArray(matchedEmailStudents)
          ? matchedEmailStudents
          : matchedStudent
            ? [matchedStudent]
            : []
      },
    },
    incomingExerciseResult: {
      async findUnique(args) {
        const where = args?.where || {}
        const identity = where?.sourceSystem_sourceAttemptId
        if (!identity) return null
        return (
          state.queueRows.find(
            (row) =>
              row?.sourceSystem === identity.sourceSystem &&
              row?.sourceAttemptId === identity.sourceAttemptId
          ) || null
        )
      },
      async findFirst(args) {
        state.incomingFindFirstCalls.push(args)
        return state.queueRows.length ? state.queueRows[state.queueRows.length - 1] : null
      },
      async create(args) {
        state.queueCreateCalls.push(args)
        const row = {
          id: `incoming-${state.queueRows.length + 1}`,
          ...args.data,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        state.queueRows.push(row)
        return row
      },
      async update(args) {
        state.incomingUpdateCalls.push(args)
        const index = state.queueRows.findIndex((row) => row.id === args?.where?.id)
        if (index < 0) throw new Error("Incoming row not found in mock state")
        const updated = {
          ...state.queueRows[index],
          ...args.data,
          updatedAt: new Date(),
        }
        state.queueRows[index] = updated
        return updated
      },
    },
    async $transaction(callback) {
      return callback(tx)
    },
  }

  return prisma
}

test("queueIncompleteExerciseSubmission retains incomplete source data and is idempotent", async () => {
  const rows = []
  const prisma = {
    incomingExerciseResult: {
      async findUnique(args) {
        const identity = args?.where?.sourceSystem_sourceAttemptId
        return rows.find((row) => row.sourceSystem === identity?.sourceSystem && row.sourceAttemptId === identity?.sourceAttemptId) || null
      },
      async create(args) {
        const row = { id: "incomplete-1", ...args.data }
        rows.push(row)
        return row
      },
    },
  }
  const payload = {
    eaglesId: "",
    email: "not-an-email",
    pageTitle: "",
    completedAt: "invalid-date",
    sourceSystem: "moodle",
    totalQuestions: 10,
    correctCount: 8,
    pendingCount: 0,
    incorrectCount: 1,
    scorePercent: 80,
  }

  const first = await queueIncompleteExerciseSubmission(payload, { prisma })
  const replay = await queueIncompleteExerciseSubmission(payload, { prisma })

  assert.equal(first.saved, true)
  assert.equal(first.queued, true)
  assert.equal(first.deduplicated, false)
  assert.equal(replay.incomingResultId, first.incomingResultId)
  assert.equal(replay.deduplicated, true)
  assert.equal(rows.length, 1)
  assert.deepEqual(first.missingFields, [
    "eaglesId",
    "email",
    "sourceAttemptId",
    "pageTitle",
    "completedAt",
    "consistent question score metrics",
  ])
  assert.equal(rows[0].status, INCOMING_EXERCISE_RESULT_STATUS_QUEUED)
  assert.equal(rows[0].submittedEaglesId, "[Missing EaglesID]")
  assert.equal(rows[0].sourceSystem, "moodle")
  assert.match(rows[0].sourceAttemptId, /^missing-[a-f0-9]{64}$/u)
  assert.deepEqual(rows[0].payloadJson, payload)
  assert.match(rows[0].notes, /consistent question score metrics/u)
  assert.equal(rows[0].totalQuestions, 0)
  assert.equal(rows[0].scorePercent, 0)
})

function nativeExercisePayload(overrides = {}) {
  return {
    eaglesId: "S001",
    email: "student@example.com",
    pageTitle: "Movers Unit 3",
    completedAt: "2026-03-01T07:34:04.862Z",
    correctCount: 8,
    pendingCount: 1,
    incorrectCount: 1,
    totalQuestions: 10,
    scorePercent: 80,
    recipients: ["teacher@example.com"],
    ...overrides,
  }
}

test("persistExerciseSubmission queues unmatched payload for manual disposition", async () => {
  const prisma = makePersistPrisma({ matchedStudent: null })

  const result = await persistExerciseSubmission(
    nativeExercisePayload({
      eaglesId: "unknown-001",
      email: "unknown@example.com",
      pageTitle: "Starter Listening 01",
    }),
    { prisma }
  )

  assert.equal(result.saved, true)
  assert.equal(result.matched, false)
  assert.equal(result.queued, true)
  assert.equal(result.incomingResultId, "incoming-1")
  assert.equal(prisma.state.queueCreateCalls.length, 1)
  assert.equal(prisma.state.submissionCreateCalls.length, 0)
  assert.equal(prisma.state.gradeRecordCreateCalls.length, 0)
  assert.equal(
    prisma.state.queueCreateCalls[0].data.status,
    INCOMING_EXERCISE_RESULT_STATUS_QUEUED
  )
})

test("persistExerciseSubmission leaves ambiguous email matches in the manual queue", async () => {
  const prisma = makePersistPrisma({
    matchedStudent: null,
    matchedEmailStudents: [
      { id: "student-child-a", eaglesId: "CHILD-A", email: "family@example.test" },
      { id: "student-child-b", eaglesId: "CHILD-B", email: "family@example.test" },
    ],
  })

  const result = await persistExerciseSubmission(
    nativeExercisePayload({
      eaglesId: "unmatched-submitted-id",
      email: "family@example.test",
    }),
    { prisma },
  )

  assert.equal(result.saved, true)
  assert.equal(result.matched, false)
  assert.equal(result.queued, true)
  assert.equal(prisma.state.queueCreateCalls.length, 1)
  assert.equal(prisma.state.submissionCreateCalls.length, 0)
  assert.equal(prisma.state.gradeRecordCreateCalls.length, 0)
})

test("persistExerciseSubmission still matches a unique email fallback", async () => {
  const prisma = makePersistPrisma({
    matchedStudent: null,
    matchedEmailStudents: [
      { id: "student-unique-email", eaglesId: "SINGLE-CHILD", email: "family@example.test" },
    ],
  })

  const result = await persistExerciseSubmission(
    nativeExercisePayload({
      eaglesId: "legacy-submitted-id",
      email: "family@example.test",
    }),
    { prisma },
  )

  assert.equal(result.matched, true)
  assert.equal(result.studentRefId, "student-unique-email")
  assert.equal(prisma.state.queueCreateCalls.length, 0)
  assert.equal(prisma.state.gradeRecordCreateCalls.length, 1)
})

test("persistExerciseSubmission de-duplicates nearby queue records and keeps the highest score", async () => {
  const prisma = makePersistPrisma({ matchedStudent: null })

  const firstPayload = nativeExercisePayload({
    eaglesId: "dup-01",
    email: "dup@example.com",
    pageTitle: "Common Nouns",
    completedAt: "2026-03-01T07:34:04.862Z",
    correctCount: 5,
    pendingCount: 0,
    incorrectCount: 5,
    totalQuestions: 10,
    scorePercent: 50,
  })

  const firstResult = await persistExerciseSubmission(firstPayload, { prisma })
  assert.equal(firstResult.shouldNotify, true)
  assert.equal(prisma.state.queueCreateCalls.length, 1)
  assert.equal(prisma.state.incomingUpdateCalls.length, 0)

  const secondPayload = {
    ...firstPayload,
    completedAt: "2026-03-01T07:34:05.100Z",
    correctCount: 10,
    pendingCount: 0,
    incorrectCount: 0,
    totalQuestions: 10,
    scorePercent: 100,
  }

  const secondResult = await persistExerciseSubmission(secondPayload, { prisma })

  assert.equal(secondResult.saved, true)
  assert.equal(secondResult.matched, false)
  assert.equal(secondResult.queued, true)
  assert.equal(secondResult.deduplicated, true)
  assert.equal(secondResult.updatedExisting, true)
  assert.equal(secondResult.shouldNotify, false)
  assert.equal(secondResult.incomingResultId, "incoming-1")
  assert.equal(prisma.state.queueCreateCalls.length, 1)
  assert.equal(prisma.state.incomingUpdateCalls.length, 1)

  const stored = prisma.state.queueRows[0]
  assert.equal(stored.correctCount, 10)
  assert.equal(stored.scorePercent, 100)
})

test("persistExerciseSubmission records directly when student account is matched", async () => {
  const prisma = makePersistPrisma({
    matchedStudent: {
      id: "student-1",
      eaglesId: "S001",
      email: "student@example.com",
    },
  })

  const result = await persistExerciseSubmission(
    nativeExercisePayload({
      eaglesId: "S001",
      email: "student@example.com",
      pageTitle: "Movers Unit 3",
      correctCount: 10,
      pendingCount: 0,
      incorrectCount: 0,
      totalQuestions: 10,
      scorePercent: 100,
    }),
    { prisma }
  )

  assert.equal(result.saved, true)
  assert.equal(result.matched, true)
  assert.equal(result.queued, false)
  assert.equal(result.studentRefId, "student-1")
  assert.equal(result.submissionId, "submission-1")
  assert.equal(result.gradeRecordId, "grade-1")
  assert.equal(prisma.state.queueCreateCalls.length, 0)
  assert.equal(prisma.state.submissionCreateCalls.length, 1)
  assert.equal(prisma.state.gradeRecordCreateCalls.length, 1)
})

test("exercise grading preserves the assignment deadline and records the submitted exercise item", async () => {
  const prisma = makePersistPrisma({
    matchedStudent: {
      id: "student-1",
      eaglesId: "S001",
      email: "student@example.com",
      profile: { currentGrade: "A1 Movers" },
    },
  })
  const templateDueAt = "2026-03-01T08:00:00.000Z"
  await persistExerciseSubmission(nativeExercisePayload({
    completedAt: "2026-03-01T09:00:00.000Z",
    correctCount: 9,
    pendingCount: 0,
    incorrectCount: 1,
    totalQuestions: 10,
    scorePercent: 90,
    assignmentTemplateItemId: "bundle-item-2",
    assignmentBundleJson: {
      assignmentTemplateId: "bundle-1",
      eaglesId: "S001",
      level: "A1 Movers",
      assignmentTitle: "Three exercises",
      assignedAt: "2026-02-20T00:00:00.000Z",
      dueAt: templateDueAt,
      items: [
        { assignmentTemplateItemId: "bundle-item-1", title: "Read", url: "https://example.test/read" },
        { assignmentTemplateItemId: "bundle-item-2", title: "Write", url: "https://example.test/write" },
        { assignmentTemplateItemId: "bundle-item-3", title: "Listen", url: "https://example.test/listen" },
      ],
    },
  }), { prisma })

  const grade = prisma.state.gradeRecordCreateCalls[0]?.data
  assert.equal(grade.dueAt.toISOString(), templateDueAt)
  assert.equal(grade.submittedAt.toISOString(), "2026-03-01T09:00:00.000Z")
  assert.equal(grade.homeworkOnTime, false)
  assert.equal(grade.assignmentBundleJson.submittedItemId, "bundle-item-2")
  assert.equal(grade.score, 90)
})

test("persistExerciseSubmission canonicalizes noisy pageTitle for auto-import grade keys", async () => {
  const prisma = makePersistPrisma({
    matchedStudent: {
      id: "student-1",
      eaglesId: "S001",
      email: "student@example.com",
    },
  })

  const result = await persistExerciseSubmission(
    nativeExercisePayload({
      eaglesId: "S001",
      email: "student@example.com",
      pageTitle: "https://portal.eagles.edu.vn/exercises/Movers-Unit-3.html?session=abc123#result",
      correctCount: 10,
      pendingCount: 0,
      incorrectCount: 0,
      totalQuestions: 10,
      scorePercent: 100,
    }),
    { prisma }
  )

  assert.equal(result.saved, true)
  assert.equal(result.matched, true)
  assert.equal(prisma.state.exerciseUpsertCalls.length, 1)
  assert.equal(prisma.state.exerciseUpsertCalls[0]?.where?.slug, "movers-unit-3")
  assert.equal(prisma.state.gradeRecordCreateCalls.length, 1)
  assert.equal(prisma.state.gradeRecordCreateCalls[0]?.data?.className, "Movers Unit 3")
  assert.equal(prisma.state.gradeRecordCreateCalls[0]?.data?.assignmentName, "Movers Unit 3")
})

test("persistExerciseSubmission normalizes dotted section tokens in pageTitle", async () => {
  const prisma = makePersistPrisma({
    matchedStudent: {
      id: "student-1",
      eaglesId: "S001",
      email: "student@example.com",
    },
  })

  const result = await persistExerciseSubmission(
    nativeExercisePayload({
      eaglesId: "S001",
      email: "student@example.com",
      pageTitle: "1.1.1 Common Nouns",
      correctCount: 10,
      pendingCount: 0,
      incorrectCount: 0,
      totalQuestions: 10,
      scorePercent: 100,
    }),
    { prisma }
  )

  assert.equal(result.saved, true)
  assert.equal(result.matched, true)
  assert.equal(prisma.state.exerciseUpsertCalls.length, 1)
  assert.equal(prisma.state.exerciseUpsertCalls[0]?.create?.title, "1 1 1 Common Nouns")
  assert.equal(prisma.state.gradeRecordCreateCalls.length, 1)
  assert.equal(prisma.state.gradeRecordCreateCalls[0]?.data?.className, "1 1 1 Common Nouns")
  assert.equal(prisma.state.gradeRecordCreateCalls[0]?.data?.assignmentName, "1 1 1 Common Nouns")
})

test("persistExerciseSubmission uses configured school setup year and quarter windows for auto-imported grade records", async () => {
  const prisma = makePersistPrisma({
    matchedStudent: {
      id: "student-1",
      eaglesId: "S001",
      email: "student@example.com",
    },
  })
  const originalUiSettingsFile = process.env.STUDENT_ADMIN_UI_SETTINGS_FILE
  const originalSchoolYearOverride = process.env.SIS_CURRENT_SCHOOL_YEAR
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sis-exercise-schoolyear-"))
  const uiSettingsPath = path.join(tempDir, "admin-ui-settings.json")
  fs.writeFileSync(
    uiSettingsPath,
    JSON.stringify({
      uiSettings: {
        schoolSetup: {
          schoolYear: "2026-2027",
          quarters: [
            {
              quarter: "q1",
              startDate: "2026-02-21",
              endDate: "2026-05-15",
            },
            {
              quarter: "q2",
              startDate: "2026-05-16",
              endDate: "2026-08-07",
            },
            {
              quarter: "q3",
              startDate: "2026-08-08",
              endDate: "2026-10-30",
            },
            {
              quarter: "q4",
              startDate: "2026-10-31",
              endDate: "2027-01-22",
            },
          ],
        },
      },
    }),
    "utf8"
  )

  delete process.env.SIS_CURRENT_SCHOOL_YEAR
  process.env.STUDENT_ADMIN_UI_SETTINGS_FILE = uiSettingsPath

  try {
    const result = await persistExerciseSubmission(
      nativeExercisePayload({
        eaglesId: "S001",
        email: "student@example.com",
        pageTitle: "Movers Unit 4",
        completedAt: "2026-03-21T09:15:00.000Z",
        correctCount: 10,
        pendingCount: 0,
        incorrectCount: 0,
        totalQuestions: 10,
        scorePercent: 100,
      }),
      { prisma }
    )

    assert.equal(result.saved, true)
    assert.equal(result.matched, true)
    assert.equal(prisma.state.gradeRecordCreateCalls.length, 1)
    assert.equal(prisma.state.gradeRecordCreateCalls[0]?.data?.schoolYear, "2026-2027")
    assert.equal(prisma.state.gradeRecordCreateCalls[0]?.data?.quarter, "q1")
  } finally {
    if (originalUiSettingsFile === undefined) {
      delete process.env.STUDENT_ADMIN_UI_SETTINGS_FILE
    } else {
      process.env.STUDENT_ADMIN_UI_SETTINGS_FILE = originalUiSettingsFile
    }
    if (originalSchoolYearOverride === undefined) {
      delete process.env.SIS_CURRENT_SCHOOL_YEAR
    } else {
      process.env.SIS_CURRENT_SCHOOL_YEAR = originalSchoolYearOverride
    }
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test("persistExerciseSubmission de-duplicates matched records and updates existing grade when incoming payload is richer", async () => {
  const prisma = makePersistPrisma({
    matchedStudent: {
      id: "student-1",
      eaglesId: "S001",
      email: "student@example.com",
      profile: {
        currentGrade: "Movers",
      },
    },
    matchedSubmissionRows: [
      {
        id: "submission-existing",
        studentRefId: "student-1",
        exerciseRefId: "exercise-1",
        submittedEaglesId: "S001",
        submittedEmail: "student@example.com",
        completedAt: new Date("2026-03-01T07:34:04.862Z"),
        totalQuestions: 1,
        correctCount: 0,
        pendingCount: 0,
        incorrectCount: 1,
        scorePercent: 0,
        recipientsJson: ["teacher@example.com"],
        createdAt: new Date("2026-03-01T07:34:04.900Z"),
      },
    ],
    matchedGradeRows: [
      {
        id: "grade-existing",
        studentRefId: "student-1",
        className: "Movers Unit 3",
        assignmentName: "Movers Unit 3",
        dueAt: new Date("2026-03-01T07:34:04.862Z"),
        submittedAt: new Date("2026-03-01T07:34:04.862Z"),
        score: 0,
        maxScore: 100,
        homeworkCompleted: true,
        homeworkOnTime: true,
        comments: "Auto-imported exercise score.",
        createdAt: new Date("2026-03-01T07:34:04.901Z"),
      },
    ],
  })

  const result = await persistExerciseSubmission(
    nativeExercisePayload({
      eaglesId: "S001",
      email: "student@example.com",
      pageTitle: "Movers Unit 3",
      completedAt: "2026-03-01T07:34:05.100Z",
      correctCount: 1,
      pendingCount: 0,
      incorrectCount: 0,
      totalQuestions: 1,
      scorePercent: 100,
    }),
    { prisma }
  )

  assert.equal(result.saved, true)
  assert.equal(result.matched, true)
  assert.equal(result.queued, false)
  assert.equal(result.deduplicated, true)
  assert.equal(result.updatedExisting, true)
  assert.equal(result.shouldNotify, false)
  assert.equal(result.submissionId, "submission-existing")
  assert.equal(result.gradeRecordId, "grade-existing")
  assert.equal(result.summary?.scorePercent, 100)
  assert.equal(prisma.state.submissionCreateCalls.length, 0)
  assert.equal(prisma.state.gradeRecordCreateCalls.length, 0)
  assert.equal(prisma.state.submissionUpdateCalls.length, 1)
  assert.equal(prisma.state.gradeRecordUpdateCalls.length, 1)
  assert.equal(prisma.state.matchedSubmissionRows[0].scorePercent, 100)
  assert.equal(prisma.state.matchedGradeRows[0].score, 100)
})

test("persistExerciseSubmission de-duplicates Moodle source identity records without relying on timestamp windows", async () => {
  const prisma = makePersistPrisma({
    matchedStudent: {
      id: "student-1",
      eaglesId: "moodle-user-1",
      email: "student@example.com",
      profile: {
        currentGrade: "Movers",
      },
    },
    matchedSubmissionRows: [
      {
        id: "submission-moodle-existing",
        studentRefId: "student-1",
        exerciseRefId: "exercise-1",
        submittedEaglesId: "moodle-user-1",
        submittedEmail: "student@example.com",
        sourceSystem: "moodle",
        sourceAttemptId: "attempt-77",
        completedAt: new Date("2026-03-01T07:34:04.862Z"),
        totalQuestions: 10,
        correctCount: 7,
        pendingCount: 1,
        incorrectCount: 2,
        scorePercent: 70,
        recipientsJson: [],
        createdAt: new Date("2026-02-01T07:34:04.862Z"),
      },
    ],
    matchedGradeRows: [
      {
        id: "grade-moodle-existing",
        studentRefId: "student-1",
        className: "Moodle Quiz",
        assignmentName: "Moodle Quiz",
        dueAt: new Date("2026-03-01T07:34:04.862Z"),
        submittedAt: new Date("2026-03-01T07:34:04.862Z"),
        score: 70,
        maxScore: 100,
        homeworkCompleted: true,
        homeworkOnTime: true,
        comments: "Auto-imported exercise score.",
        sourceSystem: "moodle",
        sourceAttemptId: "attempt-77",
        createdAt: new Date("2026-02-01T07:34:04.862Z"),
      },
    ],
  })

  const result = await persistExerciseSubmission(
    nativeExercisePayload({
      eaglesId: "moodle-user-1",
      email: "",
      pageTitle: "Do you like ____? with Animals",
      completedAt: "2026-03-01T07:34:05.100Z",
      startedAt: "2026-03-01T07:00:00.000Z",
      correctCount: 9,
      pendingCount: 0,
      incorrectCount: 1,
      totalQuestions: 10,
      scorePercent: 90,
      sourceSystem: "moodle",
      sourceAttemptId: "attempt-77",
    }),
    { prisma }
  )

  assert.equal(result.saved, true)
  assert.equal(result.matched, true)
  assert.equal(result.deduplicated, true)
  assert.equal(result.updatedExisting, true)
  assert.equal(result.shouldNotify, false)
  assert.equal(result.submissionId, "submission-moodle-existing")
  assert.equal(result.gradeRecordId, "grade-moodle-existing")
  assert.equal(prisma.state.submissionUpdateCalls.length, 1)
  assert.equal(prisma.state.gradeRecordUpdateCalls.length, 1)
  assert.equal(prisma.state.submissionUpdateCalls[0]?.data?.sourceTitle, "Do you like ____? with Animals")
  assert.equal(prisma.state.submissionUpdateCalls[0]?.data?.startedAt?.toISOString(), "2026-03-01T07:00:00.000Z")
  assert.equal(prisma.state.gradeRecordUpdateCalls[0]?.data?.assignmentName, "Do you like ____? with Animals")
  assert.equal(prisma.state.gradeRecordUpdateCalls[0]?.data?.startedAt?.toISOString(), "2026-03-01T07:00:00.000Z")
})

test("persistExerciseSubmission replay backfills Moodle source metadata without lowering an existing grade", async () => {
  const prisma = makePersistPrisma({
    matchedStudent: {
      id: "student-1",
      eaglesId: "moodle-user-1",
      email: "student@example.com",
      profile: { currentGrade: "A2 Flyers" },
    },
    matchedSubmissionRows: [
      {
        id: "submission-moodle-replay",
        studentRefId: "student-1",
        exerciseRefId: "exercise-1",
        submittedEaglesId: "moodle-user-1",
        submittedEmail: "student@example.com",
        sourceSystem: "moodle",
        sourceAttemptId: "attempt-replay",
        sourceTitle: null,
        startedAt: null,
        completedAt: new Date("2026-03-01T07:34:04.862Z"),
        totalQuestions: 10,
        correctCount: 9,
        pendingCount: 0,
        incorrectCount: 1,
        scorePercent: 90,
        recipientsJson: [],
        createdAt: new Date("2026-02-01T07:34:04.862Z"),
      },
    ],
    matchedGradeRows: [
      {
        id: "grade-moodle-replay",
        studentRefId: "student-1",
        className: "Do you like",
        assignmentName: "Do you like",
        dueAt: new Date("2026-03-01T07:34:04.862Z"),
        submittedAt: new Date("2026-03-01T07:34:04.862Z"),
        startedAt: null,
        score: 90,
        maxScore: 100,
        homeworkCompleted: true,
        homeworkOnTime: true,
        comments: "Auto-imported exercise score.",
        sourceSystem: "moodle",
        sourceAttemptId: "attempt-replay",
        createdAt: new Date("2026-02-01T07:34:04.862Z"),
      },
    ],
  })

  const result = await persistExerciseSubmission(
    nativeExercisePayload({
      eaglesId: "moodle-user-1",
      email: "student@example.com",
      pageTitle: "Do you like ____? with Animals",
      completedAt: "2026-03-01T07:34:04.862Z",
      startedAt: "2026-03-01T07:00:00.000Z",
      correctCount: 5,
      pendingCount: 0,
      incorrectCount: 5,
      totalQuestions: 10,
      scorePercent: 50,
      sourceSystem: "moodle",
      sourceAttemptId: "attempt-replay",
    }),
    { prisma }
  )

  assert.equal(result.deduplicated, true)
  assert.equal(result.updatedExisting, true)
  assert.equal(prisma.state.submissionCreateCalls.length, 0)
  assert.equal(prisma.state.gradeRecordCreateCalls.length, 0)
  assert.equal(prisma.state.submissionUpdateCalls[0]?.data?.sourceTitle, "Do you like ____? with Animals")
  assert.equal(prisma.state.submissionUpdateCalls[0]?.data?.startedAt?.toISOString(), "2026-03-01T07:00:00.000Z")
  assert.equal(prisma.state.submissionUpdateCalls[0]?.data?.scorePercent, undefined)
  assert.equal(prisma.state.gradeRecordUpdateCalls[0]?.data?.assignmentName, "Do you like ____? with Animals")
  assert.equal(prisma.state.gradeRecordUpdateCalls[0]?.data?.startedAt?.toISOString(), "2026-03-01T07:00:00.000Z")
  assert.equal(prisma.state.gradeRecordUpdateCalls[0]?.data?.score, undefined)
})

test("persistExerciseSubmission de-duplicates matched records using canonical fingerprint despite submitted identity mismatch and stale createdAt", async () => {
  const staleCreatedAt = new Date(Date.now() - 90 * 60 * 1000)
  const prisma = makePersistPrisma({
    matchedStudent: {
      id: "student-1",
      eaglesId: "S001",
      email: "student@example.com",
      profile: {
        currentGrade: "Movers",
      },
    },
    matchedSubmissionRows: [
      {
        id: "submission-stale",
        studentRefId: "student-1",
        exerciseRefId: "exercise-1",
        submittedEaglesId: "(not provided)",
        submittedEmail: null,
        completedAt: new Date("2026-03-01T07:34:04.862Z"),
        totalQuestions: 1,
        correctCount: 0,
        pendingCount: 0,
        incorrectCount: 1,
        scorePercent: 0,
        recipientsJson: ["teacher@example.com"],
        createdAt: staleCreatedAt,
      },
    ],
    matchedGradeRows: [
      {
        id: "grade-stale",
        studentRefId: "student-1",
        className: "Movers Unit 3",
        assignmentName: "Movers Unit 3",
        dueAt: new Date("2026-03-01T07:34:04.862Z"),
        submittedAt: new Date("2026-03-01T07:34:04.862Z"),
        score: 0,
        maxScore: 100,
        homeworkCompleted: true,
        homeworkOnTime: true,
        comments: "Auto-imported exercise score.",
        createdAt: staleCreatedAt,
      },
    ],
  })

  const result = await persistExerciseSubmission(
    nativeExercisePayload({
      eaglesId: "S001",
      email: "student@example.com",
      pageTitle: "Movers Unit 3",
      completedAt: "2026-03-01T07:34:05.100Z",
      correctCount: 1,
      pendingCount: 0,
      incorrectCount: 0,
      totalQuestions: 1,
      scorePercent: 100,
    }),
    { prisma }
  )

  assert.equal(result.saved, true)
  assert.equal(result.matched, true)
  assert.equal(result.queued, false)
  assert.equal(result.deduplicated, true)
  assert.equal(result.updatedExisting, true)
  assert.equal(result.shouldNotify, false)
  assert.equal(result.submissionId, "submission-stale")
  assert.equal(result.gradeRecordId, "grade-stale")
  assert.equal(result.summary?.scorePercent, 100)
  assert.equal(prisma.state.submissionCreateCalls.length, 0)
  assert.equal(prisma.state.gradeRecordCreateCalls.length, 0)
  assert.equal(prisma.state.submissionUpdateCalls.length, 1)
  assert.equal(prisma.state.gradeRecordUpdateCalls.length, 1)
  assert.equal(prisma.state.matchedSubmissionRows[0].scorePercent, 100)
  assert.equal(prisma.state.matchedGradeRows[0].score, 100)

  const submissionWhere = prisma.state.submissionFindFirstCalls[0]?.where || {}
  assert.equal("submittedEaglesId" in submissionWhere, false)
  assert.equal("submittedEmail" in submissionWhere, false)
  assert.equal("createdAt" in submissionWhere, false)

  const gradeWhere = prisma.state.gradeRecordFindFirstCalls[0]?.where || {}
  assert.equal("createdAt" in gradeWhere, false)
})

function makeResolvePrisma() {
  const state = {
    submissionCreateCalls: [],
    gradeRecordCreateCalls: [],
    incomingUpdateCalls: [],
  }

  const tx = {
    incomingExerciseResult: {
      async findUnique() {
        return {
          id: "incoming-2",
          status: "queued",
          submittedEaglesId: "TEMP-200",
          submittedEmail: "temp-200@example.com",
          pageTitle: "Flyers Reading 02",
          completedAt: new Date("2026-02-28T08:00:00.000Z"),
          totalQuestions: 2,
          correctCount: 1,
          pendingCount: 0,
          incorrectCount: 1,
          scorePercent: 50,
          recipientsJson: ["teacher@example.com"],
          notes: null,
        }
      },
      async update(args) {
        state.incomingUpdateCalls.push(args)
        return {
          id: "incoming-2",
          status: "resolved",
          submittedEaglesId: "TEMP-200",
          submittedEmail: "temp-200@example.com",
          pageTitle: "Flyers Reading 02",
          completedAt: new Date("2026-02-28T08:00:00.000Z"),
          totalQuestions: 2,
          correctCount: 1,
          pendingCount: 0,
          incorrectCount: 1,
          scorePercent: 50,
          recipientsJson: ["teacher@example.com"],
          notes: args.data.notes || null,
          reviewedByUsername: args.data.reviewedByUsername || null,
          matchedStudentRefId: args.data.matchedStudentRefId,
          resolvedAt: args.data.resolvedAt,
          createdAt: new Date("2026-02-28T07:59:59.000Z"),
          updatedAt: new Date("2026-02-28T08:01:00.000Z"),
          matchedStudent: {
            id: args.data.matchedStudentRefId,
            eaglesId: "S200",
          },
        }
      },
    },
    student: {
      async findUnique() {
        return {
          id: "student-200",
          eaglesId: "S200",
        }
      },
    },
    exercise: {
      async upsert() {
        return { id: "exercise-200" }
      },
    },
    exerciseSubmission: {
      async findUnique() {
        return null
      },
      async findFirst() {
        return null
      },
      async create(args) {
        state.submissionCreateCalls.push(args)
        return { id: "submission-200" }
      },
    },
    studentGradeRecord: {
      async findUnique() {
        return null
      },
      async findFirst() {
        return null
      },
      async create(args) {
        state.gradeRecordCreateCalls.push(args)
        return { id: "grade-200" }
      },
    },
  }

  return {
    state,
    async $transaction(callback) {
      return callback(tx)
    },
  }
}

test("resolveIncomingExerciseResultToStudent creates submission and resolves queue item", async () => {
  const prisma = makeResolvePrisma()

  const result = await resolveIncomingExerciseResultToStudent("incoming-2", "student-200", {
    prisma,
    reviewedByUsername: "admin",
    notes: "Created account from incoming test result",
  })

  assert.equal(result.resolved, true)
  assert.equal(result.studentRefId, "student-200")
  assert.equal(result.submissionId, "submission-200")
  assert.equal(result.gradeRecordId, "grade-200")
  assert.equal(result.item.status, "resolved")
  assert.equal(result.item.matchedStudentRefId, "student-200")
  assert.equal(prisma.state.submissionCreateCalls.length, 1)
  assert.equal(prisma.state.gradeRecordCreateCalls.length, 1)
  assert.equal(prisma.state.incomingUpdateCalls.length, 1)
})
