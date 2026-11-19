import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const OUTPUT = path.join(ROOT, "ops/monitoring/grafana/dashboards")
const DATASOURCE = { type: "prometheus", uid: "sis-prometheus" }

const domains = [
  {
    domain: "eagles.edu.vn",
    name: "Eagles Homepage",
    slug: "eagles-homepage",
    applicationChecks: [],
    dependencies: false,
    containers: false,
    services: ["lshttpd.service", "mariadb.service"],
    alerts: "PublicWebsite.*|EaglesHomepageDatabaseDown|OpenLiteSpeed.*",
    coverage: [
      ["Public edge", "Measured", "HTTPS availability, HTTP status, DNS, TLS, and response phases."],
      ["Host services", "Measured", "OpenLiteSpeed and MariaDB systemd active state; host resources are shared."],
      ["Application/API", "Not measured", "No domain-specific application/API probe is configured."],
      ["Database dependency", "Partial", "MariaDB service state only; no site-authenticated database query is exported."],
    ],
  },
  {
    domain: "admin.eagles.edu.vn",
    name: "SIS Admin",
    slug: "sis-admin",
    applicationChecks: ["blackbox-website-api", "blackbox-admin-auth-api"],
    dependencies: true,
    containers: false,
    services: ["nginx.service", "lshttpd.service", "exercise-mailer.service"],
    alerts: "PublicWebsite.*|AdminAuthentication.*|SiteSISAPI.*|SiteDependency.*|SISLiveApiServiceDown",
    coverage: [
      ["Public edge", "Measured", "HTTPS availability, HTTP status, DNS, TLS, and response phases."],
      ["Application/API", "Measured", "SIS route response and unauthenticated session guard."],
      ["Data dependencies", "Measured", "Authenticated PostgreSQL SELECT 1 and SIS app/session/cache Redis PING checks."],
      ["Host services", "Measured", "Nginx, OpenLiteSpeed, SIS API service, and shared host resource metrics."],
      ["SIS workflows", "Measured", "Dev keep-alive groups are environment-wide signals, not admin-domain-attributed checks."],
    ],
  },
  {
    domain: "ltd.eagles.vn",
    name: "LTD ERPNext",
    slug: "ltd-erpnext",
    applicationChecks: ["blackbox-website-app"],
    dependencies: true,
    containers: true,
    services: [],
    alerts: "PublicWebsite.*|LTDERPNext.*|SiteDependency.*",
    coverage: [
      ["Public edge", "Measured", "HTTPS availability, HTTP status, DNS, TLS, and response phases."],
      ["Application/API", "Measured", "Public Frappe ping endpoint."],
      ["Containers", "Measured", "Eight ERPNext and Redis containers, running and Docker health state."],
      ["Data dependencies", "Measured", "Authenticated Redis PING checks for ERPNext cache, queue, and socketio roles."],
      ["Host resources", "Measured", "Shared host CPU, memory, disk, and network; these are not container-specific."],
    ],
  },
  {
    domain: "ielts.eagles.edu.vn",
    name: "IELTS Portal",
    slug: "ielts-portal",
    applicationChecks: ["blackbox-website-api"],
    dependencies: false,
    containers: false,
    services: ["exercise-mailer.service"],
    alerts: "PublicWebsite.*|SiteSISAPI.*|SISLiveApiServiceDown",
    coverage: [
      ["Public edge", "Measured", "HTTPS availability, HTTP status, DNS, TLS, and response phases."],
      ["Application/API", "Measured", "SIS exercise-submission route; the SIS service metric is shared across domains."],
      ["Host services", "Measured", "Shared SIS API systemd state and host resource metrics."],
      ["Data dependencies", "Not measured", "No IELTS-domain database or Redis dependency series is exported."],
    ],
  },
  {
    domain: "thuvien.eagles.edu.vn",
    name: "Thuvien Library",
    slug: "thuvien-library",
    applicationChecks: ["blackbox-website-api", "blackbox-thuvien-media"],
    dependencies: false,
    containers: false,
    services: ["exercise-mailer.service", "thuvien-r2-flip-image.service", "thuvien-read-audio.service"],
    alerts: "PublicWebsite.*|SiteSISAPI.*|Thuvien.*|SISLiveApiServiceDown",
    coverage: [
      ["Public edge", "Measured", "HTTPS availability, HTTP status, DNS, TLS, and response phases."],
      ["Application/API", "Measured", "SIS exercise-submission route; shared SIS service state is not domain-attributed."],
      ["Media delivery", "Measured", "One-byte HTTP range checks for a Flip image and reading audio."],
      ["Host services", "Measured", "Shared SIS API plus image and audio gateway systemd states."],
      ["Data dependencies", "Not measured", "No Thuvien-domain database or object-store dependency probe is exported."],
    ],
  },
]

