import test from "node:test"
import assert from "node:assert/strict"

import { formatPrometheusMetrics, parseArgs } from "../tools/db-health-check.mjs"

test("db-health-check parseArgs keeps sane defaults", () => {
  const args = parseArgs([])
  assert.equal(args.outputPath, "runtime-data/maintenance/db-health-status.json")
  assert.equal(args.backupLatestPath, "/home/eagles/dockerz/backups/postgres/latest.json")
  assert.equal(args.vacuumReportDir, "runtime-data/maintenance-reports")
  assert.equal(args.backupStaleMinutes, 1560)
  assert.equal(args.maxQueryLatencyMs, 500)
  assert.equal(args.maxIncomingUnmatched, 0)
  assert.equal(args.maxOrphanCount, 0)
  assert.equal(args.expectedDatabase, "")
  assert.equal(args.metricsOutputPath, "")
  assert.equal(args.metricsEnvironment, "unknown")
})

test("db-health-check parseArgs overrides threshold and path options", () => {
  const args = parseArgs([
    "--output",
    "/tmp/health.json",
    "--backup-latest",
    "/tmp/latest.json",
    "--vacuum-report-dir",
    "/tmp/reports",
    "--backup-stale-minutes",
    "60",
    "--max-query-latency-ms",
    "120",
    "--max-incoming-unmatched",
    "2",
    "--max-orphan-count",
    "1",
    "--expected-database",
    "sis_dev",
    "--metrics-output",
    "/tmp/db-health.prom",
    "--metrics-environment",
    "dev",
  ])
  assert.equal(args.outputPath, "/tmp/health.json")
  assert.equal(args.backupLatestPath, "/tmp/latest.json")
  assert.equal(args.vacuumReportDir, "/tmp/reports")
  assert.equal(args.backupStaleMinutes, 60)
  assert.equal(args.maxQueryLatencyMs, 120)
  assert.equal(args.maxIncomingUnmatched, 2)
  assert.equal(args.maxOrphanCount, 1)
  assert.equal(args.expectedDatabase, "sis_dev")
  assert.equal(args.metricsOutputPath, "/tmp/db-health.prom")
  assert.equal(args.metricsEnvironment, "dev")
})

test("db-health-check rejects an empty expected database and unsafe metric labels", () => {
  assert.throws(() => parseArgs(["--expected-database"]), /requires a value/u)
  assert.throws(() => parseArgs(["--metrics-environment", "dev\"} arbitrary_metric"]), /lowercase metric label/u)
})

test("db-health-check metrics use fixed low-cardinality environment labels and bounded values", () => {
  const rendered = formatPrometheusMetrics({
    checkedAt: "2026-11-21T00:00:00.000Z",
    status: "error",
    db: { status: "error", queryLatencyMs: null },
    backup: { isStale: true },
    incoming: { unmatchedCount: 3 },
    orphans: { total: 2 },
  }, "dev")

  assert.match(rendered, /sis_db_health_check_success\{environment="dev"\} 0/u)
  assert.match(rendered, /sis_db_health_check_query_latency_ms\{environment="dev"\} -1/u)
  assert.match(rendered, /sis_db_health_backup_stale\{environment="dev"\} 1/u)
  assert.match(rendered, /sis_db_health_incoming_unmatched_count\{environment="dev"\} 3/u)
  assert.match(rendered, /sis_db_health_orphan_count\{environment="dev"\} 2/u)
  assert.doesNotMatch(rendered, /database_name|password|postgres:\/\//u)
})
