import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const dashboardsRoot = path.join(repositoryRoot, "ops/monitoring/grafana/dashboards")
const environments = [
  {
    environment: "live",
    uid: "sis-live-admin-overview",
    title: "SIS Live/Admin Mirror · Operations",
    domain: "admin.eagles.edu.vn",
    probe: 'probe_success{job="blackbox-website-http",site="admin"}',
    service: 'node_systemd_unit_state{name="exercise-mailer.service",state="active"}',
    process: "sis_live_.*",
    notice: "Live: 10 read-only SIS/dependency probes plus 10 vendor/configuration checks. Dependencies run every 60s; vendor checks every 15m. Customer workflow writes stay held.",
  },
  {
    environment: "test",
    uid: "sis-test-mirror-overview",
    title: "SIS Test Mirror · Operations",
    domain: "test.eagles.edu.vn",
    probe: 'probe_success{job="blackbox-test-mirror"}',
    service: 'node_systemd_unit_state{name="exercise-mailer-test.service",state="active"}',
    process: "sis_test_.*",
    notice: "Test: 10 authenticated workflows plus 10 vendor/configuration checks. Core groups run every 60s, parent profile every 15m, five workflows every 5m, and the no-send suite nightly at 04:00 ICT.",
  },
]

function target(expr, refId = "A", legendFormat = undefined, format = undefined, instant = false) {
  return {
    expr,
    refId,
    ...(legendFormat ? { legendFormat } : {}),
    ...(format ? { format } : {}),
    ...(instant ? { instant: true } : {}),
  }
}

function panel(id, title, type, x, y, w, h, targets = [], unit = "short", extra = {}) {
  return {
    id,
    type,
    title,
    gridPos: { h, w, x, y },
    targets,
    fieldConfig: {
      defaults: {
        unit,
        mappings: [
          { type: "value", options: { "0": { text: "DOWN", color: "red" }, "1": { text: "UP", color: "green" } } },
        ],
      },
      overrides: [],
    },
    ...extra,
  }
}

function textPanel(id, title, content, x, y, w, h) {
  return {
    id,
    type: "text",
    title,
    gridPos: { h, w, x, y },
    options: { mode: "markdown", content },
  }
}

const nightlyWorkflowGroups = [
  { name: "Engagement", group: "engagement" },
  { name: "Assignment notifications", group: "assignment_notifications" },
  { name: "Parent reports", group: "parent_reports" },
  { name: "Student profile and enrollment", cardName: "Profile + enrollment", group: "student_profile_enrollment" },
  { name: "Parent profile", group: "parent_profile" },
  { name: "Student Library", group: "student_library" },
  { name: "Dictionary Builder", group: "dictionary_builder" },
  { name: "Student News", group: "student_news" },
  { name: "Grade feeds", group: "grade_feeds" },
  { name: "Attendance", group: "attendance" },
]

const liveProbeChecks = (config) => {
  const dependency = (name, check) =>
    `site_dependency_status{environment="live",domain="${config.domain}",dependency="${name}",check="${check}"}`
  return [
    { name: "Public admin page", expr: 'probe_success{job="blackbox-website-http",site="admin"}' },
    { name: "SIS API route", expr: 'probe_success{job="blackbox-website-api",site="admin",check="sis-api"}' },
    { name: "Admin auth guard", expr: 'probe_success{job="blackbox-admin-auth-api",site="admin"}' },
    { name: "SIS API service", expr: 'node_systemd_unit_state{name="exercise-mailer.service",state="active"}' },
    { name: "PostgreSQL container", expr: dependency("sis-postgres", "container-running") },
    { name: "PostgreSQL authenticated query", expr: dependency("sis-postgres", "authenticated-select-1") },
    { name: "Redis app role", expr: dependency("sis-app", "authenticated-ping") },
    { name: "Redis sessions role", expr: dependency("sis-sessions", "authenticated-ping") },
    { name: "Redis cache role", expr: dependency("sis-cache", "authenticated-ping") },
    { name: "Grade feed read-only query", expr: 'sis_grade_feed_readonly_data_available{environment="live"}' },
  ]
}

function externalServiceChecks(environment) {
  return [
    { name: "CMU pronunciation dictionary", service: "cmu_pronunciation_dictionary", serviceEnvironment: environment },
    { name: "Merriam-Webster Collegiate", cardName: "MW Collegiate", service: "merriam_webster_collegiate", serviceEnvironment: environment },
    { name: "Merriam-Webster Learner's", cardName: "MW Learner's", service: "merriam_webster_learners", serviceEnvironment: environment },
    { name: "LanguageTool 1", service: "languagetool_1", serviceEnvironment: "shared" },
    { name: "LanguageTool 2", service: "languagetool_2", serviceEnvironment: "shared" },
    {
      name: "Email transport",
      service: environment === "live" ? "smtp_email_relay" : "brevo_api",
      serviceEnvironment: environment,
    },
    { name: "Google Forms grade endpoint key", service: "google_forms_grade_secret", serviceEnvironment: environment, configOnly: true },
    { name: "Moodle health endpoint", service: "moodle_endpoint", serviceEnvironment: environment },
    { name: "MEGS health endpoint", service: "megs_endpoint", serviceEnvironment: environment },
    { name: "Vendor monitor", serviceEnvironment: environment, aggregate: true },
  ]
}

