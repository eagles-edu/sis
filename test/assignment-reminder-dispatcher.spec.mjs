import test from "node:test"
import assert from "node:assert/strict"

import {
  buildAssignmentReminderMessage,
  markAssignmentReminderEngagementSent,
  NEWS_MMR_LEVELS,
  reminderKinds,
  wednesdayBusinessSlotMinute,
} from "../src/modules/admin/assignment-reminder-dispatcher.mjs"
import { assignmentProgress } from "../src/modules/admin/assignment-progress.mjs"

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

test("assignment completion requires every required item to score strictly above 82", () => {
  const template = {
    id: "bundle-1",
    itemsJson: [
      { assignmentTemplateItemId: "item-1" },
      { assignmentTemplateItemId: "item-2" },
      { assignmentTemplateItemId: "item-3" },
    ],
  }
  const grades = [
    { score: 100, submittedAt: "2026-09-20T10:00:00Z", assignmentBundleJson: { assignmentTemplateId: "bundle-1", submittedItemId: "item-1" } },
    { score: 82.01, submittedAt: "2026-09-21T10:00:00Z", assignmentBundleJson: { assignmentTemplateId: "bundle-1", submittedItemId: "item-2" } },
    { score: 82, submittedAt: "2026-09-22T10:00:00Z", assignmentBundleJson: { assignmentTemplateId: "bundle-1", submittedItemId: "item-3" } },
    { score: 100, submittedAt: "2026-09-20T10:00:00Z", assignmentBundleJson: { assignmentTemplateId: "another-bundle", submittedItemId: "item-3" } },
  ]
  const partial = assignmentProgress(template, grades)
  assert.equal(partial.required, 3)
  assert.equal(partial.completed, 2)
  assert.equal(partial.isComplete, false)

  grades.push({ score: 82.01, submittedAt: "2026-09-23T10:00:00Z", assignmentBundleJson: { assignmentTemplateId: "bundle-1", submittedItemId: "item-3" } })
  const complete = assignmentProgress(template, grades)
  assert.equal(complete.completed, 3)
  assert.equal(complete.isComplete, true)
  assert.equal(complete.completedAt.toISOString(), "2026-09-23T10:00:00.000Z")
})

test("assignment late reminders run Monday Wednesday and Friday while MMR keeps its daily schedule", () => {
  const mondayEvening = reminderKinds(new Date("2026-09-28T11:00:00.000Z"))
  const wednesdayEvening = reminderKinds(new Date("2026-09-30T11:00:00.000Z"))
  const thursdayEvening = reminderKinds(new Date("2026-10-01T11:00:00.000Z"))
  const fridayEvening = reminderKinds(new Date("2026-10-02T11:00:00.000Z"))
  assert.ok(mondayEvening.includes("assignment-monday"))
  assert.ok(wednesdayEvening.includes("assignment-wednesday"))
  assert.ok(fridayEvening.includes("assignment-friday"))
  assert.ok(!thursdayEvening.some((kind) => kind.startsWith("assignment-")))
  assert.ok(mondayEvening.includes("mmr-daily"))
  assert.ok(thursdayEvening.includes("mmr-daily"))
  assert.ok(fridayEvening.includes("mmr-daily"))
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
    assert.match(message, new RegExp(`MMR bài tin tức của lớp ${level}: đã hoàn thành 2/5 bài trong tuần này\.`))
    assert.match(message, /Trạng thái: chưa hoàn thành\./u)
    assert.match(message, /Còn 3 bài cần hoàn thành trước 23:59:59 Chủ nhật theo giờ Việt Nam\./u)
    assert.match(message, /số bài còn lại nhiều hơn số ngày còn lại đến Chủ nhật\./u)
    assert.match(message, /https:\/\/admin\.eagles\.edu\.vn\/student-news/)
  }
})

test("late assignment reminder message clearly identifies overdue incomplete work", () => {
  const message = buildAssignmentReminderMessage({
    studentName: "QA Student",
    assignmentTitle: "Three exercise bundle",
    level: "A1 Movers",
    dueAt: "2026-09-20",
    actionUrl: "https://eagles.edu.vn/exercise",
    completed: false,
    late: true,
    audience: "student",
  })
  assert.match(message, /Trạng thái: quá hạn, chưa hoàn thành\./u)
})

test("repeated reminder sent marking preserves the first sent timestamp", async () => {
  const sentAt = new Date("2026-09-26T03:00:00.000Z")
  const later = new Date("2026-09-26T04:00:00.000Z")
  const row = { trackingToken: "engagement-token", sentAt: null }
  const updateCalls = []
  const prisma = {
    adminNotificationQueue: {
      findUnique: async () => ({ payloadJson: { reminderEngagementToken: row.trackingToken } }),
    },
    assignmentReminderEngagement: {
      updateMany: async ({ where, data }) => {
        updateCalls.push({ where, data })
        if (where.trackingToken !== row.trackingToken) return { count: 0 }
        if (where.sentAt === null && row.sentAt !== null) return { count: 0 }
        if (data.sentAt) row.sentAt = data.sentAt
        return { count: 1 }
      },
    },
  }

  assert.deepEqual(
    await markAssignmentReminderEngagementSent("queue-1", true, { prisma, now: () => sentAt }),
    { count: 1 }
  )
  assert.deepEqual(
    await markAssignmentReminderEngagementSent("queue-1", true, { prisma, now: () => later }),
    { count: 0 }
  )
  assert.equal(row.sentAt, sentAt)
  assert.deepEqual(updateCalls.map(({ where }) => where), [
    { trackingToken: "engagement-token", sentAt: null },
    { trackingToken: "engagement-token", sentAt: null },
  ])
})
