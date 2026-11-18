import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test, { after } from "node:test"

const metricsDir = mkdtempSync(path.join(os.tmpdir(), "sis-grade-feed-request-metrics-"))
const metricsPath = path.join(metricsDir, "requests.prom")
const originalMetricsPath = process.env.SIS_REQUEST_METRICS_FILE
const originalNodeEnv = process.env.NODE_ENV
process.env.SIS_REQUEST_METRICS_FILE = metricsPath
process.env.NODE_ENV = "development"
const metrics = await import(`../src/infra/observability/student-write-metrics.mjs?test=${Date.now()}`)

after(() => {
  if (originalMetricsPath === undefined) delete process.env.SIS_REQUEST_METRICS_FILE
  else process.env.SIS_REQUEST_METRICS_FILE = originalMetricsPath
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
  rmSync(metricsDir, { recursive: true, force: true })
})

test("authorized grade/feed errors use fixed route labels and omit request identifiers", async () => {
  await metrics.initializeStudentWriteMetrics()
  const request = {
    method: "POST",
    url: "/api/admin/students/private-student-ref/grades?sourceAttemptId=private-attempt",
    headers: { host: "localhost" },
  }
  const response = { statusCode: 500 }
  await metrics.observeStudentWriteRequest(request, response, async () => {
    metrics.markStudentWriteRequestAuthenticated()
  })
  await metrics.initializeStudentWriteMetrics()

  const contents = readFileSync(metricsPath, "utf8")
  assert.match(contents, /sis_grade_feed_write_requests_total\{environment="dev",route="POST \/api\/admin\/students\/:id\/grades",status="500"\} 1/u)
  assert.doesNotMatch(contents, /private-student-ref|private-attempt/u)
})

test("authorized attendance failures use fixed route labels without student identifiers", async () => {
  const request = {
    method: "POST",
    url: "/api/admin/students/private-student-ref/attendance?date=private-date",
    headers: { host: "localhost" },
  }
  const response = { statusCode: 422 }
  await metrics.observeStudentWriteRequest(request, response, async () => {
    metrics.markStudentWriteRequestAuthenticated()
  })
  await metrics.initializeStudentWriteMetrics()

  const contents = readFileSync(metricsPath, "utf8")
  assert.match(contents, /sis_admin_student_write_requests_total\{route="POST \/api\/admin\/students\/:id\/attendance",status="422"\} 1/u)
  assert.doesNotMatch(contents, /private-student-ref|private-date/u)
})

test("attendance delete routes normalize identifiers before collection", async () => {
  const request = {
    method: "DELETE",
    url: "/api/admin/students/private-student-ref/attendance/private-record-id",
    headers: { host: "localhost" },
  }
  const response = { statusCode: 200 }
  await metrics.observeStudentWriteRequest(request, response, async () => {
    metrics.markStudentWriteRequestAuthenticated()
  })
  await metrics.initializeStudentWriteMetrics()

  const contents = readFileSync(metricsPath, "utf8")
  assert.match(contents, /sis_admin_student_write_requests_total\{route="DELETE \/api\/admin\/students\/:id\/attendance\/:recordId",status="200"\} 1/u)
  assert.doesNotMatch(contents, /private-student-ref|private-record-id/u)
})

test("unauthorized grade/feed attempts are excluded from the request counters", async () => {
  const request = {
    method: "POST",
    url: "/api/integrations/google-forms/grades",
    headers: { host: "localhost" },
  }
  const response = { statusCode: 401 }
  await metrics.observeStudentWriteRequest(request, response, async () => {})
  await metrics.initializeStudentWriteMetrics()

  const contents = readFileSync(metricsPath, "utf8")
  assert.doesNotMatch(contents, /route="POST \/api\/integrations\/google-forms\/grades",status="401"/u)
})

test("grade and exercise route IDs normalize to fixed metric templates", () => {
  assert.equal(metrics.resolveGradeFeedWriteRoute({
    method: "DELETE",
    url: "/api/admin/students/student-123/grades/record-456?debug=true",
    headers: { host: "localhost" },
  }), "DELETE /api/admin/students/:id/grades/:recordId")
  assert.equal(metrics.resolveGradeFeedWriteRoute({
    method: "POST",
    url: "/api/exercise-submission?studentId=student-123",
    headers: { host: "localhost" },
  }), "POST /api/exercise-submission")
})
