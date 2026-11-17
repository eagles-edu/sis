import assert from "node:assert/strict"
import test from "node:test"
import {
  assertDevEnvironment,
  parseWorkerHeartbeat,
  parseWorkerPollSuccess,
  renderEngagementMetrics,
} from "../tools/monitor-engagement-workflows.mjs"

test("engagement monitor is pinned to dev-owned environment variables", () => {
  assertDevEnvironment({
    NODE_ENV: "development",
    SIS_ENV_FILE: ".env.dev",
    DOTENV_CONFIG_PATH: ".env.dev",
  })
  assert.throws(() => assertDevEnvironment({
    NODE_ENV: "test",
    SIS_ENV_FILE: ".env.test",
    DOTENV_CONFIG_PATH: ".env.test",
  }), /explicit development environment/u)
  assert.throws(() => assertDevEnvironment({
    NODE_ENV: "development",
    SIS_ENV_FILE: ".env",
    DOTENV_CONFIG_PATH: ".env.dev",
  }), /explicit development environment/u)
})

test("engagement metrics expose only bounded dev gauges and flag missing or stale workers", () => {
  const metrics = renderEngagementMetrics({
    checkedAt: 200,
    durationSeconds: 0.25,
    success: false,
    lastSuccessTimestamp: 100,
    reportApiSuccess: false,
    reportEventTimestamp: 0,
    webhookReceivedTimestamp: 0,
    webhookUnprocessedCount: 1,
    webhookOldestUnprocessedAgeSeconds: 400,
    failedJobCount: 2,
    staleProcessingJobCount: 1,
    queuedJobCount: 3,
    announcementQueuedJobCount: 2,
    announcementOldestQueuedAgeSeconds: 130,
    notificationDueQueueCount: 4,
    notificationOldestDueAgeSeconds: 1900,
    notificationDeliveryFailureCount: 1,
    notificationOldestFailureAgeSeconds: 2000,
    assignmentReminderPendingCount: 2,
    assignmentReminderOldestPendingAgeSeconds: 350,
    staleAssignmentReminderDispatchCount: 1,
    assignmentReminderFailureCount: 1,
    workerLastPollTimestamp: 100,
    workerLastPollSuccess: 0,
  })
  assert.match(metrics, /sis_engagement_report_api_available\{environment="dev"\} 0/u)
  assert.match(metrics, /sis_engagement_webhook_oldest_unprocessed_age_seconds\{environment="dev"\} 400/u)
  assert.match(metrics, /sis_async_side_effect_failed_jobs_24h\{environment="dev"\} 2/u)
  assert.match(metrics, /Number of queued announcement email jobs currently available for processing\./u)
  assert.match(metrics, /sis_async_announcement_oldest_queued_age_seconds\{environment="dev"\} 130/u)
  assert.match(metrics, /sis_notification_oldest_due_queue_age_seconds\{environment="dev"\} 1900/u)
  assert.match(metrics, /sis_notification_delivery_failure_queue_items\{environment="dev"\} 1/u)
  assert.match(metrics, /sis_assignment_reminder_oldest_pending_age_seconds\{environment="dev"\} 350/u)
  assert.match(metrics, /sis_assignment_reminder_stale_pending_dispatches\{environment="dev"\} 1/u)
  assert.match(metrics, /sis_assignment_reminder_failed_dispatches_24h\{environment="dev"\} 1/u)
  assert.match(metrics, /sis_async_side_effect_worker_stale\{environment="dev"\} 1/u)
  assert.match(metrics, /sis_async_side_effect_worker_last_poll_success\{environment="dev"\} 0/u)
  assert.doesNotMatch(metrics, /student|recipient|password|cookie|session|job_id|[^\s@]+@[^\s@]+/iu)
  assert.doesNotMatch(metrics, /environment="(?:test|production)"/u)
  assert.equal(parseWorkerHeartbeat('sis_async_side_effects_worker_last_poll_timestamp_seconds{environment="dev"} 123.5\n'), 123.5)
  assert.equal(parseWorkerHeartbeat('sis_async_side_effects_worker_last_poll_timestamp_seconds{environment="test"} 123.5\n'), 0)
  assert.equal(parseWorkerPollSuccess('sis_async_side_effects_worker_last_poll_success{environment="dev"} 1\n'), 1)
  assert.equal(parseWorkerPollSuccess('sis_async_side_effects_worker_last_poll_success{environment="dev"} 0\n'), 0)
})
