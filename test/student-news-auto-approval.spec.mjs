import assert from "node:assert/strict"
import test from "node:test"

import {
  buildStudentNewsValidationPayload,
  evaluateStudentNewsAutoApprovalState,
  normalizeStudentNewsAutoApprovalConfig,
  resolveStudentNewsAutoApproveDueAt,
} from "../src/modules/admin/student-news-auto-approval.mjs"

test("student news auto-approval config normalizes defaults and explicit legacy mode", () => {
  assert.deepEqual(normalizeStudentNewsAutoApprovalConfig({}), {
    autoApproveEnabled: true,
    autoApproveDelayHours: 16,
  })
  assert.deepEqual(
    normalizeStudentNewsAutoApprovalConfig({
      autoApproveEnabled: false,
      autoApproveDelayHours: "24",
    }),
    {
      autoApproveEnabled: false,
      autoApproveDelayHours: 24,
    }
  )
})

test("student news auto-approval due time uses the latest submission timestamp", () => {
  const dueAt = resolveStudentNewsAutoApproveDueAt(
    {
      submittedAt: "2026-07-06T00:00:00.000Z",
      lastSubmittedAt: "2026-07-06T04:30:00.000Z",
    },
    {
      autoApproveEnabled: true,
      autoApproveDelayHours: 16,
    }
  )
  assert.equal(dueAt?.toISOString?.(), "2026-07-06T20:30:00.000Z")
})

test("student news auto-approval only queues current submitted MMR-passing reports", async () => {
  const report = {
    submissionState: "submitted",
    reviewStatus: "submitted",
    submittedAt: "2026-07-06T00:00:00.000Z",
    sourceLink: "https://example.com/news/story",
    articleTitle: "Students improve reports",
    byline: "Reporter",
    articleDateline: "Ho Chi Minh City",
    leadSynopsis: "A detailed synopsis that satisfies the minimum requirement length.",
    actionActor: "Students",
    actionAffected: "Their reports",
    actionWhere: "At school",
    actionWhat: "Improved the final draft after teacher guidance.",
    actionWhy: "To raise quality before automatic approval.",
    biasAssessment: "The article quotes both school staff and students and avoids loaded claims.",
  }

  assert.deepEqual(buildStudentNewsValidationPayload(report), {
    sourceLink: report.sourceLink,
    articleTitle: report.articleTitle,
    byline: report.byline,
    articleDateline: report.articleDateline,
    leadSynopsis: report.leadSynopsis,
    actionActor: report.actionActor,
    actionAffected: report.actionAffected,
    actionWhere: report.actionWhere,
    actionWhat: report.actionWhat,
    actionWhy: report.actionWhy,
    biasAssessment: report.biasAssessment,
  })

  const pendingState = await evaluateStudentNewsAutoApprovalState(report, {
    now: "2026-07-06T10:00:00.000Z",
    config: {
      autoApproveEnabled: true,
      autoApproveDelayHours: 16,
    },
  })
  assert.equal(pendingState.enabled, true)
  assert.equal(pendingState.candidate, true)
  assert.equal(pendingState.due, false)
  assert.equal(pendingState.dueAt, "2026-07-06T16:00:00.000Z")

  const dueState = await evaluateStudentNewsAutoApprovalState(report, {
    now: "2026-07-06T18:00:00.000Z",
    config: {
      autoApproveEnabled: true,
      autoApproveDelayHours: 16,
    },
  })
  assert.equal(dueState.candidate, true)
  assert.equal(dueState.due, true)

  const legacyState = await evaluateStudentNewsAutoApprovalState(report, {
    now: "2026-07-06T18:00:00.000Z",
    config: {
      autoApproveEnabled: false,
      autoApproveDelayHours: 16,
    },
  })
  assert.equal(legacyState.enabled, false)
  assert.equal(legacyState.candidate, false)
  assert.equal(legacyState.skipReason, "disabled")
})
