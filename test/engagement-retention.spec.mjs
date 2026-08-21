import assert from "node:assert/strict"
import test from "node:test"
import { ENGAGEMENT_RETENTION_DAYS, isEngagementVisible } from "../src/modules/admin/engagement-retention.mjs"

const now = new Date("2026-08-21T00:00:00.000Z")

test("engagement retention is exactly fifteen days", () => {
  assert.equal(ENGAGEMENT_RETENTION_DAYS, 15)
  assert.equal(isEngagementVisible({ sentAt: "2026-08-20T00:00:00.000Z", now }), true)
  assert.equal(isEngagementVisible({ sentAt: "2026-08-20T00:00:00.000Z", completedAt: "2026-08-06T00:00:00.000Z", now }), true)
  assert.equal(isEngagementVisible({ sentAt: "2026-08-20T00:00:00.000Z", completedAt: "2026-08-05T23:59:59.000Z", now }), false)
})

test("unsent and incomplete engagement rows follow the listing contract", () => {
  assert.equal(isEngagementVisible({ sentAt: null, now }), false)
  assert.equal(isEngagementVisible({ sentAt: "2026-08-20T00:00:00.000Z", completedAt: null, now }), true)
})
