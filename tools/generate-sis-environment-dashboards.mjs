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

function buildDashboard(config) {
  const env = config.environment
  const siteDependency = (dependency, check) =>
    `site_dependency_status{environment="${env}",domain="${config.domain}",dependency="${dependency}",check="${check}"}`
  const monitorSuccess = `site_dependency_environment_monitor_success{environment="${env}"}`
  const smoke = `sis_keepalive_check_success{environment="${env}"}`
  const smokeMetric = "sis_keepalive_check_success"
  const checkTimestamp = `sis_keepalive_check_last_check_timestamp_seconds{environment="${env}"}`
  const staleAfter = `sis_keepalive_check_stale_after_seconds{environment="${env}"}`
  const checkDuration = `sis_keepalive_check_duration_seconds{environment="${env}"}`
  const writeEnv = env === "live" ? "production" : "test"
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
    { name: "Brevo API", service: "brevo_api", serviceEnvironment: env },
    { name: "Google Forms discovery", service: "google_forms_discovery", serviceEnvironment: env },
    { name: "Moodle health endpoint", service: "moodle_endpoint", serviceEnvironment: env },
    { name: "MEGS health endpoint", service: "megs_endpoint", serviceEnvironment: env },
  ].map(({ name, service, serviceEnvironment }, index) => {
    const labels = `environment="${serviceEnvironment}",service="${service}"`
    const configured = `sis_external_service_configured{${labels}}`
    const available = `sis_external_service_available{${labels}}`
    return target(`(${available} or (${configured} - 1))`, String.fromCharCode(75 + index), name, "table", true)
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
      ...(env === "live" ? [] : [
        target(`sis_library_dictionary_builder_provider_checked{environment="${env}"}`, "D", "{{provider}} checked"),
        target(`sis_library_dictionary_builder_provider_available{environment="${env}"}`, "E", "{{provider}} available"),
        target(`sis_library_dictionary_builder_definition_providers_available{environment="${env}"}`, "F", "definition results available"),
        target(`sis_library_dictionary_builder_definition_providers_checked{environment="${env}"}`, "G", "definition sources checked"),
      ]),
      ...(env === "live" ? [
        target('sis_external_service_available{environment="shared",service=~"languagetool_.*"}', "D", "{{service}} health"),
        target('sis_external_service_http_status{environment="shared",service=~"languagetool_.*"}', "E", "{{service}} HTTP status"),
        target(`sis_external_service_check_duration_seconds{environment="${env}",service=~"merriam_webster_.*"}`, "F", "{{service}} check duration"),
        target("vector(-1)", "G", "12 Dictionary Builder buttons · not run live"),
      ] : []),
    ], "short", { description: env === "live" ? "Live emits read-only CMUdict and Merriam-Webster vendor health. It does not run the synthetic Dictionary Builder button preview against customer data; the twelve per-button series are test-only." : "Test shows all twelve fixed Dictionary Builder source IDs with checked/available status, plus read-only CMUdict and Merriam-Webster vendor health." }),
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
    panel(19, "Grade connections · Moodle and Google Forms", "timeseries", 0, 63, 12, 8, [
      target(`sis_grade_feed_grade_rows{environment="${env}",source="moodle"}`, "A", "Moodle grades"),
      target(`sis_grade_feed_grade_rows{environment="${env}",source="google_forms"}`, "B", "Google Forms grades"),
      target(`sis_grade_feed_exercise_submission_rows{environment="${env}",source="moodle"}`, "C", "Moodle submissions"),
      target(`sis_grade_feed_exercise_submission_rows{environment="${env}",source="google_forms"}`, "D", "Google Forms submissions"),
      target(`sis_grade_feed_readonly_data_available{environment="${env}"}`, "E", "Read-only DB query"),
      target(`sis_external_service_configured{environment="${env}",service="google_forms_grade_secret"}`, "F", "Grade endpoint secret configured"),
      target(`sis_external_service_configured{environment="${env}",service="google_forms_discovery"}`, "G", "Forms API discovery configured"),
      target(`sis_external_service_configured{environment="${env}",service="moodle_endpoint"}`, "H", "Moodle endpoint configured"),
      target(`(sis_external_service_available{environment="${env}",service="google_forms_discovery"} or (sis_external_service_configured{environment="${env}",service="google_forms_discovery"} - 1))`, "I", "Forms API discovery health / not configured"),
      target(`sis_external_service_http_status{environment="${env}",service="google_forms_discovery"}`, "J", "Forms API discovery HTTP status"),
      target(`sis_external_service_configured{environment="${env}",service="moodle_provisioning_secret"}`, "K", "Moodle provisioning secret configured"),
    ], "short", { fieldConfig: { defaults: { noValue: "No stored feed rows or configured vendor endpoint" }, overrides: [] } }),
    panel(20, "Brevo webhook processing", "timeseries", 12, 63, 12, 8, [
      target(`sis_engagement_webhook_unprocessed_events{environment="${env}"}`, "A", "unprocessed events"),
      target(`sis_engagement_webhook_last_received_timestamp_seconds{environment="${env}"}`, "B", "last webhook received"),
      target(`sis_engagement_webhook_readonly_data_available{environment="${env}"}`, "C", "Read-only DB query"),
      target(`sis_external_service_configured{environment="${env}",service="brevo_api"}`, "D", "Brevo API configured"),
      target(`(sis_external_service_available{environment="${env}",service="brevo_api"} or (sis_external_service_configured{environment="${env}",service="brevo_api"} - 1))`, "E", "Brevo API health / not configured"),
      target(`sis_external_service_http_status{environment="${env}",service="brevo_api"}`, "F", "Brevo API HTTP status"),
    ], "short", { fieldConfig: { defaults: { noValue: "Brevo API endpoint is not configured" }, overrides: [] } }),
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
}
