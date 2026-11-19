import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  assertDevEnvironment,
  checkParentReportApi,
  collectDatabaseMetrics,
  parseWorkerHeartbeat,
  parseWorkerPollSuccess,
  resolveParentMonitorCredentials,
  resolveMonitorContext,
  renderEngagementMetrics,
  runEngagementWorkflowMonitor,
} from "../tools/monitor-engagement-workflows.mjs"
import { hashScryptPassword } from "../src/modules/admin/users.mjs"
import { renderKeepaliveCheckMetrics } from "../src/infra/observability/keepalive-check-metrics.mjs"

test("engagement monitor records independent dependency failures and preserves last success", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sis-engagement-group-metrics-"))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const metricsFile = path.join(directory, "engagement.prom")
  const previousMetrics = renderKeepaliveCheckMetrics({
    environment: "dev",
    checkedAt: 100,
    results: {
      engagement: { success: true, durationSeconds: 1 },
      assignment_notifications: { success: true, durationSeconds: 1 },
      parent_reports: { success: true, durationSeconds: 1 },
      student_profile_enrollment: { success: true, durationSeconds: 1 },
    },
  })
  fs.writeFileSync(metricsFile, previousMetrics)

  const success = await runEngagementWorkflowMonitor({
    environment: { NODE_ENV: "development", SIS_ENV_FILE: ".env.dev", DOTENV_CONFIG_PATH: ".env.dev" },
    metricsFile,
    workerMetricsFile: path.join(directory, "worker.prom"),
    prismaClient: { $queryRaw: async () => { throw new Error("private database detail") } },
    reportApiCheck: async () => true,
    parentReportApiCheck: async () => ({ authSuccess: true, dashboardSuccess: true }),
    clock: () => 200000,
  })
  const metrics = fs.readFileSync(metricsFile, "utf8")
  assert.equal(success, false)
  assert.match(metrics, /sis_keepalive_check_success\{environment="dev",group="engagement"\} 0/u)
  assert.match(metrics, /sis_keepalive_check_last_success_timestamp_seconds\{environment="dev",group="engagement"\} 100\.000000/u)
  assert.match(metrics, /sis_keepalive_check_failure_info\{environment="dev",group="student_profile_enrollment",code="dependency_unavailable"\} 1/u)
  assert.doesNotMatch(metrics, /private database detail/u)
})

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
  assert.deepEqual(resolveMonitorContext({
    NODE_ENV: "test",
    SIS_ENV_FILE: ".env.test",
    DOTENV_CONFIG_PATH: ".env.test",
  }), { label: "test", origin: "http://127.0.0.1:8786", databaseName: "sis-test" })
  assert.throws(() => resolveMonitorContext({
    NODE_ENV: "test",
    SIS_ENV_FILE: ".env.test",
    DOTENV_CONFIG_PATH: ".env.dev",
  }), /matching explicit dev or test environment/u)
  assert.throws(() => assertDevEnvironment({
    NODE_ENV: "development",
    SIS_ENV_FILE: ".env",
    DOTENV_CONFIG_PATH: ".env.dev",
  }), /explicit development environment/u)
})

