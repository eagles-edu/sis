import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

import {
  buildStudentNewsReviewSelect,
  listStudentNewsReportsForReview,
  normalizeStudentNewsReviewStatus,
  normalizeStudentNewsReviewTake,
  resolveStudentNewsReviewActionStatus,
  resolveStudentNewsStatusColor,
  reviewStudentNewsReport,
} from "../src/modules/admin/student-news-review.mjs"

test("student news review module exposes the review API surface", () => {
  assert.equal(typeof listStudentNewsReportsForReview, "function")
  assert.equal(typeof reviewStudentNewsReport, "function")
  assert.equal(typeof buildStudentNewsReviewSelect, "function")
  assert.equal(typeof normalizeStudentNewsReviewStatus, "function")
  assert.equal(typeof normalizeStudentNewsReviewTake, "function")
  assert.equal(typeof resolveStudentNewsReviewActionStatus, "function")
  assert.equal(typeof resolveStudentNewsStatusColor, "function")
})

test("student news review helpers normalize status, action, and selection rules", () => {
  assert.equal(normalizeStudentNewsReviewStatus("approve"), "approved")
  assert.equal(normalizeStudentNewsReviewStatus("revise"), "revision-requested")
  assert.equal(resolveStudentNewsReviewActionStatus({ action: "revision-requested" }), "revision-requested")
  assert.equal(resolveStudentNewsReviewActionStatus({ action: "revise" }), "revision-requested")
  assert.equal(resolveStudentNewsReviewActionStatus({ action: "reset" }), "submitted")
  assert.equal(resolveStudentNewsStatusColor("approved"), "green")
  assert.equal(resolveStudentNewsStatusColor("revision-requested"), "red")
  assert.equal(normalizeStudentNewsReviewTake("999"), 500)

  const publicSelect = buildStudentNewsReviewSelect({ includeReviewFields: false })
  assert.equal(Object.prototype.hasOwnProperty.call(publicSelect, "reviewStatus"), false)
  assert.equal(Object.prototype.hasOwnProperty.call(publicSelect, "student"), true)

  const reviewSelect = buildStudentNewsReviewSelect({ includeReviewFields: true })
  assert.equal(reviewSelect.reviewStatus, true)
  assert.equal(reviewSelect.reviewNote, true)
  assert.equal(reviewSelect.validationIssuesJson, true)
  assert.equal(reviewSelect.reviewedByUsername, true)
  assert.equal(reviewSelect.reviewedAt, true)
  assert.equal(reviewSelect.submissionState, true)
})

test("student news admin review keeps admin statuses unchanged and only excludes pre-submit states", () => {
  const source = fs.readFileSync(new URL("../src/modules/admin/student-news-review.mjs", import.meta.url), "utf8")
  assert.match(source, /where\.submissionState = STUDENT_NEWS_SUBMISSION_STATE_SUBMITTED/)
  assert.match(source, /return !submissionState \|\| submissionState === STUDENT_NEWS_SUBMISSION_STATE_SUBMITTED/)
  assert.match(source, /const STUDENT_NEWS_REVIEW_STATUS_SUBMITTED = "submitted"/)
  assert.match(source, /const STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED = "revision-requested"/)
  assert.match(source, /const STUDENT_NEWS_REVIEW_STATUS_APPROVED = "approved"/)
})

test("student news revision requests reopen editing for a 15-day deadline", () => {
  const source = fs.readFileSync(new URL("../src/modules/admin/student-news-review.mjs", import.meta.url), "utf8")
  assert.match(source, /function resolveStudentNewsRevisionEditableUntil\(now = new Date\(\)\)/)
  assert.match(source, /return endOfDay\(addDays\(now, 15\)\)/)
  assert.match(source, /if \(reviewStatus === STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED\) \{\s*updateData\.editableUntil = resolveStudentNewsRevisionEditableUntil\(now\)/)
})
