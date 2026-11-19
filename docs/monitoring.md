# SIS Monitoring Operations

## Current pared profile

The always-on monitoring profile includes Prometheus, Alertmanager, node-exporter, and blackbox-exporter. Grafana remains available on loopback for on-demand investigation. cAdvisor, process-exporter, PostgreSQL exporter, and Redis exporter are not part of the active profile. Container-level inspection is performed with `docker stats --no-stream` during incidents.

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
├── blackbox-exporter ─── public test-mirror `/admin` availability and latency
├── Prometheus      ───── metric collection and 30-day local retention
├── Alertmanager    ───── grouped firing and resolved notifications to `#sis-alerts`
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

## Services and local endpoints

| Service | Local endpoint | Purpose |
| --- | ---: | --- |
| Grafana | `http://127.0.0.1:3030` | Dashboard UI |
| Prometheus | `http://127.0.0.1:9090` | Query and metric storage |
| Alertmanager | `http://127.0.0.1:9093` | Local notification and silence status |
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

All six monitoring targets should report `health: up`.

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

`SIS Test Mirror Health` adds:

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

### 2. Redis exporter — high priority

Add `redis_exporter` to observe:

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

### 5. Loki and Promtail — optional

Use Loki/Promtail if centralized searchable logs are needed. Keep sensitive request bodies, passwords, cookies, session IDs, and student PII out of log labels and log payloads.

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
| Parent invitation, draft, submission, approval, and profile update | `parent_profile` | `sis_parent_profile_workflow_*` | `tools/monitor-parent-profile-workflow.mjs`; one dev synthetic lifecycle, no email |
| Engagement events and reporting | `engagement` | `sis_engagement_*` | `tools/monitor-engagement-workflows.mjs`; dev/test read-only database and authenticated API checks |
| Student Library | `student_library` | `sis_library_*` excluding Dictionary Builder families | `tools/monitor-library-workflow.mjs`; dev synthetic save/review/result and cleanup |
| Student News, vocabulary, and grammar | `student_news` | `sis_news_*` | `tools/monitor-news-workflow.mjs`; dev synthetic Check/submission and cleanup |
| Admin definitions and Dictionary Builder | `dictionary_builder` | `sis_library_dictionary_builder_*` | Currently executed inside the Library monitor, with a distinct detail family; its outcome must remain independent of the student Library workflow result |
| Assignments and notifications | `assignment_notifications` | `sis_assignment_reminder_*`, `sis_notification_*`, `sis_parent_report_notification_*`, `sis_async_*` | Engagement monitor plus the async side-effects worker; queue and delivery states are measured separately, and worker health is not delivery success |
| Grades, external exercise feeds, and tables | `grade_feeds` | `sis_grade_feed_*` | `tools/monitor-grade-feeds.mjs`; dev authenticated read checks and aggregate feed state |
| Attendance | `attendance` | `sis_attendance_*` and fixed attendance route series in `sis_admin_student_write_*` | Grade/feed monitor plus authenticated write instrumentation; attendance result is independent of grade/feed result |
| Parent site, profiles, performance reports, and notifications | `parent_reports` | `sis_parent_authentication_*`, `sis_parent_report_*`, `sis_parent_report_acknowledgment_*` | Engagement monitor plus acknowledgment route metrics; authenticated parent/dashboard status is separate from acknowledgment-write status |
| Student profiles, enrollment, and provisioning | `student_profile_enrollment` | `sis_admin_student_write_*`, `sis_enrollment_*`, `sis_moodle_provisioning_*` | Engagement monitor plus authenticated write metrics; profile/enrollment status is separate from Moodle queue state |

The current monitors may share a process, but the fixed group IDs and owned detail families above retain separate results and freshness series.

