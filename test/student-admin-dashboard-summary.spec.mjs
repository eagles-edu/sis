import test from "node:test"
import assert from "node:assert/strict"

import { summarizeTodayAttendanceForDashboard } from "../server/student-admin-store.mjs"

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

test("summarizeTodayAttendanceForDashboard reconciles weekend attendance to enrolled headcount", () => {
  const profileByStudentRefId = buildProfileMap(126)
  const rows = buildTodayRows({ present: 17, absent: 21 })

  const result = summarizeTodayAttendanceForDashboard({
    rows,
    profileByStudentRefId,
    totalEnrollment: 126,
    asOfDate: new Date("2026-03-07T09:00:00.000Z"), // Saturday
  })

  assert.equal(result.todayAttendanceCount, 17)
  assert.equal(result.todayAbsences, 109)
  assert.equal(result.totalTodayTracked, 126)
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
