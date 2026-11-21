# SIS Test Mirror Monitoring Suite

> Current runtime note: cAdvisor and PostgreSQL/Redis exporters are not active. Process-exporter is enabled for SIS process metrics. The minute dependency monitor records environment-owned PostgreSQL and Redis probe status/latency and samples shared-container CPU/memory with `docker stats`.

## Scope

This document is the operational reference for monitoring the SIS **test mirror**.

The test mirror is the v2.0 deployed test environment:

- Public origin: `https://test.eagles.edu.vn`
- Admin availability probe: `https://test.eagles.edu.vn/admin`
- API runtime: `exercise-mailer-test.service`
- API listener: `127.0.0.1:8786`
- Async worker: `sis-async-side-effects-test.service`
- Static web service: `sis-web-test.service`
- Static listener: `*:8086`
- Test runtime root: `/home/test.eagles.edu.vn/sis`

This suite monitors availability and resource behavior only. It does not collect student names, emails, passwords, session cookies, request bodies, or other student PII.

## Environment-file ownership

The test mirror uses only `/home/test.eagles.edu.vn/sis/.env.test`. The fixed project-wide mapping is:

| Runtime | Environment file |
| --- | --- |
| Dev | `.env.dev` |
| Live/admin mirror | `.env` |
| Test mirror | `.env.test` |

Do not copy, align, inspect as a fallback, or reuse values across these files unless an active request explicitly authorizes the exact transfer.

`sis-nlp-grammar` is deprecated and explicitly excluded from this test-mirror monitoring scope.

## Monitoring topology

```text
Browser / operator
        |
        | SSH tunnel, localhost only
        v
Grafana :3030  <---->  Prometheus :9090
                              |
          +-------------------+-------------------+
          |                   |                   |
          v                   v                   v
 node-exporter :9100    process-exporter :9256
 host resources          SIS process resources
                         test API and async worker

                              |
                              v
                     blackbox-exporter :9115
                              |
                              v
               https://test.eagles.edu.vn/admin
```

## Components

| Component | Container | Local port | Test-mirror responsibility |
| --- | --- | ---: | --- |
| Prometheus | `sis-prometheus` | 9090 | Scrapes and evaluates metrics every 30 seconds, with seven-day local retention. |
| Grafana | `sis-grafana` | 3030 | Displays dashboards and graphs. |
| node-exporter | `sis-node-exporter` | 9100 | Host CPU, RAM, swap, disk, network, load, filesystem pressure. |
| cAdvisor | not active | — | Container metrics are not scraped from cAdvisor. PostgreSQL and Redis CPU/memory are sampled by the 60-second dependency monitor. |
| process-exporter | `sis-process-exporter` | 9256 | CPU, memory, thread/process count for live/test SIS API and async worker processes. |
| blackbox-exporter | `sis-blackbox-exporter` | 9115 | Probes the real HTTPS test-mirror admin page and records availability plus response duration. |

All ports are bound to `127.0.0.1`. No monitoring service is intentionally Internet-facing.

## Why `/admin` is the public probe

The test mirror's external `/healthz` request is blocked by the HTTPS edge and returns `403`. That is expected edge behavior, not an application failure.

The public availability check therefore probes:

```text
https://test.eagles.edu.vn/admin
```

Success means an HTTPS `GET` receives HTTP `200` within the blackbox probe timeout. It verifies DNS, TLS, Nginx/edge routing, test static web delivery, and the visible admin route. It does not authenticate and does not submit data.

## Prometheus jobs

Prometheus uses a 5-second scrape and evaluation interval. Configuration is stored in [prometheus.yml](../ops/monitoring/prometheus.yml).

