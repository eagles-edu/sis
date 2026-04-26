import assert from "node:assert/strict"
import test from "node:test"

import {
  deleteAttendanceRecord,
  deleteGradeRecord,
  findFamilyByEmergencyPhone,
  isAssignmentTrackingGradeRecord,
  isCompletedGradeRecord,
  isLateCompletedGradeRecord,
  isOnTimeCompletedGradeRecord,
  isOutstandingGradeRecord,
  mapGradeRecordForApi,
  saveAttendanceRecord,
  saveGradeRecord,
} from "../src/modules/admin/student-records.mjs"

test("student records module exposes the admin attendance, grades, and family APIs", () => {
  assert.equal(typeof findFamilyByEmergencyPhone, "function")
  assert.equal(typeof saveAttendanceRecord, "function")
  assert.equal(typeof deleteAttendanceRecord, "function")
  assert.equal(typeof saveGradeRecord, "function")
  assert.equal(typeof deleteGradeRecord, "function")
  assert.equal(typeof isCompletedGradeRecord, "function")
  assert.equal(typeof isOutstandingGradeRecord, "function")
  assert.equal(typeof isLateCompletedGradeRecord, "function")
  assert.equal(typeof isOnTimeCompletedGradeRecord, "function")
  assert.equal(typeof isAssignmentTrackingGradeRecord, "function")
  assert.equal(typeof mapGradeRecordForApi, "function")
})

test("mapGradeRecordForApi infers record source from grade payload shape", () => {
  assert.equal(mapGradeRecordForApi({ id: "manual-1" }).source, "manual")
  assert.equal(
    mapGradeRecordForApi({
      className: "Writing",
      assignmentName: "Essay Draft",
      dueAt: "2026-04-01T09:00:00.000Z",
    }).source,
    "assignment"
  )
  assert.equal(
    mapGradeRecordForApi({
      className: "Writing",
      assignmentName: "Writing",
      dueAt: "2026-04-01T09:00:00.000Z",
      submittedAt: "2026-04-01T09:00:00.000Z",
      homeworkCompleted: true,
      homeworkOnTime: true,
      comments: "auto-imported exercise score 21",
    }).source,
    "auto-import"
  )
  assert.equal(isCompletedGradeRecord({ homeworkCompleted: true }), true)
  assert.equal(
    isOutstandingGradeRecord(
      { dueAt: "2026-04-01T09:00:00.000Z" },
      new Date("2026-04-02T00:00:00.000Z")
    ),
    true
  )
  assert.equal(isLateCompletedGradeRecord({ homeworkCompleted: true, homeworkOnTime: false }), true)
  assert.equal(isOnTimeCompletedGradeRecord({ homeworkCompleted: true, homeworkOnTime: true }), true)
  assert.equal(isAssignmentTrackingGradeRecord({ assignmentName: "Essay Draft" }), true)
  assert.equal(
    isAssignmentTrackingGradeRecord({
      className: "Writing",
      assignmentName: "Writing",
      dueAt: "2026-04-01T09:00:00.000Z",
      submittedAt: "2026-04-01T09:00:00.000Z",
      homeworkCompleted: true,
      homeworkOnTime: true,
      comments: "auto-imported exercise score 21",
    }),
    false
  )
})