test("engagement metrics expose only bounded environment gauges and flag missing or stale workers", () => {
  const metricValues = {
    checkedAt: 200,
    durationSeconds: 0.25,
    success: false,
    lastSuccessTimestamp: 100,
    reportApiSuccess: false,
    parentAuthSuccess: true,
    parentReportApiSuccess: true,
    parentChildCount: 2,
    parentReportCount: 4,
    parentLoginDurationSeconds: 0.2,
    parentDashboardDurationSeconds: 0.35,
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
    parentReportNotificationQueuedCount: 3,
    parentReportNotificationOldestDueAgeSeconds: 900,
    parentReportNotificationFailureCount: 1,
    assignmentReminderPendingCount: 2,
    assignmentReminderOldestPendingAgeSeconds: 350,
    staleAssignmentReminderDispatchCount: 1,
    assignmentReminderFailureCount: 1,
    multipleActiveEnrollmentCount: 2,
    enrollmentOverlapPairCount: 3,
    moodleProvisioningDueCount: 4,
    moodleProvisioningOldestDueAgeSeconds: 500,
    moodleProvisioningProcessingCount: 2,
    moodleProvisioningOldestProcessingAgeSeconds: 350,
    moodleProvisioningRejectedCount: 1,
    workerLastPollTimestamp: 100,
    workerLastPollSuccess: 0,
  }
  const metrics = renderEngagementMetrics(metricValues)
  const testMetrics = renderEngagementMetrics({ ...metricValues, environmentLabel: "test" })
  assert.match(metrics, /sis_engagement_report_api_available\{environment="dev"\} 0/u)
  assert.match(metrics, /sis_parent_authentication_available\{environment="dev"\} 1/u)
  assert.match(metrics, /sis_parent_report_dashboard_available\{environment="dev"\} 1/u)
  assert.match(metrics, /sis_parent_linked_children\{environment="dev"\} 2/u)
  assert.match(metrics, /sis_parent_visible_reports\{environment="dev"\} 4/u)
  assert.match(metrics, /sis_parent_report_notification_oldest_due_age_seconds\{environment="dev"\} 900/u)
  assert.match(metrics, /sis_parent_report_notification_delivery_failure_items\{environment="dev"\} 1/u)
  assert.match(metrics, /sis_engagement_webhook_oldest_unprocessed_age_seconds\{environment="dev"\} 400/u)
  assert.match(metrics, /sis_async_side_effect_failed_jobs_24h\{environment="dev"\} 2/u)
  assert.match(metrics, /Number of queued announcement email jobs currently available for processing\./u)
  assert.match(metrics, /sis_async_announcement_oldest_queued_age_seconds\{environment="dev"\} 130/u)
  assert.match(metrics, /sis_notification_oldest_due_queue_age_seconds\{environment="dev"\} 1900/u)
  assert.match(metrics, /sis_notification_delivery_failure_queue_items\{environment="dev"\} 1/u)
  assert.match(metrics, /sis_assignment_reminder_oldest_pending_age_seconds\{environment="dev"\} 350/u)
  assert.match(metrics, /sis_assignment_reminder_stale_pending_dispatches\{environment="dev"\} 1/u)
  assert.match(metrics, /sis_assignment_reminder_failed_dispatches_24h\{environment="dev"\} 1/u)
  assert.match(metrics, /sis_enrollment_multiple_active_records\{environment="dev"\} 2/u)
  assert.match(metrics, /sis_enrollment_overlapping_period_pairs\{environment="dev"\} 3/u)
  assert.match(metrics, /sis_moodle_provisioning_due_commands\{environment="dev"\} 4/u)
  assert.match(metrics, /sis_moodle_provisioning_oldest_due_command_age_seconds\{environment="dev"\} 500/u)
  assert.match(metrics, /sis_moodle_provisioning_processing_commands\{environment="dev"\} 2/u)
  assert.match(metrics, /sis_moodle_provisioning_oldest_processing_age_seconds\{environment="dev"\} 350/u)
  assert.match(metrics, /sis_moodle_provisioning_rejected_commands\{environment="dev"\} 1/u)
  assert.match(metrics, /sis_async_side_effect_worker_stale\{environment="dev"\} 1/u)
  assert.match(metrics, /sis_async_side_effect_worker_last_poll_success\{environment="dev"\} 0/u)
  assert.doesNotMatch(metrics, /student|recipient|password|cookie|session|job_id|[^\s@]+@[^\s@]+/iu)
  assert.doesNotMatch(metrics, /environment="(?:test|production)"/u)
  assert.match(testMetrics, /sis_enrollment_multiple_active_records\{environment="test"\} 2/u)
  assert.match(testMetrics, /sis_notification_due_queue_items\{environment="test"\} 4/u)
  assert.doesNotMatch(testMetrics, /environment="dev"/u)
  const devHelp = metrics.split("\n").filter((line) => line.startsWith("# HELP "))
  const testHelp = testMetrics.split("\n").filter((line) => line.startsWith("# HELP "))
  assert.deepEqual(testHelp, devHelp)
  assert.equal(parseWorkerHeartbeat('sis_async_side_effects_worker_last_poll_timestamp_seconds{environment="dev"} 123.5\n'), 123.5)
  assert.equal(parseWorkerHeartbeat('sis_async_side_effects_worker_last_poll_timestamp_seconds{environment="test"} 123.5\n'), 0)
  assert.equal(parseWorkerHeartbeat('sis_async_side_effects_worker_last_poll_timestamp_seconds{environment="test"} 123.5\n', "test"), 123.5)
  assert.equal(parseWorkerPollSuccess('sis_async_side_effects_worker_last_poll_success{environment="dev"} 1\n'), 1)
  assert.equal(parseWorkerPollSuccess('sis_async_side_effects_worker_last_poll_success{environment="dev"} 0\n'), 0)
  assert.equal(parseWorkerPollSuccess('sis_async_side_effects_worker_last_poll_success{environment="test"} 1\n', "test"), 1)
})

test("database monitor collects enrollment integrity, provisioning age, and notification backlog as aggregates", async () => {
  const now = Date.UTC(2026, 10, 19, 0, 0, 0)
  const old = new Date(now - 7200 * 1000)
  const noRows = { findFirst: async () => null, count: async () => 0 }
  const prisma = {
    $queryRaw: async (query) => String(query).includes("current_database")
      ? [{ name: "sis_dev" }]
      : [{ multipleActiveStudents: 2, overlappingPeriodPairs: 3 }],
    parentClassReportEvent: { findFirst: async () => null },
    brevoEmailWebhookEvent: noRows,
    asyncSideEffectJob: noRows,
    adminNotificationQueue: {
      count: async ({ where }) => where.lastError ? 1 : where.queueType ? 2 : 5,
      findFirst: async ({ where }) => ({ createdAt: old, updatedAt: old }),
    },
    assignmentReminderDispatch: noRows,
    moodleProvisioningCommand: {
      count: async ({ where }) => where.status === "rejected" ? 1 : where.status === "processing" ? 0 : 2,
      findFirst: async ({ where }) => where.status === "processing"
        ? null
        : { createdAt: old, updatedAt: old },
    },
  }

  const result = await collectDatabaseMetrics(prisma, now)
  assert.equal(result.multipleActiveEnrollmentCount, 2)
  assert.equal(result.enrollmentOverlapPairCount, 3)
  assert.equal(result.moodleProvisioningDueCount, 2)
  assert.equal(result.moodleProvisioningOldestDueAgeSeconds, 7200)
  assert.equal(result.moodleProvisioningProcessingCount, 0)
  assert.equal(result.moodleProvisioningOldestProcessingAgeSeconds, 0)
  assert.equal(result.moodleProvisioningRejectedCount, 1)
  assert.equal(result.notificationDueQueueCount, 5)
  assert.equal(result.notificationDeliveryFailureCount, 1)
  assert.doesNotMatch(JSON.stringify(result), /student|recipient|email|password|cookie|session|private-id/iu)
})

