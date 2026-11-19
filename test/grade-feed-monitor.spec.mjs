import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  assertDevEnvironment,
  runGradeFeedMonitor,
} from "../tools/monitor-grade-feeds.mjs"

const devEnvironment = {
  NODE_ENV: "development",
  SIS_ENV_FILE: ".env.dev",
  DOTENV_CONFIG_PATH: ".env.dev",
  STUDENT_ADMIN_USER: "dev-admin",
  STUDENT_ADMIN_PASS: "not-used-by-injected-check",
}

test("grade feed monitor rejects mismatched environment ownership", () => {
  assert.throws(() => assertDevEnvironment({
    ...devEnvironment,
    DOTENV_CONFIG_PATH: ".env.test",
  }), /explicit development environment/u)
})

test("grade feed monitor exports fixed aggregate labels and authenticated table availability", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "sis-grade-feed-monitor-"))
  const metricsFile = path.join(directory, "grade-feeds.prom")
  const requestMetricsFile = path.join(directory, "request-metrics.prom")
  const now = Date.UTC(2026, 10, 18, 7, 0, 0)
  const privateSourceLabel = "student-private-marker"
  const prisma = {
    $queryRaw: async () => [{ name: "sis_dev" }],
    exerciseSubmission: {
      groupBy: async () => [
        { sourceSystem: "moodle", _count: { _all: 2 }, _max: { createdAt: new Date(now - 3600000) } },
        { sourceSystem: privateSourceLabel, _count: { _all: 1 }, _max: { createdAt: new Date(now - 60000) } },
      ],
    },
    studentGradeRecord: {
      groupBy: async () => [
        { sourceSystem: "google-forms", _count: { _all: 3 }, _max: { updatedAt: new Date(now - 30000) } },
      ],
    },
    incomingExerciseResult: {
      count: async ({ where }) => {
        if (where.matchedStudentRefId === null && where.status?.in?.join(",") === "queued,temporary") return 4
        if (where.status === "queued") return 4
        if (where.status === "temporary") return 1
        if (where.status === "failed") return 0
        return 0
      },
      findFirst: async ({ where }) => {
        assert.deepEqual(where, {
          matchedStudentRefId: null,
          status: { in: ["queued", "temporary"] },
        })
        return { createdAt: new Date(now - 7200000) }
      },
    },
  }

  try {
    const success = await runGradeFeedMonitor({
      environment: devEnvironment,
      metricsFile,
      requestMetricsFile,
      prismaClient: prisma,
      tableApiCheck: async (environment) => environment.STUDENT_ADMIN_USER === "dev-admin",
      attendanceApiCheck: async () => ({ reportingAvailable: true, schoolSetupValid: true }),
      clock: () => now,
    })
    const contents = readFileSync(metricsFile, "utf8")
    assert.equal(success, true)
    assert.match(contents, /sis_grade_feed_table_available\{environment="dev"\} 1/u)
    assert.match(contents, /sis_attendance_reporting_available\{environment="dev"\} 1\.000000/u)
    assert.match(contents, /sis_attendance_school_setup_valid\{environment="dev"\} 1\.000000/u)
    assert.match(contents, /sis_grade_feed_incoming_unmatched\{environment="dev"\} 4/u)
    assert.match(contents, /sis_grade_feed_incoming_oldest_unmatched_age_seconds\{environment="dev"\} 7200\.000000/u)
    assert.match(contents, /sis_keepalive_check_success\{environment="dev",group="grade_feeds"\} 1/u)
    assert.match(contents, /sis_keepalive_check_success\{environment="dev",group="attendance"\} 1/u)
    assert.match(contents, /sis_grade_feed_exercise_submission_rows\{environment="dev",source="moodle"\} 2/u)
    assert.match(contents, /sis_grade_feed_grade_rows\{environment="dev",source="google_forms"\} 3/u)
    assert.match(contents, /sis_grade_feed_exercise_submission_rows\{environment="dev",source="other"\} 1/u)
    assert.doesNotMatch(contents, /sis_grade_feed_grade_latest_age_seconds\{environment="dev",source="other"\}/u)
    assert.doesNotMatch(contents, new RegExp(privateSourceLabel, "u"))
    assert.match(contents, /sis_grade_feed_request_metrics_available\{environment="dev"\} 0/u)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("grade feed monitor reports a failed database check without hiding the API check", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "sis-grade-feed-monitor-down-"))
  const metricsFile = path.join(directory, "grade-feeds.prom")
  const prisma = {
    $queryRaw: async () => [{ name: "sis_test" }],
    exerciseSubmission: { groupBy: async () => [] },
    studentGradeRecord: { groupBy: async () => [] },
    incomingExerciseResult: { count: async () => 0, findFirst: async () => null },
  }
  try {
    const success = await runGradeFeedMonitor({
      environment: devEnvironment,
      metricsFile,
      requestMetricsFile: path.join(directory, "missing.prom"),
      prismaClient: prisma,
      tableApiCheck: async () => true,
      attendanceApiCheck: async () => ({ reportingAvailable: true, schoolSetupValid: true }),
      clock: () => Date.UTC(2026, 10, 18, 7, 0, 0),
    })
    const contents = readFileSync(metricsFile, "utf8")
    assert.equal(success, false)
    assert.match(contents, /sis_grade_feed_database_available\{environment="dev"\} 0/u)
    assert.match(contents, /sis_grade_feed_table_available\{environment="dev"\} 1/u)
    assert.match(contents, /sis_grade_feed_monitor_success\{environment="dev"\} 0/u)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("grade feed monitor fails and exposes attendance setup and report availability independently", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "sis-grade-feed-attendance-monitor-"))
  const metricsFile = path.join(directory, "grade-feeds.prom")
  const prisma = {
    $queryRaw: async () => [{ name: "sis_dev" }],
    exerciseSubmission: { groupBy: async () => [] },
    studentGradeRecord: { groupBy: async () => [] },
    incomingExerciseResult: { count: async () => 0, findFirst: async () => null },
  }
  try {
    const success = await runGradeFeedMonitor({
      environment: devEnvironment,
      metricsFile,
      requestMetricsFile: path.join(directory, "missing.prom"),
      prismaClient: prisma,
      tableApiCheck: async () => true,
      attendanceApiCheck: async () => ({ reportingAvailable: false, schoolSetupValid: false }),
      clock: () => Date.UTC(2026, 10, 18, 7, 0, 0),
    })
    const contents = readFileSync(metricsFile, "utf8")
    assert.equal(success, false)
    assert.match(contents, /sis_attendance_reporting_available\{environment="dev"\} 0\.000000/u)
    assert.match(contents, /sis_attendance_school_setup_valid\{environment="dev"\} 0\.000000/u)
    assert.match(contents, /sis_grade_feed_monitor_success\{environment="dev"\} 0\.000000/u)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
