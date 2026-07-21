import test from "node:test"
import assert from "node:assert/strict"
import {
  courseWeekNumberForSchoolSetupDate,
  generateCourseWeekCalendar,
} from "../src/modules/admin/course-week-calendar.mjs"

test("generates 52 consecutive weeks from the configured Q1 Saturday", () => {
  const calendar = generateCourseWeekCalendar({
    schoolYear: "2026-2027",
    q1StartDate: "2026-02-21",
    q1EndDate: "2026-05-15",
  })
  assert.equal(calendar.weeks.length, 52)
  assert.deepEqual(calendar.weeks[0], {
    weekNumber: 1,
    saturday: "2026-02-21",
    sunday: "2026-02-22",
    startDate: "2026-02-21",
    endDate: "2026-02-27",
  })
  assert.equal(calendar.weeks[51].weekNumber, 52)
  assert.equal(
    courseWeekNumberForSchoolSetupDate("2026-06-16", "2026-2027", {
      courseWeekCalendars: [calendar],
    }),
    17,
  )
})

test("does not generate a calendar without a valid Saturday anchor", () => {
  assert.equal(
    generateCourseWeekCalendar({
      schoolYear: "2026-2027",
      q1StartDate: "2026-02-20",
      q1EndDate: "2026-05-15",
    }),
    null,
  )
})
