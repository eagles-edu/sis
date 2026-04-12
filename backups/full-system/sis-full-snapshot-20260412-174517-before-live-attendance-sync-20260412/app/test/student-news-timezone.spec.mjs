import fs from "node:fs"
import test from "node:test"
import assert from "node:assert/strict"

import {
  buildStudentNewsCalendarRows,
  resolveStudentNewsSubmissionWindow,
  resolveStudentNewsQuarterWindow,
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

test("resolveStudentNewsQuarterWindow honors School Setup quarter windows for revise-mode edits", { concurrency: false }, () => {
  const tempSettingsPath = `/tmp/sis-student-news-quarter-${process.pid}.json`
  const originalSettingsPath = process.env.STUDENT_ADMIN_UI_SETTINGS_FILE
  const payload = {
    uiSettings: {
      schoolSetup: {
        schoolYear: "2026-2027",
        quarters: [
          { quarter: "q1", startDate: "2026-08-10", endDate: "2026-10-31" },
          { quarter: "q2", startDate: "2026-11-01", endDate: "2027-01-31" },
          { quarter: "q3", startDate: "2027-02-01", endDate: "2027-03-31" },
          { quarter: "q4", startDate: "2027-04-01", endDate: "2027-05-28" },
        ],
      },
    },
  }

  fs.writeFileSync(tempSettingsPath, JSON.stringify(payload), "utf8")
  process.env.STUDENT_ADMIN_UI_SETTINGS_FILE = tempSettingsPath

  try {
    const window = resolveStudentNewsQuarterWindow(new Date("2027-03-15T03:00:00.000Z"))

    assert.equal(window.quarter, "q3")
    assert.equal(window.startDate, "2027-02-01")
    assert.equal(window.endDate, "2027-03-31")
    assert.equal(window.startAt.toISOString(), "2027-01-31T17:00:00.000Z")
    assert.equal(window.endAt.toISOString(), "2027-03-31T16:59:59.999Z")
  } finally {
    if (originalSettingsPath === undefined) delete process.env.STUDENT_ADMIN_UI_SETTINGS_FILE
    else process.env.STUDENT_ADMIN_UI_SETTINGS_FILE = originalSettingsPath
    fs.rmSync(tempSettingsPath, { force: true })
  }
})
