// @ts-check

import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { AsyncLocalStorage } from "node:async_hooks"

const requestContext = new AsyncLocalStorage()
const requestMetrics = new Map()
const phaseMetrics = new Map()
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

function observeMetric(map, key, durationSeconds) {
  const current = map.get(key) || { count: 0, sum: 0 }
  current.count += 1
  current.sum += Math.max(0, durationSeconds)
  map.set(key, current)
}

function escapeLabel(value) {
  return text(value).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"')
}

function renderMetrics() {
  const lines = [
    "# HELP sis_admin_student_write_requests_total Completed authenticated student create or update requests.",
    "# TYPE sis_admin_student_write_requests_total counter",
  ]
  for (const [key, metric] of requestMetrics.entries()) {
    const [route, status] = key.split("\u0000")
    const labels = `route="${escapeLabel(route)}",status="${escapeLabel(status)}"`
    lines.push(`sis_admin_student_write_requests_total{${labels}} ${metric.count}`)
  }
  lines.push("# HELP sis_admin_student_write_request_duration_seconds Authenticated student create or update request duration.")
  lines.push("# TYPE sis_admin_student_write_request_duration_seconds summary")
  for (const [key, metric] of requestMetrics.entries()) {
    const [route, status] = key.split("\u0000")
    const labels = `route="${escapeLabel(route)}",status="${escapeLabel(status)}"`
    lines.push(`sis_admin_student_write_request_duration_seconds_sum{${labels}} ${metric.sum}`)
    lines.push(`sis_admin_student_write_request_duration_seconds_count{${labels}} ${metric.count}`)
  }
  lines.push("# HELP sis_admin_student_write_phase_duration_seconds Student write phase duration.")
  lines.push("# TYPE sis_admin_student_write_phase_duration_seconds summary")
  for (const [key, metric] of phaseMetrics.entries()) {
    const [route, phase] = key.split("\u0000")
    const labels = `route="${escapeLabel(route)}",phase="${escapeLabel(phase)}"`
    lines.push(`sis_admin_student_write_phase_duration_seconds_sum{${labels}} ${metric.sum}`)
    lines.push(`sis_admin_student_write_phase_duration_seconds_count{${labels}} ${metric.count}`)
  }
  const memory = process.memoryUsage()
  lines.push("# HELP sis_nodejs_heap_used_bytes SIS Node.js heap used bytes at the latest student write metric flush.")
  lines.push("# TYPE sis_nodejs_heap_used_bytes gauge")
  lines.push(`sis_nodejs_heap_used_bytes ${memory.heapUsed}`)
  lines.push("# HELP sis_nodejs_rss_bytes SIS Node.js resident set size at the latest student write metric flush.")
  lines.push("# TYPE sis_nodejs_rss_bytes gauge")
  lines.push(`sis_nodejs_rss_bytes ${memory.rss}`)
  return `${lines.join("\n")}\n`
}

function scheduleFlush() {
  const filePath = metricFilePath()
  if (!filePath) return
  writeQueue = writeQueue
    .catch(() => {})
    .then(async () => {
      const directory = path.dirname(filePath)
      const temporaryPath = `${filePath}.${process.pid}.tmp`
      await fs.mkdir(directory, { recursive: true, mode: 0o750 })
      await fs.writeFile(temporaryPath, renderMetrics(), { encoding: "utf8", mode: 0o640 })
      await fs.rename(temporaryPath, filePath)
    })
    .catch((error) => {
      console.error(JSON.stringify({
        event: "sis_student_write_metrics_flush_failed",
        error: text(error?.message || error),
      }))
    })
}

function resolveStudentWriteRoute(request) {
  const method = text(request?.method).toUpperCase()
  const url = new URL(request?.url || "/", `http://${request?.headers?.host || "localhost"}`)
  if (method === "POST" && url.pathname === "/api/admin/students") return "POST /api/admin/students"
  if (method === "PUT" && /^\/api\/admin\/students\/[^/]+$/.test(url.pathname)) return "PUT /api/admin/students/:id"
  return ""
}

/**
 * Execute an operation while recording a safe, aggregate phase duration when it
 * is part of an authenticated student write request.
 * @template T
 * @param {string} phase
 * @param {() => Promise<T>} operation
 * @returns {Promise<T>}
 */
export async function timeStudentWritePhase(phase, operation) {
  const context = requestContext.getStore()
  if (!context) return operation()
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
 * Mark the current route-level timing context as having passed the admin
 * session gate.  Keeping this call after the real auth check means failed or
 * anonymous requests never enter the emitted metrics or structured logs.
 */
export function markStudentWriteRequestAuthenticated() {
  const context = requestContext.getStore()
  if (context) context.authenticated = true
}

/**
 * Wrap the real request handler for authenticated student create/update routes.
 * No request body, student identifier, cookie, or user identity is retained.
 * @template T
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {() => Promise<T>} operation
 * @returns {Promise<T>}
 */
export async function observeStudentWriteRequest(request, response, operation) {
  const route = resolveStudentWriteRoute(request)
  if (!route) return operation()
  const context = { requestId: crypto.randomUUID(), route, phases: [], authenticated: false }
  return requestContext.run(context, async () => {
    const startedAt = performance.now()
    try {
      return await operation()
    } finally {
      if (context.authenticated) {
        const durationSeconds = (performance.now() - startedAt) / 1000
        const status = String(response.statusCode || 500)
        observeMetric(requestMetrics, metricKey(route, status), durationSeconds)
        scheduleFlush()
        console.info(JSON.stringify({
          event: "sis_student_write_timing",
          requestId: context.requestId,
          route,
          status: Number(response.statusCode || 500),
          durationMs: Math.round(durationSeconds * 1000),
          phases: context.phases,
        }))
      }
    }
  })
}
