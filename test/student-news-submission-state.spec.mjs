import test from "node:test"
import assert from "node:assert/strict"

import { mapStudentNewsReportRow } from "../src/modules/admin/student-news-submissions.mjs"

test("post-cutoff report without firstSubmittedAt cannot map as submitted", () => {
  const item = mapStudentNewsReportRow({
    id: "report-1",
    createdAt: "2026-07-01T10:00:00.000Z",
    submissionState: "submitted",
    submittedAt: "2026-07-01T10:00:00.000Z",
    firstSubmittedAt: null,
    mmrPassedAt: null,
    dateSatisfiedAt: null,
    reportDateLockedAt: null,
  })
  assert.equal(item.submissionState, "draft")
  assert.equal(item.firstSubmittedAt, "")
})

test("post-cutoff report with check evidence maps as ready", () => {
  const item = mapStudentNewsReportRow({
    id: "report-2",
    createdAt: "2026-07-01T10:00:00.000Z",
    submissionState: "submitted",
    firstSubmittedAt: null,
    mmrPassedAt: "2026-07-01T10:00:00.000Z",
  })
  assert.equal(item.submissionState, "ready")
})

test("firstSubmittedAt is authoritative for submitted state", () => {
  const item = mapStudentNewsReportRow({
    id: "report-3",
    createdAt: "2026-07-01T10:00:00.000Z",
    submissionState: "draft",
    firstSubmittedAt: "2026-07-02T10:00:00.000Z",
  })
  assert.equal(item.submissionState, "submitted")
})