function resultMappings({ indicator = false } = {}) {
  return [
    {
      type: "value",
      options: indicator
        ? {
            "-1": { text: "■", color: "orange" },
            "0": { text: "■", color: "red" },
            "1": { text: "■", color: "green" },
          }
        : {
            "-1": { text: "NO DATA / STALE / NOT CONFIGURED", color: "orange" },
            "0": { text: "LAST RUN FAILED", color: "red" },
            "1": { text: "LAST RUN PASSED", color: "green" },
          },
    },
  ]
}

function currentStatusExpression(check) {
  if (check.kind === "workflow") {
    const success = `sis_keepalive_check_success{environment="test",group="${check.group}"}`
    const checked = `sis_keepalive_check_last_check_timestamp_seconds{environment="test",group="${check.group}"}`
    const staleAfter = `sis_keepalive_check_stale_after_seconds{environment="test",group="${check.group}"}`
    return `(max by () (${success}) and on () (time() - max by () (${checked}) <= max by () (${staleAfter}))) or on () vector(-1)`
  }

  if (check.kind === "vendor") {
    const labels = check.aggregate
      ? `environment="${check.serviceEnvironment}"`
      : `environment="${check.serviceEnvironment}",service="${check.service}"`
    const value = check.aggregate
      ? `max by () (sis_external_service_monitor_success{${labels}})`
      : check.configOnly
        ? `max by () (sis_external_service_configured{${labels}})`
        : `(max by () (sis_external_service_available{${labels}}) or (max by () (sis_external_service_configured{${labels}}) - 1))`
    const checked = `max by () (sis_external_service_last_check_timestamp_seconds{${labels}})`
    return `(${value} and on () (time() - ${checked} <= 1800)) or on () vector(-1)`
  }

  const latest = `max by () (last_over_time((${check.expr})[5m:15s]))`
  const fresh = `max by () (present_over_time((${check.expr})[5m:15s]))`
  return `(${latest} and on () ${fresh}) or on () vector(-1)`
}

function dailyStatusExpression(check) {
  if (check.kind === "workflow") {
    const success = `sis_keepalive_check_success{environment="test",group="${check.group}"}`
    const checked = `sis_keepalive_check_last_check_timestamp_seconds{environment="test",group="${check.group}"}`
    const staleAfter = `sis_keepalive_check_stale_after_seconds{environment="test",group="${check.group}"}`
    const latest = `max by () (last_over_time((${success})[1d:1m]))`
    const latestChecked = `max by () (last_over_time((${checked})[1d:1m]))`
    const latestStaleAfter = `max by () (last_over_time((${staleAfter})[1d:1m]))`
    return `(${latest} and on () (time() - ${latestChecked} <= ${latestStaleAfter})) or on () vector(-1)`
  }

  if (check.kind === "vendor") {
    const labels = check.aggregate
      ? `environment="${check.serviceEnvironment}"`
      : `environment="${check.serviceEnvironment}",service="${check.service}"`
    const value = check.aggregate
      ? `max by () (last_over_time((sis_external_service_monitor_success{${labels}})[1d:1m]))`
      : check.configOnly
        ? `max by () (last_over_time((sis_external_service_configured{${labels}})[1d:1m]))`
        : `(max by () (last_over_time((sis_external_service_available{${labels}})[1d:1m])) or (max by () (last_over_time((sis_external_service_configured{${labels}})[1d:1m])) - 1))`
    const checked = `max by () (last_over_time((sis_external_service_last_check_timestamp_seconds{${labels}})[1d:1m]))`
    return `(${value} and on () (time() - ${checked} <= 1800)) or on () vector(-1)`
  }

  const latest = `max by () (last_over_time((${check.expr})[1d:1m]))`
  const present = `max by () (present_over_time((${check.expr})[1d:1m]))`
  return `(${latest} and on () ${present}) or on () vector(-1)`
}

function messageTarget(check) {
  if (check.kind === "workflow") {
    const passing = `sis_keepalive_check_failure_info{environment="test",group="${check.group}",code="none"} == 1`
    const failing = `sis_keepalive_check_failure_info{environment="test",group="${check.group}",code!="none"} == 1`
    const expression = `label_replace(max by (code) (${passing}), "run_message", "LAST RUN PASSED", "code", ".*") or label_replace(max by (code) (${failing}), "run_message", "LAST RUN FAILED · $1", "code", "(.+)")`
    return target(expression, "A", "{{run_message}}", undefined, true)
  }
  return target(currentStatusExpression(check), "A", "Last run message", undefined, true)
}

function reportPanel(id, title, type, x, y, w, h, targetSpec, fieldConfig, options, extra = {}) {
  return {
    id,
    type,
    title,
    gridPos: { h, w, x, y },
    targets: Array.isArray(targetSpec) ? targetSpec : [targetSpec],
    datasource: { type: "prometheus", uid: "sis-prometheus" },
    fieldConfig,
    options,
    ...extra,
  }
}

