import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const DASHBOARD_DIR = path.join(ROOT, "ops/monitoring/grafana/dashboards")
const live = JSON.parse(fs.readFileSync(path.join(DASHBOARD_DIR, "live-admin-mirror-overview.json"), "utf8"))
const mirrorTest = JSON.parse(fs.readFileSync(path.join(DASHBOARD_DIR, "test-mirror-overview.json"), "utf8"))

test("live and test operations dashboards keep identical page structure", () => {
  assert.equal(live.panels.length, mirrorTest.panels.length)
  assert.equal(live.refresh, mirrorTest.refresh)
  assert.deepEqual(live.time, mirrorTest.time)
  for (const [index, panel] of live.panels.entries()) {
    const paired = mirrorTest.panels[index]
    assert.equal(panel.id, paired.id)
    assert.equal(panel.type, paired.type)
    assert.equal(panel.title, paired.title)
    assert.deepEqual(panel.gridPos, paired.gridPos)
    assert.equal(panel.targets?.length || 0, paired.targets?.length || 0)
  }
  assert.equal(live.panels.find((panel) => panel.id === 8).gridPos.h, 16)
  assert.equal(live.panels.find((panel) => panel.id === 10).gridPos.y, 23)
})

test("live dashboard reports ten read-only probes without representing them as customer workflow writes", () => {
  const serialized = JSON.stringify(live)
  const results = live.panels.find((panel) => panel.title === "Subsystem smoke results")
  assert.equal((results.targets[0].expr.match(/label_replace\(/g) || []).length, 10)
  assert.ok(serialized.includes("sis_grade_feed_readonly_data_available"))
  assert.ok(serialized.includes("No customer workflow writes or messages are generated"))
})

test("test smoke rows have one valid environment and group selector", () => {
  const smoke = mirrorTest.panels.find((panel) => panel.title === "Subsystem smoke results")
  const history = mirrorTest.panels.find((panel) => panel.title === "Historical smoke pass/fail by subsystem")
  assert.equal(smoke.targets.length, 1)
  assert.equal((smoke.targets[0].expr.match(/label_replace\(/g) || []).length, 10)
  for (const target of history.targets) {
    assert.match(target.expr, /^last_over_time\(sis_keepalive_check_success\{environment="test",group="[a-z_]+"\}\[10m\]\)$|^sis_keepalive_check_success\{environment="test",group="[a-z_]+"\}$/)
  }
})

test("live reported result count sums all ten distinct read-only probe families", () => {
  const count = live.panels.find((panel) => panel.title === "Subsystem results reported").targets[0].expr
  assert.equal((count.match(/\(count\(/g) || []).length, 10)
})

test("both dashboards include real vendor, grade, Redis, and historical measurements", () => {
  for (const dashboard of [live, mirrorTest]) {
    const serialized = JSON.stringify(dashboard)
    for (const metric of [
      "sis_external_service_available",
      "sis_external_service_http_status",
      "sis_grade_feed_grade_rows",
      "sis_engagement_webhook_unprocessed_events",
      "site_dependency_probe_duration_seconds",
      "site_dependency_container_cpu_percent",
      "site_dependency_container_memory_used_bytes",
      "last_over_time",
    ]) {
      assert.ok(serialized.includes(metric), `${dashboard.title} must include ${metric}`)
    }
    assert.ok(dashboard.panels.some((panel) => panel.title === "MEGS health endpoint configuration"))
  }
})

test("student-save panels state when actual write samples are absent", () => {
  for (const dashboard of [live, mirrorTest]) {
    const requests = dashboard.panels.find((panel) => panel.title === "Student-save requests in the last 5 minutes")
    const latency = dashboard.panels.find((panel) => panel.title === "Student-save mean latency by stage")
    assert.equal(requests.fieldConfig.defaults.noValue, "No request samples")
    assert.equal(latency.fieldConfig.defaults.noValue, "No real student-write samples in the selected range")
    assert.match(latency.description, /Missing telemetry is not zero latency/u)
  }
})
