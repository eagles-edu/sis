# SIS Monitoring Operations

## Current pared profile

The monitoring profile includes Prometheus, Alertmanager, node-exporter, blackbox-exporter, cAdvisor, Loki, Grafana Alloy, and Grafana on loopback. Process-exporter is enabled for SIS process diagnostics. PostgreSQL exporter and Redis exporter are not active. cAdvisor records Docker resource metrics; Alloy forwards only allowlisted monitoring-container logs to the seven-day local Loki store, with persistent Docker read offsets and stale-backlog filtering. Loki pauses WAL writes at 95% filesystem use; a paired dashboard shows current WAL filesystem pressure, accepted log throughput, and guard events. The 60-second dependency monitor records shared PostgreSQL and Redis container CPU and memory from `docker stats --no-stream`, plus environment-owned authenticated database and Redis probe status and latency.

## Purpose

This document describes the local monitoring suite installed for the SIS host. It is intended to make CPU, RAM, Docker, PostgreSQL, Redis, and SIS application incidents observable without exposing monitoring services directly to the Internet.

The immediate use case is diagnosing reports that saving a new student causes CPU or RAM saturation and requires a reboot.

## Environment-file ownership

| Runtime | Environment file | Rule |
| --- | --- | --- |
| Dev (`:8788`) | `.env.dev` | Local development only |
| Live/admin mirror (`admin.eagles.edu.vn`) | `.env` | Live/admin-mirror only |
| Test mirror (`test.eagles.edu.vn`, `:8786`) | `.env.test` | Test-mirror only |

These files are separate runtime contracts. Never copy credentials or settings between them, and never use one as a fallback for another. Monitoring configuration must target the environment it observes without importing application credentials from a different environment.

## Installed architecture

```text
Host
├── node-exporter  ───── host CPU, RAM, disk, filesystem, load, network
├── blackbox-exporter ─── public HTTPS availability and latency for monitored sites
├── cAdvisor          ─── Docker container CPU and memory
├── Grafana Alloy     ─── allowlisted monitoring-container logs to Loki
├── Loki              ─── local logs, seven-day retention
├── Prometheus      ───── metric collection and 7-day local retention
├── Alertmanager    ───── grouped firing and resolved notifications to `#sis-alert`
└── Grafana         ───── dashboards and visual investigation
```

The monitoring files are maintained in:

- `ops/monitoring/docker-compose.yml`
- `ops/monitoring/prometheus.yml`
- `ops/monitoring/grafana/provisioning/`
- `ops/monitoring/grafana/dashboards/`

Persistent Docker volumes:

- `monitoring_prometheus-data`
- `runtime-data/prometheus/alertmanager/` (Alertmanager state; ignored runtime data)
- `monitoring_grafana-data`
- `monitoring_loki-data` (seven-day local log store)
- `monitoring_alloy-data` (Docker log read offsets)

## Services and local endpoints

| Service | Local endpoint | Purpose |
| --- | ---: | --- |
| Grafana | `http://127.0.0.1:3030` | Dashboard UI |
| Prometheus | `http://127.0.0.1:9090` | Query and metric storage |
| Alertmanager | `http://127.0.0.1:9093` | Local notification and silence status |
| Grafana Alloy | `http://127.0.0.1:12345` | Collector readiness and metrics; Docker socket access is limited to the monitoring allowlist |
| Loki | private Compose network, `loki:3100` | Searchable logs; no host-published port |
| cAdvisor | `http://127.0.0.1:8089` | Docker metrics |
| node-exporter | `http://127.0.0.1:9100` | Host metrics |
| process-exporter | `http://127.0.0.1:9256` | Test-mirror process metrics |
| blackbox-exporter | `http://127.0.0.1:9115` | Public HTTP(S) probe metrics |
| Security Overview | `http://127.0.0.1:3030/d/host-security-overview` | Local CrowdSec/Fail2ban status and active banned-address table |

All endpoints are bound to loopback. They are not public web services and should remain behind SSH access or an authenticated internal reverse proxy.

## Host Security Overview

Grafana's **Host Security Overview** dashboard is provisioned from `ops/monitoring/grafana/dashboards/security-overview.json` and remains subject to the existing Grafana authentication and loopback-only listener. The dashboard includes current CrowdSec decisions, current Fail2ban SSH bans and failures, policy settings, systemd service state, and an active ban table grouped by source and country.

The host timer `eagles-security-metrics.timer` runs the root-owned installed copy of `tools/security-monitoring-metrics.sh` every 30 seconds. It writes an atomic Prometheus textfile snapshot into `runtime-data/prometheus/security-overview.prom`, which the existing node-exporter textfile collector scrapes. CrowdSec decisions and Fail2ban's active SSH list are joined to the local `/var/lib/crowdsec/data/GeoLite2-City.mmdb` database; country lookups do not send addresses to an external service. Unknown or non-IP ranges display `Unknown` rather than using a remote lookup.

The active-ban table intentionally contains address labels because the local dashboard needs to show the banned addresses. Those label series remain in Prometheus for its configured seven-day retention after a ban disappears from the current list. No new network listener is added, and the dashboard does not expose unban controls or the Fail2ban control socket.

Useful local checks:

```bash
systemctl status eagles-security-metrics.timer
systemctl start eagles-security-metrics.service
curl -fsS http://127.0.0.1:9100/metrics | grep '^eagles_security_'
curl -fsS http://127.0.0.1:3030/api/health
```

## Domain Layer Dashboards

Grafana provisions one dashboard per monitored public domain from `ops/monitoring/grafana/dashboards/`. The dashboard JSON is generated by `node tools/generate-domain-monitoring-dashboards.mjs`; the file provider reloads changes on its configured 30-second interval. All dashboards refresh every 30 seconds and default to the last 24 hours.