Group status is exported as `sis_keepalive_check_success`, `sis_keepalive_check_last_check_timestamp_seconds`, `sis_keepalive_check_last_success_timestamp_seconds`, `sis_keepalive_check_duration_seconds`, `sis_keepalive_check_stale_after_seconds`, and `sis_keepalive_check_failure_info`. Each check computes its own result; shared-process duration records the enclosing run duration. Failed runs preserve that group's last successful timestamp. Failure information uses only `none`, `workflow_failed`, `dependency_unavailable`, `cleanup_failed`, or `configuration_invalid`; raw exception text and account or student data are never label values. The dev alerts report a failed group and compare each last-check timestamp with its configured stale limit. A zero stale limit marks an on-demand group and disables scheduled-staleness alerting. Test metrics use `environment="test"` and zero stale limits until test-owned schedules are installed.

### Group environment and execution policy

The rows below define the target policy for each logical group. `dev` means `.env.dev` / `NODE_ENV=development` / `sis_dev`; `test` means `.env.test` / `NODE_ENV=test` / `sis-test`. Every database-backed run must verify its database identity. No new live/admin check is authorized here; any future live check is read-only unless an explicitly isolated synthetic flow is approved. A test cadence or timeout marked as a target is not active until its test-owned runner or service enforces it.

| Group | Environment and cadence | Maximum run time | Dependencies | Owner | Safe data lifecycle |
| --- | --- | --- | --- | --- | --- |
| `parent_profile` | Dev, on demand; no recurring timer is installed | 120s process timeout | Dev API, PostgreSQL, Redis-backed sessions, exact dev admin and parent credentials, Playwright | `tools/monitor-parent-profile-workflow.mjs` | UUID-scoped invitation and profile workflow; manual no-email invitation; delete synthetic rows and verify cleanup; no live/test writes |
| `engagement` | Dev every 60s; test on demand until a test timer is implemented | Dev service 25s; test target 25s total, each auth/API request 10s | Environment-owned PostgreSQL, admin engagement API/session, exact `cmmark001` parent session/dashboard, monitor and worker textfiles | `tools/monitor-engagement-workflows.mjs` | Read-only DB aggregates and authenticated GET checks; create no engagement events, reports, notifications, or synthetic accounts |
| `student_library` | Dev every 5m; test on demand only after a test-owned runner exists | 270s systemd service timeout | Dev API/DB, Redis sessions, student/admin credentials, CMUdict, configured Merriam-Webster providers | `tools/monitor-library-workflow.mjs` | UUID-scoped synthetic save/review/result data; deterministic repeatable cleanup with absence checks; never dispatch notifications |
| `student_news` | Dev every 5m; test on demand only after a test-owned runner exists | 90s systemd service timeout; each API request 20s | Dev API/DB, exact student/admin sessions, LanguageTool, CMUdict, configured Merriam-Webster provider | `tools/monitor-news-workflow.mjs` | Synthetic draft, Check, and submission; deterministic cleanup verifies no report or queued notification remains; no external message delivery |
| `dictionary_builder` | Dev with the 5m Library timer; test is not implemented | 270s enclosing service; dictionary preview request 240s | Dev admin API/session, database, local Dictionary Builder path, configured provider keys and services | Library monitor's Dictionary Builder check | Fixed `monitor` preview only; do not apply provider output or persist entries; inspect provider output in memory only |
| `assignment_notifications` | Dev aggregate monitor every 60s, assignment dispatcher timer every 5m, async worker poll every 15s; test worker poll every 15s and monitor on demand | Dev engagement service 25s; worker is long-running and polls on its 15s interval; test monitor target 25s | Owned database, assignment/notification queues, side-effects worker, notification provider state | Engagement monitor, assignment-reminder service, and environment-owned side-effects worker | Monitoring is read-only; never enqueue synthetic deliveries; synthetic workflow tests must use disabled delivery or a non-deliverable test transport and prove no real send occurred |
| `grade_feeds` | Dev every 5m; test on demand only after a test-owned runner exists | 60s systemd service timeout; each authenticated API check 10s | Dev PostgreSQL, admin cookie session, grade/feed tables and incoming-review queue | `tools/monitor-grade-feeds.mjs` | Read-only counts, ages, and authenticated table availability; no grade, submission, or incoming-queue writes |
| `attendance` | Dev every 5m with the grade-feed monitor; test on demand only after a test-owned runner exists | 60s systemd service timeout; each authenticated API check 10s | Dev PostgreSQL, admin cookie session, valid stored SIS school setup, attendance dashboard summary and write metrics | Attendance group in `tools/monitor-grade-feeds.mjs` plus authenticated route metrics | Read-only setup and dashboard checks; write-path metrics are observational; do not create or remove attendance records in the recurring check |
| `parent_reports` | Dev every 60s through the engagement monitor; test on demand | Dev service 25s; test target 25s total and each auth/API request 10s | Owned PostgreSQL, admin engagement API/session, exact parent account and dashboard, acknowledgment route metrics | Engagement monitor plus parent-report acknowledgment request metrics | Recurring check is read-only; browser acknowledgment regression uses isolated response data and no real email; no synthetic report/acknowledgment database writes in the monitor |
| `student_profile_enrollment` | Dev every 60s through the engagement monitor; test on demand | Dev service 25s; test target 25s total and each auth/API request 10s | Owned PostgreSQL, authenticated admin API, exact parent dashboard, enrollment history, Moodle outbox, worker heartbeat | Engagement monitor plus authenticated student-write metrics | Monitor is read-only; separately authorized dev/test synthetic create/update/enroll probes must use API cleanup, verify student/family absence, suppress email and Moodle calls, and never run live |

