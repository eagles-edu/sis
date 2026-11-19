import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"

import {
  buildStudentNewsCalendarRows,
  resolveStudentNewsSubmissionWindow,
} from "../src/modules/admin/student-news-submissions.mjs"

test("resolveStudentNewsSubmissionWindow gives yesterday a UTC+7 grace window until 02:00", () => {
  const now = new Date("2026-03-13T17:10:00.000Z") // 2026-03-14 00:10 in UTC+7
  const window = resolveStudentNewsSubmissionWindow(now)

  assert.equal(window.todayDate, "2026-03-14")
  assert.equal(window.reportDate, "2026-03-13")
  assert.equal(window.opensAt, "2026-03-12T17:00:00.000Z")
  assert.equal(window.closesAt, "2026-03-13T19:00:00.000Z")
  assert.equal(window.isOpen, true)
  assert.equal(window.closedReason, "")
})

test("resolveStudentNewsSubmissionWindow changes report date exactly at 02:00 UTC+7", () => {
  const beforeCutoff = resolveStudentNewsSubmissionWindow(new Date("2026-03-13T18:59:59.999Z"))
  const atCutoff = resolveStudentNewsSubmissionWindow(new Date("2026-03-13T19:00:00.000Z"))

  assert.equal(beforeCutoff.reportDate, "2026-03-13")
  assert.equal(beforeCutoff.closesAt, "2026-03-13T19:00:00.000Z")
  assert.equal(atCutoff.todayDate, "2026-03-14")
  assert.equal(atCutoff.reportDate, "2026-03-14")
  assert.equal(atCutoff.opensAt, "2026-03-13T17:00:00.000Z")
  assert.equal(atCutoff.closesAt, "2026-03-14T19:00:00.000Z")
})

test("resolveStudentNewsSubmissionWindow keeps today's report open through 23:00", () => {
  const now = new Date("2026-03-14T16:00:00.000Z") // 2026-03-14 23:00 in UTC+7
  const window = resolveStudentNewsSubmissionWindow(now)

  assert.equal(window.todayDate, "2026-03-14")
  assert.equal(window.reportDate, "2026-03-14")
  assert.equal(window.closesAt, "2026-03-14T19:00:00.000Z")
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
      createdAt: new Date("2026-03-12T03:45:00.000Z"),
      submittedAt: "2026-03-12T03:45:00.000Z",
    },
  ]

  const rows = buildStudentNewsCalendarRows({ now, reports, days: 7 })
  assert.ok(Array.isArray(rows))
  assert.equal(rows[0]?.date, "2026-03-14")
  assert.equal(rows[0]?.status, "upcoming")
  assert.equal(rows[0]?.canSubmit, false)

  assert.equal(rows[1]?.date, "2026-03-13")
  assert.equal(rows[1]?.status, "open")
  assert.equal(rows[1]?.canSubmit, true)

  assert.equal(rows[2]?.date, "2026-03-12")
  assert.equal(rows[2]?.status, "completed")
  assert.equal(rows[2]?.canSubmit, false)
})

test("student news submissions module exposes the calendar/save API surface", () => {
  const source = fs.readFileSync(new URL("../src/modules/admin/student-news-submissions.mjs", import.meta.url), "utf8")
  assert.match(source, /export function resolveStudentNewsSubmissionWindow\(/)
  assert.match(source, /export function buildStudentNewsCalendarRows\(/)
  assert.match(source, /export async function listStudentNewsCalendar\(/)
  assert.match(source, /export async function saveStudentNewsDraftCheck\(/)
  assert.match(source, /export async function saveStudentNewsReport\(/)
})

test("student News calendar leaves the date before 02:00 upcoming without a missed alert", () => {
  const client = fs.readFileSync(new URL("../web-asset/student/student-portal.js", import.meta.url), "utf8")
  assert.match(client, /status === "upcoming"/)
  assert.match(client, /if \(token === "upcoming"\) return;/)
})

test("student news calendar supports quarter-to-date lookback beyond seven weeks", () => {
  const source = fs.readFileSync(new URL("../src/modules/admin/student-news-submissions.mjs", import.meta.url), "utf8")
  assert.match(source, /const STUDENT_NEWS_MAX_DAYS = 120/)
})
