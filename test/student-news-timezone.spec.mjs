import test from "node:test"
import assert from "node:assert/strict"

import {
  buildStudentNewsCalendarRows,
  resolveStudentNewsSubmissionWindow,
} from "../server/student-admin-store.mjs"

test("resolveStudentNewsSubmissionWindow normalizes day boundaries to UTC+7", () => {
  const now = new Date("2026-03-13T17:10:00.000Z") // 2026-03-14 00:10 in UTC+7
  const window = resolveStudentNewsSubmissionWindow(now)

  assert.equal(window.todayDate, "2026-03-14")
  assert.equal(window.reportDate, "2026-03-14")
  assert.equal(window.opensAt, "2026-03-13T17:00:00.000Z")
  assert.equal(window.closesAt, "2026-03-14T16:59:59.999Z")
  assert.equal(window.isOpen, true)
  assert.equal(window.closedReason, "")
})

test("resolveStudentNewsSubmissionWindow keeps Friday open in UTC+7", () => {
  const now = new Date("2026-03-13T03:00:00.000Z") // 2026-03-13 10:00 in UTC+7 (Friday)
  const window = resolveStudentNewsSubmissionWindow(now)

  assert.equal(window.todayDate, "2026-03-13")
  assert.equal(window.reportDate, "2026-03-13")
  assert.equal(window.isOpen, true)
  assert.equal(window.closedReason, "")
})

test("buildStudentNewsCalendarRows resolves open/completed states in UTC+7", () => {
  const now = new Date("2026-03-13T17:10:00.000Z") // 2026-03-14 00:10 in UTC+7
  const reports = [
    {
      reportDate: new Date("2026-03-11T17:00:00.000Z"), // 2026-03-12 in UTC+7
      submittedAt: "2026-03-12T03:45:00.000Z",
    },
  ]

  const rows = buildStudentNewsCalendarRows({ now, reports, days: 7 })
  assert.ok(Array.isArray(rows))
  assert.equal(rows[0]?.date, "2026-03-14")
  assert.equal(rows[0]?.status, "open")
  assert.equal(rows[0]?.canSubmit, true)

  assert.equal(rows[1]?.date, "2026-03-13")
  assert.equal(rows[1]?.status, "missed")
  assert.equal(rows[1]?.canSubmit, false)

  assert.equal(rows[2]?.date, "2026-03-12")
  assert.equal(rows[2]?.status, "completed")
  assert.equal(rows[2]?.canSubmit, false)
})
