import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { pathToFileURL } from "node:url"
import { getSharedPrismaClient, closeSharedPrismaClient } from "../src/infra/db/prisma-client.mjs"
import { verifyScryptPassword } from "../src/modules/admin/users.mjs"

const DEV_ORIGIN = "http://127.0.0.1:8788"
const METRICS_FILE = path.join(process.cwd(), "runtime-data/prometheus/engagement-workflows-dev.prom")
const WORKER_METRICS_FILE = path.join(process.cwd(), "runtime-data/prometheus/async-side-effects-worker-dev.prom")
const CHECK_TIMEOUT_MS = 10000
const WORKER_STALE_AFTER_SECONDS = 30
const PROCESSING_STALE_AFTER_SECONDS = 300
const WEBHOOK_STALE_AFTER_SECONDS = 300
const ANNOUNCEMENT_QUEUE_STALE_AFTER_SECONDS = 120
const NOTIFICATION_QUEUE_STALE_AFTER_SECONDS = 1800
const ASSIGNMENT_DISPATCH_STALE_AFTER_SECONDS = 300
const STANDARD_PARENT_LOGIN = "cmmark001"

export function assertDevEnvironment(environment = process.env) {
  if (
    String(environment.NODE_ENV || "").trim() !== "development" ||
    String(environment.SIS_ENV_FILE || "").trim() !== ".env.dev" ||
    String(environment.DOTENV_CONFIG_PATH || "").trim() !== ".env.dev"
  ) throw new Error("Engagement workflow monitor requires the explicit development environment")
}

function metricNumber(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw new TypeError("Metric values must be finite non-negative numbers")
  return number.toFixed(6)
}

function timestampSeconds(value) {
  const date = value instanceof Date ? value : new Date(value || 0)
  const result = date.getTime() / 1000
  return Number.isFinite(result) && result > 0 ? result : 0
}

export function parseWorkerHeartbeat(contents = "") {
  const match = String(contents).match(/^sis_async_side_effects_worker_last_poll_timestamp_seconds\{environment="dev"\} ([0-9]+(?:\.[0-9]+)?)$/mu)
  return match ? Number(match[1]) : 0
}

export function parseWorkerPollSuccess(contents = "") {
  const match = String(contents).match(/^sis_async_side_effects_worker_last_poll_success\{environment="dev"\} ([01])$/mu)
  return match ? Number(match[1]) : 0
}

