import test from "node:test"
import assert from "node:assert/strict"

import {
  selectCurrentNotYetDueAssignmentsByLevel,
  selectAttendanceRiskStudentsFromSignals,
  selectAtRiskStudentsFromSignals,
  summarizeTodayAttendanceForDashboard,
} from "../server/student-admin-store.mjs"

function buildProfileMap(total = 0, level = "A1 Movers") {
  const map = new Map()
  for (let index = 1; index <= total; index += 1) {
    map.set(`stu-${index}`, { currentGrade: level })
  }
  return map
}

function buildTodayRows({ present = 0, absent = 0 } = {}) {
  const rows = []
  for (let index = 1; index <= present; index += 1) {
    const isLate = index > present - 2
    rows.push({
      studentRefId: `stu-${index}`,
      level: "A1 Movers",
      status: isLate ? "late" : "present",
      comments: isLate ? (index % 2 === 0 ? "15 mins" : "35 mins") : "",
    })
  }
  for (let index = present + 1; index <= present + absent; index += 1) {
    rows.push({
      studentRefId: `stu-${index}`,
      level: "A1 Movers",
      status: "absent",
      comments: "",
    })
  }
  return rows
}

test("summarizeTodayAttendanceForDashboard keeps weekend absences tied to tracked rows", () => {
  const profileByStudentRefId = buildProfileMap(126)
  const rows = buildTodayRows({ present: 17, absent: 21 })

  const result = summarizeTodayAttendanceForDashboard({
    rows,
    profileByStudentRefId,
    totalEnrollment: 126,
    asOfDate: new Date("2026-03-07T09:00:00.000Z"), // Saturday
  })

  assert.equal(result.todayAttendanceCount, 17)
  assert.equal(result.todayAbsences, 21)
  assert.equal(result.totalTodayTracked, 38)
  assert.equal(result.tardy10PlusCount, 2)
  assert.equal(result.tardy30PlusCount, 1)
  assert.equal(result.attendanceByLevel.get("A1 Movers"), 17)
})

test("summarizeTodayAttendanceForDashboard keeps weekday tracked absences unchanged", () => {
  const profileByStudentRefId = buildProfileMap(126)
  const rows = buildTodayRows({ present: 17, absent: 21 })

  const result = summarizeTodayAttendanceForDashboard({
    rows,
    profileByStudentRefId,
    totalEnrollment: 126,
    asOfDate: new Date("2026-03-09T09:00:00.000Z"), // Monday
  })

  assert.equal(result.todayAttendanceCount, 17)
  assert.equal(result.todayAbsences, 21)
  assert.equal(result.totalTodayTracked, 38)
  assert.equal(result.tardy10PlusCount, 2)
  assert.equal(result.tardy30PlusCount, 1)
  assert.equal(result.attendanceByLevel.get("A1 Movers"), 17)
})

test("summarizeTodayAttendanceForDashboard de-duplicates per student and prefers attended over absent", () => {
  const profileByStudentRefId = buildProfileMap(3)
  const rows = [
    { studentRefId: "stu-1", level: "A1 Movers", status: "absent", comments: "" },
    { studentRefId: "stu-1", level: "A1 Movers", status: "late", comments: "32 mins" },
    { studentRefId: "stu-2", level: "A1 Movers", status: "absent", comments: "" },
    { studentRefId: "stu-2", level: "A1 Movers", status: "absent", comments: "" },
    { studentRefId: "stu-3", level: "A1 Movers", status: "late", comments: "8 mins" },
  ]

  const result = summarizeTodayAttendanceForDashboard({
    rows,
    profileByStudentRefId,
    totalEnrollment: 3,
    asOfDate: new Date("2026-03-10T09:00:00.000Z"), // Tuesday
  })

  assert.equal(result.todayAttendanceCount, 2)
  assert.equal(result.todayAbsences, 1)
  assert.equal(result.totalTodayTracked, 3)
  assert.equal(result.tardy10PlusCount, 1)
  assert.equal(result.tardy30PlusCount, 1)
  assert.equal(result.attendanceByLevel.get("A1 Movers"), 2)
})