function target(expr, refId, legendFormat, instant = false) {
  return { expr, refId, legendFormat, ...(instant ? { instant: true } : {}) }
}

function panel(id, title, type, exprs, gridPos, options = {}) {
  return {
    id,
    type,
    title,
    description: options.description || "",
    gridPos,
    datasource: DATASOURCE,
    targets: exprs.map((entry, index) => target(entry.expr, String.fromCharCode(65 + index), entry.legend || "{{domain}}", entry.instant)),
    fieldConfig: options.fieldConfig || { defaults: {}, overrides: [] },
    options: options.options || {},
  }
}

function statOptions() {
  return { reduceOptions: { values: false, calcs: ["lastNotNull"], fields: "" }, orientation: "auto", textMode: "auto", colorMode: "value", graphMode: "area", justifyMode: "auto" }
}

function statusField() {
  return { defaults: { mappings: [{ type: "value", options: { "0": { text: "DOWN", color: "red" }, "1": { text: "UP", color: "green" } } }], thresholds: { mode: "absolute", steps: [{ color: "red", value: null }, { color: "green", value: 1 }] } }, overrides: [] }
}

function dashboardFor(config) {
  const domain = config.domain
  const selector = `domain="${domain}"`
  const appJobs = config.applicationChecks.join("|")
  const appSelector = appJobs ? `probe_success{${selector},job=~"${appJobs}"}` : null
  const panels = [
    panel(1, "Public HTTPS", "stat", [target(`probe_success{job="blackbox-website-http",${selector},check="main"}`, "A", domain, true)], { x: 0, y: 0, w: 5, h: 5 }, { fieldConfig: statusField(), options: statOptions() }),
    panel(2, "HTTP status", "stat", [target(`probe_http_status_code{job="blackbox-website-http",${selector},check="main"}`, "A", domain, true)], { x: 5, y: 0, w: 4, h: 5 }, { options: statOptions() }),
    panel(3, "TLS days remaining", "stat", [target(`(probe_ssl_earliest_cert_expiry{job="blackbox-website-http",${selector},check="main"} - time()) / 86400`, "A", domain, true)], { x: 9, y: 0, w: 5, h: 5 }, { fieldConfig: { defaults: { unit: "d", thresholds: { mode: "absolute", steps: [{ color: "red", value: null }, { color: "yellow", value: 14 }, { color: "green", value: 30 }] } }, overrides: [] }, options: statOptions() }),
    panel(4, "Probe freshness", "stat", [target(`time() - timestamp(probe_success{job="blackbox-website-http",${selector},check="main"})`, "A", "seconds since last probe", true)], { x: 14, y: 0, w: 5, h: 5 }, { fieldConfig: { defaults: { unit: "s" }, overrides: [] }, options: statOptions() }),
    panel(5, "Active domain alerts", "stat", [target(`count(ALERTS{alertname=~"${config.alerts}",alertstate=~"pending|firing",domain="${domain}"}) or vector(0)`, "A", "alerts", true)], { x: 19, y: 0, w: 5, h: 5 }, { fieldConfig: { defaults: { thresholds: { mode: "absolute", steps: [{ color: "green", value: null }, { color: "red", value: 1 }] } }, overrides: [] }, options: statOptions() }),
    panel(6, "Public availability history", "state-timeline", [target(`probe_success{job="blackbox-website-http",${selector},check="main"}`, "A", "{{check}}")], { x: 0, y: 5, w: 24, h: 7 }, { fieldConfig: statusField(), options: { mergeValues: true, showValue: "auto", alignValue: "center", rowHeight: 0.9, tooltip: { mode: "single", sort: "none" } } }),
    panel(7, "Request phases", "timeseries", [target(`probe_http_duration_seconds{job="blackbox-website-http",${selector}}`, "A", "{{phase}}")], { x: 0, y: 12, w: 12, h: 8 }, { fieldConfig: { defaults: { unit: "s" }, overrides: [] }, options: { legend: { displayMode: "list", placement: "bottom" }, tooltip: { mode: "multi", sort: "desc" } } }),
    panel(8, "DNS resolution", "timeseries", [target(`probe_dns_lookup_time_seconds{job="blackbox-website-http",${selector}}`, "A", "DNS lookup")], { x: 12, y: 12, w: 12, h: 8 }, { fieldConfig: { defaults: { unit: "s" }, overrides: [] }, options: { legend: { displayMode: "list", placement: "bottom" }, tooltip: { mode: "multi", sort: "desc" } } }),
    panel(9, "Application and media probe state", "state-timeline", appSelector ? [target(appSelector, "A", "{{check}} · {{job}}")]: [], { x: 0, y: 20, w: 12, h: 8 }, { description: appSelector ? "Only configured domain-specific checks appear. Coverage gaps are listed in the layer map below." : "No domain-specific application or API probe is configured; this is an explicit instrumentation gap.", fieldConfig: statusField(), options: { mergeValues: true, showValue: "auto", alignValue: "center", rowHeight: 0.9, tooltip: { mode: "single", sort: "none" } } }),
    panel(10, "Host resources · shared host", "timeseries", [
      target("100 * (1 - avg(rate(node_cpu_seconds_total{mode=\"idle\"}[5m])))", "A", "CPU busy"),
      target("100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)", "B", "Memory used"),
      target("100 * (1 - node_filesystem_avail_bytes{mountpoint=\"/\",fstype!~\"tmpfs|overlay\"} / node_filesystem_size_bytes{mountpoint=\"/\",fstype!~\"tmpfs|overlay\"})", "C", "Root filesystem used"),
    ], { x: 12, y: 20, w: 12, h: 8 }, { description: "Node-exporter reports the shared host. These resource metrics are not attributed to this domain.", fieldConfig: { defaults: { unit: "percent", min: 0, max: 100 }, overrides: [] }, options: { legend: { displayMode: "list", placement: "bottom" }, tooltip: { mode: "multi", sort: "desc" } } }),
    panel(11, "Layer coverage and attribution", "text", [], { x: 0, y: 28, w: 12, h: 9 }, { description: "This map distinguishes collected signals from uninstrumented layers; shared host metrics are not presented as per-domain measurements.", options: { mode: "markdown", content: `| Layer | Coverage | Signals |\n| --- | --- | --- |\n${config.coverage.map(([layer, status, detail]) => `| ${layer} | **${status}** | ${detail} |`).join("\n")}` } }),
    panel(12, "Host service state", "table", config.services.length ? [target(`node_systemd_unit_state{name=~"(${config.services.map((service) => service.replaceAll(".", "\\\\.")).join("|")})",state=~"active|failed"}`, "A", "{{name}} / {{state}}", true)] : [], { x: 12, y: 28, w: 12, h: 9 }, { description: "Shared host systemd state. Missing series mean no matching systemd unit is exported.", fieldConfig: statusField(), options: { showHeader: true, cellHeight: "md", sortBy: [] } }),
    panel(13, "Domain dependencies", "table", config.dependencies ? [target(`site_dependency_status{${selector}}`, "A", "{{dependency}} · {{check}}", true)] : [], { x: 0, y: 37, w: config.containers ? 12 : 24, h: 9 }, { description: config.dependencies ? "Read-only authenticated dependency probes. No rows means the collector has not exported this layer." : "No domain-specific authenticated database/cache dependency probe is configured.", fieldConfig: statusField(), options: { showHeader: true, cellHeight: "md", sortBy: [] } }),
    panel(17, "Application/API response time", "timeseries", [target(`probe_duration_seconds{${selector},job=~"${appJobs}"}`, "A", "{{check}}")], { x: 12, y: 20, w: 12, h: 8 }, { description: appSelector ? "Response duration for configured domain application/API probes." : "No domain-specific application/API latency probe is configured.", fieldConfig: { defaults: { unit: "s" }, overrides: [] }, options: { legend: { displayMode: "list", placement: "bottom" }, tooltip: { mode: "multi", sort: "desc" } } }),
  ]

  if (config.containers) {
    panels.push(panel(14, "ERPNext component health", "table", [
      target(`erpnext_container_running{${selector}}`, "A", "{{component}} running", true),
      target(`erpnext_container_health{${selector}}`, "B", "{{component}} health", true),
    ], { x: 12, y: 37, w: 12, h: 9 }, { description: "Eight expected containers; health -1 means the container has no Docker healthcheck.", options: { showHeader: true, cellHeight: "md", sortBy: [] } }))
  }

  const alertsY = config.containers ? 46 : 46
  const adminAckAlert = config.slug === "sis-admin"
    ? [target("ALERTS{alertname=\"DevParentReportAcknowledgmentServerFailure\",environment=\"dev\",alertstate=~\"pending|firing\"}", "B", "SIS parent acknowledgment 5xx")]
    : []
  panels.push(panel(15, "Domain alert timeline", "state-timeline", [
    target(`ALERTS{alertname=~"${config.alerts}",alertstate=~"pending|firing",domain="${domain}"}`, "A", "{{alertname}} / {{severity}}"),
    ...adminAckAlert,
  ], { x: 0, y: alertsY, w: 24, h: 8 }, { description: config.slug === "sis-admin"
    ? "Domain-labeled alerts and the environment-wide dev parent report acknowledgment server-failure alert are shown."
    : "Only pending and firing alerts with this domain label are shown. Shared, unlabelled service/workflow alerts are called out in layer descriptions.", options: { mergeValues: true, showValue: "auto", alignValue: "center", rowHeight: 0.9, tooltip: { mode: "single", sort: "none" } } }))

  if (config.slug === "sis-admin") {
    panels.push(panel(16, "SIS dev workflow state and freshness · environment-wide", "timeseries", [
      target("sis_keepalive_check_failure_info{environment=\"dev\"}", "A", "{{group}} · {{code}}"),
      target("time() - sis_keepalive_check_last_check_timestamp_seconds{environment=\"dev\"}", "B", "{{group}} freshness seconds"),
    ], { x: 0, y: 54, w: 24, h: 8 }, { description: "These dev checks have environment labels, not domain labels. Failure series are binary, and freshness is graphed as seconds since the last check.", fieldConfig: { defaults: { unit: "s" }, overrides: [] }, options: { legend: { displayMode: "list", placement: "bottom" }, tooltip: { mode: "multi", sort: "desc" } } }))
    panels.push(panel(18, "Parent report acknowledgment results · dev", "timeseries", [
      target("sum by(status) (increase(sis_parent_report_acknowledgment_requests_total{environment=\"dev\",route=\"POST /api/parent/reports/:reportId/acknowledge\"}[1h]))", "A", "HTTP {{status}}"),
      target("ALERTS{alertname=\"DevParentReportAcknowledgmentServerFailure\",environment=\"dev\",alertstate=~\"pending|firing\"}", "B", "5xx alert"),
    ], { x: 0, y: 62, w: 24, h: 8 }, { description: "Environment-wide dev acknowledgment result counts and the corresponding 5xx alert; these are not attributed to one individual report.", options: { legend: { displayMode: "list", placement: "bottom" }, tooltip: { mode: "multi", sort: "desc" } } }))
  }

  return {
    uid: `domain-${config.slug}`,
    title: `${config.name} · Domain Layers`,
    tags: ["domain", config.slug, "availability", "coverage"],
    timezone: "browser",
    schemaVersion: 39,
    refresh: "30s",
    time: { from: "now-24h", to: "now" },
    annotations: { list: [{ builtIn: 1, datasource: { type: "grafana", uid: "-- Grafana --" }, enable: true, hide: true, iconColor: "rgba(0, 211, 255, 1)", name: "Annotations & Alerts", type: "dashboard" }] },
    panels,
    templating: { list: [] },
    version: 1,
    weekStart: "monday",
  }
}

for (const config of domains) {
  const dashboard = dashboardFor(config)
  fs.writeFileSync(path.join(OUTPUT, `${config.slug}-domain.json`), `${JSON.stringify(dashboard, null, 2)}\n`)
}