Only the dev schedules listed above are active for the full synthetic workflow monitors. Test supports the engagement read-only check and async-worker heartbeat; test Library, News, grade-feed, attendance, and parent-profile recurring schedules remain unimplemented. All production checks remain out of scope and read-only.

## Parent profile workflow monitor

Run the dev functional monitor with:

```bash
npm run monitor:parent-profile:dev
```

It uses the explicit `.env.dev` / `development` environment and pins the browser flow to `http://127.0.0.1:8788`. The check performs the authenticated synthetic invitation, draft save/reload/resave, submission, review, and approval workflow. It uses a manual no-email invitation and UUID-scoped synthetic records; test cleanup removes the records. The monitor treats a skipped E2E test as a failed check and has a 120-second process timeout.

The result is atomically written to `runtime-data/prometheus/parent-profile-workflow.prom`, which the existing node-exporter textfile collector scrapes. Its fixed `environment="dev"` label has no student, parent, account, route-parameter, or credential values. The metrics report the latest result, duration, check time, and last successful check time. Prometheus displays `DevParentProfileWorkflowCheckFailed` when the latest result stays failed for 30 seconds.

This command is a one-shot functional check; this item does not install a timer. Scheduling, stale-result handling, interrupted-run cleanup, retries, and controlled restarts are addressed by the separate monitoring-worker checklist items. Firing and resolved notifications route through Alertmanager to `#sis-alerts`.

## Engagement workflow monitor (dev and test)

Run the read-only engagement monitor with:

```bash
npm run monitor:engagement:dev
npm run monitor:engagement:test
```

The monitor accepts only the explicit `.env.dev` / `development` pair for `sis_dev` at `127.0.0.1:8788`, or `.env.test` / `test` for `sis-test` at `127.0.0.1:8786`. It checks the authenticated `/api/admin/performance-engagement` response using that environment's configured admin account and uses only the exact configured `cmmark001` parent account for the cookie-session dashboard check. Missing exact-account credentials fail closed; it does not substitute another parent. It reads the latest parent-report engagement event, Brevo webhook receipt/processing state, failed and stale async jobs, and queued-job count. It records due notification queue count and age (queued items with at least one recipient whose scheduled time is due), delivery-error queue count and age, parent-report notification count/age/errors, available announcement-job count and age, and pending/failed assignment-reminder dispatches. It also checks enrollment period overlaps and multiple active periods, plus due, processing, and rejected Moodle provisioning commands. The dev runtime deliberately starts its side-effects worker with the `parent-profile-invitation` job-type allowlist, so announcement queue age is reported as backlog and does not imply that this worker is configured to deliver announcements. Metrics use fixed `environment="dev"` or `environment="test"` labels and are written atomically to their corresponding textfiles under `runtime-data/prometheus`. Worker logs use fixed event categories and aggregate poll counts; they do not emit event payloads, recipient values, student fields, credentials, cookies, raw error messages, filenames, or job identifiers.

