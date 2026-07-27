import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

import {
  buildStudentNewsReviewSelect,
  listStudentNewsReportsForReview,
  normalizeStudentNewsReviewStatus,
  normalizeStudentNewsReviewTake,
  reviewStudentNewsReportsBulk,
  resolveStudentNewsReviewActionStatus,
  resolveStudentNewsStatusColor,
  reviewStudentNewsReport,
} from "../src/modules/admin/student-news-review.mjs"

test("student news review module exposes the review API surface", () => {
  assert.equal(typeof listStudentNewsReportsForReview, "function")
  assert.equal(typeof reviewStudentNewsReport, "function")
  assert.equal(typeof reviewStudentNewsReportsBulk, "function")
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

test("student news admin review keeps admin statuses unchanged and can expose saved drafts", () => {
  const source = fs.readFileSync(new URL("../src/modules/admin/student-news-review.mjs", import.meta.url), "utf8")
  assert.match(source, /const requestedSubmissionState = rawStatus === "draft" \? "draft" : ""/)
  assert.match(source, /rawStatus === "all" \|\| !submissionState \|\| submissionState === STUDENT_NEWS_SUBMISSION_STATE_SUBMITTED/)
  assert.match(source, /const STUDENT_NEWS_REVIEW_STATUS_SUBMITTED = "submitted"/)
  assert.match(source, /const STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED = "revision-requested"/)
  assert.match(source, /const STUDENT_NEWS_REVIEW_STATUS_APPROVED = "approved"/)
  assert.match(source, /await reconcileStudentNewsAutoApprovals\(\)/)
  assert.match(source, /editablePayload\.vocabularyJson = existingReport\.vocabularyJson/)
  assert.doesNotMatch(source, /Approved news reports cannot be edited/)
  assert.match(source, /const filtered = mapped\.filter\(\(entry\) => \{/)
  assert.match(source, /submissionState === "draft"/)
})

test("admin news review keeps every report status actionable and grants revision access", () => {
  const review = fs.readFileSync(new URL("../src/modules/admin/student-news-review.mjs", import.meta.url), "utf8")
  const fallback = fs.readFileSync(new URL("../src/modules/admin/student-news-fallback.mjs", import.meta.url), "utf8")
  const admin = fs.readFileSync(new URL("../server/student-admin-routes.mjs", import.meta.url), "utf8")

  assert.doesNotMatch(review, /existingReport\?\.reviewStatus[\s\S]{0,240}Approved news reports cannot be edited/)
  assert.doesNotMatch(fallback, /Approved news reports cannot be edited/)
  assert.match(review, /if \(action === "save"\) \{[\s\S]*normalizeStudentNewsReviewEditablePayload\(payload\)/)
  assert.match(review, /if \(reviewStatus === STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED\) \{[\s\S]*updateData\.editableUntil/)
  assert.match(admin, /if \(newsReportMatch && method === "POST"\) \{[\s\S]*assertCanManageUsers\(rolePolicy\)/)
})

test("student news revision requests reopen editing for a 15-day deadline", () => {
  const source = fs.readFileSync(new URL("../src/modules/admin/student-news-review.mjs", import.meta.url), "utf8")
  assert.match(source, /function resolveStudentNewsRevisionEditableUntil\(now = new Date\(\)\)/)
  assert.match(source, /return endOfDay\(addDays\(now, 15\)\)/)
  assert.match(source, /if \(reviewStatus === STUDENT_NEWS_REVIEW_STATUS_REVISION_REQUESTED\) \{\s*updateData\.editableUntil = resolveStudentNewsRevisionEditableUntil\(now\)/)
})

test("student news bulk review validates report ids before any store work", async () => {
  await assert.rejects(
    () => reviewStudentNewsReportsBulk({ action: "approve", reportIds: [] }),
    (error) => {
      assert.match(String(error?.message || ""), /reportIds are required/i)
      return true
    },
  )
  await assert.rejects(
    () => reviewStudentNewsReportsBulk({ action: "revision-requested", reportIds: ["news-001"] }),
    (error) => {
      assert.match(String(error?.message || ""), /unsupported bulk news review action/i)
      return true
    },
  )
})