export function renderEngagementMetrics({
  checkedAt,
  durationSeconds,
  success,
  lastSuccessTimestamp,
  reportApiSuccess,
  parentAuthSuccess = 0,
  parentReportApiSuccess = 0,
  parentChildCount = 0,
  parentReportCount = 0,
  parentLoginDurationSeconds = 0,
  parentDashboardDurationSeconds = 0,
  reportEventTimestamp,
  webhookReceivedTimestamp,
  webhookUnprocessedCount,
  webhookOldestUnprocessedAgeSeconds,
  failedJobCount,
  staleProcessingJobCount,
  queuedJobCount,
  announcementQueuedJobCount,
  announcementOldestQueuedAgeSeconds,
  notificationDueQueueCount,
  notificationOldestDueAgeSeconds,
  notificationDeliveryFailureCount,
  notificationOldestFailureAgeSeconds,
  parentReportNotificationQueuedCount = 0,
  parentReportNotificationOldestDueAgeSeconds = 0,
  parentReportNotificationFailureCount = 0,
  assignmentReminderPendingCount,
  assignmentReminderOldestPendingAgeSeconds,
  staleAssignmentReminderDispatchCount,
  assignmentReminderFailureCount,
  workerLastPollTimestamp,
  workerLastPollSuccess,
}) {
  const workerAge = workerLastPollTimestamp > 0 ? Math.max(0, checkedAt - workerLastPollTimestamp) : 0
  const workerStale = workerLastPollTimestamp <= 0 || workerAge > WORKER_STALE_AFTER_SECONDS
  const values = [
    ["sis_engagement_workflow_check_success", "Whether the latest dev engagement workflow monitor passed.", success ? 1 : 0],
    ["sis_engagement_workflow_check_duration_seconds", "Duration of the latest dev engagement workflow monitor.", durationSeconds],
    ["sis_engagement_workflow_last_check_timestamp_seconds", "Unix timestamp of the latest dev engagement workflow monitor.", checkedAt],
    ["sis_engagement_workflow_last_success_timestamp_seconds", "Unix timestamp of the latest successful dev engagement workflow monitor.", lastSuccessTimestamp],
    ["sis_engagement_report_api_available", "Whether the authenticated dev engagement report API returned its expected response.", reportApiSuccess ? 1 : 0],
    ["sis_parent_authentication_available", "Whether the exact configured cmmark001 dev parent account authenticated successfully.", parentAuthSuccess ? 1 : 0],
    ["sis_parent_report_dashboard_available", "Whether the authenticated dev parent dashboard returned linked children and report archive data.", parentReportApiSuccess ? 1 : 0],
    ["sis_parent_linked_children", "Number of linked children returned to the authenticated dev parent monitor account.", parentChildCount],
    ["sis_parent_visible_reports", "Aggregate number of parent-visible reports returned by the authenticated dev dashboard.", parentReportCount],
    ["sis_parent_authentication_duration_seconds", "Duration of the latest dev parent login request.", parentLoginDurationSeconds],
    ["sis_parent_dashboard_duration_seconds", "Duration of the latest authenticated dev parent dashboard request.", parentDashboardDurationSeconds],
    ["sis_engagement_report_event_last_timestamp_seconds", "Unix timestamp of the most recently ingested parent report engagement event, or zero when none exists.", reportEventTimestamp],
    ["sis_engagement_webhook_last_received_timestamp_seconds", "Unix timestamp of the most recently received email webhook event, or zero when none exists.", webhookReceivedTimestamp],
    ["sis_engagement_webhook_unprocessed_events", "Number of email webhook events without a processed timestamp.", webhookUnprocessedCount],
    ["sis_engagement_webhook_oldest_unprocessed_age_seconds", "Age of the oldest unprocessed email webhook event.", webhookOldestUnprocessedAgeSeconds],
    ["sis_async_side_effect_failed_jobs_24h", "Number of async side-effect jobs in failed state updated during the last 24 hours.", failedJobCount],
    ["sis_async_side_effect_stale_processing_jobs", "Number of async side-effect jobs locked for more than five minutes.", staleProcessingJobCount],
    ["sis_async_side_effect_queued_jobs", "Number of queued async side-effect jobs.", queuedJobCount],
    ["sis_async_announcement_queued_jobs", "Number of queued announcement email jobs currently available for processing.", announcementQueuedJobCount],
    ["sis_async_announcement_oldest_queued_age_seconds", "Age of the oldest available queued dev announcement email job.", announcementOldestQueuedAgeSeconds],
    ["sis_notification_due_queue_items", "Number of due dev notification queue items with at least one address.", notificationDueQueueCount],
    ["sis_notification_oldest_due_queue_age_seconds", "Age of the oldest due dev notification queue item with an address.", notificationOldestDueAgeSeconds],
    ["sis_notification_delivery_failure_queue_items", "Number of queued dev notification items retaining a delivery error.", notificationDeliveryFailureCount],
    ["sis_notification_oldest_delivery_failure_age_seconds", "Age of the oldest dev notification delivery error.", notificationOldestFailureAgeSeconds],
    ["sis_parent_report_notification_queued_items", "Number of due dev parent report notifications with destinations.", parentReportNotificationQueuedCount],
    ["sis_parent_report_notification_oldest_due_age_seconds", "Age of the oldest due dev parent report notification with destinations.", parentReportNotificationOldestDueAgeSeconds],
    ["sis_parent_report_notification_delivery_failure_items", "Number of due dev parent report notification queue items retaining a delivery error.", parentReportNotificationFailureCount],
    ["sis_assignment_reminder_pending_dispatches", "Number of dev assignment reminder dispatches still pending.", assignmentReminderPendingCount],
    ["sis_assignment_reminder_oldest_pending_age_seconds", "Age of the oldest pending dev assignment reminder dispatch.", assignmentReminderOldestPendingAgeSeconds],
    ["sis_assignment_reminder_stale_pending_dispatches", "Number of dev assignment reminder dispatches pending for more than five minutes.", staleAssignmentReminderDispatchCount],
    ["sis_assignment_reminder_failed_dispatches_24h", "Number of dev assignment reminder dispatches failed in the last 24 hours.", assignmentReminderFailureCount],
    ["sis_async_side_effect_worker_last_poll_timestamp_seconds", "Unix timestamp of the most recently completed dev async side-effect worker poll.", workerLastPollTimestamp],
    ["sis_async_side_effect_worker_last_poll_success", "Whether the most recent dev async side-effect worker poll completed successfully.", workerLastPollSuccess],
    ["sis_async_side_effect_worker_poll_age_seconds", "Age of the most recently completed dev async side-effect worker poll.", workerAge],
    ["sis_async_side_effect_worker_stale", "Whether the dev async side-effect worker heartbeat is missing or older than thirty seconds.", workerStale ? 1 : 0],
  ]
  return values.flatMap(([name, help, value]) => [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} gauge`,
    `${name}{environment="dev"} ${metricNumber(value)}`,
  ]).concat("").join("\n")
}

function readLastSuccessTimestamp(metricsFile) {
  if (!fs.existsSync(metricsFile)) return 0
  const contents = fs.readFileSync(metricsFile, "utf8")
  const match = contents.match(/^sis_engagement_workflow_last_success_timestamp_seconds\{environment="dev"\} ([0-9]+(?:\.[0-9]+)?)$/mu)
  return match ? Number(match[1]) : 0
}

function readWorkerTimestamp(metricsFile) {
  if (!fs.existsSync(metricsFile)) return 0
  return parseWorkerHeartbeat(fs.readFileSync(metricsFile, "utf8"))
}

function readWorkerPollSuccess(metricsFile) {
  if (!fs.existsSync(metricsFile)) return 0
  return parseWorkerPollSuccess(fs.readFileSync(metricsFile, "utf8"))
}

export function writeMetricsAtomically(metricsFile, contents) {
  const directory = path.dirname(metricsFile)
  fs.mkdirSync(directory, { recursive: true, mode: 0o750 })
  const temporaryFile = `${metricsFile}.${process.pid}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporaryFile, contents, { encoding: "utf8", flag: "wx", mode: 0o644 })
    fs.renameSync(temporaryFile, metricsFile)
  } catch (error) {
    fs.rmSync(temporaryFile, { force: true })
    throw error
  }
}

