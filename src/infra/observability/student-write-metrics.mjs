// @ts-check

import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { AsyncLocalStorage } from "node:async_hooks"

const requestContext = new AsyncLocalStorage()
const requestMetrics = new Map()
const parentReportAcknowledgmentMetrics = new Map()
const phaseMetrics = new Map()
const gradeFeedMetrics = new Map()
let writeQueue = Promise.resolve()

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim()
}

function metricFilePath() {
  return text(process.env.SIS_REQUEST_METRICS_FILE)
}

function metricKey(...parts) {
  return parts.map((part) => text(part)).join("\u0000")
}

function observeMetric(map, key, durationSeconds = 0) {
  const current = map.get(key) || { count: 0, sum: 0 }
  current.count += 1
  current.sum += Math.max(0, durationSeconds)
  map.set(key, current)
}

function escapeLabel(value) {
  return text(value).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"')
}

function metricEnvironment() {
  const environment = text(process.env.NODE_ENV)
  const envFile = text(process.env.SIS_ENV_FILE)
  const dotenvConfigPath = text(process.env.DOTENV_CONFIG_PATH)
  if (environment === "development" && envFile === ".env.dev" && dotenvConfigPath === ".env.dev") return "dev"
  if (environment === "test" && envFile === ".env.test" && dotenvConfigPath === ".env.test") return "test"
  if (environment === "production" && envFile === ".env" && dotenvConfigPath === ".env") return "production"
  return "unknown"
}

function renderRequestMetrics() {
  const environment = metricEnvironment()
  const lines = [
    "# HELP sis_admin_student_write_requests_total Completed authenticated student profile, enrollment, and attendance write requests.",
    "# TYPE sis_admin_student_write_requests_total counter",
  ]
  for (const [key, metric] of requestMetrics.entries()) {
    const [route, status] = key.split("\u0000")
    const labels = `environment="${environment}",route="${escapeLabel(route)}",status="${escapeLabel(status)}"`
    lines.push(`sis_admin_student_write_requests_total{${labels}} ${metric.count}`)
  }
  lines.push("# HELP sis_admin_student_write_request_duration_seconds Authenticated student profile and attendance write request duration.")
  lines.push("# TYPE sis_admin_student_write_request_duration_seconds summary")
  for (const [key, metric] of requestMetrics.entries()) {
    const [route, status] = key.split("\u0000")
    const labels = `environment="${environment}",route="${escapeLabel(route)}",status="${escapeLabel(status)}"`
    lines.push(`sis_admin_student_write_request_duration_seconds_sum{${labels}} ${metric.sum}`)
    lines.push(`sis_admin_student_write_request_duration_seconds_count{${labels}} ${metric.count}`)
  }
  lines.push("# HELP sis_parent_report_acknowledgment_requests_total Completed authenticated parent report acknowledgment requests by response status.")
  lines.push("# TYPE sis_parent_report_acknowledgment_requests_total counter")
  for (const [status, metric] of parentReportAcknowledgmentMetrics.entries()) {
    const labels = `environment="${metricEnvironment()}",route="POST /api/parent/reports/:reportId/acknowledge",status="${escapeLabel(status)}"`
    lines.push(`sis_parent_report_acknowledgment_requests_total{${labels}} ${metric.count}`)
  }
  lines.push("# HELP sis_parent_report_acknowledgment_request_duration_seconds Authenticated parent report acknowledgment request duration.")
  lines.push("# TYPE sis_parent_report_acknowledgment_request_duration_seconds summary")
  for (const [status, metric] of parentReportAcknowledgmentMetrics.entries()) {
    const labels = `environment="${metricEnvironment()}",route="POST /api/parent/reports/:reportId/acknowledge",status="${escapeLabel(status)}"`
    lines.push(`sis_parent_report_acknowledgment_request_duration_seconds_sum{${labels}} ${metric.sum}`)
    lines.push(`sis_parent_report_acknowledgment_request_duration_seconds_count{${labels}} ${metric.count}`)
  }
  lines.push("# HELP sis_admin_student_write_phase_duration_seconds Student write phase duration.")
  lines.push("# TYPE sis_admin_student_write_phase_duration_seconds summary")
  for (const [key, metric] of phaseMetrics.entries()) {
    const [route, phase] = key.split("\u0000")
    const labels = `environment="${environment}",route="${escapeLabel(route)}",phase="${escapeLabel(phase)}"`
    lines.push(`sis_admin_student_write_phase_duration_seconds_sum{${labels}} ${metric.sum}`)
    lines.push(`sis_admin_student_write_phase_duration_seconds_count{${labels}} ${metric.count}`)
  }

  lines.push("# HELP sis_grade_feed_write_requests_total Authorized grade writes and signed exercise-feed submissions by route and response status.")
  lines.push("# TYPE sis_grade_feed_write_requests_total counter")
  for (const [key, metric] of gradeFeedMetrics.entries()) {
    const [route, status] = key.split("\u0000")
    const labels = `environment="${metricEnvironment()}",route="${escapeLabel(route)}",status="${escapeLabel(status)}"`
    lines.push(`sis_grade_feed_write_requests_total{${labels}} ${metric.count}`)
  }

  const memory = process.memoryUsage()
  lines.push("# HELP sis_nodejs_heap_used_bytes SIS Node.js heap used bytes at the latest student write metric flush.")
  lines.push("# TYPE sis_nodejs_heap_used_bytes gauge")
  lines.push(`sis_nodejs_heap_used_bytes{environment="${environment}"} ${memory.heapUsed}`)
  lines.push("# HELP sis_nodejs_rss_bytes SIS Node.js resident set size at the latest student write metric flush.")
  lines.push("# TYPE sis_nodejs_rss_bytes gauge")
  lines.push(`sis_nodejs_rss_bytes{environment="${environment}"} ${memory.rss}`)
  return `${lines.join("\n")}\n`
}

