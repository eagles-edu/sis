import test from "node:test"
import assert from "node:assert/strict"

import {
  classifyAction,
  incomingFingerprint,
  isIncomingMalformed,
  parseArgs,
} from "../tools/vacuum-incoming-exercise-results.mjs"

test("parseArgs keeps safe defaults", () => {
  const args = parseArgs([])
  assert.equal(args.apply, false)
  assert.equal(args.deleteUnmatched, true)
  assert.equal(args.deleteMalformed, true)
  assert.equal(args.purgeResolvedDays, 45)
  assert.equal(args.purgeArchivedDays, 45)
  assert.equal(args.reportRetentionDays, 30)
})

test("parseArgs supports keep flags and numeric windows", () => {
  const args = parseArgs([
    "--apply",
    "--keep-unmatched",
    "--keep-malformed",
    "--purge-resolved-days",
    "10",
    "--purge-archived-days",
    "20",
    "--report-retention-days",
    "15",
  ])
  assert.equal(args.apply, true)
  assert.equal(args.deleteUnmatched, false)
  assert.equal(args.deleteMalformed, false)
  assert.equal(args.purgeResolvedDays, 10)
  assert.equal(args.purgeArchivedDays, 20)
  assert.equal(args.reportRetentionDays, 15)
})

test("isIncomingMalformed validates required identity/title and score sums", () => {
  const valid = {
    submittedEaglesId: "eag001",
    submittedEmail: "student@example.com",
    pageTitle: "1.1.4 Collective Nouns",
    completedAt: "2026-03-14T13:39:59.540Z",
    totalQuestions: 10,
    correctCount: 8,
    pendingCount: 1,
    incorrectCount: 1,
  }
  assert.equal(isIncomingMalformed(valid), false)
  assert.equal(isIncomingMalformed({ ...valid, submittedEaglesId: "", submittedEmail: "" }), true)
  assert.equal(isIncomingMalformed({ ...valid, pageTitle: "" }), true)
  assert.equal(isIncomingMalformed({ ...valid, totalQuestions: 10, correctCount: 9, pendingCount: 1, incorrectCount: 1 }), true)
})

test("incomingFingerprint collapses case-only differences", () => {
  const left = incomingFingerprint({
    submittedEaglesId: "EAG001",
    submittedEmail: "A@EXAMPLE.COM",
    pageTitle: "Unit 1",
    completedAt: "2026-03-14T13:39:59.540Z",
  })
  const right = incomingFingerprint({
    submittedEaglesId: "eag001",
    submittedEmail: "a@example.com",
    pageTitle: "unit 1",
    completedAt: "2026-03-14T13:39:59.540Z",
  })
  assert.equal(left, right)
})

test("classifyAction resolves matched rows and routes malformed/unmatched correctly", () => {
  const row = {
    submittedEaglesId: "eag001",
    pageTitle: "Unit 1",
    completedAt: "2026-03-14T13:39:59.540Z",
    totalQuestions: 10,
    correctCount: 8,
    pendingCount: 1,
    incorrectCount: 1,
  }

  const resolveAction = classifyAction(row, {
    isDuplicate: false,
    studentCandidate: { id: "student-1" },
    candidateReason: "matched-by-eaglesId",
    deleteUnmatched: true,
    deleteMalformed: true,
  })
  assert.equal(resolveAction.action, "resolve")

  const malformedAction = classifyAction({ ...row, pageTitle: "" }, {
    isDuplicate: false,
    studentCandidate: null,
    candidateReason: "no-student-match",
    deleteUnmatched: true,
    deleteMalformed: false,
  })
  assert.equal(malformedAction.action, "manual")

  const unmatchedAction = classifyAction(row, {
    isDuplicate: false,
    studentCandidate: null,
    candidateReason: "no-student-match",
    deleteUnmatched: true,
    deleteMalformed: true,
  })
  assert.equal(unmatchedAction.action, "delete")
})