| Job | Target | What it confirms |
| --- | --- | --- |
| `prometheus` | `prometheus:9090` | Prometheus itself is healthy. |
| `node` | `node-exporter:9100` | Host metrics are available. |
| `process-diagnostics` | `process-exporter:9256` | Live/test SIS process metrics are available. |
| `blackbox-test-mirror` | `https://test.eagles.edu.vn/admin` through blackbox exporter | The public test-mirror admin page is reachable and responds with `200`. |
| `blackbox-website-http`, `blackbox-website-api`, `blackbox-admin-auth-api`, `blackbox-thuvien-media`, `blackbox-website-app` | public application, auth-guard, media, and Frappe routes | The monitored public pages, APIs, and media endpoints respond as expected. |

Target health is visible at:

```text
http://127.0.0.1:9090/targets
```

All configured targets must show `UP` before interpreting a missing metric as an application failure. `redis-diagnostics` is intentionally absent until an authenticated Redis exporter target is configured.

## Test-mirror process matching

Process matching is configured in [process-exporter.yml](../ops/monitoring/process-exporter.yml).

| Metric group | Required command-path match | Expected process count | Meaning |
| --- | --- | ---: | --- |
| `sis_test_api` | `/home/test.eagles.edu.vn/sis/server/exercise-mailer.mjs` | 1 | Test API is running. |
| `sis_test_async_worker` | `/home/test.eagles.edu.vn/sis/tools/async-side-effects-worker.mjs` | 1 | Async side-effect worker is running. |
| `sis_test_static_server` | `/home/test.eagles.edu.vn/public_html` | 3 | Normal `npm exec → shell → serve` static-service chain. |

The static-service group reports three processes by design. Do not alert simply because it is greater than one.

Useful process metrics:

```promql
namedprocess_namegroup_num_procs{groupname=~"sis_test_.*"}
rate(namedprocess_namegroup_cpu_seconds_total{groupname=~"sis_test_.*"}[1m])
namedprocess_namegroup_memory_bytes{groupname=~"sis_test_.*"}
namedprocess_namegroup_num_threads{groupname=~"sis_test_.*"}
```

## Dashboards

Open Grafana through an SSH tunnel:

```bash
ssh -L 3030:127.0.0.1:3030 user@server
```

Then browse to:

```text
http://127.0.0.1:3030
```

Do not record the Grafana credential in this document. It is stored in the ignored local monitoring environment file.

### SIS Test Mirror · Operations

Dashboard source: [test-mirror-overview.json](../ops/monitoring/grafana/dashboards/test-mirror-overview.json)

This dashboard is structurally identical to **SIS Live/Admin Mirror · Operations** and contains:

1. Public admin probe status (`UP`/`DOWN`)
2. Public admin response time
3. Test API process status
4. Test async-worker process status
5. Test API, worker, and static-service CPU usage
6. Test API, worker, and static-service memory usage
7. Host CPU and memory pressure
8. PostgreSQL and Redis authenticated-probe latency and shared-container CPU/memory history
9. Ten scheduled logical workflow results, freshness, cadence, and duration history
10. Student-save mean latency by stage after an authenticated write is observed
11. CMUdict, LanguageTool, Dictionary Builder aggregate-provider, News, Moodle, Google Forms, Brevo webhook, Thuvien image, and reading-audio signals

Test's owned `.env.test` is checked independently from the live `.env`. The 60-second site-dependency monitor writes read-only PostgreSQL database-identity/`SELECT 1` and Redis `PING` status/duration metrics for each environment, plus shared-container CPU/memory samples. The PostgreSQL timing includes Docker/`psql` startup overhead and is not pure server execution time. Workflow smoke groups are scheduled for test and dev; live workflow smoke is not scheduled.

Use a 15-minute range for a controlled test. Use a 60-minute range when correlating a user-reported incident with service or database logs.

### SIS Resource Overview

Dashboard source: [sis-resource-overview.json](../ops/monitoring/grafana/dashboards/sis-resource-overview.json)

Use this dashboard for host-wide context: all Docker container resource usage, host CPU, and host memory.

## Alerts

Prometheus alert rules are in [alerts.yml](../ops/monitoring/alerts.yml). They are evaluated every five seconds and can be viewed at:

```text
http://127.0.0.1:9090/alerts
```