async function checkReportApi(environment) {
  const username = String(environment.STUDENT_ADMIN_USER || "").trim()
  const password = String(environment.STUDENT_ADMIN_PASS || "")
  if (!username || !password) return false
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
  try {
    const login = await fetch(`${DEV_ORIGIN}/api/admin/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
      signal: controller.signal,
    })
    if (!login.ok) return false
    const cookie = String(login.headers.get("set-cookie") || "").split(";", 1)[0]
    if (!cookie) return false
    const reportResponse = await fetch(`${DEV_ORIGIN}/api/admin/performance-engagement?dateFrom=2999-01-01&dateTo=2999-01-02`, {
      headers: { cookie },
      signal: controller.signal,
    })
    if (!reportResponse.ok) return false
    const report = await reportResponse.json()
    return Number.isInteger(report?.totalReports) && Array.isArray(report?.rows) && Array.isArray(report?.days)
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

export function resolveParentMonitorCredentials(environment = process.env) {
  const directUser = String(environment.STUDENT_PARENT_USER || "").trim()
  const directPass = String(environment.STUDENT_PARENT_PASS || "")
  if (directUser === STANDARD_PARENT_LOGIN && directPass) {
    return { user: STANDARD_PARENT_LOGIN, pass: directPass }
  }
  let accounts = []
  try {
    const parsed = JSON.parse(String(environment.STUDENT_PARENT_PORTAL_ACCOUNTS_JSON || "[]"))
    accounts = Array.isArray(parsed) ? parsed : []
  } catch {
    return null
  }
  const account = accounts.find((entry) =>
    (entry?.parentsId || entry?.username) === STANDARD_PARENT_LOGIN &&
    (typeof entry?.password === "string" && entry.password.length > 0 ||
      typeof entry?.passwordHash === "string" && entry.passwordHash.length > 0) &&
    String(entry.status || "active").toLowerCase() !== "inactive"
  )
  if (!account) return null
  if (typeof account.password === "string" && account.password.length > 0) {
    return { user: STANDARD_PARENT_LOGIN, pass: account.password }
  }
  return directPass && verifyScryptPassword(directPass, account.passwordHash)
    ? { user: STANDARD_PARENT_LOGIN, pass: directPass }
    : null
}

export async function checkParentReportApi(environment = process.env, fetchImpl = fetch) {
  const credentials = resolveParentMonitorCredentials(environment)
  const startedAt = performance.now()
  let loginDurationSeconds = 0
  let dashboardDurationSeconds = 0
  if (!credentials) {
    return {
      authSuccess: false,
      dashboardSuccess: false,
      childCount: 0,
      reportCount: 0,
      loginDurationSeconds,
      dashboardDurationSeconds,
    }
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
  try {
    const loginStartedAt = performance.now()
    const login = await fetchImpl(`${DEV_ORIGIN}/api/parent/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentsId: credentials.user, password: credentials.pass }),
      signal: controller.signal,
    })
    loginDurationSeconds = (performance.now() - loginStartedAt) / 1000
    if (!login.ok) {
      return { authSuccess: false, dashboardSuccess: false, childCount: 0, reportCount: 0, loginDurationSeconds, dashboardDurationSeconds }
    }
    const cookie = String(login.headers.get("set-cookie") || "").split(";", 1)[0]
    if (!cookie) {
      return { authSuccess: false, dashboardSuccess: false, childCount: 0, reportCount: 0, loginDurationSeconds, dashboardDurationSeconds }
    }
    const dashboardStartedAt = performance.now()
    const dashboardResponse = await fetchImpl(`${DEV_ORIGIN}/api/parent/dashboard`, {
      headers: { cookie },
      signal: controller.signal,
    })
    dashboardDurationSeconds = (performance.now() - dashboardStartedAt) / 1000
    if (!dashboardResponse.ok) {
      return { authSuccess: true, dashboardSuccess: false, childCount: 0, reportCount: 0, loginDurationSeconds, dashboardDurationSeconds }
    }
    const payload = await dashboardResponse.json()
    const children = Array.isArray(payload?.children) ? payload.children : []
    const validShape = children.length > 0 && children.every((child) => Array.isArray(child?.details?.reportArchive))
    const reportCount = validShape
      ? children.reduce((total, child) => total + child.details.reportArchive.length, 0)
      : 0
    return {
      authSuccess: true,
      dashboardSuccess: validShape,
      childCount: children.length,
      reportCount,
      loginDurationSeconds,
      dashboardDurationSeconds,
    }
  } catch {
    return {
      authSuccess: loginDurationSeconds > 0,
      dashboardSuccess: false,
      childCount: 0,
      reportCount: 0,
      loginDurationSeconds,
      dashboardDurationSeconds: Math.max(dashboardDurationSeconds, (performance.now() - startedAt) / 1000 - loginDurationSeconds),
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function collectDatabaseMetrics(prisma, now) {
  const database = await prisma.$queryRaw`SELECT current_database() AS name`
  if (database[0]?.name !== "sis_dev") throw new Error("Engagement workflow monitor connected to an unexpected database")
  const dayAgo = new Date(now - 86400 * 1000)
  const processingCutoff = new Date(now - PROCESSING_STALE_AFTER_SECONDS * 1000)
  const assignmentDispatchCutoff = new Date(now - ASSIGNMENT_DISPATCH_STALE_AFTER_SECONDS * 1000)
  const nowDate = new Date(now)
  const dueNotificationWhere = {
    status: "queued",
    recipients: { isEmpty: false },
    OR: [{ scheduledFor: null }, { scheduledFor: { lte: nowDate } }],
  }
  const queueableAnnouncementWhere = {
    jobType: "announcement-email",
    status: "queued",
    OR: [{ availableAt: null }, { availableAt: { lte: nowDate } }],
  }
  const dueParentReportWhere = {
    queueType: "parent-report",
    status: "queued",
    recipients: { isEmpty: false },
    OR: [{ scheduledFor: null }, { scheduledFor: { lte: nowDate } }],
  }
  const failedParentReportWhere = {
    queueType: "parent-report",
    status: "queued",
    lastError: { not: null },
  }
  const [latestReportEvent, latestWebhook, unprocessedCount, oldestUnprocessed, failedJobCount, staleProcessingJobCount, queuedJobCount, announcementQueuedJobCount, oldestAnnouncementQueued, notificationDueQueueCount, oldestDueNotification, notificationDeliveryFailureCount, oldestNotificationFailure, parentReportNotificationQueuedCount, oldestParentReportNotification, parentReportNotificationFailureCount, assignmentReminderPendingCount, oldestPendingReminder, staleAssignmentReminderDispatchCount, assignmentReminderFailureCount] = await Promise.all([
    prisma.parentClassReportEvent.findFirst({ orderBy: { eventAt: "desc" }, select: { eventAt: true } }),
    prisma.brevoEmailWebhookEvent.findFirst({ orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
    prisma.brevoEmailWebhookEvent.count({ where: { processedAt: null } }),
    prisma.brevoEmailWebhookEvent.findFirst({ where: { processedAt: null }, orderBy: { receivedAt: "asc" }, select: { receivedAt: true } }),
    prisma.asyncSideEffectJob.count({ where: { status: "failed", updatedAt: { gte: dayAgo } } }),
    prisma.asyncSideEffectJob.count({ where: { status: "processing", lockedAt: { lt: processingCutoff } } }),
    prisma.asyncSideEffectJob.count({ where: { status: "queued" } }),
    prisma.asyncSideEffectJob.count({ where: queueableAnnouncementWhere }),
    prisma.asyncSideEffectJob.findFirst({ where: queueableAnnouncementWhere, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.adminNotificationQueue.count({ where: dueNotificationWhere }),
    prisma.adminNotificationQueue.findFirst({ where: dueNotificationWhere, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.adminNotificationQueue.count({ where: { status: "queued", lastError: { not: null } } }),
    prisma.adminNotificationQueue.findFirst({ where: { status: "queued", lastError: { not: null } }, orderBy: { updatedAt: "asc" }, select: { updatedAt: true } }),
    prisma.adminNotificationQueue.count({ where: dueParentReportWhere }),
    prisma.adminNotificationQueue.findFirst({ where: dueParentReportWhere, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.adminNotificationQueue.count({ where: failedParentReportWhere }),
    prisma.assignmentReminderDispatch.count({ where: { status: "pending" } }),
    prisma.assignmentReminderDispatch.findFirst({ where: { status: "pending" }, orderBy: { updatedAt: "asc" }, select: { updatedAt: true } }),
    prisma.assignmentReminderDispatch.count({ where: { status: "pending", updatedAt: { lt: assignmentDispatchCutoff } } }),
    prisma.assignmentReminderDispatch.count({ where: { status: "failed", updatedAt: { gte: dayAgo } } }),
  ])
  const oldestTimestamp = timestampSeconds(oldestUnprocessed?.receivedAt)
  const oldestAge = oldestTimestamp
    ? Math.max(0, now / 1000 - oldestTimestamp)
    : (unprocessedCount > 0 ? WEBHOOK_STALE_AFTER_SECONDS + 1 : 0)
  const ageSince = (value) => {
    const timestamp = timestampSeconds(value)
    return timestamp ? Math.max(0, now / 1000 - timestamp) : 0
  }
  return {
    reportEventTimestamp: timestampSeconds(latestReportEvent?.eventAt),
    webhookReceivedTimestamp: timestampSeconds(latestWebhook?.receivedAt),
    webhookUnprocessedCount: unprocessedCount,
    webhookOldestUnprocessedAgeSeconds: unprocessedCount > 0 ? oldestAge : 0,
    failedJobCount,
    staleProcessingJobCount,
    queuedJobCount,
    announcementQueuedJobCount,
    announcementOldestQueuedAgeSeconds: ageSince(oldestAnnouncementQueued?.createdAt),
    notificationDueQueueCount,
    notificationOldestDueAgeSeconds: ageSince(oldestDueNotification?.createdAt),
    notificationDeliveryFailureCount,
    notificationOldestFailureAgeSeconds: ageSince(oldestNotificationFailure?.updatedAt),
    parentReportNotificationQueuedCount,
    parentReportNotificationOldestDueAgeSeconds: ageSince(oldestParentReportNotification?.createdAt),
    parentReportNotificationFailureCount,
    assignmentReminderPendingCount,
    assignmentReminderOldestPendingAgeSeconds: ageSince(oldestPendingReminder?.updatedAt),
    staleAssignmentReminderDispatchCount,
    assignmentReminderFailureCount,
  }
}

export async function runEngagementWorkflowMonitor({
  environment = process.env,
  metricsFile = METRICS_FILE,
  workerMetricsFile = WORKER_METRICS_FILE,
  prismaClient = null,
  reportApiCheck = checkReportApi,
  parentReportApiCheck = checkParentReportApi,
  clock = () => Date.now(),
} = {}) {
  assertDevEnvironment(environment)
  const started = clock()
  const prisma = prismaClient || await getSharedPrismaClient()
  let metrics
  let reportApiSuccess = false
  let parentReportCheck = {
    authSuccess: false,
    dashboardSuccess: false,
    childCount: 0,
    reportCount: 0,
    loginDurationSeconds: 0,
    dashboardDurationSeconds: 0,
  }
  try {
    const reportApiCheckResult = await reportApiCheck(environment)
    reportApiSuccess = Boolean(reportApiCheckResult)
    parentReportCheck = await parentReportApiCheck(environment)
    const collected = await collectDatabaseMetrics(prisma, clock())
    const checkedAt = clock() / 1000
    const previousSuccess = readLastSuccessTimestamp(metricsFile)
    const workerLastPollTimestamp = readWorkerTimestamp(workerMetricsFile)
    const workerLastPollSuccess = readWorkerPollSuccess(workerMetricsFile)
    const success = reportApiSuccess &&
      parentReportCheck.authSuccess &&
      parentReportCheck.dashboardSuccess &&
      collected.webhookOldestUnprocessedAgeSeconds < WEBHOOK_STALE_AFTER_SECONDS &&
      collected.staleProcessingJobCount === 0 &&
      collected.failedJobCount === 0 &&
      collected.announcementOldestQueuedAgeSeconds <= ANNOUNCEMENT_QUEUE_STALE_AFTER_SECONDS &&
      collected.notificationOldestDueAgeSeconds <= NOTIFICATION_QUEUE_STALE_AFTER_SECONDS &&
      collected.notificationDeliveryFailureCount === 0 &&
      collected.parentReportNotificationOldestDueAgeSeconds <= NOTIFICATION_QUEUE_STALE_AFTER_SECONDS &&
      collected.parentReportNotificationFailureCount === 0 &&
      collected.staleAssignmentReminderDispatchCount === 0 &&
      collected.assignmentReminderFailureCount === 0 &&
      workerLastPollTimestamp > 0 &&
      checkedAt - workerLastPollTimestamp <= WORKER_STALE_AFTER_SECONDS &&
      workerLastPollSuccess === 1
    metrics = renderEngagementMetrics({
      checkedAt,
      durationSeconds: (clock() - started) / 1000,
      success,
      lastSuccessTimestamp: success ? checkedAt : previousSuccess,
      reportApiSuccess,
      parentAuthSuccess: parentReportCheck.authSuccess,
      parentReportApiSuccess: parentReportCheck.dashboardSuccess,
      parentChildCount: parentReportCheck.childCount,
      parentReportCount: parentReportCheck.reportCount,
      parentLoginDurationSeconds: parentReportCheck.loginDurationSeconds,
      parentDashboardDurationSeconds: parentReportCheck.dashboardDurationSeconds,
      ...collected,
      workerLastPollTimestamp,
      workerLastPollSuccess,
    })
    writeMetricsAtomically(metricsFile, metrics)
    process.stdout.write(`engagement_workflow_monitor environment=dev result=${success ? "pass" : "fail"} report_api=${reportApiSuccess ? "up" : "down"} parent_dashboard=${parentReportCheck.dashboardSuccess ? "up" : "down"}\n`)
    return success
  } finally {
    if (!prismaClient) await closeSharedPrismaClient()
  }
}

function main() {
  runEngagementWorkflowMonitor().then((success) => {
    process.exitCode = success ? 0 : 1
  }).catch(() => {
    process.stderr.write("engagement_workflow_monitor environment=dev result=fail reason=configuration_or_database_error\n")
    process.exitCode = 1
  })
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main()