function buildSubsystemReport(config) {
  const checks = config.environment === "live"
    ? liveProbeChecks(config).map((check) => ({ ...check, kind: "probe" }))
    : nightlyWorkflowGroups.map((check) => ({ ...check, kind: "workflow" }))
  checks.push(...externalServiceChecks(config.environment).map((check) => ({ ...check, kind: "vendor" })))

  const panels = [
    textPanel(
      1,
      "How to read this report",
      `Green = passed; red = failed; amber = stale, missing, or not configured. Bars show each day's latest result, with today on the right. Prometheus retains 28 days; older history was not kept and will fill over time.\n\n${config.notice}`,
      0,
      0,
      24,
      4,
    ),
  ]

  for (const [index, check] of checks.entries()) {
    const cardX = index % 2 === 0 ? 0 : 12
    const cardY = 4 + Math.floor(index / 2) * 10
    const firstId = index * 3 + 2
    const current = currentStatusExpression(check)
    const history = `(${dailyStatusExpression(check)}) + 2`
    const statusMap = resultMappings()
    const indicatorMap = resultMappings({ indicator: true })

    panels.push(reportPanel(
      firstId,
      check.cardName ?? check.name,
      "stat",
      cardX,
      cardY,
      6,
      3,
      messageTarget(check),
      {
        defaults: {
          unit: "short",
          color: { mode: "fixed", fixedColor: "text" },
          mappings: statusMap,
          noValue: "No recent run message",
        },
        overrides: [],
      },
      {
        reduceOptions: { calcs: ["lastNotNull"], fields: "", values: false },
        orientation: "horizontal",
        textMode: check.kind === "workflow" ? "name" : "value",
        colorMode: "none",
        graphMode: "none",
        justifyMode: "center",
        wideLayout: true,
        text: { titleSize: 12, valueSize: 16 },
      },
      { description: check.configOnly
        ? "Shows whether the SIS-side Google Forms grade endpoint key is configured. This does not verify the external Apps Script trigger, its Script Properties, or a submitted grade."
        : "Shows the latest bounded monitor outcome. Workflow messages use the monitor's bounded failure category; vendor and live probe messages show the current semantic result." },
    ))

    panels.push(reportPanel(
      firstId + 1,
      "STATUS",
      "stat",
      cardX + 6,
      cardY,
      6,
      3,
      target(current, "A", undefined, undefined, true),
      {
        defaults: {
          unit: "short",
          color: { mode: "thresholds" },
          mappings: indicatorMap,
          noValue: "■",
        },
        overrides: [],
      },
      {
        reduceOptions: { calcs: ["lastNotNull"], fields: "", values: false },
        orientation: "horizontal",
        textMode: "value",
        colorMode: "value",
        graphMode: "none",
        justifyMode: "center",
        wideLayout: true,
        text: { titleSize: 12, valueSize: 44 },
      },
      { description: "Green is a fresh pass, red is a fresh failure, and amber means stale, missing, or unconfigured." },
    ))

    panels.push(reportPanel(
      firstId + 2,
      `${check.name} · daily result trend`,
      "timeseries",
      cardX,
      cardY + 3,
      12,
      6,
      [
        target(`(${history}) == bool 1`, "A", "NO DATA"),
        target(`(${history}) == bool 2`, "B", "FAIL"),
        target(`(${history}) == bool 3`, "C", "PASS"),
      ].map((query) => ({ ...query, interval: "1d" })),
      {
        defaults: {
          unit: "short",
          min: 0,
          max: 1,
          color: { mode: "fixed", fixedColor: "green" },
          custom: {
            drawStyle: "bars",
            lineInterpolation: "stepAfter",
            barAlignment: 0,
            barWidthFactor: 0.8,
            lineWidth: 0,
            fillOpacity: 100,
            gradientMode: "none",
            showPoints: "never",
            spanNulls: false,
            stacking: { mode: "none", group: "A" },
            axisPlacement: "left",
            axisLabel: "Observed",
            axisColorMode: "text",
            axisCenteredZero: false,
            scaleDistribution: { type: "linear" },
            thresholdsStyle: { mode: "off" },
            hideFrom: { tooltip: false, viz: false, legend: false },
          },
          mappings: [],
          noValue: "No daily result",
        },
        overrides: [
          { matcher: { id: "byName", options: "NO DATA" }, properties: [{ id: "color", value: { mode: "fixed", fixedColor: "orange" } }] },
          { matcher: { id: "byName", options: "FAIL" }, properties: [{ id: "color", value: { mode: "fixed", fixedColor: "red" } }] },
          { matcher: { id: "byName", options: "PASS" }, properties: [{ id: "color", value: { mode: "fixed", fixedColor: "green" } }] },
        ],
      },
      {
        tooltip: { mode: "single", sort: "none" },
        legend: { showLegend: false },
      },
      { description: "One daily last-result sample over the selected rolling 28-day window; the rightmost bar is today. Amber covers stale, missing, and unconfigured outcomes." },
    ))
  }

  const slug = config.environment === "live" ? "live-nightly-subsystem-report" : "test-nightly-subsystem-report"
  return {
    uid: config.environment === "live" ? "sis-live-nightly-report" : "sis-test-nightly-report",
    title: config.environment === "live" ? "SIS Live · Nightly Subsystem Report" : "SIS Test · Nightly Subsystem Report",
    description: "Twenty environment-specific checks with bounded latest-run messages, semantic status indicators, and daily result history. The bar chart covers a rolling 28-day window.",
    tags: ["sis", "nightly", "subsystems", `${config.environment}-mirror`],
    timezone: "browser",
    schemaVersion: 39,
    version: 1,
    refresh: "1m",
    time: { from: "now-28d", to: "now" },
    links: [{
      title: "Operations overview",
      type: "link",
      icon: "dashboard",
      url: config.environment === "live"
        ? "/d/sis-live-admin-overview/sis-live-admin-mirror-c2b7-operations"
        : "/d/sis-test-mirror-overview/sis-test-mirror-c2b7-operations",
      keepTime: true,
      targetBlank: false,
    }],
    panels,
  }
}