| Alert | Trigger | For | Severity |
| --- | --- | ---: | --- |
| `TestMirrorPublicAdminDown` | public `/admin` probe fails | 2 min | critical |
| `TestMirrorApiProcessDown` | test API process count is below 1 | 1 min | critical |
| `TestMirrorAsyncWorkerDown` | test async worker process count is below 1 | 2 min | warning |
| `TestMirrorStaticServerDown` | static-service process count is below 1 | 2 min | warning |
| `HostCpuHigh` | host CPU >85% | 5 min | warning |
| `HostMemoryLow` | host available memory <15% | 5 min | warning |

Prometheus evaluates these alerts and the active Alertmanager route delivers firing and resolved notifications to Slack `#sis-alert` through the configured incoming webhook. The controlled KA-127 test verified both statuses in that channel with zero failed Slack notifications.

## Controlled restart policy

The test API (`exercise-mailer-test.service`), static server (`sis-web-test.service`), and async worker (`sis-async-side-effects-test.service`) use the same bounded systemd policy from `ops/systemd/keepalive-test-restart-guard.conf`: `Restart=on-failure`, a 30-second delay, and at most four executed starts (initial start plus three automatic restarts) in 15 minutes. On the limit, systemd leaves the unit failed and performs no host-level action. On this host the journal recorded `Start request repeated too quickly` for the rejected next attempt while `systemctl show` reported `Result=exit-code` from the last executed process failure; inspect both the unit properties and journal. Apply the allowlisted test-only drop-ins with `sudo tools/install-test-restart-guards.sh`; it validates each unit's `/home/test.eagles.edu.vn` runtime path and `.env.test` ownership before installing, then runs `systemctl daemon-reload` without restarting active services. The install output reports each effective limit.

The dev API is managed separately as the user service `sis-dev-api.service` with bounded process-failure restarts: a 30-second delay and at most four starts in 15 minutes. Its automatic start executes only the dev Node service entrypoint and does not run build, Prisma, migration, sync, or worker commands. Install it with `npm run dev:install-restart-guard`; the installer verifies `/home/eagles/dockerz/sis`, `.env.dev`, and the pinned Node runtime and does not restart the active API. `npm run dev:restart` remains operator initiated because it rebuilds assets and runs dev-owned Prisma generation/migration checks before starting the managed service. The dev unit is user-scoped and separate from the live/admin and test system units; no live/admin unit is in either restart-guard installer allowlist.

## Normal operating baseline

Expected healthy state:

- all five Prometheus jobs are `UP`;
- public probe value is `1`;
- test API process count is `1`;
- test async worker process count is `1`;
- test static-server process count is `3`;
- no alert is pending or firing;
- test API and worker RSS remain broadly stable outside active workloads;
- PostgreSQL and Redis do not show a sustained CPU or memory rise during an ordinary student save;
- host available memory remains safely above the 15% alert threshold;
- host swap does not climb continuously.

## Controlled authenticated student-save procedure

Use this procedure to investigate the reported CPU/RAM saturation safely.

1. Confirm the five Prometheus jobs are `UP`.
2. Open `SIS Test Mirror · Environment Health` in Grafana and select `Last 15 minutes` with 5-second refresh.
3. Open the test mirror's real admin login page.
4. Log in through the visible browser flow using an authorized administrator account.
5. Confirm the authenticated admin page is loaded and the session is cookie-backed.
6. Create one clearly synthetic test student through the normal UI.
7. Record the exact time immediately before clicking Save.
8. Keep Grafana open for at least five minutes after the response.
9. Correlate the save time with API process CPU/RSS, host CPU/memory, PostgreSQL CPU/memory, Redis CPU/memory, and response probe duration.
10. If the issue does not occur, record the result as a successful baseline.
11. Remove the synthetic student through the authenticated UI when the investigation is complete.

Do not use direct database mutation, direct Prisma imports, or an API-only login as evidence for this workflow. The objective is to test the real UI, session, router, API, database, and post-save path together.

## Incident capture commands

