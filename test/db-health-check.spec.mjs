import test from "node:test"
import assert from "node:assert/strict"

import { parseArgs } from "../tools/db-health-check.mjs"

test("db-health-check parseArgs keeps sane defaults", () => {
  const args = parseArgs([])
  assert.equal(args.outputPath, "runtime-data/maintenance/db-health-status.json")
  assert.equal(args.backupLatestPath, "backups/postgres/latest.json")
  assert.equal(args.vacuumReportDir, "runtime-data/maintenance-reports")
  assert.equal(args.backupStaleMinutes, 1560)
  assert.equal(args.maxQueryLatencyMs, 500)
  assert.equal(args.maxIncomingUnmatched, 0)
  assert.equal(args.maxOrphanCount, 0)
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
  ])
  assert.equal(args.outputPath, "/tmp/health.json")
  assert.equal(args.backupLatestPath, "/tmp/latest.json")
  assert.equal(args.vacuumReportDir, "/tmp/reports")
  assert.equal(args.backupStaleMinutes, 60)
  assert.equal(args.maxQueryLatencyMs, 120)
  assert.equal(args.maxIncomingUnmatched, 2)
  assert.equal(args.maxOrphanCount, 1)
})