test("selectCurrentNotYetDueAssignmentsByLevel chooses the nearest future assignment per level", () => {
  const now = new Date("2026-03-08T09:00:00.000Z")
  const result = selectCurrentNotYetDueAssignmentsByLevel(
    [
      {
        studentRefId: "stu-1",
        level: "A2 KET",
        assignmentName: "Future Near",
        dueAt: "2026-03-10T00:00:00.000Z",
        submittedAt: "2026-03-08T08:00:00.000Z",
        homeworkCompleted: true,
      },
      {
        studentRefId: "stu-2",
        level: "A2 KET",
        assignmentName: "Future Near",
        dueAt: "2026-03-10T00:00:00.000Z",
        submittedAt: "",
        homeworkCompleted: false,
      },
      {
        studentRefId: "stu-1",
        level: "A2 KET",
        assignmentName: "Future Later",
        dueAt: "2026-03-14T00:00:00.000Z",
        homeworkCompleted: false,
      },
      {
        studentRefId: "stu-9",
        level: "A1 Movers",
        assignmentName: "Movers Upcoming",
        dueAt: "2026-03-11T00:00:00.000Z",
        homeworkCompleted: false,
      },
    ],
    now
  )

  assert.equal(result.length, 2)
  assert.equal(result[0].level, "A1 Movers")
  assert.equal(result[0].assignmentName, "Movers Upcoming")
  assert.equal(result[1].level, "A2 KET")
  assert.equal(result[1].assignmentName, "Future Near")
  assert.equal(result[1].dueAt, "2026-03-10")
  assert.deepEqual(
    result[1].students.map((entry) => entry.studentRefId),
    ["stu-1", "stu-2"]
  )
  assert.equal(result[1].students[0].completed, true)
  assert.equal(result[1].students[0].submittedAt, "2026-03-08")
  assert.equal(result[1].students[1].completed, false)
})

test("selectCurrentNotYetDueAssignmentsByLevel ignores overdue and invalid due dates", () => {
  const now = new Date("2026-03-08T09:00:00.000Z")
  const result = selectCurrentNotYetDueAssignmentsByLevel(
    [
      {
        studentRefId: "stu-1",
        level: "A2 Flyers",
        assignmentName: "Overdue",
        dueAt: "2026-03-07T00:00:00.000Z",
        homeworkCompleted: false,
      },
      {
        studentRefId: "stu-2",
        level: "A2 Flyers",
        assignmentName: "Invalid date",
        dueAt: "bad-value",
        homeworkCompleted: false,
      },
      {
        studentRefId: "stu-3",
        level: "A2 Flyers",
        assignmentName: "Upcoming",
        dueAt: "2026-03-09T00:00:00.000Z",
        homeworkCompleted: false,
      },
    ],
    now
  )

  assert.equal(result.length, 1)
  assert.equal(result[0].level, "A2 Flyers")
  assert.equal(result[0].assignmentName, "Upcoming")
  assert.equal(result[0].dueAt, "2026-03-09")
  assert.deepEqual(
    result[0].students.map((entry) => entry.studentRefId),
    ["stu-3"]
  )
})

test("selectCurrentNotYetDueAssignmentsByLevel excludes auto-imported external exercise rows", () => {
  const now = new Date("2026-03-08T09:00:00.000Z")
  const result = selectCurrentNotYetDueAssignmentsByLevel(
    [
      {
        studentRefId: "stu-1",
        level: "A2 KET",
        className: "MEGS Reading Pack 1",
        assignmentName: "MEGS Reading Pack 1",
        dueAt: "2026-03-10T00:00:00.000Z",
        submittedAt: "2026-03-10T00:00:00.000Z",
        homeworkCompleted: true,
        homeworkOnTime: true,
        score: 90,
        maxScore: 100,
        comments: "",
      },
      {
        studentRefId: "stu-1",
        level: "A2 KET",
        className: "A2 KET",
        assignmentName: "Class Homework 7",
        dueAt: "2026-03-11T00:00:00.000Z",
        submittedAt: "",
        homeworkCompleted: false,
      },
      {
        studentRefId: "stu-2",
        level: "A2 KET",
        className: "A2 KET",
        assignmentName: "Class Homework 7",
        dueAt: "2026-03-11T00:00:00.000Z",
        submittedAt: "",
        homeworkCompleted: false,
      },
    ],
    now
  )

  assert.equal(result.length, 1)
  assert.equal(result[0].level, "A2 KET")
  assert.equal(result[0].assignmentName, "Class Homework 7")
  assert.equal(result[0].dueAt, "2026-03-11")
  assert.deepEqual(
    result[0].students.map((entry) => entry.studentRefId),
    ["stu-1", "stu-2"]
  )
  assert.equal(result[0].students[0].completed, false)
  assert.equal(result[0].students[1].completed, false)
})