function buildDashboard(config) {
  const env = config.environment
  const emailService = env === "live" ? "smtp_email_relay" : "brevo_api"
  const emailServiceName = env === "live" ? "SMTP email relay" : "Brevo API"
  const siteDependency = (dependency, check) =>
    `site_dependency_status{environment="${env}",domain="${config.domain}",dependency="${dependency}",check="${check}"}`
  const monitorSuccess = `site_dependency_environment_monitor_success{environment="${env}"}`
  const smoke = `sis_keepalive_check_success{environment="${env}"}`
  const smokeMetric = "sis_keepalive_check_success"
  const checkTimestamp = `sis_keepalive_check_last_check_timestamp_seconds{environment="${env}"}`
  const staleAfter = `sis_keepalive_check_stale_after_seconds{environment="${env}"}`
  const checkDuration = `sis_keepalive_check_duration_seconds{environment="${env}"}`
  const writeEnv = env === "live" ? "production" : "test"
  const dictionaryBuilderMetricPrefix = env === "live" ? "sis_live_dictionary_builder" : "sis_library_dictionary_builder"
  const liveReadOnlyTargets = [
    target('probe_success{job="blackbox-website-http",site="admin"}', "A", "Public admin page", "table", true),
    target('probe_success{job="blackbox-website-api",site="admin",check="sis-api"}', "B", "SIS API route", "table", true),
    target('probe_success{job="blackbox-admin-auth-api",site="admin"}', "C", "Auth guard", "table", true),
    target('node_systemd_unit_state{name="exercise-mailer.service",state="active"}', "D", "SIS API service", "table", true),
    target(siteDependency("sis-postgres", "container-running"), "E", "PostgreSQL container", "table", true),
    target(siteDependency("sis-postgres", "authenticated-select-1"), "F", "PostgreSQL SELECT 1", "table", true),
    target(siteDependency("sis-app", "authenticated-ping"), "G", "Redis app role", "table", true),
    target(siteDependency("sis-sessions", "authenticated-ping"), "H", "Redis sessions role", "table", true),
    target(siteDependency("sis-cache", "authenticated-ping"), "I", "Redis cache role", "table", true),
    target(`sis_grade_feed_readonly_data_available{environment="${env}"}`, "J", "Grade/feed read-only query", "table", true),
  ]
  const testSmokeTargets = [
    "engagement",
    "assignment_notifications",
    "parent_reports",
    "student_profile_enrollment",
    "parent_profile",
    "student_library",
    "dictionary_builder",
    "student_news",
    "grade_feeds",
    "attendance",
  ].map((group, index) => target(`${smokeMetric}{environment="${env}",group="${group}"}`, String.fromCharCode(65 + index), group, "table", true))
  const vendorServices = [
    { name: "CMU pronunciation dictionary", service: "cmu_pronunciation_dictionary", serviceEnvironment: env },
    { name: "Merriam-Webster Collegiate", service: "merriam_webster_collegiate", serviceEnvironment: env },
    { name: "Merriam-Webster Learner's", service: "merriam_webster_learners", serviceEnvironment: env },
    { name: "LanguageTool 1", service: "languagetool_1", serviceEnvironment: "shared" },
    { name: "LanguageTool 2", service: "languagetool_2", serviceEnvironment: "shared" },
    { name: emailServiceName, service: emailService, serviceEnvironment: env },
    { name: "Google Forms grade endpoint key", service: "google_forms_grade_secret", serviceEnvironment: env, configOnly: true },
    { name: "Moodle health endpoint", service: "moodle_endpoint", serviceEnvironment: env },
    { name: "MEGS health endpoint", service: "megs_endpoint", serviceEnvironment: env },
  ].map(({ name, service, serviceEnvironment, configOnly }, index) => {
    const labels = `environment="${serviceEnvironment}",service="${service}"`
    const configured = `sis_external_service_configured{${labels}}`
    const available = `sis_external_service_available{${labels}}`
    return target(configOnly ? configured : `(${available} or (${configured} - 1))`, String.fromCharCode(75 + index), name, "table", true)
  })
  vendorServices.push(target(`sis_external_service_monitor_success{environment="${env}"}`, "T", "Vendor monitor", "table", true))
  const subsystemTableTarget = (targets) => target(
    targets.map(({ expr, legendFormat }) =>
      `label_replace(max by () (${expr}), "subsystem", "${legendFormat}", "__name__", ".*")`
    ).join(" or "),
    "A",
    "{{subsystem}}",
    "table",
    true,
  )
  const outcomeTargets = env === "live" ? [...liveReadOnlyTargets, ...vendorServices] : [...testSmokeTargets, ...vendorServices]
  const outcomeExpression = subsystemTableTarget(outcomeTargets).expr
  const panels = [
    panel(1, "Public SIS page", "stat", 0, 0, 4, 4, [target(config.probe, "A", undefined, undefined, true)], "short"),
    panel(2, "SIS API service", "stat", 4, 0, 4, 4, [target(config.service, "A", undefined, undefined, true)], "short"),
    panel(3, "PostgreSQL authenticated probe", "stat", 8, 0, 4, 4, [target(siteDependency("sis-postgres", "authenticated-select-1"), "A", undefined, undefined, true)], "short"),
    panel(4, "Redis session probe", "stat", 12, 0, 4, 4, [target(siteDependency("sis-sessions", "authenticated-ping"), "A", undefined, undefined, true)], "short"),
    panel(5, "Dependency monitor", "stat", 16, 0, 4, 4, [target(monitorSuccess, "A", undefined, undefined, true)], "short"),
    panel(6, "Subsystem checks reported", "stat", 20, 0, 4, 4, [target(`count(${outcomeExpression}) or vector(0)`, "A", undefined, undefined, true)], "short", {
      fieldConfig: { defaults: { mappings: [{ type: "value", options: { "0": { text: "0", color: "gray" }, "20": { text: "20", color: "green" } } }] }, overrides: [] },
    }),
    textPanel(7, "Monitoring schedule", config.notice, 0, 4, 24, 3),
    panel(8, "20 subsystem checks · current results", "table", 0, 7, 12, 24, [subsystemTableTarget(outcomeTargets)], "short", {
      fieldConfig: { defaults: { mappings: [{ type: "value", options: { "-1": { text: "NOT CONFIGURED", color: "gray" }, "0": { text: "FAIL", color: "red" }, "1": { text: "PASS", color: "green" } } }] }, overrides: [] },
      options: { showHeader: true, sortBy: [{ displayName: "Result", desc: true }] },
      transformations: [{
        id: "organize",
        options: {
          excludeByName: { Time: true },
          indexByName: { subsystem: 0, Value: 1 },
          renameByName: { Value: "Result" },
        },
      }],
    }),
    panel(9, "Check freshness and stale threshold", "timeseries", 12, 7, 12, 9, env === "live" ? [
      target(`time() - site_dependency_environment_monitor_last_check_timestamp_seconds{environment="${env}"}`, "A", "dependency monitor age"),
      target(`time() - sis_external_service_last_check_timestamp_seconds{environment="${env}"}`, "B", "vendor check age"),
    ] : [
      target(`time() - ${checkTimestamp}`, "A", "age {{group}}"),
      target(staleAfter, "B", "stale after {{group}}"),
    ], "s"),
    panel(10, "Historical subsystem result cadence", "state-timeline", 12, 16, 12, 8, outcomeTargets.map(({ expr, legendFormat }, index) => target(`last_over_time((${expr})[30m:30s])`, String.fromCharCode(65 + index), legendFormat))),
    panel(11, "Historical subsystem check duration", "timeseries", 0, 31, 12, 8, env === "live" ? [
      target(`site_dependency_probe_duration_seconds{environment="${env}",dependency=~"sis-(postgres|app|sessions|cache)"}`, "A", "{{dependency}} / {{check}}"),
      target('probe_duration_seconds{job=~"blackbox-website-http|blackbox-website-api|blackbox-admin-auth-api",site="admin"}', "B", "{{check}}"),
      target(`sis_external_service_check_duration_seconds{environment="${env}"}`, "C", "{{service}}"),
    ] : [
      target(checkDuration, "A", "{{group}}"),
      target(`site_dependency_probe_duration_seconds{environment="${env}",dependency=~"sis-(postgres|app|sessions|cache)"}`, "B", "{{dependency}} / {{check}}"),
      target(`sis_external_service_check_duration_seconds{environment="${env}"}`, "C", "{{service}}"),
    ], "s"),
    panel(12, "Student-save requests in the last 5 minutes", "stat", 12, 31, 12, 8, [
      target(`sum(increase(sis_admin_student_write_requests_total{environment="${writeEnv}"}[5m])) or vector(0)`),
    ], "short", { fieldConfig: { defaults: { mappings: [{ type: "value", options: { "0": { text: "0 writes", color: "gray" } } }] }, overrides: [] } }),
    panel(13, "Student-save mean latency by stage", "timeseries", 0, 39, 12, 8, [
      target(`sum by (phase) (increase(sis_admin_student_write_phase_duration_seconds_sum{environment="${writeEnv}"}[$__range])) / sum by (phase) (increase(sis_admin_student_write_phase_duration_seconds_count{environment="${writeEnv}"}[$__range]))`, "A", "mean {{phase}}"),
    ], "s", {
      description: "Mean phase latency uses real authenticated student-write samples over the selected range. No samples means no measured latency; zero is never substituted.",
      fieldConfig: { defaults: { noValue: "No real student-write samples in the selected range" }, overrides: [] },
    }),
    panel(14, "PostgreSQL vs Redis probe p95 · sampled", "timeseries", 12, 39, 12, 8, [
      target(`quantile_over_time(0.95, site_dependency_probe_duration_seconds{environment="${env}",dependency="sis-postgres"}[1h])`, "A", "PostgreSQL SELECT 1"),
      target(`quantile_over_time(0.95, site_dependency_probe_duration_seconds{environment="${env}",dependency=~"sis-(app|sessions|cache)"}[1h])`, "B", "Redis {{dependency}}"),
    ], "s", { description: "These are sampled dependency probe durations. PostgreSQL includes Docker/psql startup and is not pure server query latency; use PostgreSQL and Redis resource panels to corroborate bottleneck hypotheses." }),
    panel(15, "SIS API and worker memory", "timeseries", 0, 47, 12, 8, [
      target(`namedprocess_namegroup_memory_bytes{job="process-diagnostics",groupname=~"${config.process}",memtype="resident"}`, "A", "{{groupname}} RSS"),
    ], "bytes"),
    panel(16, "Redis diagnostics by role", "timeseries", 12, 47, 12, 8, [
      target(`site_dependency_status{environment="${env}",domain="${config.domain}",dependency=~"sis-(app|sessions|cache)",check="authenticated-ping"}`, "A", "{{dependency}} ping"),
      target(`site_dependency_status{environment="${env}",domain="${config.domain}",dependency=~"sis-(app|sessions|cache)",check="container-running"}`, "B", "{{dependency}} container"),
    ]),
    panel(17, "Pronunciation and definition providers", "timeseries", 0, 55, 12, 8, [
      target(`sis_external_service_available{environment="${env}",service=~"cmu_pronunciation_dictionary|merriam_webster_.*"}`, "A", "{{service}} health"),
      target(`sis_external_service_configured{environment="${env}",service=~"cmu_pronunciation_dictionary|merriam_webster_.*"}`, "B", "{{service}} configured"),
      target(`sis_external_service_http_status{environment="${env}",service=~"merriam_webster_.*"}`, "C", "{{service}} HTTP status"),
      target(`${dictionaryBuilderMetricPrefix}_provider_checked{environment="${env}"}`, "D", "{{provider}} checked"),
      target(`${dictionaryBuilderMetricPrefix}_provider_available{environment="${env}"}`, "E", "{{provider}} available"),
      target(`${dictionaryBuilderMetricPrefix}_definition_providers_available{environment="${env}"}`, "F", "definition results available"),
      target(`${dictionaryBuilderMetricPrefix}_definition_providers_checked{environment="${env}"}`, "G", "definition sources checked"),
    ], "short", { description: "Both environments emit fixed-ID Dictionary Builder provider checks from the same read-only preview contract. Live uses a fixed sample word and exports only checked/available status; the preview does not write Library or student records." }),
    panel(18, "News grammar and dictionary services", "timeseries", 12, 55, 12, 8, [
      ...(env === "live" ? [] : [
        target(`sis_news_language_tool_available{environment="${env}"}`, "A", "LanguageTool in News workflow"),
        target(`sis_news_dictionary_available{environment="${env}"}`, "B", "pronunciation dictionary in News workflow"),
        target(`sis_news_check_success{environment="${env}"}`, "C", "News Check workflow"),
        target(`sis_news_submission_success{environment="${env}"}`, "D", "News submit workflow"),
      ]),
      target('sis_external_service_available{environment="shared",service=~"languagetool_.*"}', "E", "{{service}}"),
      target('sis_external_service_http_status{environment="shared",service=~"languagetool_.*"}', "F", "{{service}} HTTP status"),
      target(`sis_external_service_available{environment="${env}",service="cmu_pronunciation_dictionary"}`, "G", "CMUdict health"),
      ...(env === "live" ? [
        target(`sis_external_service_configured{environment="${env}",service="cmu_pronunciation_dictionary"}`, "H", "CMUdict configured"),
        target("vector(-1)", "I", "News Check · not run live"),
        target("vector(-1)", "J", "News submit · not run live"),
        target('sis_external_service_check_duration_seconds{environment="shared",service=~"languagetool_.*"}', "K", "{{service}} check duration"),
      ] : []),
    ], "short", { description: env === "live" ? "Live LanguageTool and CMUdict feeds are read-only vendor checks. News Check and submit are not run on live; customer workflow writes remain held." : "News Check, submit, LanguageTool, and pronunciation-dictionary results come from the scheduled authenticated test workflow, with separate shared vendor-health samples." }),
    panel(19, "Grade connections · Google Forms → SIS and Moodle", "timeseries", 0, 63, 12, 8, [
      target(`sis_grade_feed_grade_rows{environment="${env}",source="moodle"}`, "A", "Moodle grades"),
      target(`sis_grade_feed_grade_rows{environment="${env}",source="google_forms"}`, "B", "Google Forms grades in SIS"),
      target(`sis_grade_feed_exercise_submission_rows{environment="${env}",source="moodle"}`, "C", "Moodle submissions"),
      target(`sis_grade_feed_readonly_data_available{environment="${env}"}`, "D", "Grade database read available"),
      target(`sis_external_service_configured{environment="${env}",service="google_forms_grade_secret"}`, "E", "Google Forms SIS endpoint key configured"),
      target(`sis_external_service_configured{environment="${env}",service="moodle_endpoint"}`, "F", "Moodle endpoint configured"),
      target(`sis_external_service_configured{environment="${env}",service="moodle_provisioning_secret"}`, "G", "Moodle provisioning secret configured"),
      target(`(time() - max by () (sis_grade_feed_grade_latest_updated_timestamp_seconds{environment="${env}",source="google_forms"} > 0)) or vector(-1)`, "H", "Age of latest Google Forms grade in SIS", "table", true),
      target(`(sum(increase(sis_grade_feed_write_requests_total{environment="${writeEnv}",route="POST /api/integrations/google-forms/grades",status=~"2.."}[24h])) or vector(-1))`, "I", "Signed Google Forms grade requests accepted · 24h", "table", true),
      target(`(sum(increase(sis_grade_feed_write_requests_total{environment="${writeEnv}",route="POST /api/integrations/google-forms/grades",status=~"[45].."}[24h])) or vector(-1))`, "J", "Signed Google Forms grade requests failed · 24h", "table", true),
    ], "short", { description: "Google Forms grades flow from the form to its response sheet, the Apps Script submit trigger, and the signed SIS grade endpoint. Grade counts and latest-update age are read from SIS aggregates; request counters include only requests that passed HMAC authentication. The endpoint-key card reports only SIS-side configuration. These signals do not prove the external trigger or matching Apps Script properties, and the monitor never submits a grade.", fieldConfig: { defaults: { noValue: "No stored Google Forms grade or signed-request sample" }, overrides: [
      { matcher: { id: "byName", options: "Age of latest Google Forms grade in SIS" }, properties: [{ id: "mappings", value: [{ type: "value", options: { "-1": { text: "NO GOOGLE FORMS GRADE YET", color: "gray" } } }] }] },
      { matcher: { id: "byName", options: "Signed Google Forms grade requests accepted · 24h" }, properties: [{ id: "mappings", value: [{ type: "value", options: { "-1": { text: "NO OBSERVED REQUESTS", color: "orange" } } }] }] },
      { matcher: { id: "byName", options: "Signed Google Forms grade requests failed · 24h" }, properties: [{ id: "mappings", value: [{ type: "value", options: { "-1": { text: "NO OBSERVED REQUESTS", color: "orange" } } }] }] },
    ] } }),
    panel(20, "Email transport and webhook processing", "timeseries", 12, 63, 12, 8, [
      target(`sis_engagement_webhook_unprocessed_events{environment="${env}"}`, "A", "unprocessed events"),
      target(`sis_engagement_webhook_last_received_timestamp_seconds{environment="${env}"}`, "B", "last webhook received"),
      target(`sis_engagement_webhook_readonly_data_available{environment="${env}"}`, "C", "Read-only DB query"),
      target(`sis_external_service_configured{environment="${env}",service="${emailService}"}`, "D", `${emailServiceName} configured`),
      target(`(sis_external_service_available{environment="${env}",service="${emailService}"} or (sis_external_service_configured{environment="${env}",service="${emailService}"} - 1))`, "E", `${emailServiceName} health / not configured`),
      target(`(sis_external_service_http_status{environment="${env}",service="${emailService}"} or (sis_external_service_configured{environment="${env}",service="${emailService}"} - 1))`, "F", `${emailServiceName} status / not configured`),
    ], "short", { fieldConfig: { defaults: { noValue: `${emailServiceName} endpoint is not configured` }, overrides: [
      { matcher: { id: "byName", options: `${emailServiceName} status / not configured` }, properties: [{ id: "mappings", value: [{ type: "value", options: { "-1": { text: "NOT CONFIGURED", color: "gray" }, "0": { text: "NO HTTP RESPONSE", color: "orange" } } }] }] },
    ] } }),
    panel(21, "Thuvien and ESL reading probes", "timeseries", 0, 71, 12, 8, [
      target('probe_success{job="blackbox-website-http",site="thuvien"}', "A", "Thuvien public page"),
      target('probe_success{job="blackbox-thuvien-media"}', "B", "{{check}}"),
    ]),
    panel(22, "MEGS health endpoint configuration", "stat", 12, 71, 12, 8, [
      target(`sis_external_service_configured{environment="${env}",service="megs_endpoint"}`, "A", "MEGS endpoint configured", undefined, true),
      target(`(sis_external_service_available{environment="${env}",service="megs_endpoint"} or (sis_external_service_configured{environment="${env}",service="megs_endpoint"} - 1))`, "B", "MEGS endpoint health / not configured", undefined, true),
    ], "short", { fieldConfig: { defaults: { noValue: "MEGS endpoint not configured", mappings: [] }, overrides: [
      { matcher: { id: "byName", options: "MEGS endpoint configured" }, properties: [{ id: "mappings", value: [{ type: "value", options: { "0": { text: "NOT CONFIGURED", color: "gray" }, "1": { text: "CONFIGURED", color: "green" } } }] }] },
      { matcher: { id: "byName", options: "MEGS endpoint health / not configured" }, properties: [{ id: "mappings", value: [{ type: "value", options: { "-1": { text: "NOT CONFIGURED", color: "gray" }, "0": { text: "DOWN", color: "red" }, "1": { text: "UP", color: "green" } } }] }] },
    ] } }),
    panel(23, "Nightly no-send proof", "stat", 0, 87, 6, 4, [
      target(`sis_keepalive_nightly_smoke_success{environment="${env}"}`, "A"),
      target(`sis_keepalive_nightly_smoke_no_external_message_proof{environment="${env}"}`, "B"),
      target(`sis_keepalive_nightly_smoke_last_check_timestamp_seconds{environment="${env}"}`, "C"),
      target(`time() - sis_keepalive_nightly_smoke_last_check_timestamp_seconds{environment="${env}"}`, "D"),
    ], "short", { fieldConfig: { defaults: { noValue: env === "live" ? "No live nightly suite is scheduled" : "No nightly result has been published" }, overrides: [] } }),
    panel(25, "PostgreSQL vs Redis CPU", "timeseries", 0, 79, 12, 8, [
      target('site_dependency_container_cpu_percent{container="postgres"}', "A", "PostgreSQL"),
      target('site_dependency_container_cpu_percent{container="redis"}', "B", "Redis"),
    ], "percent"),
    panel(26, "PostgreSQL vs Redis memory", "timeseries", 12, 79, 12, 8, [
      target('site_dependency_container_memory_used_bytes{container="postgres"}', "A", "PostgreSQL used"),
      target('site_dependency_container_memory_used_bytes{container="redis"}', "B", "Redis used"),
    ], "bytes"),
    textPanel(24, "Measurement notes", "The 20-row table combines scheduled environment checks with read-only service/vendor probes; it does not claim live customer workflow writes. Unconfigured vendors display NOT CONFIGURED. News, student-save, and Dictionary Builder live workflows are not synthesized. Student-save latency is the measured mean of real writes only. PostgreSQL probes include client/Docker startup. Redis uses authenticated role probes plus container and cAdvisor resource metrics; its dedicated exporter stays off until persistent read-only ACL support is configured. Loki receives allowlisted monitoring-container logs only.", 6, 87, 18, 4),
    panel(27, "Redis aggregate diagnostics", "timeseries", 0, 91, 12, 8, [
      target(`site_dependency_probe_duration_seconds{environment="${env}",dependency=~"sis-(sessions|cache|app)"}`, "A", "{{dependency}} probe"),
      target('site_dependency_container_cpu_percent{container="redis"}', "B", "Redis CPU"),
      target('site_dependency_container_memory_used_bytes{container="redis"}', "C", "Redis memory"),
    ], "short", { description: "Authenticated Redis role probes, latency, and shared-container resource metrics. A direct exporter requires a persistent read-only ACL account; no application credentials are reused.", fieldConfig: { defaults: { noValue: "No Redis dependency telemetry reported" }, overrides: [] } }),
    panel(28, "Container CPU and memory · SIS / PostgreSQL / Redis", "timeseries", 12, 91, 12, 8, [
      target('sum by (name) (rate(container_cpu_usage_seconds_total{name=~"sis-.*|redis-stack"}[5m])) * 100', "A", "{{name}} CPU %"),
      target('container_memory_working_set_bytes{name=~"sis-.*|redis-stack"}', "B", "{{name}} working set"),
    ], "short", { description: "cAdvisor is docker-only and exports resource totals for the named SIS and Redis containers. Values are shared-host measurements." }),
    panel(29, "Monitoring service logs · Loki", "logs", 0, 99, 24, 12, [target('{job="monitoring-containers"}', "A")], "short", {
      datasource: { type: "loki", uid: "sis-loki" },
      description: "Loki receives logs only from the explicit monitoring-container allowlist. SIS application, PostgreSQL, and student/parent request logs are excluded.",
    }),
    panel(30, "Loki WAL filesystem use", "timeseries", 0, 111, 24, 8, [
      target("loki_ingester_wal_disk_usage_percent * 100", "A", "WAL filesystem use %", "percent"),
    ], "percent", { description: "Shared Loki monitoring service. WAL writes pause at 95% filesystem use. This is the measured filesystem-wide pressure on Loki's WAL volume." }),
    panel(31, "Loki ingestion and WAL guard", "stat", 0, 119, 24, 4, [
      target("sum(rate(loki_distributor_lines_received_total[5m]))", "A", "Accepted log lines / sec", undefined, true),
      target("sum(increase(loki_ingester_wal_disk_full_failures_total[15m])) or vector(0)", "B", "WAL guard events / 15m", undefined, true),
    ], "short", {
      description: "Current accepted log throughput and disk guard events over fifteen minutes. Loki write guard events are reported by Loki's WAL metrics.",
      fieldConfig: {
        defaults: { unit: "short" },
        overrides: [
          { matcher: { id: "byName", options: "Accepted log lines / sec" }, properties: [{ id: "unit", value: "ops" }] },
        ],
      },
    }),
  ]

  return {
    uid: config.uid,
    title: config.title,
    tags: ["sis", "operations", `${env}-mirror`],
    links: [{
      title: "Nightly subsystem report",
      type: "link",
      icon: "graph-bar",
      url: env === "live"
        ? "/d/sis-live-nightly-report/sis-live-c2b7-nightly-subsystem-report"
        : "/d/sis-test-nightly-report/sis-test-c2b7-nightly-subsystem-report",
      keepTime: true,
      targetBlank: false,
    }],
    timezone: "browser",
    schemaVersion: 39,
    version: 1,
    refresh: "30s",
    time: { from: "now-7d", to: "now" },
    panels,
  }
}

for (const config of environments) {
  const filename = config.environment === "test" ? "test-mirror-overview.json" : "live-admin-mirror-overview.json"
  const outputPath = path.join(dashboardsRoot, filename)
  await fs.writeFile(outputPath, `${JSON.stringify(buildDashboard(config), null, 2)}\n`, "utf8")

  const reportFilename = config.environment === "test" ? "test-nightly-subsystem-report.json" : "live-nightly-subsystem-report.json"
  const reportPath = path.join(dashboardsRoot, reportFilename)
  await fs.writeFile(reportPath, `${JSON.stringify(buildSubsystemReport(config), null, 2)}\n`, "utf8")
}
