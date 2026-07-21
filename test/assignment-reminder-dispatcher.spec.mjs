import test from "node:test"
import assert from "node:assert/strict"

import {
  buildAssignmentReminderMessage,
  NEWS_MMR_LEVELS,
  wednesdayBusinessSlotMinute,
} from "../src/modules/admin/assignment-reminder-dispatcher.mjs"

test("news-report MMR applies to Flyers, KET, and PET", () => {
  assert.deepEqual(NEWS_MMR_LEVELS, ["A2 Flyers", "A2 KET", "B1 PET"])
})

test("Wednesday reminder slot is deterministic and stays within business hours", () => {
  const now = new Date("2026-07-22T09:00:00+07:00")
  const first = wednesdayBusinessSlotMinute("A2 Flyers", now)
  const second = wednesdayBusinessSlotMinute("A2 Flyers", now)
  assert.equal(first, second)
  assert.ok(first >= 9 * 60)
  assert.ok(first <= 16 * 60)
})

test("reminder message preserves actionable assignment and Flyers MMR data", () => {
  for (const level of NEWS_MMR_LEVELS) {
    const message = buildAssignmentReminderMessage({
      studentName: "QA News Student",
      assignmentTitle: "Weekly report",
      level,
      dueAt: "26/07/26 23:59:59",
      actionUrl: "https://admin.eagles.edu.vn/student-news",
      completed: false,
      audience: "student",
      mmr: { completed: 2, required: 5, remaining: 3, daysRemaining: 2, warning: true },
    })
    assert.match(message, new RegExp(`${level} news-report MMR: 2/5 completed this week`))
    assert.match(message, /Status: not completed yet\./)
    assert.match(message, /3 reports remain before Sunday/)
    assert.match(message, /remaining reports exceed the number of days left/)
    assert.match(message, /https:\/\/admin\.eagles\.edu\.vn\/student-news/)
  }
})