function scheduleFlush() {
  const filePath = metricFilePath()
  if (!filePath) return Promise.resolve()
  writeQueue = writeQueue
    .catch(() => {})
    .then(async () => {
      const directory = path.dirname(filePath)
      const temporaryPath = `${filePath}.${process.pid}.tmp`
      await fs.mkdir(directory, { recursive: true, mode: 0o750 })
      await fs.writeFile(temporaryPath, renderRequestMetrics(), { encoding: "utf8", mode: 0o640 })
      await fs.rename(temporaryPath, filePath)
    })
    .catch((error) => {
      void error
      console.error(JSON.stringify({
        event: "sis_student_write_metrics_flush_failed",
        reason: "metrics_write_failed",
      }))
    })
  return writeQueue
}

function resolveStudentWriteRoute(request) {
  const method = text(request?.method).toUpperCase()
  const url = new URL(request?.url || "/", `http://${request?.headers?.host || "localhost"}`)
  if (method === "POST" && url.pathname === "/api/admin/students") return "POST /api/admin/students"
  if (method === "PUT" && /^\/api\/admin\/students\/[^/]+$/u.test(url.pathname)) return "PUT /api/admin/students/:id"
  if (method === "POST" && /^\/api\/admin\/students\/[^/]+\/enrollment$/u.test(url.pathname)) {
    return "POST /api/admin/students/:id/enrollment"
  }
  if (method === "POST" && /^\/api\/admin\/students\/[^/]+\/attendance$/u.test(url.pathname)) {
    return "POST /api/admin/students/:id/attendance"
  }
  if (method === "DELETE" && /^\/api\/admin\/students\/[^/]+\/attendance\/[^/]+$/u.test(url.pathname)) {
    return "DELETE /api/admin/students/:id/attendance/:recordId"
  }
  return ""
}

