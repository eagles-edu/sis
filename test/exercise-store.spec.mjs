import test from "node:test"
import assert from "node:assert/strict"

import {
  INCOMING_EXERCISE_RESULT_STATUS_QUEUED,
  persistExerciseSubmission,
  resolveIncomingExerciseResultToStudent,
} from "../server/exercise-store.mjs"

function makePersistPrisma({
  matchedStudent = null,
  matchedSubmissionRows = [],
  matchedGradeRows = [],
} = {}) {
  const state = {
    studentFindFirstCalls: [],
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
      async findFirst(args) {
        state.submissionFindFirstCalls.push(args)
        return state.matchedSubmissionRows.length
          ? state.matchedSubmissionRows[state.matchedSubmissionRows.length - 1]
          : null
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
      async findFirst(args) {
        state.gradeRecordFindFirstCalls.push(args)
        return state.matchedGradeRows.length
          ? state.matchedGradeRows[state.matchedGradeRows.length - 1]
          : null
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
        return matchedStudent
      },
    },
    incomingExerciseResult: {
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

test("persistExerciseSubmission queues unmatched payload for manual disposition", async () => {
  const prisma = makePersistPrisma({ matchedStudent: null })

  const result = await persistExerciseSubmission(
    {
      studentId: "",
      email: "unknown@example.com",
      pageTitle: "Starter Listening 01",
      answers: [{ id: 1, answers: ["A"], status: "correct" }],
      recipients: ["teacher@example.com"],
    },
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

test("persistExerciseSubmission de-duplicates nearby queue records and prefers richer status payload", async () => {
  const prisma = makePersistPrisma({ matchedStudent: null })

  const firstPayload = {
    studentId: "dup-01",
    email: "dup@example.com",
    pageTitle: "Common Nouns",
    completedAt: "2026-03-01T07:34:04.862Z",
    recipients: ["teacher@example.com"],
    answers: [{ id: 1, answers: ["book"] }],
  }

  const firstResult = await persistExerciseSubmission(firstPayload, { prisma })
  assert.equal(firstResult.shouldNotify, true)
  assert.equal(prisma.state.queueCreateCalls.length, 1)
  assert.equal(prisma.state.incomingUpdateCalls.length, 0)

  const secondPayload = {
    ...firstPayload,
    completedAt: "2026-03-01T07:34:05.100Z",
    answers: [{ id: 1, answers: ["book"], status: "correct", needsReview: false }],
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
  assert.equal(stored.correctCount, 1)
  assert.equal(stored.scorePercent, 100)
  assert.equal(stored.answersJson[0].status, "correct")
})

test("persistExerciseSubmission records directly when student account is matched", async () => {
  const prisma = makePersistPrisma({
    matchedStudent: {
      id: "student-1",
      studentId: "S001",
      email: "student@example.com",
    },
  })

  const result = await persistExerciseSubmission(
    {
      studentId: "S001",
      email: "student@example.com",
      pageTitle: "Movers Unit 3",
      answers: [{ id: 1, answers: ["B"], status: "correct" }],
      recipients: ["teacher@example.com"],
    },
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
        submittedStudentId: "S001",
        submittedEmail: "student@example.com",
        completedAt: new Date("2026-03-01T07:34:04.862Z"),
        totalQuestions: 1,
        correctCount: 0,
        pendingCount: 0,
        incorrectCount: 1,
        scorePercent: 0,
        answersJson: [{ id: "1", answers: ["book"] }],
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
    {
      studentId: "S001",
      email: "student@example.com",
      pageTitle: "Movers Unit 3",
      completedAt: "2026-03-01T07:34:05.100Z",
      answers: [{ id: 1, answers: ["B"], status: "correct" }],
      recipients: ["teacher@example.com"],
    },
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
          submittedStudentId: "TEMP-200",
          submittedEmail: "temp-200@example.com",
          pageTitle: "Flyers Reading 02",
          completedAt: new Date("2026-02-28T08:00:00.000Z"),
          totalQuestions: 2,
          correctCount: 1,
          pendingCount: 0,
          incorrectCount: 1,
          scorePercent: 50,
          answersJson: [
            { id: "1", answers: ["A"], status: "correct" },
            { id: "2", answers: ["B"], status: "incorrect" },
          ],
          recipientsJson: ["teacher@example.com"],
          notes: null,
        }
      },
      async update(args) {
        state.incomingUpdateCalls.push(args)
        return {
          id: "incoming-2",
          status: "resolved",
          submittedStudentId: "TEMP-200",
          submittedEmail: "temp-200@example.com",
          pageTitle: "Flyers Reading 02",
          completedAt: new Date("2026-02-28T08:00:00.000Z"),
          totalQuestions: 2,
          correctCount: 1,
          pendingCount: 0,
          incorrectCount: 1,
          scorePercent: 50,
          answersJson: [
            { id: "1", answers: ["A"], status: "correct" },
            { id: "2", answers: ["B"], status: "incorrect" },
          ],
          recipientsJson: ["teacher@example.com"],
          notes: args.data.notes || null,
          reviewedByUsername: args.data.reviewedByUsername || null,
          matchedStudentRefId: args.data.matchedStudentRefId,
          resolvedAt: args.data.resolvedAt,
          createdAt: new Date("2026-02-28T07:59:59.000Z"),
          updatedAt: new Date("2026-02-28T08:01:00.000Z"),
          matchedStudent: {
            id: args.data.matchedStudentRefId,
            studentId: "S200",
          },
        }
      },
    },
    student: {
      async findUnique() {
        return {
          id: "student-200",
          studentId: "S200",
        }
      },
    },
    exercise: {
      async upsert() {
        return { id: "exercise-200" }
      },
    },
    exerciseSubmission: {
      async create(args) {
        state.submissionCreateCalls.push(args)
        return { id: "submission-200" }
      },
    },
    studentGradeRecord: {
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
