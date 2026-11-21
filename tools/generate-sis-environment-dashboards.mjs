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
    notice: "Live subsystem smoke flows are not scheduled. This page shows read-only live dependency checks and explicitly leaves absent workflow results unreported.",
  },
  {
    environment: "test",
    uid: "sis-test-mirror-overview",
    title: "SIS Test Mirror · Operations",
    domain: "test.eagles.edu.vn",
    probe: 'probe_success{job="blackbox-test-mirror"}',
    service: 'node_systemd_unit_state{name="exercise-mailer-test.service",state="active"}',
    process: "sis_test_.*",
    notice: "Test schedules: engagement, assignment notifications, parent reports, and profile/enrollment every 60s; parent profile every 15m; Library, Dictionary Builder, News, grades/feeds, and attendance every 5m; full no-send suite nightly at 04:00 ICT.",
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
  const checkTimestamp = `sis_keepalive_check_last_check_timestamp_seconds{environment="${env}"}`
  const staleAfter = `sis_keepalive_check_stale_after_seconds{environment="${env}"}`
  const checkDuration = `sis_keepalive_check_duration_seconds{environment="${env}"}`
  const writeEnv = env === "live" ? "production" : "test"
  const panels = [
    panel(1, "Public SIS page", "stat", 0, 0, 4, 4, [target(config.probe, "A", undefined, undefined, true)], "short"),
    panel(2, "SIS API service", "stat", 4, 0, 4, 4, [target(config.service, "A", undefined, undefined, true)], "short"),
    panel(3, "PostgreSQL authenticated probe", "stat", 8, 0, 4, 4, [target(siteDependency("sis-postgres", "authenticated-select-1"), "A", undefined, undefined, true)], "short"),
    panel(4, "Redis session probe", "stat", 12, 0, 4, 4, [target(siteDependency("sis-sessions", "authenticated-ping"), "A", undefined, undefined, true)], "short"),
    panel(5, "Dependency monitor", "stat", 16, 0, 4, 4, [target(monitorSuccess, "A", undefined, undefined, true)], "short"),
    panel(6, "Subsystem results reported", "stat", 20, 0, 4, 4, [target(`count(${smoke}) or vector(0)`, "A", undefined, undefined, true)], "short", {
      fieldConfig: { defaults: { mappings: [{ type: "value", options: { "0": { text: "0", color: "gray" }, "1": { text: "1", color: "green" } } }] }, overrides: [] },
    }),
    textPanel(7, "Monitoring schedule", config.notice, 0, 4, 24, 3),
    panel(8, "Subsystem smoke results", "table", 0, 7, 12, 9, [target(smoke, "A", undefined, "table", true)], "short", {
      fieldConfig: { defaults: { mappings: [{ type: "value", options: { "0": { text: "FAIL", color: "red" }, "1": { text: "PASS", color: "green" } } }] }, overrides: [] },
      options: { showHeader: true, sortBy: [{ displayName: "Value", desc: true }] },
    }),
    panel(9, "Check freshness and stale threshold", "timeseries", 12, 7, 12, 9, [
      target(`time() - ${checkTimestamp}`, "A", "age {{group}}"),
      target(staleAfter, "B", "stale after {{group}}"),
    ], "s"),
    panel(10, "Historical smoke pass/fail by subsystem", "state-timeline", 0, 16, 24, 8, [target(`last_over_time(${smoke}[10m])`, "A", "{{group}}")]),
    panel(11, "Historical subsystem check duration", "timeseries", 0, 24, 12, 8, [target(checkDuration, "A", "{{group}}")], "s"),
    panel(12, "Student-save requests in the last 5 minutes", "stat", 12, 24, 6, 8, [
      target(`sum(increase(sis_admin_student_write_requests_total{environment="${writeEnv}"}[5m]))`),
    ]),
    panel(13, "Student-save mean latency by stage", "timeseries", 0, 32, 12, 8, [
      target(`sum by (phase) (rate(sis_admin_student_write_phase_duration_seconds_sum{environment="${writeEnv}"}[10m])) / sum by (phase) (rate(sis_admin_student_write_phase_duration_seconds_count{environment="${writeEnv}"}[10m]))`, "A", "mean {{phase}}"),
    ], "s"),
    panel(14, "PostgreSQL vs Redis probe latency", "timeseries", 12, 32, 12, 8, [
      target(`site_dependency_probe_duration_seconds{environment="${env}",dependency="sis-postgres"}`, "A", "PostgreSQL SELECT 1"),
      target(`site_dependency_probe_duration_seconds{environment="${env}",dependency=~"sis-(app|sessions|cache)"}`, "B", "Redis {{dependency}}"),
    ], "s"),
    panel(15, "SIS API and worker memory", "timeseries", 0, 40, 12, 8, [
      target(`namedprocess_namegroup_memory_bytes{job="process-diagnostics",groupname=~"${config.process}",memtype="resident"}`, "A", "{{groupname}} RSS"),
    ], "bytes"),
    panel(16, "Redis diagnostics by role", "timeseries", 12, 40, 12, 8, [
      target(`site_dependency_status{environment="${env}",domain="${config.domain}",dependency=~"sis-(app|sessions|cache)",check="authenticated-ping"}`, "A", "{{dependency}} ping"),
      target(`site_dependency_status{environment="${env}",domain="${config.domain}",dependency=~"sis-(app|sessions|cache)",check="container-running"}`, "B", "{{dependency}} container"),
    ]),
    panel(17, "Pronunciation and definition providers", "timeseries", 0, 48, 12, 8, [
      target(`sis_library_cmu_dictionary_available{environment="${env}"}`, "A", "CMUdict"),
      target(`sis_library_dictionary_builder_definition_providers_available{environment="${env}"}`, "B", "definitions available"),
      target(`sis_library_dictionary_builder_definition_providers_checked{environment="${env}"}`, "C", "definitions checked"),
      target(`sis_library_mw_collegiate_key_configured{environment="${env}"}`, "D", "MW Collegiate configured"),
      target(`sis_library_mw_learners_key_configured{environment="${env}"}`, "E", "MW Learner's configured"),
    ]),
    panel(18, "News grammar and dictionary services", "timeseries", 12, 48, 12, 8, [
      target(`sis_news_language_tool_available{environment="${env}"}`, "A", "LanguageTool"),
      target(`sis_news_dictionary_available{environment="${env}"}`, "B", "pronunciation dictionary"),
      target(`sis_news_check_success{environment="${env}"}`, "C", "News Check"),
      target(`sis_news_submission_success{environment="${env}"}`, "D", "News submit"),
    ]),
    panel(19, "Grade connections · Moodle and Google Forms", "timeseries", 0, 56, 12, 8, [
      target(`sis_grade_feed_grade_rows{environment="${env}",source="moodle"}`, "A", "Moodle grades"),
      target(`sis_grade_feed_grade_rows{environment="${env}",source="google_forms"}`, "B", "Google Forms grades"),
      target(`sis_grade_feed_exercise_submission_rows{environment="${env}",source="moodle"}`, "C", "Moodle submissions"),
      target(`sis_grade_feed_exercise_submission_rows{environment="${env}",source="google_forms"}`, "D", "Google Forms submissions"),
    ]),
    panel(20, "Brevo webhook processing", "timeseries", 12, 56, 12, 8, [
      target(`sis_engagement_webhook_unprocessed_events{environment="${env}"}`, "A", "unprocessed events"),
      target(`sis_engagement_webhook_last_received_timestamp_seconds{environment="${env}"}`, "B", "last webhook received"),
    ]),
    panel(21, "Thuvien and ESL reading probes", "timeseries", 0, 64, 12, 8, [
      target('probe_success{job="blackbox-website-http",site="thuvien"}', "A", "Thuvien public page"),
      target('probe_success{job="blackbox-thuvien-media"}', "B", "{{check}}"),
    ]),
    textPanel(22, "MEGS integration coverage", "MEGS is a separate runtime at `/home/eagles/dockerz/megs`. SIS Prometheus currently has no MEGS-owned health or grade-ingestion series, so this dashboard does not infer MEGS health from SIS grade counts.", 12, 64, 12, 8),
    panel(23, "Nightly no-send proof", "stat", 0, 80, 6, 4, [
      target(`sis_keepalive_nightly_smoke_success{environment="${env}"}`, "A"),
      target(`sis_keepalive_nightly_smoke_no_external_message_proof{environment="${env}"}`, "B"),
    ]),
    panel(25, "PostgreSQL vs Redis CPU", "timeseries", 0, 72, 12, 8, [
      target('site_dependency_container_cpu_percent{container="postgres"}', "A", "PostgreSQL"),
      target('site_dependency_container_cpu_percent{container="redis"}', "B", "Redis"),
    ], "percent"),
    panel(26, "PostgreSQL vs Redis memory", "timeseries", 12, 72, 12, 8, [
      target('site_dependency_container_memory_used_bytes{container="postgres"}', "A", "PostgreSQL used"),
      target('site_dependency_container_memory_used_bytes{container="redis"}', "B", "Redis used"),
    ], "bytes"),
    textPanel(24, "Measurement notes", "Latency panels use measured request/probe durations. Missing series mean the source is not instrumented or no observation exists in the selected range; they are never converted into healthy zeroes. PostgreSQL and Redis resource panels are shared-container Docker samples, not environment-attributed database usage. Redis memory/client totals require a secured exporter and are not currently collected.", 6, 80, 18, 4),
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
