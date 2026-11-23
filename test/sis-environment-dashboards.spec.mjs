import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const DASHBOARD_DIR = path.join(ROOT, "ops/monitoring/grafana/dashboards")
const live = JSON.parse(fs.readFileSync(path.join(DASHBOARD_DIR, "live-admin-mirror-overview.json"), "utf8"))
const mirrorTest = JSON.parse(fs.readFileSync(path.join(DASHBOARD_DIR, "test-mirror-overview.json"), "utf8"))
const liveReport = JSON.parse(fs.readFileSync(path.join(DASHBOARD_DIR, "live-nightly-subsystem-report.json"), "utf8"))
const testReport = JSON.parse(fs.readFileSync(path.join(DASHBOARD_DIR, "test-nightly-subsystem-report.json"), "utf8"))
const monitoringCompose = fs.readFileSync(path.join(ROOT, "ops/monitoring/docker-compose.yml"), "utf8")
const alloyConfig = fs.readFileSync(path.join(ROOT, "ops/monitoring/alloy-config.alloy"), "utf8")
const lokiConfig = fs.readFileSync(path.join(ROOT, "ops/monitoring/loki-config.yml"), "utf8")

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
  assert.equal(live.panels.length, 31)
  assert.equal(live.panels.find((panel) => panel.id === 8).gridPos.h, 24)
  assert.equal(live.panels.find((panel) => panel.id === 10).gridPos.y, 16)
  const resultTable = live.panels.find((panel) => panel.id === 8)
  assert.match(resultTable.targets[0].expr, /max by \(\) /u)
  assert.deepEqual(resultTable.transformations[0].options.excludeByName, { Time: true })
  assert.deepEqual(resultTable.transformations[0].options.indexByName, { subsystem: 0, Value: 1 })
  for (const dashboard of [live, mirrorTest]) {
    for (const [index, a] of dashboard.panels.entries()) {
      for (const b of dashboard.panels.slice(index + 1)) {
        const overlap = a.gridPos.x < b.gridPos.x + b.gridPos.w
          && b.gridPos.x < a.gridPos.x + a.gridPos.w
          && a.gridPos.y < b.gridPos.y + b.gridPos.h
          && b.gridPos.y < a.gridPos.y + a.gridPos.h
        assert.equal(overlap, false, `${dashboard.title} panels ${a.id} and ${b.id} must not overlap`)
      }
    }
  }
})

test("live and test nightly reports keep identical panel structure and complete target sets", () => {
  assert.equal(liveReport.panels.length, testReport.panels.length)
  assert.equal(liveReport.refresh, testReport.refresh)
  assert.deepEqual(liveReport.time, testReport.time)
  assert.equal(liveReport.panels.length, 61)
  for (const [index, panel] of liveReport.panels.entries()) {
    const paired = testReport.panels[index]
    assert.equal(panel.id, paired.id)
    assert.equal(panel.type, paired.type)
    assert.deepEqual(panel.gridPos, paired.gridPos)
    assert.equal(panel.targets?.length || 0, paired.targets?.length || 0)
  }
  for (const [name, dashboard] of [["live", liveReport], ["test", testReport]]) {
    const targets = dashboard.panels.flatMap((panel) => panel.targets || [])
    assert.equal(targets.length, 100, `${name} report must query all configured checks`)
    const statusCards = dashboard.panels.filter((panel) => panel.title === "STATUS")
    assert.equal(statusCards.length, 20)
    assert.ok(targets.some((target) => target.expr.includes('service="google_forms_grade_secret"')))
    assert.ok(!JSON.stringify(dashboard).includes("google_forms_discovery"))
  }
})

