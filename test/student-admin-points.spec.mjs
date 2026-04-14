import assert from "node:assert/strict"
import test from "node:test"

import {
  buildStudentPointsEvents,
  createStudentPointsAdjustment,
  getSchoolPointsYtdSummary,
  listStudentPointsLedger,
  listStudentPointsSnapshots,
  STUDENT_POINTS_ELECTIVE_SUBMISSION_VALUE,
  STUDENT_POINTS_SCHEDULED_ON_TIME_VALUE,
  setStudentPointsTotal,
  sumStudentPointsEvents,
} from "../src/modules/admin/points.mjs"

test("points module exposes the admin points API surface", () => {
  assert.equal(typeof buildStudentPointsEvents, "function")
  assert.equal(typeof sumStudentPointsEvents, "function")
  assert.equal(typeof listStudentPointsSnapshots, "function")
  assert.equal(typeof getSchoolPointsYtdSummary, "function")
  assert.equal(typeof listStudentPointsLedger, "function")
  assert.equal(typeof createStudentPointsAdjustment, "function")
  assert.equal(typeof setStudentPointsTotal, "function")
  assert.equal(STUDENT_POINTS_SCHEDULED_ON_TIME_VALUE, 10)
  assert.equal(STUDENT_POINTS_ELECTIVE_SUBMISSION_VALUE, 21)
})

test("buildStudentPointsEvents combines points sources in chronological order", () => {
  const events = buildStudentPointsEvents({
    gradeRecords: [
      {
        id: "grade-1",
        studentRefId: "student-1",
        assignmentName: "Essay Draft",
        className: "Writing",
        dueAt: "2026-04-01T09:00:00.000Z",
        submittedAt: "2026-04-01T08:15:00.000Z",
        homeworkCompleted: true,
        homeworkOnTime: true,
      },
    ],
    approvedReports: [
      {
        id: "report-1",
        studentRefId: "student-1",
        className: "Writing",
        participationPointsAward: "5",
        approvedAt: "2026-04-02T10:00:00.000Z",
      },
    ],
    adjustments: [
      {
        id: "adjustment-1",
        studentRefId: "student-1",
        pointsDelta: "-3",
        appliedAt: "2026-04-03T11:00:00.000Z",
      },
    ],
  })

  assert.deepEqual(events.map((entry) => entry.eventType), [
    "scheduled-assignment-on-time",
    "report-participation-approved",
    "admin-adjustment",
  ])
  assert.equal(sumStudentPointsEvents(events), 12)
})
