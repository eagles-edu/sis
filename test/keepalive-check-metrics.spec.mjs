import assert from "node:assert/strict"
import test from "node:test"
import { readKeepaliveLastSuccess, renderKeepaliveCheckMetrics } from "../src/infra/observability/keepalive-check-metrics.mjs"

test("logical check metrics preserve per-group last success and use bounded failure labels", () => {
  const previous = renderKeepaliveCheckMetrics({
    environment: "dev",
    checkedAt: 100,
    results: {
      student_news: { success: true, durationSeconds: 4 },
      attendance: { success: true, durationSeconds: 3 },
    },
  })
  const updated = renderKeepaliveCheckMetrics({
    environment: "dev",
    checkedAt: 200,
    previousMetrics: previous,
    results: {
      student_news: { success: false, durationSeconds: 5, failureCode: "cleanup_failed" },
      attendance: { success: true, durationSeconds: 2 },
    },
  })

  assert.equal(readKeepaliveLastSuccess(previous, "dev", "student_news"), 100)
  assert.match(updated, /sis_keepalive_check_success\{environment="dev",group="student_news"\} 0/u)
  assert.match(updated, /sis_keepalive_check_last_success_timestamp_seconds\{environment="dev",group="student_news"\} 100\.000000/u)
  assert.match(updated, /sis_keepalive_check_last_success_timestamp_seconds\{environment="dev",group="attendance"\} 200\.000000/u)
  assert.match(updated, /sis_keepalive_check_failure_info\{environment="dev",group="student_news",code="cleanup_failed"\} 1/u)
  assert.match(updated, /sis_keepalive_check_stale_after_seconds\{environment="dev",group="student_news"\} 900\.000000/u)
  assert.doesNotMatch(updated, /password|cookie|student-private-marker|Error:/iu)
  assert.throws(() => renderKeepaliveCheckMetrics({
    environment: "dev",
    checkedAt: 1,
    results: { engagement: { success: false, durationSeconds: 1, failureCode: "database error with private data" } },
  }), /bounded vocabulary/u)
})

test("on-demand group freshness is disabled and environment labels are restricted", () => {
  const metrics = renderKeepaliveCheckMetrics({
    environment: "test",
    checkedAt: 100,
    results: {
      parent_profile: { success: false, durationSeconds: 9 },
      engagement: { success: true, durationSeconds: 1 },
    },
  })
  assert.match(metrics, /environment="test",group="parent_profile"\} 0\.000000/u)
  assert.match(metrics, /environment="test",group="engagement"\} 0\.000000/u)
  assert.throws(() => renderKeepaliveCheckMetrics({ environment: "production", checkedAt: 100, results: {} }), /controlled environment/u)
})