function resolveGradeFeedWriteRoute(request) {
  const method = text(request?.method).toUpperCase()
  const url = new URL(request?.url || "/", `http://${request?.headers?.host || "localhost"}`)
  if (method === "POST" && /^\/api\/admin\/students\/[^/]+\/grades$/u.test(url.pathname)) {
    return "POST /api/admin/students/:id/grades"
  }
  if (method === "DELETE" && /^\/api\/admin\/students\/[^/]+\/grades\/[^/]+$/u.test(url.pathname)) {
    return "DELETE /api/admin/students/:id/grades/:recordId"
  }
  if (method === "POST" && url.pathname === "/api/integrations/google-forms/grades") {
    return "POST /api/integrations/google-forms/grades"
  }
  if (method === "POST" && url.pathname === "/api/exercise-submission") {
    return "POST /api/exercise-submission"
  }
  return ""
}

export function resolveParentReportAcknowledgmentRoute(request) {
  const method = text(request?.method).toUpperCase()
  const url = new URL(request?.url || "/", `http://${request?.headers?.host || "localhost"}`)
  if (method === "POST" && /^\/api\/parent\/reports\/[^/]+\/acknowledge$/u.test(url.pathname)) {
    return "POST /api/parent/reports/:reportId/acknowledge"
  }
  return ""
}

/**
 * Execute an operation while recording a safe aggregate phase duration for
 * authenticated student create/update requests.
 * @template T
 * @param {string} phase
 * @param {() => Promise<T>} operation
 * @returns {Promise<T>}
 */
export async function timeStudentWritePhase(phase, operation) {
  const context = requestContext.getStore()
  if (!context || context.metricClass !== "student-write") return operation()
  const startedAt = performance.now()
  try {
    return await operation()
  } finally {
    const durationSeconds = (performance.now() - startedAt) / 1000
    context.phases.push({ phase: text(phase), durationMs: Math.round(durationSeconds * 1000) })
    observeMetric(phaseMetrics, metricKey(context.route, phase), durationSeconds)
  }
}

/**
 * Mark the current observed request as authorized after its session or signed
 * request gate succeeds. Unauthenticated and unsigned failures are not counted.
 */
export function markStudentWriteRequestAuthenticated() {
  const context = requestContext.getStore()
  if (context) context.authorized = true
}

/**
 * Create the textfile collector snapshot at service start without retaining
 * request bodies, identifiers, cookies, or account identities.
 */
export function initializeStudentWriteMetrics() {
  return scheduleFlush()
}

/**
 * Wrap student and grade/feed write routes using the real HTTP request context.
 * Only requests marked authorized by their route handler are emitted.
 * @template T
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {() => Promise<T>} operation
 * @returns {Promise<T>}
 */
export async function observeStudentWriteRequest(request, response, operation) {
  const studentRoute = resolveStudentWriteRoute(request)
  const gradeFeedRoute = resolveGradeFeedWriteRoute(request)
  const parentReportAckRoute = resolveParentReportAcknowledgmentRoute(request)
  if (!studentRoute && !gradeFeedRoute && !parentReportAckRoute) return operation()
  const metricClass = studentRoute ? "student-write" : gradeFeedRoute ? "grade-feed" : "parent-report-acknowledgment"
  const route = studentRoute || gradeFeedRoute || parentReportAckRoute
  const context = { requestId: crypto.randomUUID(), route, phases: [], authorized: false, metricClass }
  return requestContext.run(context, async () => {
    const startedAt = performance.now()
    try {
      return await operation()
    } finally {
      if (context.authorized) {
        const durationSeconds = (performance.now() - startedAt) / 1000
        const status = String(response.statusCode || 500)
        if (metricClass === "student-write") {
          observeMetric(requestMetrics, metricKey(route, status), durationSeconds)
          console.info(JSON.stringify({
            event: "sis_student_write_timing",
            requestId: context.requestId,
            route,
            status: Number(response.statusCode || 500),
            durationMs: Math.round(durationSeconds * 1000),
            phases: context.phases,
          }))
        } else {
          if (metricClass === "grade-feed") observeMetric(gradeFeedMetrics, metricKey(route, status))
          else observeMetric(parentReportAcknowledgmentMetrics, metricKey(status), durationSeconds)
        }
        void scheduleFlush()
      }
    }
  })
}

export { resolveGradeFeedWriteRoute }