When a spike begins, run the following read-only commands promptly and retain their timestamped output in the incident record:

```bash
date --iso-8601=seconds
uptime
free -h
docker stats --no-stream
ps -eo pid,ppid,%cpu,%mem,rss,etime,cmd --sort=-%cpu | head -30
docker events --since 10m --until 0s
```

Test service status:

```bash
systemctl --no-pager status \
  exercise-mailer-test.service \
  sis-async-side-effects-test.service \
  sis-web-test.service
```

Test-service journal window:

```bash
journalctl \
  -u exercise-mailer-test.service \
  -u sis-async-side-effects-test.service \
  -u sis-web-test.service \
  --since '15 minutes ago' \
  --no-pager
```

PostgreSQL activity:

```bash
docker exec sis-postgres psql -U sis_app -d sis-test \
  -c 'select pid, usename, state, wait_event_type, wait_event, query_start, left(query, 300) from pg_stat_activity order by query_start nulls last;'
```

PostgreSQL locks:

```bash
docker exec sis-postgres psql -U sis_app -d sis-test \
  -c 'select pid, locktype, mode, granted, relation::regclass, waitstart from pg_locks order by granted, waitstart nulls last;'
```

Redis health:

```bash
docker exec redis-stack redis-cli INFO memory
docker exec redis-stack redis-cli INFO stats
docker exec redis-stack redis-cli INFO clients
```

## Operations

Start or reconcile the suite:

```bash
docker compose --env-file ops/monitoring/.env \
  -f ops/monitoring/docker-compose.yml up -d
```

Show service state:

```bash
docker compose --env-file ops/monitoring/.env \
  -f ops/monitoring/docker-compose.yml ps
```

View monitoring logs:

```bash
docker compose --env-file ops/monitoring/.env \
  -f ops/monitoring/docker-compose.yml logs --tail=200 -f
```

Validate Prometheus configuration before applying changes:

```bash
docker compose --env-file ops/monitoring/.env \
  -f ops/monitoring/docker-compose.yml config --quiet
```

Reload Prometheus after only changing `prometheus.yml` or `alerts.yml`:

```bash
curl -fsS -X POST http://127.0.0.1:9090/-/reload
```

Restart Grafana after adding or changing a provisioned dashboard:

```bash
docker compose --env-file ops/monitoring/.env \
  -f ops/monitoring/docker-compose.yml restart grafana
```

Stop monitoring without deleting history:

```bash
docker compose --env-file ops/monitoring/.env \
  -f ops/monitoring/docker-compose.yml stop
```

Do not run `docker compose down -v` in normal operation. The `-v` option deletes Prometheus metric history and Grafana state.

## Approved telemetry additions and delivery status

The following scope is approved for this test mirror. It is intentionally restricted to the authenticated student create/update path and operational datastore statistics. No student identifier, name, email, request body, session ID, cookie, username, SQL text, or query parameter may be emitted as a metric label or timing-log field.

| Addition | Test-mirror scope | Delivery state |
| --- | --- | --- |
| Route metrics | Authenticated `POST /api/admin/students`, `PUT /api/admin/students/:id`, and `POST /api/admin/students/:id/enrollment`; total duration, response status, and safe phase durations | Test runtime sync and textfile collector configuration verified |
| PostgreSQL exporter | Connections, locks, transactions, cache-hit inputs, long-running/idle activity, autovacuum, I/O | Requires dedicated `sis_monitor` role, secret file, Docker network attachment, then target validation |
| Redis exporter | Session/cache availability, memory, evictions, blocked clients, command statistics | Requires a dedicated read-only Redis ACL user, persistence verification, secret file, Docker network attachment, then target validation |
| Alertmanager | Prometheus firing/resolved alerts routed to Slack `#sis-alert` | Configured route verified by KA-127 firing and resolved notifications |
| Structured timing log | `requestId`, route template, HTTP status, total milliseconds, named safe phase milliseconds | Requires test runtime sync and a real authenticated UI save verification |

### Profile, enrollment, provisioning, and notification monitoring