The test API's `.env.test` sets `SIS_REQUEST_METRICS_FILE` to the test request-counter textfile in the host textfile collector directory. The test async worker service sets the matching `.env.test` / `test` environment triplet and writes its heartbeat to `async-side-effects-worker-test.prom` in that same directory. The local node-exporter scrapes the test-labeled route counters, worker heartbeat, and one-shot test monitor output alongside dev metrics.

The same read-only monitor checks enrollment history for multiple active records and overlapping period pairs, and measures the count and age of due pending/retry and processing Moodle provisioning commands plus rejected commands. It fails when enrollment conflicts or rejected provisioning commands exist, due work is older than 30 minutes, or processing work is older than five minutes. Authenticated profile and enrollment writes use the route-template counters in `runtime-data/prometheus/sis-dev-request-metrics.prom`; the enrollment route is recorded only after the shared admin session/role gate succeeds. Node-exporter scrapes both files from the textfile collector directory. Prometheus alerts cover failed profile/enrollment writes, enrollment integrity conflicts, stale or rejected Moodle provisioning commands. These checks expose aggregate counts only.

The dev and test async side-effects workers write separate atomic heartbeats after every completed poll, including poll success. Their logs contain only fixed failure categories and aggregate poll counts; raw provider/worker errors, job identifiers, and report filenames are excluded. Announcement queue and async-job error fields use a bounded category (`provider_timeout`, `provider_rate_limited`, `provider_unavailable`, `provider_rejected`, `operation_timeout`, or `operation_failed`) rather than provider response text. Prometheus rules cover dashboard availability, stale monitor results, unprocessed webhook age, failed jobs, stuck processing jobs, failed worker polls, stale worker heartbeat, announcement and notification queue age, enrollment integrity, profile/enrollment write errors, Moodle provisioning age/rejections, and notification delivery errors. The monitor fails its latest check when an authenticated dashboard is unavailable or any monitored queue, enrollment, or worker condition is stale or failed. Event timestamps and queue counts are available as gauges; idle periods with no new engagement event do not trigger an ingestion alarm. Firing and resolved alerts route through Alertmanager to `#sis-alerts`. Enable the one-minute dev systemd timer with:

```bash
install -D -m 0644 ops/monitoring/systemd/sis-engagement-monitor-dev.service "$HOME/.config/systemd/user/sis-engagement-monitor-dev.service"
install -D -m 0644 ops/monitoring/systemd/sis-engagement-monitor-dev.timer "$HOME/.config/systemd/user/sis-engagement-monitor-dev.timer"
systemctl --user daemon-reload
systemctl --user enable --now sis-engagement-monitor-dev.timer
```

## Student Library workflow monitor (dev)

Run the authenticated synthetic Library check with:

```bash
npm run monitor:library:dev
```

The monitor is pinned to `.env.dev` / `development` and `http://127.0.0.1:8788`. It checks the SIS health endpoint, the `sis_dev` database, session Redis, the local CMU pronunciation dictionary, authenticated student and admin Library access, a student submission, admin approval, and the student's canonical result. Merriam-Webster key presence is reported as configuration gauges; provider keys and provider responses are never emitted. It uses the exact configured `mark001` student account and configured dev admin account without printing either credential.

The submission uses a random lowercase word and source ID. Cleanup removes only the matching contribution and its revisions, then removes its canonical entry only when that contribution was found and the entry's creator matches the configured admin. The check fails if cleanup cannot be verified. Open-review count and oldest pending/legacy review age are measured before the synthetic submission.

