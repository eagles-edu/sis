import assert from "node:assert/strict"
import test from "node:test"

import { validateAttendanceSchoolContext } from "../src/modules/admin/attendance-school-setup.mjs"
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

const validAttendanceSchoolSetup = {
  schoolYear: "2026-2027",
  startDate: "2026-02-21",
  endDate: "2027-01-24",
  schoolSetupState: "ok",
  quarters: [
    { quarter: "q1", startDate: "2026-02-21", endDate: "2026-05-15" },
    { quarter: "q2", startDate: "2026-05-16", endDate: "2026-08-07" },
    { quarter: "q3", startDate: "2026-08-08", endDate: "2026-10-31" },
    { quarter: "q4", startDate: "2026-11-01", endDate: "2027-01-24" },
  ],
}

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

test("attendance school context accepts configured inclusive boundaries and exact quarters", () => {
  const boundaries = [
    ["2026-02-21", "q1"],
    ["2026-05-15", "q1"],
    ["2026-05-16", "q2"],
    ["2026-08-07", "q2"],
    ["2026-08-08", "q3"],
    ["2026-10-31", "q3"],
    ["2026-11-01", "q4"],
    ["2027-01-24", "q4"],
  ]

  for (const [attendanceDate, quarter] of boundaries) {
    assert.deepEqual(
      validateAttendanceSchoolContext({
        schoolYear: "2026-2027",
        quarter,
        attendanceDate,
        setup: validAttendanceSchoolSetup,
      }),
      { schoolYear: "2026-2027", quarter, attendanceDate },
      `${attendanceDate} must be accepted in ${quarter}`,
    )
  }
})

test("attendance school context rejects dates outside the year even when a course week exists", () => {
  assert.throws(
    () => validateAttendanceSchoolContext({
      schoolYear: "2026-2027",
      quarter: "q4",
      attendanceDate: "2027-01-25",
      setup: validAttendanceSchoolSetup,
    }),
    { statusCode: 422, message: "attendanceDate is outside configured SIS school-year dates" },
  )
})

test("saveAttendanceRecord rejects an out-of-school-year date before opening the database", async () => {
  await assert.rejects(
    saveAttendanceRecord("synthetic-attendance-boundary", {
      className: "A2 KET",
      schoolYear: "2026-2027",
      quarter: "q4",
      attendanceDate: "2027-01-25",
      status: "present",
    }),
    { statusCode: 422, message: "attendanceDate is outside configured SIS school-year dates" },
  )
})

test("attendance school context rejects mismatched school year and quarter", () => {
  assert.throws(
    () => validateAttendanceSchoolContext({
      schoolYear: "2027-2028",
      quarter: "q2",
      attendanceDate: "2026-07-19",
      setup: validAttendanceSchoolSetup,
    }),
    { statusCode: 422, message: "schoolYear does not match configured SIS school year" },
  )
  assert.throws(
    () => validateAttendanceSchoolContext({
      schoolYear: "2026-2027",
      quarter: "q3",
      attendanceDate: "2026-07-19",
      setup: validAttendanceSchoolSetup,
    }),
    { statusCode: 422, message: "quarter does not match attendanceDate's configured SIS quarter" },
  )
})

test("attendance school context fails closed for malformed or incomplete setup", () => {
  const invalidSetups = [
    {
      setup: { ...validAttendanceSchoolSetup, schoolSetupState: "missing" },
      message: "SIS school setup is invalid or incomplete",
    },
    {
      setup: { ...validAttendanceSchoolSetup, schoolYear: "" },
      message: "SIS school setup is invalid or incomplete",
    },
    {
      setup: { ...validAttendanceSchoolSetup, startDate: "2026-02-30" },
      message: "SIS school setup is invalid or incomplete",
    },
    {
      setup: {
        ...validAttendanceSchoolSetup,
        quarters: validAttendanceSchoolSetup.quarters.slice(0, 3),
      },
      message: "SIS school setup has invalid quarter boundaries",
    },
    {
      setup: {
        ...validAttendanceSchoolSetup,
        quarters: validAttendanceSchoolSetup.quarters.map((quarter, index) =>
          index === 1 ? { ...quarter, startDate: "2026-05-17" } : quarter
        ),
      },
      message: "SIS quarter dates are not sequential",
    },
    {
      setup: {
        ...validAttendanceSchoolSetup,
        quarters: validAttendanceSchoolSetup.quarters.map((quarter, index) =>
          index === 3 ? { ...quarter, endDate: "2027-01-23" } : quarter
        ),
      },
      message: "SIS Q4 does not match the school-year end date",
    },
  ]

  for (const { setup, message } of invalidSetups) {
    assert.throws(
      () => validateAttendanceSchoolContext({
        schoolYear: "2026-2027",
        quarter: "q1",
        attendanceDate: "2026-02-21",
        setup,
      }),
      { statusCode: 422, message },
    )
  }

  assert.throws(
    () => validateAttendanceSchoolContext({
      schoolYear: "2026-2027",
      quarter: "q1",
      attendanceDate: "2026-02-30",
      setup: validAttendanceSchoolSetup,
    }),
    { statusCode: 422, message: "attendanceDate is outside configured SIS school-year dates" },
  )
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
