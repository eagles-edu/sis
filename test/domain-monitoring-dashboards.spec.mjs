import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const DASHBOARD_DIR = path.join(ROOT, "ops/monitoring/grafana/dashboards")
const expectations = new Map([
  ["eagles-homepage-domain.json", { domain: "eagles.edu.vn", checks: ["probe_success", "probe_http_duration_seconds", "node_systemd_unit_state", "site_dependency_nginx_config_valid"], hasGap: true }],
  ["sis-admin-domain.json", { title: "SIS Admin Mirror · Domain Layers", domain: "admin.eagles.edu.vn", checks: ["blackbox-admin-auth-api", "site_dependency_status", "site_dependency_nginx_config_valid", "sis_keepalive_check_failure_info", "sis_parent_report_acknowledgment_requests_total", "DevParentReportAcknowledgmentServerFailure"], hasGap: false }],
  ["ltd-erpnext-domain.json", { domain: "ltd.eagles.vn", checks: ["blackbox-website-app", "erpnext_container_running"], excludedChecks: ["site_dependency_nginx_config_valid"], hasGap: false }],
  ["ielts-portal-domain.json", { domain: "ielts.eagles.edu.vn", checks: ["blackbox-website-api", "node_systemd_unit_state", "site_dependency_nginx_config_valid"], hasGap: true }],
  ["thuvien-library-domain.json", { domain: "thuvien.eagles.edu.vn", checks: ["blackbox-thuvien-media", "thuvien-r2-flip-image", "thuvien-read-audio", "site_dependency_nginx_config_valid"], hasGap: true }],
  ["moodle-portal-domain.json", { title: "Moodle Portal · Domain Layers", domain: "moodle.eagles.edu.vn", checks: ["probe_success", "php8[.]2-fpm[.]service", "mariadb[.]service", "site_dependency_nginx_config_valid"], hasGap: true }],
])

test("each monitored domain has a layered Grafana dashboard with explicit measured and missing coverage", () => {
  const domainFiles = fs.readdirSync(DASHBOARD_DIR).filter((filename) => filename.endsWith("-domain.json")).sort()
  assert.deepEqual(domainFiles, [...expectations.keys()].sort(), "the dashboards must cover every configured public domain and no untracked domain")

  for (const [filename, expected] of expectations) {
    const dashboard = JSON.parse(fs.readFileSync(path.join(DASHBOARD_DIR, filename), "utf8"))
    assert.equal(dashboard.uid.startsWith("domain-"), true, filename)
    if (expected.title) assert.equal(dashboard.title, expected.title, filename)
    assert.equal(dashboard.refresh, "30s", filename)
    assert.ok(dashboard.panels.length >= 17, `${filename} should expose the measured layers and independent public checks`)
    const serialized = JSON.stringify(dashboard)
    assert.ok(serialized.includes(expected.domain), `${filename} must filter to its configured domain`)
    for (const check of expected.checks) assert.ok(serialized.includes(check), `${filename} must include ${check}`)
    for (const check of expected.excludedChecks || []) assert.ok(!serialized.includes(check), `${filename} must not attribute ${check} to this domain`)
    assert.ok(serialized.includes("Layer coverage and attribution"), `${filename} must include an explicit layer coverage map`)
    if (expected.hasGap) assert.ok(serialized.includes("Not measured") || serialized.includes("Partial"), `${filename} must call out missing instrumentation`)
    assert.ok(dashboard.panels.some((panel) => panel.type === "state-timeline"), `${filename} must show state history`)
    assert.ok(dashboard.panels.some((panel) => panel.type === "timeseries"), `${filename} must graph time-series data`)
    assert.ok(dashboard.panels.some((panel) => panel.type === "stat"), `${filename} must show summary cards`)
    const availability = dashboard.panels.find((panel) => panel.title === "24h uptime" && panel.type === "stat")
    assert.ok(availability, `${filename} must show 24-hour availability`)
    assert.deepEqual(availability.targets.map((target) => target.legendFormat), ["Success %", "Samples"], `${filename} must show the rate beside its collected sample count`)
    assert.ok(dashboard.panels.some((panel) => panel.title === "Layer coverage and attribution" && panel.type === "text"), `${filename} must label measured and missing layers`)
    const requestPhases = dashboard.panels.find((panel) => panel.title === "Request phases")
    assert.equal(requestPhases.targets[0].legendFormat, "{{phase}}", `${filename} must distinguish each measured request phase`)
    const externalStatus = dashboard.panels.find((panel) => panel.title === "Independent public availability")
    const externalHistory = dashboard.panels.find((panel) => panel.title === "Independent public region history")
    assert.ok(externalStatus, `${filename} must show independent public status`)
    assert.ok(externalHistory, `${filename} must show independent public region history`)
    assert.ok(externalStatus.targets.every((target) => target.expr.includes(`domain="${expected.domain}"`)), `${filename} external status must be attributed to its domain`)
    assert.ok(externalStatus.targets[0].expr.includes("eagles_external_public_site_state"), `${filename} must distinguish inconclusive checks from confirmed outages`)
    assert.ok(JSON.stringify(externalStatus.fieldConfig).includes("UNVERIFIED"), `${filename} must label inconclusive checks as unverified`)
    assert.ok(externalHistory.targets[0].expr.includes(`domain="${expected.domain}"`), `${filename} external region history must be attributed to its domain`)

    for (const [index, panel] of dashboard.panels.entries()) {
      assert.ok(panel.gridPos && panel.gridPos.x >= 0 && panel.gridPos.y >= 0, `${filename} panel ${panel.title} must have a grid position`)
      assert.ok(panel.gridPos.w > 0 && panel.gridPos.h > 0 && panel.gridPos.x + panel.gridPos.w <= 24, `${filename} panel ${panel.title} must fit the Grafana grid`)
      for (const other of dashboard.panels.slice(index + 1)) {
        const overlaps = panel.gridPos.x < other.gridPos.x + other.gridPos.w
          && panel.gridPos.x + panel.gridPos.w > other.gridPos.x
          && panel.gridPos.y < other.gridPos.y + other.gridPos.h
          && panel.gridPos.y + panel.gridPos.h > other.gridPos.y
        assert.equal(overlaps, false, `${filename} panels "${panel.title}" and "${other.title}" must not overlap`)
      }
    }
  }
})

test("the SIS test dashboard names its environment explicitly", () => {
  const dashboard = JSON.parse(fs.readFileSync(path.join(DASHBOARD_DIR, "test-mirror-overview.json"), "utf8"))
  assert.equal(dashboard.title, "SIS Test Mirror · Operations")
  assert.ok(dashboard.tags.includes("test-mirror"))
})
