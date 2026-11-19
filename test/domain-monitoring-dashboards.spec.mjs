import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const DASHBOARD_DIR = path.join(ROOT, "ops/monitoring/grafana/dashboards")
const expectations = new Map([
  ["eagles-homepage-domain.json", { domain: "eagles.edu.vn", checks: ["probe_success", "probe_http_duration_seconds", "node_systemd_unit_state"], hasGap: true }],
  ["sis-admin-domain.json", { domain: "admin.eagles.edu.vn", checks: ["blackbox-admin-auth-api", "site_dependency_status", "sis_keepalive_check_failure_info", "sis_parent_report_acknowledgment_requests_total", "DevParentReportAcknowledgmentServerFailure"], hasGap: false }],
  ["ltd-erpnext-domain.json", { domain: "ltd.eagles.vn", checks: ["blackbox-website-app", "erpnext_container_running", "site_dependency_status"], hasGap: false }],
  ["ielts-portal-domain.json", { domain: "ielts.eagles.edu.vn", checks: ["blackbox-website-api", "node_systemd_unit_state"], hasGap: true }],
  ["thuvien-library-domain.json", { domain: "thuvien.eagles.edu.vn", checks: ["blackbox-thuvien-media", "thuvien-r2-flip-image", "thuvien-read-audio"], hasGap: true }],
])

test("each monitored domain has a layered Grafana dashboard with explicit measured and missing coverage", () => {
  for (const [filename, expected] of expectations) {
    const dashboard = JSON.parse(fs.readFileSync(path.join(DASHBOARD_DIR, filename), "utf8"))
    assert.equal(dashboard.uid.startsWith("domain-"), true, filename)
    assert.equal(dashboard.refresh, "30s", filename)
    assert.ok(dashboard.panels.length >= 15, `${filename} should expose the measured layers`)
    const serialized = JSON.stringify(dashboard)
    assert.ok(serialized.includes(expected.domain), `${filename} must filter to its configured domain`)
    for (const check of expected.checks) assert.ok(serialized.includes(check), `${filename} must include ${check}`)
    assert.ok(serialized.includes("Layer coverage and attribution"), `${filename} must include an explicit layer coverage map`)
    if (expected.hasGap) assert.ok(serialized.includes("Not measured") || serialized.includes("Partial"), `${filename} must call out missing instrumentation`)
    assert.ok(dashboard.panels.some((panel) => panel.type === "state-timeline"), `${filename} must show state history`)
    assert.ok(dashboard.panels.some((panel) => panel.type === "timeseries"), `${filename} must graph time-series data`)
    assert.ok(dashboard.panels.some((panel) => panel.type === "stat"), `${filename} must show summary cards`)
  }
})
