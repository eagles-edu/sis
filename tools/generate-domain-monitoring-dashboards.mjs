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
    services: ["nginx.service", "lshttpd.service", "mariadb.service"],
    alerts: "PublicWebsite.*|EaglesHomepageDatabaseDown|OpenLiteSpeed.*",
    coverage: [
      ["Public edge", "Measured", "Host-origin HTTPS details plus independent public checks from Vietnam, the United States, and the United Kingdom."],
      ["Host services", "Measured", "Nginx and OpenLiteSpeed systemd active state, plus shared-host Nginx configuration validation and MariaDB state."],
      ["Application/API", "Not measured", "No domain-specific application/API probe is configured."],
      ["Database dependency", "Partial", "MariaDB service state only; no site-authenticated database query is exported."],
    ],
  },
  {
    domain: "admin.eagles.edu.vn",
    name: "SIS Admin Mirror",
    slug: "sis-admin",
    applicationChecks: ["blackbox-website-api", "blackbox-admin-auth-api"],
    dependencies: true,
    containers: false,
    services: ["nginx.service", "lshttpd.service", "exercise-mailer.service"],
    alerts: "PublicWebsite.*|AdminAuthentication.*|SiteSISAPI.*|SiteDependency.*|SISLiveApiServiceDown",
    coverage: [
      ["Public edge", "Measured", "Host-origin HTTPS details plus independent public checks from Vietnam, the United States, and the United Kingdom."],
      ["Application/API", "Measured", "SIS route response and unauthenticated session guard."],
      ["Data dependencies", "Measured", "Authenticated PostgreSQL SELECT 1 and SIS app/session/cache Redis PING checks."],
      ["Host services", "Measured", "Nginx and OpenLiteSpeed state, shared-host Nginx configuration validation, SIS API service, and shared host resources."],
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
      ["Public edge", "Measured", "Host-origin HTTPS details plus independent public checks from Vietnam, the United States, and the United Kingdom."],
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
    services: ["nginx.service", "exercise-mailer.service"],
    alerts: "PublicWebsite.*|SiteSISAPI.*|SISLiveApiServiceDown",
    coverage: [
      ["Public edge", "Measured", "Host-origin HTTPS details plus independent public checks from Vietnam, the United States, and the United Kingdom."],
      ["Application/API", "Measured", "SIS exercise-submission route; the SIS service metric is shared across domains."],
      ["Host services", "Measured", "Shared Nginx configuration and SIS API systemd state; host resources are shared."],
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
    services: ["nginx.service", "exercise-mailer.service", "thuvien-r2-flip-image.service", "thuvien-read-audio.service"],
    alerts: "PublicWebsite.*|SiteSISAPI.*|Thuvien.*|SISLiveApiServiceDown",
    coverage: [
      ["Public edge", "Measured", "Host-origin HTTPS details plus independent public checks from Vietnam, the United States, and the United Kingdom."],
      ["Application/API", "Measured", "SIS exercise-submission route; shared SIS service state is not domain-attributed."],
      ["Media delivery", "Measured", "One-byte HTTP range checks for a Flip image and reading audio."],
      ["Host services", "Measured", "Shared Nginx configuration, SIS API, image, and audio gateway systemd states."],
      ["Data dependencies", "Not measured", "No Thuvien-domain database or object-store dependency probe is exported."],
    ],
  },
  {
    domain: "moodle.eagles.edu.vn",
    name: "Moodle Portal",
    slug: "moodle-portal",
    applicationChecks: [],
    dependencies: false,
    containers: false,
    services: ["nginx.service", "php8.2-fpm.service", "mariadb.service"],
    alerts: "PublicWebsite.*|NginxConfigurationInvalid",
    coverage: [
      ["Public edge", "Measured", "Host-origin HTTPS details plus independent public checks from Vietnam, the United States, and the United Kingdom."],
      ["Application", "Partial", "Public Moodle page availability is measured; authenticated Moodle actions are not exercised by this probe."],
      ["Host services", "Measured", "Shared Nginx configuration and the PHP-FPM/MariaDB systemd states."],
      ["Data dependencies", "Partial", "MariaDB service state only; no Moodle-authenticated database query is exported."],
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
    targets: exprs.map((entry, index) => target(entry.expr, entry.refId || String.fromCharCode(65 + index), entry.legend || entry.legendFormat || "{{domain}}", entry.instant)),
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

function explicitGapPanel(id, title, x, y, description) {
  return panel(id, title, "text", [], { x, y, w: 12, h: 9 }, {
    description,
    options: { mode: "markdown", content: description },
  })
}

function dashboardFor(config) {
  const domain = config.domain
  const selector = `domain="${domain}"`
  const appJobs = config.applicationChecks.join("|")
  const appSelector = appJobs ? `probe_success{${selector},job=~"${appJobs}"}` : null
  const sharedNginxConfig = config.services.includes("nginx.service")
  const alertCountExpr = [
    `(count(ALERTS{alertname=~"${config.alerts}",alertstate=~"pending|firing",domain="${domain}"}) or vector(0))`,
    ...(sharedNginxConfig ? [`(count(ALERTS{alertname="NginxConfigurationInvalid",scope="shared_host",alertstate=~"pending|firing"}) or vector(0))`] : []),
  ].join(" + ")
  const panels = [
    panel(1, "Public HTTPS", "stat", [target(`probe_success{job="blackbox-website-http",${selector},check="main"}`, "A", domain, true)], { x: 0, y: 0, w: 4, h: 5 }, { fieldConfig: statusField(), options: statOptions() }),
    panel(2, "HTTP status", "stat", [target(`probe_http_status_code{job="blackbox-website-http",${selector},check="main"}`, "A", domain, true)], { x: 4, y: 0, w: 4, h: 5 }, { fieldConfig: { defaults: { thresholds: { mode: "absolute", steps: [{ color: "red", value: null }, { color: "green", value: 200 }, { color: "yellow", value: 300 }, { color: "red", value: 400 }] } }, overrides: [] }, options: statOptions() }),
    panel(3, "TLS left", "stat", [target(`(probe_ssl_earliest_cert_expiry{job="blackbox-website-http",${selector},check="main"} - time()) / 86400`, "A", domain, true)], { x: 8, y: 0, w: 4, h: 5 }, { fieldConfig: { defaults: { unit: "d", thresholds: { mode: "absolute", steps: [{ color: "red", value: null }, { color: "yellow", value: 14 }, { color: "green", value: 30 }] } }, overrides: [] }, options: statOptions() }),
    panel(4, "Probe age", "stat", [target(`time() - timestamp(probe_success{job="blackbox-website-http",${selector},check="main"})`, "A", "seconds since last probe", true)], { x: 12, y: 0, w: 4, h: 5 }, { fieldConfig: { defaults: { unit: "s" }, overrides: [] }, options: statOptions() }),
    panel(5, "Alerts", "stat", [target(alertCountExpr, "A", sharedNginxConfig ? "domain and shared-host alerts" : "domain alerts", true)], { x: 16, y: 0, w: 4, h: 5 }, { fieldConfig: { defaults: { thresholds: { mode: "absolute", steps: [{ color: "green", value: null }, { color: "red", value: 1 }] } }, overrides: [] }, options: statOptions() }),
    panel(19, "24h uptime", "stat", [
      target(`100 * avg_over_time(probe_success{job="blackbox-website-http",${selector},check="main"}[24h])`, "A", "Success %", true),
      target(`count_over_time(probe_success{job="blackbox-website-http",${selector},check="main"}[24h])`, "B", "Samples", true),
    ], { x: 20, y: 0, w: 4, h: 5 }, { description: "The success rate is calculated from samples actually collected in the last 24 hours. The sample count sits beside the rate so incomplete history is visible; no data is not treated as healthy.", fieldConfig: { defaults: { decimals: 2 }, overrides: [
      { matcher: { id: "byName", options: "Success %" }, properties: [{ id: "unit", value: "percent" }, { id: "min", value: 0 }, { id: "max", value: 100 }, { id: "thresholds", value: { mode: "absolute", steps: [{ color: "red", value: null }, { color: "yellow", value: 99 }, { color: "green", value: 99.9 }] } }] },
      { matcher: { id: "byName", options: "Samples" }, properties: [{ id: "unit", value: "short" }, { id: "decimals", value: 0 }, { id: "thresholds", value: { mode: "absolute", steps: [{ color: "red", value: null }, { color: "yellow", value: 1 }, { color: "green", value: 1200 }] } }] },
    ] }, options: { ...statOptions(), textMode: "value_and_name" } }),
    panel(6, "Public availability history", "state-timeline", [target(`probe_success{job="blackbox-website-http",${selector},check="main"}`, "A", "{{check}}")], { x: 0, y: 5, w: 24, h: 7 }, { fieldConfig: statusField(), options: { mergeValues: true, showValue: "auto", alignValue: "center", rowHeight: 0.9, tooltip: { mode: "single", sort: "none" } } }),
    panel(7, "Request phases", "timeseries", [target(`probe_http_duration_seconds{job="blackbox-website-http",${selector}}`, "A", "{{phase}}")], { x: 0, y: 12, w: 12, h: 8 }, { fieldConfig: { defaults: { unit: "s" }, overrides: [] }, options: { legend: { displayMode: "list", placement: "bottom" }, tooltip: { mode: "multi", sort: "desc" } } }),
    panel(8, "DNS resolution", "timeseries", [target(`probe_dns_lookup_time_seconds{job="blackbox-website-http",${selector}}`, "A", "DNS lookup")], { x: 12, y: 12, w: 12, h: 8 }, { fieldConfig: { defaults: { unit: "s" }, overrides: [] }, options: { legend: { displayMode: "list", placement: "bottom" }, tooltip: { mode: "multi", sort: "desc" } } }),
    appSelector
      ? panel(9, "Application and media probe state", "state-timeline", [target(appSelector, "A", "{{check}} · {{job}}")], { x: 0, y: 20, w: 12, h: 8 }, { description: "Only configured domain-specific checks appear. Coverage gaps are listed in the layer map below.", fieldConfig: statusField(), options: { mergeValues: true, showValue: "auto", alignValue: "center", rowHeight: 0.9, tooltip: { mode: "single", sort: "none" } } })
      : panel(9, "Application and media probe state", "text", [], { x: 0, y: 20, w: 12, h: 8 }, { description: "No domain-specific application or API probe is configured; this is an explicit instrumentation gap.", options: { mode: "markdown", content: "No application or media probe is configured for this domain. Review the layer coverage map before interpreting this as a healthy result." } }),
    panel(10, "Host resources · shared host", "timeseries", [
      target("100 * (1 - avg(rate(node_cpu_seconds_total{mode=\"idle\"}[5m])))", "A", "CPU busy"),
      target("100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)", "B", "Memory used"),
      target("100 * (1 - node_filesystem_avail_bytes{mountpoint=\"/\",fstype!~\"tmpfs|overlay\"} / node_filesystem_size_bytes{mountpoint=\"/\",fstype!~\"tmpfs|overlay\"})", "C", "Root filesystem used"),
    ], { x: 0, y: 28, w: 12, h: 8 }, { description: "Node-exporter reports the shared host. These resource metrics are not attributed to this domain.", fieldConfig: { defaults: { unit: "percent", min: 0, max: 100 }, overrides: [] }, options: { legend: { displayMode: "list", placement: "bottom" }, tooltip: { mode: "multi", sort: "desc" } } }),
    panel(11, "Layer coverage and attribution", "text", [], { x: 12, y: 28, w: 12, h: 9 }, { description: "This map distinguishes collected signals from uninstrumented layers; shared host metrics are not presented as per-domain measurements.", options: { mode: "markdown", content: `| Layer | Coverage | Signals |\n| --- | --- | --- |\n${config.coverage.map(([layer, status, detail]) => `| ${layer} | **${status}** | ${detail} |`).join("\n")}` } }),
    config.services.length
      ? panel(12, "Host service state", "table", [
        target(`max by (name) (node_systemd_unit_state{name=~"(${config.services.map((service) => service.replaceAll(".", "[.]" )).join("|")})",state="active"})`, "A", "{{name}}", true),
        ...(sharedNginxConfig ? [target("site_dependency_nginx_config_valid{scope=\"shared_host\"}", "B", "Nginx config test", true)] : []),
      ], { x: 0, y: 37, w: 12, h: 9 }, { description: "Shared host systemd active state and a full host-wide nginx -t result. The configuration check covers all loaded vhosts and is not a per-domain test.", fieldConfig: statusField(), options: { showHeader: true, cellHeight: "md", sortBy: [] } })
      : explicitGapPanel(12, "Host service state", 0, 37, "No domain-specific systemd service is configured for this domain; check the container layer where configured."),
    config.dependencies
      ? panel(13, "Domain dependencies", "table", [target(`site_dependency_status{${selector}}`, "A", "{{dependency}} · {{check}}", true)], { x: 12, y: 37, w: 12, h: 9 }, { description: "Read-only authenticated dependency probes for this domain.", fieldConfig: statusField(), options: { showHeader: true, cellHeight: "md", sortBy: [] } })
      : explicitGapPanel(13, "Domain dependencies", 12, 37, "No authenticated domain-specific database or cache dependency probe is configured. This is an instrumentation gap, not a healthy result."),
    appSelector
      ? panel(17, "Application/API response time", "timeseries", [target(`probe_duration_seconds{${selector},job=~"${appJobs}"}`, "A", "{{check}}")], { x: 12, y: 20, w: 12, h: 8 }, { description: "Response duration for configured domain application/API probes.", fieldConfig: { defaults: { unit: "s" }, overrides: [] }, options: { legend: { displayMode: "list", placement: "bottom" }, tooltip: { mode: "multi", sort: "desc" } } })
      : panel(17, "Application/API response time", "text", [], { x: 12, y: 20, w: 12, h: 8 }, { description: "No domain-specific application/API latency probe is configured.", options: { mode: "markdown", content: "No domain-specific application/API latency probe is configured. Review the layer coverage map; no latency data is available." } }),
  ]

  panels.push(config.services.length
    ? panel(20, "Host service health history · shared host", "state-timeline", [
      target(`max by (name) (node_systemd_unit_state{name=~"(${config.services.map((service) => service.replaceAll(".", "[.]" )).join("|")})",state="active"})`, "A", "{{name}}", false),
      ...(sharedNginxConfig ? [target("site_dependency_nginx_config_valid{scope=\"shared_host\"}", "B", "Nginx config test", false)] : []),
    ], { x: 0, y: 46, w: 12, h: 9 }, { description: "Systemd state for configured services and full host-wide Nginx configuration validation over time. These are shared-host signals, not domain-isolated processes.", fieldConfig: statusField(), options: { mergeValues: true, showValue: "auto", alignValue: "center", rowHeight: 0.9, tooltip: { mode: "single", sort: "none" } } })
    : explicitGapPanel(20, "Host service health history · shared host", 0, 46, "No domain-specific systemd service history is configured. This is an instrumentation gap, not a healthy result."))
  panels.push(config.dependencies
    ? panel(21, "Dependency health history", "state-timeline", [target(`site_dependency_status{${selector}}`, "A", "{{dependency}} · {{check}}")], { x: 12, y: 46, w: 12, h: 9 }, { description: "Authenticated database/cache and container dependency check results over time. Only the fixed dependency and check labels are shown.", fieldConfig: statusField(), options: { mergeValues: true, showValue: "auto", alignValue: "center", rowHeight: 0.9, tooltip: { mode: "single", sort: "none" } } })
    : explicitGapPanel(21, "Dependency health history", 12, 46, "No authenticated domain-specific database or cache dependency history is configured. This is an instrumentation gap, not a healthy result."))

  panels.push(panel(23, "Independent public availability", "stat", [
    target(`eagles_external_public_site_state{domain="${domain}",provider="globalping"}`, "A", "Public site state", true),
    target(`time() - eagles_external_public_site_last_check_timestamp_seconds{domain="${domain}",provider="globalping"}`, "B", "Check age seconds", true),
  ], { x: 0, y: 90, w: 8, h: 6 }, { description: "Independent checks run every five minutes from Globalping probes in Vietnam, the United States, and the United Kingdom. A pass requires at least two HTTP 2xx/3xx responses; incomplete checks are UNVERIFIED.", fieldConfig: { defaults: { mappings: [{ type: "value", options: { "-1": { text: "UNVERIFIED", color: "gray" }, "0": { text: "DOWN", color: "red" }, "1": { text: "UP", color: "green" } } }], thresholds: { mode: "absolute", steps: [{ color: "red", value: null }, { color: "green", value: 1 }] } }, overrides: [] }, options: statOptions() }))
  panels.push(panel(24, "Independent public region history", "state-timeline", [
    target(`eagles_external_public_probe_state{domain="${domain}",provider="globalping"}`, "A", "{{country}}"),
  ], { x: 8, y: 90, w: 16, h: 8 }, { description: "Per-region public HTTP result. Completed failures and pending/inconclusive locations remain distinct; check age above distinguishes stale collection.", fieldConfig: { defaults: { mappings: [{ type: "value", options: { "-1": { text: "WAITING", color: "gray" }, "0": { text: "DOWN", color: "red" }, "1": { text: "UP", color: "green" } } }] }, overrides: [] }, options: { mergeValues: true, showValue: "auto", alignValue: "center", rowHeight: 0.9, tooltip: { mode: "single", sort: "none" } } }))

  if (config.containers) {
    panels.push(panel(14, "ERPNext component health", "table", [
      target(`erpnext_container_running{${selector}}`, "A", "{{component}} running", true),
      target(`erpnext_container_health{${selector}}`, "B", "{{component}} health", true),
    ], { x: 12, y: 55, w: 12, h: 9 }, { description: "Eight expected containers. HEALTHY and UNHEALTHY reflect Docker healthchecks; NO HEALTHCHECK means Docker does not define a healthcheck for that component.", fieldConfig: { defaults: { mappings: [{ type: "value", options: { "-1": { text: "NO HEALTHCHECK", color: "gray" }, "0": { text: "UNHEALTHY", color: "red" }, "1": { text: "HEALTHY", color: "green" } } }] }, overrides: [] }, options: { showHeader: true, cellHeight: "md", sortBy: [] } }))
    panels.push(panel(22, "Container running history", "state-timeline", [target(`erpnext_container_running{${selector}}`, "A", "{{component}}")], { x: 0, y: 55, w: 12, h: 9 }, { description: "Running state for each ERPNext and Redis component over time. Docker healthcheck state is shown separately in the component table.", fieldConfig: statusField(), options: { mergeValues: true, showValue: "auto", alignValue: "center", rowHeight: 0.9, tooltip: { mode: "single", sort: "none" } } }))
  }

  const alertsY = config.containers ? 64 : 55
  const adminAckAlert = config.slug === "sis-admin"
    ? [target("count(ALERTS{alertname=\"DevParentReportAcknowledgmentServerFailure\",environment=\"dev\",alertstate=~\"pending|firing\"}) or vector(0)", "B", "SIS parent acknowledgment 5xx")]
    : []
  panels.push(panel(15, "Domain alert timeline", "state-timeline", [
    target(`sum by (alertname, severity) (ALERTS{alertname=~"${config.alerts}",alertstate=~"pending|firing",domain="${domain}"}) or vector(0)`, "A", "{{alertname}} / {{severity}}"),
    ...(sharedNginxConfig ? [target("sum by (alertname, severity) (ALERTS{alertname=\"NginxConfigurationInvalid\",scope=\"shared_host\",alertstate=~\"pending|firing\"}) or vector(0)", "C", "{{alertname}} / {{severity}} · shared host")] : []),
    ...adminAckAlert,
    ], { x: 0, y: alertsY, w: 24, h: 8 }, { description: config.slug === "sis-admin"
    ? "Domain-labeled alerts and the environment-wide dev parent report acknowledgment server-failure alert are shown."
    : "Only pending and firing alerts with this domain label are shown. Shared, unlabelled service/workflow alerts are called out in layer descriptions.", options: { mergeValues: true, showValue: "auto", alignValue: "center", rowHeight: 0.9, tooltip: { mode: "single", sort: "none" } } }))

  if (config.slug === "sis-admin") {
    panels.push(panel(16, "SIS dev workflow state and freshness · environment-wide", "timeseries", [
      target("sis_keepalive_check_failure_info{environment=\"dev\"}", "A", "{{group}} · {{code}}"),
      target("time() - sis_keepalive_check_last_check_timestamp_seconds{environment=\"dev\"}", "B", "{{group}} freshness seconds"),
    ], { x: 0, y: 72, w: 24, h: 8 }, { description: "These dev checks have environment labels, not domain labels. Failure series are binary, and freshness is graphed as seconds since the last check.", fieldConfig: { defaults: { unit: "s" }, overrides: [] }, options: { legend: { displayMode: "list", placement: "bottom" }, tooltip: { mode: "multi", sort: "desc" } } }))
    panels.push(panel(18, "Parent report acknowledgment results · dev", "timeseries", [
      target("sum by(status) (increase(sis_parent_report_acknowledgment_requests_total{environment=\"dev\",route=\"POST /api/parent/reports/:reportId/acknowledge\"}[1h])) or vector(0)", "A", "HTTP {{status}}"),
      target("count(ALERTS{alertname=\"DevParentReportAcknowledgmentServerFailure\",environment=\"dev\",alertstate=~\"pending|firing\"}) or vector(0)", "B", "5xx alert"),
    ], { x: 0, y: 80, w: 24, h: 8 }, { description: "Environment-wide dev acknowledgment result counts and the corresponding 5xx alert; these are not attributed to one individual report.", options: { legend: { displayMode: "list", placement: "bottom" }, tooltip: { mode: "multi", sort: "desc" } } }))
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