test("parent workflow monitor uses only the exact cmmark001 account and checks its cookie-session dashboard", async () => {
  const exactParentPassword = "Synthetic-parent-password-123!"
  const exactParentPasswordHash = hashScryptPassword(exactParentPassword)
  assert.deepEqual(resolveParentMonitorCredentials({
    STUDENT_PARENT_USER: "other-parent",
    STUDENT_PARENT_PASS: "ignored-password",
    STUDENT_PARENT_PORTAL_ACCOUNTS_JSON: JSON.stringify([
      { parentsId: "cmmark001", password: "parent-password", status: "active" },
      { parentsId: "another-parent", password: "other-password", status: "active" },
    ]),
  }), { user: "cmmark001", pass: "parent-password" })
  assert.equal(resolveParentMonitorCredentials({
    STUDENT_PARENT_USER: "other-parent",
    STUDENT_PARENT_PASS: "other-password",
    STUDENT_PARENT_PORTAL_ACCOUNTS_JSON: "[]",
  }), null)
  assert.deepEqual(resolveParentMonitorCredentials({
    STUDENT_PARENT_USER: "another-parent",
    STUDENT_PARENT_PASS: exactParentPassword,
    STUDENT_PARENT_PORTAL_ACCOUNTS_JSON: JSON.stringify([
      { parentsId: "cmmark001", passwordHash: exactParentPasswordHash, status: "active" },
      { parentsId: "another-parent", passwordHash: hashScryptPassword("Other-parent-password-123!"), status: "active" },
    ]),
  }), { user: "cmmark001", pass: exactParentPassword })
  assert.equal(resolveParentMonitorCredentials({
    STUDENT_PARENT_USER: "another-parent",
    STUDENT_PARENT_PASS: "Wrong-parent-password-123!",
    STUDENT_PARENT_PORTAL_ACCOUNTS_JSON: JSON.stringify([
      { parentsId: "cmmark001", passwordHash: exactParentPasswordHash, status: "active" },
    ]),
  }), null)

  const requests = []
  const result = await checkParentReportApi({
    NODE_ENV: "development",
    SIS_ENV_FILE: ".env.dev",
    DOTENV_CONFIG_PATH: ".env.dev",
    STUDENT_PARENT_USER: "cmmark001",
    STUDENT_PARENT_PASS: "parent-password",
  }, async (url, options = {}) => {
    requests.push({ url: String(url), options })
    if (requests.length === 1) return { ok: true, headers: { get: () => "parent-session=synthetic; Path=/; HttpOnly" } }
    return { ok: true, json: async () => ({ children: [
      { details: { reportArchive: [{ id: "private-id" }] } },
      { details: { reportArchive: [] } },
    ] }) }
  })
  assert.equal(result.authSuccess, true)
  assert.equal(result.dashboardSuccess, true)
  assert.equal(result.childCount, 2)
  assert.equal(result.reportCount, 1)
  assert.match(requests[1].options.headers.cookie, /^parent-session=synthetic$/u)
  assert.doesNotMatch(JSON.stringify(result), /private-id|password|cookie/u)
})

test("test parent monitor uses the test mirror origin and exact cmmark001 account", async () => {
  const requests = []
  const result = await checkParentReportApi({
    NODE_ENV: "test",
    SIS_ENV_FILE: ".env.test",
    DOTENV_CONFIG_PATH: ".env.test",
    STUDENT_PARENT_USER: "cmmark001",
    STUDENT_PARENT_PASS: "synthetic-test-password",
  }, async (url, options = {}) => {
    requests.push({ url: String(url), options })
    if (requests.length === 1) return { ok: true, headers: { get: () => "test-session=synthetic; Path=/; HttpOnly" } }
    return { ok: true, json: async () => ({ children: [{ details: { reportArchive: [] } }] }) }
  })
  assert.equal(result.authSuccess, true)
  assert.equal(result.dashboardSuccess, true)
  assert.match(requests[0].url, /^http:\/\/127\.0\.0\.1:8786\//u)
  assert.match(requests[1].url, /^http:\/\/127\.0\.0\.1:8786\//u)
  assert.match(requests[1].options.headers.cookie, /^test-session=synthetic$/u)
})