test("selectCurrentNotYetDueAssignmentsByLevel keeps imported exercise rows when they carry an explicit assignment due date", () => {
  const now = new Date("2026-03-08T09:00:00.000Z")
  const result = selectCurrentNotYetDueAssignmentsByLevel(
    [
      {
        studentRefId: "stu-1",
        level: "A2 KET",
        className: "MEGS Listening Pack 2",
        assignmentName: "MEGS Listening Pack 2",
        dueAt: "2026-03-12T00:00:00.000Z",
        submittedAt: "2026-03-09T08:00:00.000Z",
        homeworkCompleted: true,
        homeworkOnTime: true,
        score: 90,
        maxScore: 100,
        comments: "Auto-imported exercise score (9/10 correct).",
      },
    ],
    now
  )

  assert.equal(result.length, 1)
  assert.equal(result[0].level, "A2 KET")
  assert.equal(result[0].assignmentName, "MEGS Listening Pack 2")
  assert.equal(result[0].dueAt, "2026-03-12")
  assert.equal(result[0].students.length, 1)
  assert.equal(result[0].students[0].studentRefId, "stu-1")
  assert.equal(result[0].students[0].completed, true)
  assert.equal(result[0].students[0].submittedAt, "2026-03-09")
})

test("selectAtRiskStudentsFromSignals only flags students with overdue outstanding assignments", () => {
  const result = selectAtRiskStudentsFromSignals([
    { fullName: "Brian", absences: 2, late30Plus: 0, outstandingWeek: 0 },
    { fullName: "Nancy", absences: 0, late30Plus: 2, outstandingWeek: 0 },
    { fullName: "Harry", absences: 0, late30Plus: 0, outstandingWeek: 1 },
  ])

  assert.equal(result.length, 1)
  assert.equal(result[0].fullName, "Harry")
  assert.equal(result[0].outstandingWeek, 1)
})

test("selectAtRiskStudentsFromSignals sorts by outstanding assignments then student name", () => {
  const result = selectAtRiskStudentsFromSignals([
    { fullName: "Zulu", outstandingWeek: 1 },
    { fullName: "Alpha", outstandingWeek: 3 },
    { fullName: "Bravo", outstandingWeek: 3 },
    { fullName: "Echo", outstandingWeek: "2" },
  ])

  assert.deepEqual(
    result.map((entry) => entry.fullName),
    ["Alpha", "Bravo", "Echo", "Zulu"]
  )
  assert.deepEqual(
    result.map((entry) => Number.parseInt(String(entry.outstandingWeek), 10)),
    [3, 3, 2, 1]
  )
})

test("selectAttendanceRiskStudentsFromSignals keeps attendance thresholds independent from assignment outstanding", () => {
  const result = selectAttendanceRiskStudentsFromSignals([
    { fullName: "Brian", absences: 2, late30Plus: 0, outstandingWeek: 0 },
    { fullName: "Nancy", absences: 0, late30Plus: 1, outstandingWeek: 0 },
    { fullName: "Harry", absences: 0, late30Plus: 0, outstandingWeek: 3 },
  ])

  assert.deepEqual(
    result.map((entry) => entry.fullName),
    ["Brian", "Nancy"]
  )
})

test("selectAttendanceRiskStudentsFromSignals sorts by attendance risk score then name", () => {
  const result = selectAttendanceRiskStudentsFromSignals([
    { fullName: "Zulu", absences: 2, late30Plus: 0 },
    { fullName: "Alpha", absences: 2, late30Plus: 1 },
    { fullName: "Bravo", absences: 2, late30Plus: 1 },
  ])

  assert.deepEqual(
    result.map((entry) => entry.fullName),
    ["Alpha", "Bravo", "Zulu"]
  )
})