test("live dashboard reports ten read-only probes and ten vendor outcomes", () => {
  const serialized = JSON.stringify(live)
  const results = live.panels.find((panel) => panel.title === "20 subsystem checks · current results")
  assert.equal((results.targets[0].expr.match(/label_replace\(/g) || []).length, 20)
  assert.ok(serialized.includes("sis_grade_feed_readonly_data_available"))
  assert.ok(serialized.includes("sis_external_service_monitor_success"))
  assert.ok(serialized.includes("Customer workflow writes stay held"))
})

test("test dashboard reports ten authenticated workflows and ten vendor outcomes", () => {
  const smoke = mirrorTest.panels.find((panel) => panel.title === "20 subsystem checks · current results")
  const history = mirrorTest.panels.find((panel) => panel.title === "Historical subsystem result cadence")
  assert.equal(smoke.targets.length, 1)
  assert.equal((smoke.targets[0].expr.match(/label_replace\(/g) || []).length, 20)
  assert.ok(smoke.targets[0].expr.includes('group="student_news"'))
  assert.ok(smoke.targets[0].expr.includes('service="brevo_api"'))
  assert.ok(smoke.targets[0].expr.includes('service="google_forms_grade_secret"'))
  assert.ok(!smoke.targets[0].expr.includes("google_forms_discovery"))
  assert.ok(smoke.fieldConfig.defaults.mappings[0].options["-1"])
  for (const target of history.targets) {
    assert.match(target.expr, /^last_over_time\(\(.+\)\[30m:30s\]\)$/)
  }
})

test("both environment result counters include twenty checks", () => {
  const count = live.panels.find((panel) => panel.title === "Subsystem checks reported").targets[0].expr
  assert.equal((count.match(/label_replace\(/g) || []).length, 20)
  const paired = mirrorTest.panels.find((panel) => panel.title === "Subsystem checks reported").targets[0].expr
  assert.equal((paired.match(/label_replace\(/g) || []).length, 20)
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
      "site_dependency_probe_duration_seconds",
      "container_memory_working_set_bytes",
    ]) {
      assert.ok(serialized.includes(metric), `${dashboard.title} must include ${metric}`)
    }
    assert.ok(dashboard.panels.some((panel) => panel.title === "MEGS health endpoint configuration"))
    assert.equal(dashboard.panels.find((panel) => panel.id === 27).title, "Redis aggregate diagnostics")
    assert.ok(dashboard.panels.find((panel) => panel.id === 27).targets.some((target) => target.expr.includes('container="redis"')))
    assert.equal(dashboard.panels.find((panel) => panel.id === 29).datasource.uid, "sis-loki")
    assert.equal(dashboard.panels.find((panel) => panel.id === 30).title, "Loki WAL filesystem use")
    assert.ok(dashboard.panels.find((panel) => panel.id === 30).targets.some((target) => target.expr.includes("loki_ingester_wal_disk_usage_percent")))
    assert.equal(dashboard.panels.find((panel) => panel.id === 31).title, "Loki ingestion and WAL guard")
    assert.ok(dashboard.panels.find((panel) => panel.id === 31).targets.some((target) => target.expr.includes("loki_distributor_lines_received_total")))
  }
})

test("Google Forms grade connections observe the signed SIS path and Brevo shows endpoint state", () => {
  for (const dashboard of [live, mirrorTest]) {
    const grades = dashboard.panels.find((panel) => panel.id === 19)
    const brevo = dashboard.panels.find((panel) => panel.id === 20)
    assert.equal(grades.title, "Grade connections · Google Forms → SIS and Moodle")
    assert.ok(grades.targets.some((target) => target.expr.includes('source="google_forms"') && target.expr.includes("grade_rows")))
    assert.ok(grades.targets.some((target) => target.expr.includes('route="POST /api/integrations/google-forms/grades"') && target.expr.includes('status=~"2.."')))
    assert.ok(grades.targets.some((target) => target.expr.includes("sis_grade_feed_grade_latest_updated_timestamp_seconds")))
    assert.match(grades.description, /do not prove the external trigger/u)
    assert.ok(!JSON.stringify(grades).includes("google_forms_discovery"))
    assert.ok(grades.fieldConfig.overrides.some((item) => JSON.stringify(item).includes("NO OBSERVED REQUESTS")))
    assert.match(brevo.targets.find((target) => target.refId === "F").expr, /http_status[\s\S]*configured[\s\S]*- 1/u)
    assert.ok(brevo.fieldConfig.overrides.some((item) => JSON.stringify(item).includes("NO HTTP RESPONSE")))
  }
})

test("student-save panels state when actual write samples are absent", () => {
  for (const dashboard of [live, mirrorTest]) {
    const requests = dashboard.panels.find((panel) => panel.title === "Student-save requests in the last 5 minutes")
    const latency = dashboard.panels.find((panel) => panel.title === "Student-save mean latency by stage")
    assert.match(requests.targets[0].expr, /or vector\(0\)$/u)
    assert.equal(latency.fieldConfig.defaults.noValue, "No real student-write samples in the selected range")
    assert.match(latency.targets[0].expr, /increase\(/u)
    assert.match(latency.description, /zero is never substituted/u)
  }
})

test("live provider and News panels read live vendor and read-only Dictionary Builder feeds", () => {
  const providers = live.panels.find((panel) => panel.id === 17)
  const news = live.panels.find((panel) => panel.id === 18)
  assert.ok(providers.targets.some((target) => target.expr.includes('environment="live"') && target.expr.includes("sis_external_service_available")))
  assert.ok(providers.targets.some((target) => target.expr.includes('environment="live"') && target.expr.includes("sis_live_dictionary_builder_provider_checked")))
  assert.ok(providers.targets.some((target) => target.expr.includes('environment="live"') && target.expr.includes("sis_live_dictionary_builder_definition_providers_checked")))
  assert.ok(!JSON.stringify(providers).includes("not run live"))
  assert.ok(news.description.includes("News Check and submit are not run on live"))
  assert.ok(!news.targets.some((target) => target.expr.includes("sis_news_check_success")))
})

test("monitoring log and container feeds have bounded scope, persistent offsets, and a guarded WAL", () => {
  assert.match(monitoringCompose, /cadvisor:[\s\S]*?image: ghcr\.io\/google\/cadvisor/u)
  assert.match(monitoringCompose, /loki:[\s\S]*?image: grafana\/loki/u)
  assert.match(monitoringCompose, /alloy:[\s\S]*?--storage\.path=\/var\/lib\/alloy\/data[\s\S]*?alloy-data:\/var\/lib\/alloy\/data/u)
  assert.match(alloyConfig, /stage\.docker \{ \}[\s\S]*?older_than\s+= "30m"/u)
  assert.match(alloyConfig, /"\/sis-prometheus"[\s\S]*?"\/sis-alloy"/u)
  assert.match(lokiConfig, /disk_full_threshold: 0\.95/u)
  assert.ok(!alloyConfig.includes("/sis-postgres"), "database container logs must remain outside Loki")
})