The monitor atomically writes fixed `environment="dev"` gauges to `runtime-data/prometheus/library-workflow-dev.prom`. It records access checks, submission/review checks, exact synthetic definition persistence, Dictionary Builder preview status, aggregate count of providers returning a definition, queue count and age, API/database/Redis/CMUdict availability, optional Merriam-Webster key configuration, cleanup status, and last success time. The Builder check uses the fixed probe word `monitor`; provider output is inspected only in memory to count definition availability and is never written to metrics or output. The synthetic definition is compared in memory with the canonical database readback; its text is never written to metrics or output. No account, entry, contribution, source, request, cookie, credential, provider name, provider response, or definition value is a metric label or monitor-output field. Prometheus evaluates alerts for missing monitor reports, access/save/review/definition failures, Builder provider unavailability, queue age over 24 hours, required dependency failures, and cleanup failures. The authenticated Builder preview can take up to four minutes; the systemd service timeout is 270 seconds, and its five-minute timer does not start an overlapping service run. Firing and resolved notifications route through Alertmanager to `#sis-alerts`.

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

The monitor is pinned to `.env.dev` / `development`, verifies `sis_dev`, and uses the exact configured `mark001` student and dev admin accounts. It authenticates to the local dev service, reads the admin News review queue, checks a synthetic report, submits it using the server-issued report ID, and deletes/verifies the synthetic row by its unique UUID-scoped source marker. No student identity, report content, provider response, account, session, credential, or report ID is written to metrics or monitor output.

The synthetic Check duration, Check result, LanguageTool result from the completed sentence checks, and Merriam-Webster vocabulary availability are written as fixed `environment="dev"` gauges to `runtime-data/prometheus/news-workflow-dev.prom`. The monitor also records synthetic submission success/failure, cleanup status, open submitted review count, oldest submitted review age, database/API availability, and last-success time. Prometheus alerts on stale monitor output, Check or submission failure, provider unavailability, cleanup failure, and a review older than 24 hours. Firing and resolved notifications route through Alertmanager to `#sis-alerts`.

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

The monitor writes atomic aggregate gauges to `runtime-data/prometheus/grade-feeds-dev.prom`, scraped by the existing node-exporter textfile collector. It does not change student, grade, or feed records. Prometheus alerts on a missing monitor result, failed database or authenticated table checks, missing request instrumentation, an unmatched incoming backlog, and recorded non-2xx authorized grade/feed writes. Feed-age gauges are available for investigation without treating an idle source as a failure. Firing and resolved alerts route through Alertmanager to `#sis-alerts`.

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

The active receiver is the approved dedicated Slack channel `#sis-alerts`, using an Incoming Webhook. The raw webhook URL is stored only in ignored `ops/monitoring/.env.alertmanager-slack-webhook` with mode `0600`; Alertmanager runs as the owning host UID/GID and reads that file at `/run/secrets/slack_webhook_url` through a read-only mount. Never add the webhook URL to Git, a dashboard, a command history, or this documentation. Alertmanager's web endpoint is bound to `127.0.0.1:9093`; Prometheus sends firing and resolved alerts to `alertmanager:9093` on the private Compose network.

Routing policy:

| Severity | Route | Grouping | Repeat |
| --- | --- | --- | --- |
| `critical` | `#sis-alerts` | alert name, instance, job | 30 minutes while firing |
| `warning` | `#sis-alerts` | alert name, instance, job | 4 hours while firing |

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

## Resource and security considerations

The monitoring stack consumes additional resources. In the initial installation, Grafana used roughly 190 MB, Prometheus roughly 100–130 MB, cAdvisor roughly 65–85 MB, and node-exporter roughly 18 MB. cAdvisor can briefly use noticeable CPU while collecting metrics.

Recommended safeguards:

- keep all monitoring ports bound to `127.0.0.1`;
- use SSH tunneling or an authenticated reverse proxy;
- retain only the required 30-day metric window;
- do not expose Grafana anonymously;
- do not commit monitoring credentials;
- use least-privilege exporter database accounts;
- avoid high-cardinality labels;
- do not label metrics with student identity or session data;
- monitor disk usage because Prometheus retention is disk-backed;
- back up Grafana dashboards and provisioning files, not secret environment files.

## Operational commands

### Dashboard map

- **SIS Operations**: student-save throughput, p95 latency by stage, RSS, and the test-mirror synthetic probe.
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