| Domain | Dashboard | Domain-specific layers collected |
| --- | --- | --- |
| `eagles.edu.vn` | [Eagles Homepage](http://127.0.0.1:3030/d/domain-eagles-homepage) | Public HTTPS, DNS, TLS, response phases, shared Nginx configuration validation, OpenLiteSpeed and MariaDB service state |
| `admin.eagles.edu.vn` | [SIS Admin Mirror · Domain Layers](http://127.0.0.1:3030/d/domain-sis-admin) | Public HTTPS, SIS API route, authentication guard, authenticated PostgreSQL/Redis checks, shared Nginx configuration validation and SIS service state, environment-wide dev workflow freshness/failure signals, and parent-report acknowledgment status/5xx alert |
| `ltd.eagles.vn` | [LTD ERPNext](http://127.0.0.1:3030/d/domain-ltd-erpnext) | Public HTTPS, Frappe ping, eight ERPNext/Redis container states, authenticated Redis role checks |
| `ielts.eagles.edu.vn` | [IELTS Portal](http://127.0.0.1:3030/d/domain-ielts-portal) | Public HTTPS, SIS API route, shared Nginx configuration validation and SIS API service state |
| `thuvien.eagles.edu.vn` | [Thuvien Library](http://127.0.0.1:3030/d/domain-thuvien-library) | Public HTTPS, SIS API route, image/audio range requests, shared Nginx configuration validation, SIS API and media gateway service states |
| `moodle.eagles.edu.vn` | [Moodle Portal](http://127.0.0.1:3030/d/domain-moodle-portal) | Public HTTPS, shared Nginx and PHP-FPM/MariaDB service state; authenticated Moodle actions and database query are not probed |

The one-minute `blackbox-website-http` checks cover all six domains above and alert after two minutes of failed HTTPS probes or missing target series. These probes originate from this monitoring host: they verify the configured public route from this host's network path, but they cannot prove reachability from every student, parent, or staff ISP. The connected-browser incident check is recorded separately from these host-originated probes.

The 60-second `site-dependency-monitor.service` also runs a bounded, read-only `/usr/sbin/nginx -t -q` check. It exports only `site_dependency_nginx_config_valid`, its duration, and its check timestamp under `scope="shared_host"`; Nginx stderr and local configuration paths are discarded. `NginxConfigurationInvalid` warns after one minute. A syntax failure blocks a future reload but does not establish that the currently running workers stopped serving their last loaded configuration, so the alert does not trigger an automatic reload or restore.

The live/admin and test SIS mirrors have structurally identical operations dashboards generated by `node tools/generate-sis-environment-dashboards.mjs`:

- [SIS Live/Admin Mirror · Operations](http://127.0.0.1:3030/d/sis-live-admin-overview)
- [SIS Test Mirror · Operations](http://127.0.0.1:3030/d/sis-test-mirror-overview)

Both pages use the same 31 panels, time range, refresh, panel order, and per-panel query count; only environment filters and the truthful live/test check sources differ. Current health cards use instant Prometheus queries so low-frequency checks do not disappear at the dashboard time-series sampling interval. The historical subsystem timeline carries forward each latest result for thirty minutes. Each page shows twenty outcomes: the test page has ten authenticated workflow groups plus ten vendor/configuration checks; the live page has ten scheduled read-only probes plus those ten vendor/configuration checks. The live probes cover the public admin page, SIS API route, auth guard, API service, PostgreSQL container and `SELECT 1`, three Redis roles, and aggregate grade/feed query. These are environment outcomes, not a claim that live customer workflow writes run. Live synthetic workflow writes and sends are not scheduled. The live SIS service now exports authenticated write counters and real request-stage durations to the node-exporter textfile collector; graphs remain empty until actual writes happen and never substitute zero latency. Both pages also show live Loki logs and the Loki WAL usage/ingestion guard, and all dashboard panels occupy non-overlapping grid cells.

The `site-dependency-monitor.timer` runs every 60 seconds and records separate live (`.env`) and test (`.env.test`) PostgreSQL database-identity/`SELECT 1` and Redis `AUTH`/`SELECT`/`PING` results and elapsed durations. It also samples the shared PostgreSQL and Redis container CPU and memory, exports read-only grade/exercise counts and Brevo webhook aggregates, and records whether those aggregate queries succeeded for each database. Raw grade/webhook detail is never emitted. The test's existing grade and engagement monitor files remain their only source for overlapping detail series; the dependency monitor emits those detail series only for live to prevent node-exporter duplicate-series errors. The PostgreSQL timing includes Docker/`psql` client startup overhead, so compare its trend and container resources with Redis ping latency; do not treat a single probe as pure server query time. The test and live config files are read independently and are never copied between environments. The `SiteDependencyProbeSetIncomplete` alert checks expected cardinalities separately: eight live/admin SIS dependency checks, eight test-mirror SIS dependency checks, and six LTD Redis-role checks.

The `sis-vendor-health-monitor.timer` runs `ops/monitoring/monitor-vendor-health.py` every 15 minutes using only the live `.env` and test `.env.test`. It makes read-only GET requests for configured Brevo, Merriam-Webster Collegiate/Learner's, Google Forms API discovery, and Moodle/MEGS health endpoints; checks each runtime's installed CMUdict file; and probes both shared LanguageTool instances. For live, it also logs into the admin API and requests a fixed-word Dictionary Builder preview. That endpoint stores only an expiring in-memory preview; the monitor exports the twelve fixed provider IDs and checked/available status, never definitions, credentials, provider responses, student data, or Library records. It never sends email or submits grades. It exports configuration state, availability, response code, duration, and last-check time using fixed service labels. The Google Forms discovery result is explicitly distinct from the SIS HMAC grade-ingestion contract; the dashboard also reports whether that environment's `GOOGLE_FORMS_GRADES_SECRET` is configured. Moodle provisioning-secret and MEGS endpoint configuration are reported separately from endpoint health. The service returns success when it publishes a complete snapshot; per-vendor failures remain visible in metrics. No notification rule was added for these new vendor metrics.

Both system timers are enabled and active on the monitoring host: dependency probes every 60 seconds and vendor checks every 15 minutes. On 2026-11-22, the live admin login and fixed-word Dictionary Builder preview returned HTTP 200; six of twelve provider IDs returned an available definition and the other six remained explicitly unchecked/not offered. Live/test CMUdict files are present, both Merriam-Webster endpoints return HTTP 200 in each environment, and both shared LanguageTool instances return HTTP 200. Test Brevo returns HTTP 200; live Brevo is not configured. Google Forms discovery is not configured in live; it is configured in test and returns HTTP 403. The HMAC grade secret is configured in both, but these checks do not validate grade-ingestion permissions or delivery. Moodle health endpoints and MEGS health endpoints are not configured; a Moodle provisioning secret is present only in live. The dependency monitor, authenticated Redis role probes, cAdvisor container metrics, Loki ingestion, and the paired vendor feeds are active. Live student-save phase metrics are now wired to the textfile collector and will populate only when real authenticated writes occur.

The Library monitors export separate `checked` and `available` series for all twelve fixed Dictionary Builder source IDs. An unchecked source emits `checked=0` and no `available` series, so missing work is not shown as a vendor failure. Test uses its existing workflow monitor; live uses the read-only preview endpoint with a fixed candidate and does not create or alter Library or student records. Live-only metric families use the `sis_live_dictionary_builder_*` prefix to avoid duplicate HELP/TYPE declarations in node-exporter's textfile collector. The preview may return fewer than twelve sources; every absent or not-offered source remains visible as unchecked. Provider IDs are fixed source identifiers only; entry text, response content, credentials, and user data are not metric labels.

Dev/test textfile metric families use the same environment-neutral `HELP` text in each owned file; the `environment` label carries the distinction. A stale legacy `parent-profile-workflow.prom` file must not remain beside the current `parent-profile-workflow-dev.prom` and `parent-profile-workflow-test.prom` files, because duplicate series or inconsistent help text causes node-exporter's textfile collector to reject the combined scrape.

Coverage limits remain visible on both dashboards: aggregate grade rows show stored data, not successful source delivery; Google Forms discovery does not validate form permissions or grade submissions. As checked on 2026-11-22, a Google Forms HMAC grade secret is configured in both owned files, but this monitor does not validate the secret or submit grades; Moodle health endpoints are unconfigured in both, the provisioning secret is configured only in live, and MEGS health URLs are unconfigured in both. MEGS is a separate code/runtime tree, and its health is not inferred from SIS grade counts. Live Dictionary Builder provider metrics come from a read-only preview and leave absent or not-offered source IDs explicitly unchecked. Redis diagnostics use authenticated per-role pings and latency plus dependency-monitor and cAdvisor CPU/memory series. The dedicated redis_exporter remains off: the shared Redis server has no persistent ACL file, so provisioning its read-only account requires changing and restarting the shared Redis service. The monitoring feed does not reuse an application owner's credentials. At KA-205, Loki exposed its configured disk guard at 95% because the host filesystem measured 91.7% use; writes are retained while this remains under the guard, and the dashboards now show that shared-filesystem pressure. The Loki read pipeline parses Docker timestamps, drops entries older than 30 minutes, persists read offsets, and was verified with a fresh allowlisted monitoring-container log event.

Each dashboard combines six status cards (including measured 24-hour public-probe availability alongside its collected-sample count), availability and alert timelines, request-phase and DNS graphs, application latency where configured, current service/dependency tables, service and dependency health-history timelines, and shared-host resource graphs. The ERPNext dashboard also graphs running state for every component and labels Docker healthcheck states as `HEALTHY`, `UNHEALTHY`, or `NO HEALTHCHECK`. Chart legends retain their measured phase/check/component labels. Panels use a non-overlapping grid. Missing application, latency, service, dependency, or container probes render an explicit instrumentation-gap note instead of an empty chart that could be mistaken for healthy status. The coverage map distinguishes measured, partial, and unmeasured layers. Shared host CPU/memory/disk metrics are explicitly labeled as host-wide; they are not attributed to an individual domain. SIS dev workflow signals are labeled environment-wide because their metrics do not carry domain labels.

The current coverage gaps are deliberate and visible: the apex site has no application/API or authenticated database query; IELTS has no domain-specific DB/cache probe; Thuvien has no domain-specific database/object-store probe; Moodle has no authenticated action or database-query probe; host resource, shared Nginx configuration, and shared SIS API metrics are not domain-attributed. Add probes before changing those coverage rows to “Measured.”

## Starting and checking the suite

From the SIS repository:

```bash
docker compose \
  --env-file ops/monitoring/.env \
  -f ops/monitoring/docker-compose.yml \
  up -d
```

Check container status:

```bash
docker compose \
  --env-file ops/monitoring/.env \
  -f ops/monitoring/docker-compose.yml \
  ps
```

Check service health:

```bash
curl -fsS http://127.0.0.1:9090/-/ready
curl -fsS http://127.0.0.1:3030/api/health
curl -fsS http://127.0.0.1:8089/healthz
curl -fsS http://127.0.0.1:9100/metrics >/dev/null
```

Check Prometheus target health:

```bash
curl -fsS http://127.0.0.1:9090/api/v1/targets
```

At KA-205, all 20 active Prometheus targets reported `health: up`, including Loki, Alloy, and cAdvisor. Target counts change as blackbox sites and optional diagnostics are enabled; evaluate every active target returned by the API rather than relying on a fixed count.

## Accessing Grafana remotely

The preferred access method is an SSH tunnel:

```bash
ssh -L 3030:127.0.0.1:3030 user@server
```

Then open:

```text
http://127.0.0.1:3030
```

The Grafana administrator password is stored in the local ignored monitoring environment file. It must not be committed to Git or copied into this document.

The Prometheus datasource is provisioned automatically as `SIS Prometheus`. The default dashboard is in the `SIS` folder and is named `SIS Resource Overview`.

## Current dashboard panels

The provisioned dashboards contain:

1. Host CPU usage
2. Host memory used
3. CPU usage by Docker container
4. Memory usage by Docker container
5. PostgreSQL container CPU and memory

The test environment dashboard adds:

1. `https://test.eagles.edu.vn/admin` availability and response time
2. Test API process status, CPU, and memory
3. Test async worker process status, CPU, and memory
4. Test static web process status, CPU, and memory
5. Host CPU and memory pressure beside PostgreSQL and Redis container usage

The dashboard refreshes every five seconds and initially displays the last 30 minutes.

## Useful Prometheus queries

### Host CPU percentage

```promql
100 * (1 - avg by (instance) (
  rate(node_cpu_seconds_total{mode="idle"}[1m])
))
```

### Host memory percentage

```promql
100 * (
  1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes
)
```

### Docker CPU by container

```promql
100 * sum by (name) (
  rate(container_cpu_usage_seconds_total{name!=""}[1m])
)
```

### Docker memory by container

```promql
sum by (name) (
  container_memory_working_set_bytes{name!=""}
)
```

### PostgreSQL container memory

```promql
sum(container_memory_working_set_bytes{name="/sis-postgres"})
```

### Container restart evidence

```promql
changes(container_start_time_seconds{name!=""}[30m])
```

## Reproducing the student-save incident

Use the test mirror first. Do not create a production student as a diagnostic step unless production testing is explicitly authorized.

The valid workflow is:

1. Open the test mirror admin page.
2. Establish a real admin cookie session through the visible login flow.
3. Confirm the page reports the authenticated admin state.
4. Open Grafana and set the time range to `Last 15 minutes`.
5. Open Prometheus targets in a second tab and confirm all targets are up.
6. Open a terminal and start a one-second resource watch:

```bash
watch -n 1 '
  date
  free -h
  docker stats --no-stream
  docker compose -f ops/monitoring/docker-compose.yml ps
'
```

1. In the authenticated admin UI, create one clearly synthetic test student using the normal form.
2. Record the exact local time when Save is clicked.
3. Observe host CPU, host memory, PostgreSQL, Redis, the SIS Node process, and all Docker containers for at least five minutes.
4. Capture the Grafana dashboard screenshot and Prometheus target state if a spike occurs.
5. Remove the synthetic test record through the authenticated admin UI after the investigation.

Do not use a direct Prisma import, direct SQL insert, or an unauthenticated API call as a substitute for this reproduction. Those paths do not test the real browser/session/router contract.

## Evidence to capture during a spike

Capture all of the following with timestamps:

```bash
date --iso-8601=seconds
uptime
free -h
docker stats --no-stream
ps -eo pid,ppid,%cpu,%mem,rss,etime,cmd --sort=-%cpu | head -30
docker events --since 10m --until 0s
```

PostgreSQL activity snapshot:

```bash
docker exec sis-postgres psql -U sis_app -d sis \
  -c 'select pid, usename, state, wait_event_type, wait_event, query_start, left(query, 300) from pg_stat_activity order by query_start nulls last;'
```

PostgreSQL locks:

```bash
docker exec sis-postgres psql -U sis_app -d sis \
  -c 'select pid, locktype, mode, granted, relation::regclass, waitstart from pg_locks order by granted, waitstart nulls last;'
```

Redis runtime snapshot:

```bash
docker exec redis-stack redis-cli INFO memory
docker exec redis-stack redis-cli INFO stats
docker exec redis-stack redis-cli INFO clients
```

The exact request timestamp must be correlated with:

- Nginx access logs for the admin mirror or test mirror
- SIS Node service logs
- PostgreSQL activity and slow-query data
- Grafana CPU/memory graphs
- Docker restart or OOM events

## Initial findings from the first controlled backend check

A synthetic server-side save in the test database completed in approximately 1.26 seconds and did not produce a PostgreSQL or host resource spike. This was useful as a baseline only; it was not a valid browser/authentication reproduction and must not be treated as proof that the real UI path is healthy.

The historical incident evidence showed:

- PostgreSQL health query latency reaching approximately 8 seconds before the reboot.
- Repeated database connection termination messages from the async worker.
- No recorded kernel OOM or killed-process event.
- A large desktop browser/IDE workload on the host at shutdown.

The next authenticated reproduction must determine whether the trigger is:

- browser-side CPU or memory growth;
- SIS Node process growth;
- PostgreSQL query latency or lock contention;
- Redis/session behavior;
- another Docker container consuming the host;
- or a host-wide desktop workload unrelated to the save request.

## Recommended add-ons

### 1. PostgreSQL exporter — highest priority

Add `postgres_exporter` with a least-privilege monitoring database account. Useful metrics include:

- active and idle connections;
- transaction rate;
- cache hit ratio;
- deadlocks;
- temporary files and temporary bytes;
- database and table size;
- long-running transactions;
- locks and wait events.

Do not give the exporter the application owner's write privileges. Use a dedicated monitoring role with only the required statistics permissions.

### 2. Redis exporter — available, deferred pending safe ACL persistence

The optional `redis-exporter` profile is available but remains stopped. The shared Redis service has no persistent ACL file, so a dedicated read-only monitoring account cannot currently survive a Redis restart without changing and restarting the shared Redis service. Do not reuse an application account. The active dashboard feed already measures authenticated app/session/cache role pings and latency, plus shared Redis CPU and memory from the dependency monitor and cAdvisor. Enable the direct exporter only after a persistent, read-only ACL user is provisioned through the approved shared-Redis change process.

When enabled with that account, `redis_exporter` observes:

- used memory and memory fragmentation;
- evictions;
- blocked clients;
- connected clients;
- command rate and latency;
- key count;
- rejected connections.

This is especially useful because Redis is used for sessions and filter-cache behavior.

### 3. Process exporter — high priority

Add `process-exporter` to track SIS Node independently from the rest of the host. Track at least:

- production/admin `exercise-mailer.mjs`;
- test `exercise-mailer.mjs`;
- async side-effects worker;
- PostgreSQL;
- Redis;
- LanguageTool containers.

This distinguishes a Node heap leak from a container or browser problem.

### 4. Alertmanager and Slack delivery

Prometheus should alert on:

| Alert | Suggested threshold |
| --- | --- |
| Host CPU saturation | >85% for 5 minutes |
| Low available memory | <15% for 5 minutes |
| Swap activity | sustained swap-in/swap-out |
| SIS process CPU | >150% for 2 minutes on a 6-core host |
| SIS process memory | continuous growth for 15 minutes |
| PostgreSQL latency | health query >500 ms for 3 samples |
| PostgreSQL lock wait | any critical write blocked >30 seconds |
| Container OOM | any OOM event |
| Container restart | unexpected restart in 10 minutes |
| Prometheus target down | any target down for 2 minutes |

Alert delivery should go to an approved channel such as email, Slack, or another operational notification destination. Do not place delivery credentials in this document.

### 5. Loki and Alloy — installed monitoring log feed

Loki and Grafana Alloy run in the monitoring Compose project. Alloy reads only the explicit monitoring-container allowlist and excludes the SIS app, PostgreSQL, and student/parent request logs. It parses Docker timestamps before dropping backlog entries older than 30 minutes and persists its Docker read offsets in `monitoring_alloy-data`. Loki retains local logs for seven days and has no host-published port. Keep request bodies, passwords, cookies, session IDs, and student PII out of log labels and payloads. The paired SIS dashboards show the Loki stream and its WAL filesystem pressure, accepted log throughput, and disk-guard events.

For this incident, structured SIS request logs with request ID, route, status, duration, and database timing are more valuable than collecting every log line centrally.

## SIS application instrumentation still needed

Infrastructure metrics alone cannot identify the exact save operation. The SIS service should eventually expose a protected Prometheus metrics endpoint or emit structured timing records for:

- authenticated login duration;
- `POST /api/admin/students` duration;
- `PUT /api/admin/students/:id` duration;
- Prisma transaction duration;
- roster reload duration;
- profile backup snapshot duration;
- filter-cache invalidation duration;
- response status and error code;
- active request count;
- Node heap used, heap total, RSS, and event-loop delay.

Request labels must use route templates, not student IDs, names, emails, cookies, or raw request bodies. This avoids turning Prometheus into a student-data store.

## Keep-alive logical check groups

Each checklist subsystem has a fixed logical group ID. A process may run more than one group, but each group must publish its own result, last-check time, last-success time, duration, and bounded failure code. Process exit status or another group's passing result must never stand in for a group's outcome. These group status series use the common `sis_keepalive_check_*` families with only the controlled `environment` and `group` labels; existing subsystem metric families remain the detailed measurements. Group-level status emission is a separate implementation step and is not implied by the existing combined monitors.

| Checklist subsystem | Group ID | Existing detail metric families | Current execution owner and boundary |
| --- | --- | --- | --- |
| Parent invitation, draft, submission, approval, and profile update | `parent_profile` | `sis_parent_profile_workflow_*` | `tools/monitor-parent-profile-workflow.mjs`; synthetic authenticated lifecycle every 15m in dev and test, no email |
| Engagement events and reporting | `engagement` | `sis_engagement_*` | `tools/monitor-engagement-workflows.mjs`; dev/test read-only database and authenticated API checks |
| Student Library | `student_library` | `sis_library_*` excluding Dictionary Builder families | `tools/monitor-library-workflow.mjs`; synthetic save/review/result and verified cleanup every 5m in dev and test |
| Student News, vocabulary, and grammar | `student_news` | `sis_news_*` | `tools/monitor-news-workflow.mjs`; synthetic Check/submission and verified cleanup every 5m in dev and test |
| Admin definitions and Dictionary Builder | `dictionary_builder` | `sis_library_dictionary_builder_*` | Executed inside the Library monitor every 5m in dev and test, with an independent group result and detail family |
| Assignments and notifications | `assignment_notifications` | `sis_assignment_reminder_*`, `sis_notification_*`, `sis_parent_report_notification_*`, `sis_async_*` | Engagement monitor plus the async side-effects worker; queue and delivery states are measured separately, and worker health is not delivery success |
| Grades, external exercise feeds, and tables | `grade_feeds` | `sis_grade_feed_*` | `tools/monitor-grade-feeds.mjs`; authenticated read checks and aggregate feed state every 5m in dev and test |
| Attendance | `attendance` | `sis_attendance_*` and fixed attendance route series in `sis_admin_student_write_*` | Grade/feed monitor plus authenticated write instrumentation every 5m in dev and test; attendance result is independent of grade/feed result |
| Parent site, profiles, performance reports, and notifications | `parent_reports` | `sis_parent_authentication_*`, `sis_parent_report_*`, `sis_parent_report_acknowledgment_*` | Engagement monitor plus acknowledgment route metrics; authenticated parent/dashboard status is separate from acknowledgment-write status |
| Student profiles, enrollment, and provisioning | `student_profile_enrollment` | `sis_admin_student_write_*`, `sis_enrollment_*`, `sis_moodle_provisioning_*` | Engagement monitor plus authenticated write metrics; profile/enrollment status is separate from Moodle queue state |

The current monitors may share a process, but the fixed group IDs and owned detail families above retain separate results and freshness series.

Group status is exported as `sis_keepalive_check_success`, `sis_keepalive_check_last_check_timestamp_seconds`, `sis_keepalive_check_last_success_timestamp_seconds`, `sis_keepalive_check_duration_seconds`, `sis_keepalive_check_stale_after_seconds`, and `sis_keepalive_check_failure_info`. Each check computes its own result; shared-process duration records the enclosing run duration. Failed runs preserve that group's last successful timestamp. Failure information uses only `none`, `workflow_failed`, `dependency_unavailable`, `cleanup_failed`, or `configuration_invalid`; raw exception text and account or student data are never label values. Dev and test alert on failed groups and compare each scheduled group's last-check timestamp with its configured stale limit. A zero stale limit marks an on-demand group and disables scheduled-staleness alerting. Test stale limits are enabled only for groups with an active test-owned recurring monitor; groups without one remain explicitly unscheduled. `ops/monitoring/alerts.test.yml` exercises the test Library stale transition at its 900-second limit in addition to the engagement failure/staleness cases.

### Group environment and execution policy

The rows below define the target policy for each logical group. `dev` means `.env.dev` / `NODE_ENV=development` / `sis_dev`; `test` means `.env.test` / `NODE_ENV=test` / `sis-test`. Every database-backed run must verify its database identity. No new live/admin check is authorized here; any future live check is read-only unless an explicitly isolated synthetic flow is approved. A test cadence or timeout marked as a target is not active until its test-owned runner or service enforces it.

The five dev API-backed monitor services run `tools/wait-for-dev-api-listener.mjs` as `ExecStartPre`. It polls only the local TCP listener at `127.0.0.1:8788`, without an HTTP request, database access, or configuration repair, and waits for at most 60 seconds. This lets scheduled monitors survive an operator-started API restart without converting the expected startup window into failed workflow results. After the listener opens, each monitor still runs its normal authenticated workflow and dependency checks; provider, database, session, or cleanup failures remain visible. The unit start deadlines include the 60-second preflight bound. Test monitor services are unchanged.

| Group | Environment and cadence | Maximum run time | Dependencies | Owner | Safe data lifecycle |
| --- | --- | --- | --- | --- | --- |
| `parent_profile` | Dev and test every 15m | 120s process timeout | Environment-owned API, PostgreSQL, Redis-backed sessions, exact environment-owned admin and parent credentials, Playwright | `tools/monitor-parent-profile-workflow.mjs` | UUID-scoped invitation and profile workflow; manual no-email invitation; delete synthetic rows and verify cleanup; no live writes |
| `engagement` | Dev and test every 60s | 25s total; each auth/API request 10s | Environment-owned PostgreSQL, admin engagement API/session, exact `cmmark001` parent session/dashboard, monitor and worker textfiles | `tools/monitor-engagement-workflows.mjs` | Read-only DB aggregates and authenticated GET checks; create no engagement events, reports, notifications, or synthetic accounts |
| `student_library` | Dev and test every 5m | 270s systemd service timeout | Environment-owned API/DB, Redis sessions, student/admin credentials, CMUdict, configured Merriam-Webster providers | `tools/monitor-library-workflow.mjs` | UUID-scoped synthetic save/review/result data; deterministic repeatable cleanup with absence checks; never dispatch notifications |
| `student_news` | Dev and test every 5m | 90s systemd service timeout; each API request 20s | Environment-owned API/DB, exact student/admin sessions, LanguageTool, CMUdict, configured Merriam-Webster provider | `tools/monitor-news-workflow.mjs` | Synthetic draft, Check, and submission; deterministic cleanup verifies no report or queued notification remains; no external message delivery |
| `dictionary_builder` | Dev and test with each environment's 5m Library timer | 270s enclosing service; dictionary preview request 240s | Environment-owned admin API/session, database, local Dictionary Builder path, configured provider keys and services | Library monitor's independent Dictionary Builder check | Fixed `monitor` preview only; do not apply provider output or persist entries; inspect provider output in memory only |
| `assignment_notifications` | Dev aggregate monitor every 60s and assignment dispatcher every 5m; engagement monitor every 60s and async worker poll every 15s in both dev and test | Dev and test engagement service 25s; worker is long-running and polls on its 15s interval | Owned database, assignment/notification queues, side-effects worker, notification provider state | Engagement monitor, assignment-reminder service, and environment-owned side-effects worker | Monitoring is read-only; never enqueue synthetic deliveries; synthetic workflow tests must use disabled delivery or a non-deliverable test transport and prove no real send occurred |
| `grade_feeds` | Dev and test every 5m | 60s systemd service timeout; each authenticated API check 10s | Environment-owned PostgreSQL, admin cookie session, grade/feed tables and incoming-review queue | `tools/monitor-grade-feeds.mjs` | Read-only counts, ages, and authenticated table availability; no grade, submission, or incoming-queue writes |
| `attendance` | Dev and test every 5m with the grade-feed monitor | 60s systemd service timeout; each authenticated API check 10s | Environment-owned PostgreSQL, admin cookie session, valid stored SIS school setup, attendance dashboard summary and write metrics | Attendance group in `tools/monitor-grade-feeds.mjs` plus authenticated route metrics | Read-only setup and dashboard checks; write-path metrics are observational; do not create or remove attendance records in the recurring check |
| `parent_reports` | Dev and test every 60s through the engagement monitor | Dev and test service 25s; each auth/API request 10s | Owned PostgreSQL, admin engagement API/session, exact parent account and dashboard, acknowledgment route metrics | Engagement monitor plus parent-report acknowledgment request metrics | Recurring check is read-only; browser acknowledgment regression uses isolated response data and no real email; no synthetic report/acknowledgment database writes in the monitor |
| `student_profile_enrollment` | Dev and test every 60s through the engagement monitor | Dev and test service 25s; each auth/API request 10s | Owned PostgreSQL, authenticated admin API, exact parent dashboard, enrollment history, Moodle outbox, worker heartbeat | Engagement monitor plus authenticated student-write metrics | Monitor is read-only; separately authorized dev/test synthetic create/update/enroll probes must use API cleanup, verify student/family absence, suppress email and Moodle calls, and never run live |

Dev and test schedule all ten logical groups: engagement, assignment_notifications, parent_reports, and student_profile_enrollment every 60 seconds; parent_profile every 15 minutes; and student_library, dictionary_builder, student_news, grade_feeds, and attendance every 5 minutes. The test-owned monitors use only `.env.test` / `NODE_ENV=test`, verify `current_database() = sis-test`, and publish separate `environment=dev` or `environment=test` metrics. Synthetic test workflows use UUID-scoped records, verified cleanup, and no email delivery. The read-only test engagement monitor runs every 60 seconds; its engagement, assignment_notifications, parent_reports, and student_profile_enrollment groups each publish independent result and freshness metrics. The test-owned nightly suite runs every registered `test/*.spec.mjs` file, including applicable authenticated browser flows, and verifies database identity before it starts; it does not run migrations. The first complete run on 2026-11-21 passed all 165 registered files in 1,011.6 seconds. The four test timers each completed successfully against `sis-test`, and Prometheus reported all ten test groups fresh and passing. Three authenticated specs that had previously skipped in test are now enabled for the exact `.env.test` / `NODE_ENV=test` pair: Student Library edit/submit, Student News → New Words → Library, and Student News review/revision/retry/resubmission. Each passed 1/1 against `sis-test`, and a subsequent full nightly run passed all 165 registered files in 1,186.9 seconds with the test-wide no-send proof verified. The runner removes configured SMTP/Brevo credentials from every test-suite child process and pins SMTP and Brevo send endpoints to an unbound loopback port while preserving ordinary web access for browser checks. It compares test email-job, notification-queue, and provider-delivery aggregates before and after the full run; the no-send proof is `1` only when those values are unchanged. The test API and worker remain separate processes; the full suite's authenticated browser cases are audited to avoid message-dispatch actions. At 20:34 ICT on 2026-11-21, the first scheduled dev News, Library/Dictionary Builder, grade-feed, and attendance monitor executions raced the dev restart before the API was ready and reported bounded failures. All five groups passed on their 20:39 scheduled retry, and their Prometheus alerts cleared after scrape convergence (KA-186); this confirms that restart-recovery path only. The dev-owned `sis-db-health-dev.timer` refreshes the maintenance snapshot every 15 minutes using `.env.dev`, requires `current_database() = sis_dev`, and atomically writes the database snapshot plus fixed `environment="dev"` metrics. Failed queries emit bounded failure categories, a failure gauge, and a nonzero service result; a missing or stale dev snapshot alerts after 30 minutes. The dev health service reads `/home/eagles/dockerz/backups/postgres-dev/latest.json`, isolated from the live backup registry. On 2026-11-21, a one-shot backup of verified `sis_dev` was created and verified with `pg_restore --list` and SHA-256; the backup directory is mode `0700` and its files are mode `0600`. No second nightly backup timer is enabled: the single installed `sis-db-backup.timer` still reads the live/admin `.env`. The dev health check reports freshness from the isolated metadata and will warn when that backup exceeds the configured 26-hour limit; `DevDatabaseBackupStale` alerts after the stale gauge remains set for one minute. A recurring dev backup needs to be integrated into the existing single nightly scheduler without changing the live/admin backup contract. The live/admin `sis-db-health.timer` is unchanged. All production checks remain out of scope and read-only.

The nightly runner is `tools/run-keepalive-nightly-smoke.mjs`, scheduled by the system-level `sis-keepalive-nightly-smoke-test.timer` at 04:00 host time. Install and enable its test-only system service and persistent timer with `sudo tools/install-keepalive-nightly-smoke-test-timer.sh`; the installer disables the duplicate user timer before enabling the system timer. The service runs as the repository owner, puts its pinned Node 22.22.1 binary directory first in `PATH` so helper processes use the same runtime as `ExecStart`, is capped at five hours, and uses a lower CPU/I/O priority. Before running the suite, the runner reads only `.env.test` and fails closed unless the exact `mark001` student and `cmmark001` parent credentials, admin credentials, and executable Chromium are present; missing prerequisites publish bounded `configuration_invalid` metrics instead of allowing authenticated browser specs to silently skip. The runner removes configured SMTP/Brevo credentials from the full-suite child environment, pins SMTP and Brevo send endpoints to an unbound loopback port, and preserves ordinary outbound access used by authenticated browser and provider-availability checks. Before and after the full suite it verifies the database identity and compares message-job, notification-queue, and provider-delivery aggregates; any change fails the run. Prometheus alerts on suite failure, unverified message isolation, and when no result has been published for 26 hours. The standard all-file test runner uses per-file timeouts and the same exact `.env.test` tuple; it does not run migrations. The latest complete authenticated run on 2026-11-21 passed all 165 specs in 1,245.4 seconds; its bounded result was `success=1`, `no_external_message_proof=1`, `failure_code=none` (KA-185).

## Controlled test-mirror service restarts

`ops/systemd/keepalive-test-restart-guard.conf` defines the bounded systemd policy for the exact test-mirror API, static server, and async worker units: restart only on process failure, wait 30 seconds between attempts, and allow at most four executed starts (the initial start plus three automatic restarts) in a rolling 15-minute interval. After the limit, systemd leaves the unit failed and `StartLimitAction=none` prevents a host reboot or other system-wide action. On this host, the rejected next attempt was recorded in the journal as `Start request repeated too quickly`; `systemctl show` still reported `Result=exit-code` from the last executed process failure. Check both the unit properties and journal rather than expecting one `Result` value. Install and verify the test-only drop-ins with `sudo tools/install-test-restart-guards.sh`. The installer checks each unit's runtime path and test-owned `.env.test` before writing and records any replaced drop-in under `/home/eagles/dockerz/backups/manual-edits/`.

Automatic recovery starts only the installed service executable and its port-collision preflight. The test static server calls its repository-pinned `serve` binary directly; it does not invoke `npx` or a package manager during restart. The installer backs up and removes the legacy `exercise-mailer-test.service.d/10-boot-prep.conf`, which previously ran code synchronization, package installation, Prisma generation, and database migrations before every systemd start or retry. It verifies the effective `ExecStartPre` and `ExecStart` for all three allowlisted test units contain no sync, package-manager, or migration command. Runtime self-heal telemetry also uses read-only source/runtime comparison: a mismatch is reported in health status, while file repair and deployment remain operator-controlled. Full test synchronization and Prisma operations remain explicit deployment actions; they are not recovery actions.

The dev API runs as the user service `sis-dev-api.service`, installed from `ops/systemd/user/sis-dev-api.service` by `npm run dev:install-restart-guard`. Its bounded policy restarts only process failures, waits 30 seconds, and allows at most four starts (initial start plus three automatic restarts) in 15 minutes; at the limit it remains failed without host-level action. This dev unit is separate from the live/admin system service `exercise-mailer.service` and the test system service `exercise-mailer-test.service`. Automatic dev API starts run only the Node service entrypoint: they do not rebuild assets, run Prisma, migrate, sync code, restart the async worker, or dispatch recovery actions. The dev async worker remains outside this API restart policy because starting it can process side-effect jobs. Routine `npm run dev:restart` remains operator initiated; it rebuilds assets, performs dev-owned Prisma generation/migration checks, then starts the guarded API and the existing allowlisted worker. The restart script refuses ports other than `8788` and verifies a legacy listener belongs to the dev workspace before stopping it. The system-level test-only drop-ins do not modify either dev or live/admin units.

AI-assisted incident response is advisory. It may analyze authorized health results, aggregate metrics, sanitized logs, source, and tests and propose a repair; it does not receive alert-triggered authority to write student data, replay jobs, send messages, repair config, restore backups, restart services, deploy code, or migrate a database. The active request or standing operating procedure must authorize any exact operation and environment. SIS has no AI-connected recovery executor in `server/`, `src/`, `tools/`, or `ops/`; the fixed test restart policy remains independent of AI. Follow the full evidence and authorization boundary in `AGENTS.md` and `docs/sop.md`.

Prometheus raises `TestServiceRestartFailed` when one of the three guarded test units stays in systemd's `failed` state for 30 seconds while node-exporter is available. The node-exporter metric does not identify the precise systemd `Result`; inspect `systemctl show <unit> -p Result -p NRestarts` and the unit journal together. In the controlled test, the journal recorded `Start request repeated too quickly` while `Result` remained `exit-code`. `DevEngagementSideEffectFailures` and `TestEngagementSideEffectFailures` alert when their environment-owned engagement monitor reports terminal async side-effect jobs in the previous 24 hours. Test engagement checks run every 60 seconds; `TestEngagementMonitorStale` separately warns when that result is older than three minutes, and a fresh result resolves the stale alert until the next run becomes due. The dev and test signals use aggregate counts and contain no job IDs or payloads. Alerts are routed through the configured Alertmanager channel.

The retry and restart alert rules have deterministic Prometheus rule tests in `ops/monitoring/alerts.test.yml`. Validate both syntax and firing behavior with the same pinned Prometheus tool image used by the monitoring stack:

```bash
docker run --rm --network none --entrypoint=/bin/promtool \
  -v "$PWD/ops/monitoring:/monitoring:ro" \
  prom/prometheus:v3.5.0 check rules /monitoring/alerts.yml
docker run --rm --network none --entrypoint=/bin/promtool \
  -v "$PWD/ops/monitoring:/monitoring:ro" \
  prom/prometheus:v3.5.0 test rules /monitoring/alerts.test.yml
```

## Parent profile workflow monitor

Run the dev functional monitor with:

```bash
npm run monitor:parent-profile:dev
```

It uses the explicit `.env.dev` / `development` environment and pins the browser flow to `http://127.0.0.1:8788`. The check performs the authenticated synthetic invitation, draft save/reload/resave, submission, review, and approval workflow. It uses a manual no-email invitation and UUID-scoped synthetic records. The E2E cleanup removes and verifies the student/profile, invitation, parent account, links, locks, submissions, and any side-effect job keyed by those invitation IDs, including after a mid-flow assertion failure. The monitor treats a skipped E2E test as a failed check and has a 120-second process timeout.

The result is atomically written to `runtime-data/prometheus/parent-profile-workflow-dev.prom` or `parent-profile-workflow-test.prom`, which the node-exporter textfile collector scrapes. The fixed environment label has no student, parent, account, route-parameter, or credential values. The metrics report the latest result, duration, check time, and last successful check time. Prometheus displays `DevParentProfileWorkflowCheckFailed` when the latest result stays failed for 30 seconds.

This command is a one-shot functional check; this item does not install a timer. Scheduling, stale-result handling, interrupted-run cleanup, retries, and controlled restarts are addressed by the separate monitoring-worker checklist items. Firing and resolved notifications route through Alertmanager to `#sis-alert`.

## Engagement workflow monitor (dev and test)

Run the read-only engagement monitor with:

```bash
npm run monitor:engagement:dev
npm run monitor:engagement:test
```

The monitor accepts only the explicit `.env.dev` / `development` pair for `sis_dev` at `127.0.0.1:8788`, or `.env.test` / `test` for `sis-test` at `127.0.0.1:8786`. It checks the authenticated `/api/admin/performance-engagement` response using that environment's configured admin account and uses only the exact configured `cmmark001` parent account for the cookie-session dashboard check. Missing exact-account credentials fail closed; it does not substitute another parent. It reads the latest parent-report engagement event, Brevo webhook receipt/processing state, failed and stale async jobs, and queued-job count. It records due notification queue count and age (queued items with at least one recipient whose scheduled time is due), delivery-error queue count and age, parent-report notification count/age/errors, available announcement-job count and age, and pending/failed assignment-reminder dispatches. It also checks enrollment period overlaps and multiple active periods, plus due, processing, and rejected Moodle provisioning commands. The dev runtime deliberately starts its side-effects worker with the `parent-profile-invitation` job-type allowlist, so announcement queue age is reported as backlog and does not imply that this worker is configured to deliver announcements. Metrics use fixed `environment="dev"` or `environment="test"` labels and are written atomically to their corresponding textfiles under `runtime-data/prometheus`. Worker logs use fixed event categories and aggregate poll counts; they do not emit event payloads, recipient values, student fields, credentials, cookies, raw error messages, filenames, or job identifiers.

The live/admin API uses the tracked `ops/systemd/exercise-mailer-live-request-metrics.conf` drop-in to set `.env` / `production` and write its existing authenticated request-stage metrics to `/home/eagles/dockerz/sis/runtime-data/prometheus/sis-live-request-metrics.prom`; the installed drop-in is `/etc/systemd/system/exercise-mailer.service.d/20-sis-live-request-metrics.conf`. Its textfile is scraped by node-exporter. The test API `.env.test` sets `SIS_REQUEST_METRICS_FILE` to the test request-counter textfile in the same collector directory. The test async worker uses the matching `.env.test` / `test` triplet and writes its heartbeat to `async-side-effects-worker-test.prom`. The collector reads live and test route counters, worker heartbeats, one-shot monitor outputs, and dev metrics.

Authenticated parent report acknowledgments are measured by `sis_parent_report_acknowledgment_requests_total` and `sis_parent_report_acknowledgment_request_duration_seconds`, with only the fixed route template, environment, and HTTP status labels. The counter captures authenticated success and failure results without report IDs. `DevParentReportAcknowledgmentServerFailure` alerts on authenticated dev 5xx responses; 4xx results remain visible in the status counter but expected report-scope denials do not page. The read-only engagement monitor separately measures exact-parent authentication, linked children, visible reports, login/dashboard latency, notification backlog, and delivery errors. Existing stale queue alerts remain actionable when that monitor reports backlog.

The same read-only monitor counts duplicate open active enrollment periods by student and school year (`status='active' AND endedAt IS NULL`) and overlapping interval pairs only when both periods belong to the same student and school year. Closed historical active periods are not treated as current conflicts, and overlaps across school years are excluded. It also measures the count and age of due pending/retry and processing Moodle provisioning commands plus rejected commands. It fails when enrollment conflicts or rejected provisioning commands exist, due work is older than 30 minutes, or processing work is older than five minutes. Authenticated profile and enrollment writes use the route-template counters in `runtime-data/prometheus/sis-dev-request-metrics.prom`; the enrollment route is recorded only after the shared admin session/role gate succeeds. Node-exporter scrapes both files from the textfile collector directory. Prometheus alerts cover failed profile/enrollment writes, enrollment integrity conflicts, stale or rejected Moodle provisioning commands. These checks expose aggregate counts only.

The dev and test async side-effects workers write separate atomic heartbeats after every completed poll, including poll success. Their logs contain only fixed failure categories and aggregate poll counts; raw provider/worker errors, job identifiers, and report filenames are excluded. Announcement queue and async-job error fields use a bounded category (`provider_timeout`, `provider_rate_limited`, `provider_unavailable`, `provider_rejected`, `operation_timeout`, or `operation_failed`) rather than provider response text. Prometheus rules cover dashboard availability, stale monitor results, unprocessed webhook age, failed jobs, stuck processing jobs, failed worker polls, stale worker heartbeat, announcement and notification queue age, enrollment integrity, profile/enrollment write errors, Moodle provisioning age/rejections, and notification delivery errors. The monitor fails its latest check when an authenticated dashboard is unavailable or any monitored queue, enrollment, or worker condition is stale or failed. Event timestamps and queue counts are available as gauges; idle periods with no new engagement event do not trigger an ingestion alarm. Firing and resolved alerts route through Alertmanager to `#sis-alert`. Enable the one-minute dev systemd timer with:

```bash
install -D -m 0644 ops/monitoring/systemd/sis-engagement-monitor-dev.service "$HOME/.config/systemd/user/sis-engagement-monitor-dev.service"
install -D -m 0644 ops/monitoring/systemd/sis-engagement-monitor-dev.timer "$HOME/.config/systemd/user/sis-engagement-monitor-dev.timer"
systemctl --user daemon-reload
systemctl --user enable --now sis-engagement-monitor-dev.timer
```

### Async side-effect retry and stale-lock policy

Automatic retries are limited to `report-card-pdf`, a generation operation with no external delivery; when an output path is configured, each attempt rewrites that same path from the persisted job input. The worker makes at most three total attempts with a 30-second delay between retryable failures. The attempt limit is clamped to ten even when a caller supplies a larger value. A stale PDF lock is reclaimed only while attempts remain below that limit.

`announcement-email` and `parent-profile-invitation` are not automatically retried after a failure or stale lock. SMTP provides no durable idempotency contract, and Brevo's idempotency window is time-limited; a worker can also lose its database acknowledgment after a provider accepted a message. These cases are terminally recorded as failed with a bounded failure code for operator review. Do not interpret a failed email job as proof that no message was delivered. A deliberate operator resend is a new delivery decision.

Unknown job types and exhausted PDF jobs are terminally failed on stale recovery. Completion-callback failures are counted separately from job failures and do not change a succeeded job back to queued; they mark the worker poll unhealthy and emit only an aggregate `callback_failed` count.

The `test/async-side-effect-jobs.spec.mjs` memory contracts cover email no-retry, bounded PDF retries, stale recovery policy, and post-completion callback failure. `test/async-side-effect-stale-recovery.db.spec.mjs` verifies the same stale-lock policy against the isolated test database and cleans every synthetic row.

## Student Library workflow monitor (dev)

Run the authenticated synthetic Library check with:

```bash
npm run monitor:library:dev
```

The monitor is pinned to `.env.dev` / `development` and `http://127.0.0.1:8788`. It checks the SIS health endpoint, the `sis_dev` database, session Redis, the local CMU pronunciation dictionary, authenticated student and admin Library access, a student submission, admin approval, and the student's canonical result. Its `finally` cleanup removes the exact UUID-scoped contribution, revisions, and monitor-created canonical entry, then verifies both contribution and entry absence, even when a request fails after the server has accepted review. Merriam-Webster key presence is reported as configuration gauges; provider keys and provider responses are never emitted. It uses the exact configured `mark001` student account and configured dev admin account without printing either credential.

The submission uses a random lowercase word and source ID. Cleanup removes only the matching contribution and its revisions, then removes its canonical entry only when that contribution was found and the entry's creator matches the configured admin. The check fails if cleanup cannot be verified. Open-review count and oldest pending/legacy review age are measured before the synthetic submission.

The monitor atomically writes fixed `environment="dev"` gauges to `runtime-data/prometheus/library-workflow-dev.prom`. It records access checks, submission/review checks, exact synthetic definition persistence, Dictionary Builder preview status, aggregate count of providers returning a definition, queue count and age, API/database/Redis/CMUdict availability, optional Merriam-Webster key configuration, cleanup status, and last success time. The Builder check uses the fixed probe word `monitor`; provider output is inspected only in memory to count definition availability and is never written to metrics or output. The synthetic definition is compared in memory with the canonical database readback; its text is never written to metrics or output. No account, entry, contribution, source, request, cookie, credential, provider name, provider response, or definition value is a metric label or monitor-output field. Prometheus evaluates alerts for missing monitor reports, access/save/review/definition failures, Builder provider unavailability, queue age over 24 hours, required dependency failures, and cleanup failures. The authenticated Builder preview can take up to four minutes; the systemd service timeout is 270 seconds, and its five-minute timer does not start an overlapping service run. Firing and resolved notifications route through Alertmanager to `#sis-alert`.

To schedule the check every five minutes for the current user:

```bash
install -D -m 0644 ops/monitoring/systemd/sis-library-monitor-dev.service "$HOME/.config/systemd/user/sis-library-monitor-dev.service"
install -D -m 0644 ops/monitoring/systemd/sis-library-monitor-dev.timer "$HOME/.config/systemd/user/sis-library-monitor-dev.timer"
systemctl --user daemon-reload
systemctl --user enable --now sis-library-monitor-dev.timer
```

## Student News workflow monitor (dev)

Run the authenticated synthetic News check with:

```bash
npm run monitor:news:dev
```

The monitor is pinned to `.env.dev` / `development`, verifies `sis_dev`, and uses the exact configured `mark001` student and dev admin accounts. It authenticates to the local dev service, reads the admin News review queue, checks a synthetic report, submits it using the server-issued report ID, and deletes/verifies the synthetic row by its unique UUID-scoped source marker in `finally`, including when the server accepts submission but the monitor then receives a failure. No student identity, report content, provider response, account, session, credential, or report ID is written to metrics or monitor output.

The synthetic Check duration, Check HTTP status, Check result, whether LanguageTool was reached, LanguageTool result, and Merriam-Webster vocabulary availability are written as fixed `environment="dev"` gauges to `runtime-data/prometheus/news-workflow-dev.prom`. The report date comes from the SIS submission-window resolver, including its two-hour ICT grace period after midnight. A rejected Check therefore cannot send a calendar-date report after midnight and be mistaken for a provider failure. `DevNewsProviderUnavailable` alerts for LanguageTool only when a sentence check was performed; dictionary unavailability remains independently alertable. The monitor also records synthetic submission success/failure and HTTP status, cleanup status, open submitted review count, oldest submitted review age, database/API availability, and last-success time. Prometheus alerts on stale monitor output, Check or submission failure, provider unavailability, cleanup failure, and a review older than 24 hours. Firing and resolved notifications route through Alertmanager to `#sis-alert`.

Schedule it every five minutes for the current user:

```bash
install -D -m 0644 ops/monitoring/systemd/sis-news-monitor-dev.service "$HOME/.config/systemd/user/sis-news-monitor-dev.service"
install -D -m 0644 ops/monitoring/systemd/sis-news-monitor-dev.timer "$HOME/.config/systemd/user/sis-news-monitor-dev.timer"
systemctl --user daemon-reload
systemctl --user enable --now sis-news-monitor-dev.timer
```

The monitor is a one-shot synthetic workflow; `sis-news-monitor-dev.timer` schedules recurring runs. Metrics contain only aggregate results and fixed environment labels.

## Grade and exercise-feed monitor (dev)

Run the read-only monitor with:

```bash
npm run monitor:grades:dev
```

The monitor is pinned to `.env.dev` / `development` and requires `current_database() = sis_dev`. It checks the authenticated admin student-table API, aggregates Moodle and Google Forms exercise/grade timestamps, and records incoming exercise rows by matched/queued/temporary/failed state plus the oldest unmatched age. Feed and grade ages are exported as observations; no stale-feed threshold is applied because submissions are event-driven and may be idle.

The request wrapper records response counts for admin grade create/delete routes after the session and role gate, Moodle exercise submissions after valid HMAC verification, and Google Forms grade submissions after valid HMAC verification. Status labels and route labels are fixed templates; request bodies, student identifiers, names, emails, signatures, nonces, cookies, and provider payloads are never written to metrics. Unauthorized requests are excluded. The dev runtime writes these counters to `runtime-data/prometheus/sis-dev-request-metrics.prom`.

The monitor writes atomic aggregate gauges to `runtime-data/prometheus/grade-feeds-dev.prom`, scraped by the existing node-exporter textfile collector. It does not change student, grade, or feed records. Prometheus alerts on a missing monitor result, failed database or authenticated table checks, missing request instrumentation, an unmatched incoming backlog, and recorded non-2xx authorized grade/feed writes. Feed-age gauges are available for investigation without treating an idle source as a failure. Firing and resolved alerts route through Alertmanager to `#sis-alert`.

The same five-minute dev monitor checks `/api/admin/settings/ui` for a valid school setup and `/api/admin/dashboard` for a well-formed `attendanceRiskWeek` summary using an authenticated admin cookie. It inspects only setup status and summary shape; student names, identifiers, and report data remain in memory and are not written to metrics or monitor output. The textfile exports `sis_attendance_school_setup_valid{environment="dev"}` and `sis_attendance_reporting_available{environment="dev"}`. Prometheus alerts when either check fails.

Authenticated admin attendance `POST` and `DELETE` requests are recorded in `sis_admin_student_write_requests_total` with fixed route templates and HTTP status codes. The wrapper marks a request only after the cookie session and admin write-role gate pass; unauthorized and teacher-denied requests are excluded. A non-2xx attendance response fires `DevAttendanceSaveFailure`. Student IDs, attendance dates, comments, cookies, and request bodies are never metric labels or log fields.

Install the recurring five-minute user timer for dev:

```bash
install -D -m 0644 ops/monitoring/systemd/sis-grade-feed-monitor-dev.service "$HOME/.config/systemd/user/sis-grade-feed-monitor-dev.service"
install -D -m 0644 ops/monitoring/systemd/sis-grade-feed-monitor-dev.timer "$HOME/.config/systemd/user/sis-grade-feed-monitor-dev.timer"
systemctl --user daemon-reload
systemctl --user enable --now sis-grade-feed-monitor-dev.timer
```

Inspect the latest run with:

```bash
systemctl --user status sis-grade-feed-monitor-dev.timer sis-grade-feed-monitor-dev.service
journalctl --user -u sis-grade-feed-monitor-dev.service -n 30 --no-pager
```

## Approved telemetry additions

The following additions are approved for the test mirror. They are deliberately limited to the student-write incident path and safe operational metadata. They must not expose student data, credentials, session data, request bodies, SQL text, or query parameters.

### 1. Authenticated student create/update timing

Scope:

- `POST /api/admin/students`
- `PUT /api/admin/students/:id`
- only after the real cookie-session authentication and role gate have passed.

The route template, rather than a concrete URL, is the only route label. Each completed authenticated request records its response status and total duration. The safe timing phases are:

| Phase | Meaning |
| --- | --- |
| `profile_backup_pre` | Pre-save profile snapshot write |
| `database_transaction` | Prisma transaction containing the write |
| `filter_cache_invalidation` | Student filter/cache invalidation |
| `roster_reload` | Post-save roster readback |
| `profile_backup_post` | Post-save profile snapshot write |

The Prometheus textfile metrics are written atomically to the configured `SIS_REQUEST_METRICS_FILE` path and collected by node-exporter's textfile collector. The metric family is:

```text
sis_admin_student_write_requests_total{route,status}
sis_admin_student_write_request_duration_seconds_sum{route,status}
sis_admin_student_write_request_duration_seconds_count{route,status}
sis_admin_student_write_phase_duration_seconds_sum{route,phase}
sis_admin_student_write_phase_duration_seconds_count{route,phase}
sis_nodejs_heap_used_bytes
sis_nodejs_rss_bytes
```

Useful query for the five-minute mean route duration:

```promql
rate(sis_admin_student_write_request_duration_seconds_sum[5m])
/
rate(sis_admin_student_write_request_duration_seconds_count[5m])
```

Useful query for a phase mean:

```promql
rate(sis_admin_student_write_phase_duration_seconds_sum{phase="database_transaction"}[5m])
/
rate(sis_admin_student_write_phase_duration_seconds_count{phase="database_transaction"}[5m])
```

### 2. PostgreSQL exporter and monitoring role

`postgres_exporter` will expose PostgreSQL server statistics on loopback port `9187`, scraped by Prometheus every five seconds. It connects through the monitoring Docker network to `sis-postgres`; it does not need a public database port.

The dedicated `sis_monitor` role must be login-capable, non-superuser, non-creatorole, non-createdb, non-replication, and have no table write grants. It receives only `pg_monitor` plus explicit database `CONNECT` grants. Its password belongs only in the ignored monitoring exporter environment file.

Covered signals include:

- connection counts and database session states;
- lock count and lock waits;
- transaction commit/rollback rate;
- cache hit rate from database block hits versus reads;
- deadlocks, temporary-file activity, and database size;
- long-running transactions, idle transactions, and autovacuum activity;
- table and index I/O statistics.

Slow activity is represented by duration and wait-state metadata only. Do not export raw SQL, bind values, user names, or student-related query text into Prometheus labels.

### 3. Redis exporter

`redis_exporter` will expose Redis runtime statistics on loopback port `9121`, scraped every five seconds through the monitoring Docker network. It must use a dedicated Redis ACL user with read-only monitoring commands where Redis ACL persistence is available; otherwise this dependency must be documented before relying on the account after a Redis restart.

The exporter covers:

- session/cache Redis availability and connected/blocked clients;
- used memory, peak memory, fragmentation, and memory pressure;
- evicted and expired keys;
- command totals, command rates, and rejected connections;
- keyspace counts and cache database activity;
- slowlog and latency counters when the Redis configuration permits those read-only commands.

It must not scan keys, export key values, or add key names, client addresses, or session identifiers as metric labels.

### 4. Alertmanager and Slack routing

The active receiver is the approved dedicated Slack channel `#sis-alert`, using an Incoming Webhook. The raw webhook URL is stored only in ignored `ops/monitoring/.env.alertmanager-slack-webhook` with mode `0600`; Alertmanager runs as the owning host UID/GID and reads that file at `/run/secrets/slack_webhook_url` through a read-only mount. Never add the webhook URL to Git, a dashboard, a command history, or this documentation. Alertmanager's web endpoint is bound to `127.0.0.1:9093`; Prometheus sends firing and resolved alerts to `alertmanager:9093` on the private Compose network.

Routing policy:

| Severity | Route | Grouping | Repeat |
| --- | --- | --- | --- |
| `critical` | `#sis-alert` | alert name, instance, job | 30 minutes while firing |
| `warning` | `#sis-alert` | alert name, instance, job | 4 hours while firing |

Use a 30-second group wait and five-minute group interval so one incident is grouped without hiding distinct alerts. Resolved notifications are enabled. Warning notifications repeat every four hours while firing; critical notifications repeat every 30 minutes. Prometheus scrapes Alertmanager's notification success/failure metrics from its private Compose target. Verify receiver health through Prometheus `/api/v1/alertmanagers` and the `alertmanager_notifications_total` / `alertmanager_notifications_failed_total` metrics without printing the webhook URL.

### 5. Structured SIS request timing logs

For each completed authenticated student create/update request, SIS emits one JSON log event named `sis_student_write_timing`. Its permitted fields are:

```json
{
  "event": "sis_student_write_timing",
  "requestId": "generated request UUID",
  "route": "POST /api/admin/students",
  "status": 200,
  "durationMs": 0,
  "phases": [{ "phase": "database_transaction", "durationMs": 0 }]
}
```

`requestId` is generated per request and is used solely to correlate the local SIS service log with the incident timestamp. The log must contain no request body, student ID, name, email, cookie, session ID, authenticated username, SQL statement, query parameter, or stack trace with user data. Observability failures are isolated so they do not alter normal request handling.

### 6. Student News Check authentication rejection causes

Dev and test runtimes record a counter only for `POST /api/student/news-reports/check` when authentication returns 401. The metric has fixed `environment` and `reason` labels; the metric family name identifies the route:

```text
sis_student_news_check_auth_rejections_total{environment,reason}
```

The only reasons are `missing_cookie` and `session_not_found`. Required Redis-store failures return 503 and are not recorded as either 401 cause. In `auto` mode, if Redis becomes unavailable after issuing a Redis-backed session, `touchSession` returns 503 when that ID is absent from the in-memory fallback; it must not turn an unavailable Redis lookup into a false 401 or clear the student's cookie. Sessions created in the memory fallback remain usable there. The metric never stores a cookie, session ID, student/account identity, request body, URL, or query parameter. It does not change session lifetime. This metric is not enabled for production/live.

For a `session_not_found` response on News Check, the first Check 401 preserves the browser cookie so the client can call `/api/student/auth/me` with the same session identifier. A successful confirmation permits one bounded Check retry. If `/auth/me` also returns 401, that endpoint expires the cookie and the client returns to sign-in; Redis availability errors remain 503 and do not sign the student out. A missing-cookie Check remains unauthorized and cannot be retried as an authenticated request.

Useful query for the latest five-minute rate by safe cause:

```promql
sum by (environment, reason) (rate(sis_student_news_check_auth_rejections_total[5m]))
```

## Resource and security considerations

The monitoring stack consumes additional resources. In the initial installation, Grafana used roughly 190 MB, Prometheus roughly 100–130 MB, cAdvisor roughly 65–85 MB, and node-exporter roughly 18 MB. cAdvisor can briefly use noticeable CPU while collecting metrics.

Recommended safeguards:

- keep all monitoring ports bound to `127.0.0.1`;
- use SSH tunneling or an authenticated reverse proxy;
- retain the configured seven-day metric window;
- do not expose Grafana anonymously;
- do not commit monitoring credentials;
- use least-privilege exporter database accounts;
- avoid high-cardinality labels;
- do not label metrics with student identity or session data;
- monitor disk usage because Prometheus retention is disk-backed;
- back up Grafana dashboards and provisioning files, not secret environment files.

## Operational commands

### Dashboard map

- **SIS Operations**: student-save throughput, measured mean latency by stage, RSS, and the test-mirror public probe. Stage latency is absent until an authenticated write has been observed; it is not estimated from a nonexistent histogram.
- **SIS Live/Admin Mirror · Operations** and **SIS Test Mirror · Operations**: identical environment pages with database/Redis probe latency, workflow-monitor results, provider and grade-feed aggregates, process RSS, and public/media probes.
- **Ubuntu Host Overview**: CPU, memory, swap, root filesystem, disk/network pressure, and required systemd services.
- **Availability and Edge**: blackbox availability and HTTP phases; OpenLiteSpeed/CyberPanel state and LiteSpeed traffic when its exporter is enabled.
- **On-demand Diagnostics: Processes and Redis**: use for a short investigation window, especially browser, VS Code, Redis, or Node CPU/RSS contention.

The on-demand exporters have no Prometheus target while disabled, so they do not create a misleading down target or continuous collection overhead. Enable one only for an investigation:

```bash
tools/monitoring-diagnostics.sh process on
tools/monitoring-diagnostics.sh redis on
tools/monitoring-diagnostics.sh litespeed on
```

Disable it when finished:

```bash
tools/monitoring-diagnostics.sh process off
tools/monitoring-diagnostics.sh redis off
tools/monitoring-diagnostics.sh litespeed off
```

`litespeed on` requires the official LiteSpeed Prometheus Exporter already listening privately on `127.0.0.1:9936`; the helper fails closed when it is absent. The Redis exporter is also loopback-only and takes its address from `SIS_REDIS_EXPORTER_ADDR` if Redis is not on the default local address.

Restart only the monitoring stack:

```bash
docker compose --env-file ops/monitoring/.env \
  -f ops/monitoring/docker-compose.yml restart
```

View monitoring logs:

```bash
docker compose --env-file ops/monitoring/.env \
  -f ops/monitoring/docker-compose.yml logs --tail=200 -f
```

Stop the monitoring stack without deleting data:

```bash
docker compose --env-file ops/monitoring/.env \
  -f ops/monitoring/docker-compose.yml stop
```

Never use `docker compose down -v` during normal operations because it deletes the Prometheus and Grafana data volumes.

## Success criteria for the next incident reproduction

The investigation is complete only when the evidence identifies:

1. the authenticated browser request and exact timestamp;
2. the SIS route and response duration;
3. the dominant CPU consumer;
4. the dominant memory consumer;
5. PostgreSQL wait/lock/query state during the request;
6. whether Redis or another container was involved;
7. whether the behavior reproduces on the test mirror;
8. whether the synthetic test record was removed through the authenticated UI.