The test SIS API writes authenticated profile and enrollment request counters to the central node-exporter textfile directory through `SIS_REQUEST_METRICS_FILE` in the test-owned `.env.test`. Every emitted sample carries the matching `environment="test"` label plus only fixed route templates, response status, or phase names; account and record identifiers are excluded. The test async worker receives the matching `SIS_ENV_FILE=.env.test`, `DOTENV_CONFIG_PATH=.env.test`, and `NODE_ENV=test` triplet and writes an `environment="test"` heartbeat to the same collector directory. Dev and test series use separate filenames and environment labels, with identical HELP text for shared metric families.

Run the read-only test monitor with `npm run monitor:engagement:test`. It verifies the database name is `sis-test`, checks the authenticated test admin report API and the exact configured `cmmark001` parent dashboard through `127.0.0.1:8786`, and records aggregate duplicate open active periods by student and school year, same-school-year interval overlaps, Moodle provisioning queue age and rejection counts, and notification queue age/delivery failures. Closed historical active periods and cross-school-year overlaps do not count as enrollment conflicts. It writes `engagement-workflows-test.prom`; no writes are made to test SIS records or external services by this monitor. Prometheus rules alert on stale test-monitor output, failed profile/enrollment requests, enrollment conflicts, stale/rejected Moodle commands, and notification delay/failure. Alertmanager routes firing and resolved alerts to Slack `#sis-alert`.

### Route-level timing contract

Timing starts before the request router and is retained only once the existing cookie-session authentication and role check succeeds. Unauthenticated and rejected requests produce no timing record. The fixed route templates are:

```text
POST /api/admin/students
PUT /api/admin/students/:id
```

The permitted phase names are `profile_backup_pre`, `database_transaction`, `filter_cache_invalidation`, `roster_reload`, and `profile_backup_post`. Metrics are written atomically to node-exporter's textfile directory so Prometheus can scrape them without an additional public SIS metrics endpoint.

### PostgreSQL monitoring role contract

The `sis_monitor` role is a dedicated non-owner login. It is not superuser, cannot create databases or roles, cannot replicate, and has no write grants. It receives `pg_monitor` plus database `CONNECT` only. The database password is stored solely in an ignored local exporter secret file.

The PostgreSQL exporter is reachable only at `127.0.0.1:9187`. Prometheus uses the internal Docker service endpoint; no PostgreSQL port is exposed.

### Redis monitoring contract

The Redis monitoring account must be a dedicated ACL user restricted to exporter read operations. The Redis exporter is reachable only at `127.0.0.1:9121`; Redis itself remains unexposed. Key scanning and key-value export are disabled to prevent performance impact and data leakage. Before enabling the exporter, verify the ACL user survives a controlled Redis restart or use the Redis ACL persistence mechanism configured for this host.

### Slack alert delivery contract

The notification destination is Slack channel `#sis-alert` with an Incoming Webhook. Its raw URL is held only in ignored `ops/monitoring/.env.alertmanager-slack-webhook` with mode `0600`; Alertmanager reads it from a read-only container mount. Critical alerts repeat every 30 minutes, warning alerts every four hours, and resolved notifications are sent. KA-127 verified firing and resolved test-service alerts in this channel; the failed-notification counter remained zero. Alertmanager binds to loopback only.

### Structured timing log contract

SIS emits exactly one JSON timing record per completed authenticated student write. It contains a generated request UUID, route template, status, total duration, and the fixed safe phase durations. It excludes all student, authentication, session, request-body, and SQL information. This record is the correlation point between the browser Save click and Prometheus host, process, PostgreSQL, and Redis graphs.

## Verification record

The suite was verified with:

- `blackbox-test-mirror` probe returning `probe_success = 1` for `https://test.eagles.edu.vn/admin`;
- one detected `sis_test_api` process;
- one detected `sis_test_async_worker` process;
- three detected `sis_test_static_server` processes;
- all five Prometheus jobs reporting `UP`;
- Grafana health endpoint returning HTTP `200`.
