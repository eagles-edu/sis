# SIS Monitoring Operations

## Current pared profile

The always-on monitoring profile is intentionally limited to Prometheus, node-exporter, and blackbox-exporter. Grafana remains available on loopback for on-demand investigation. cAdvisor, process-exporter, PostgreSQL exporter, Redis exporter, and Alertmanager are not part of the active profile. Container-level inspection is performed with `docker stats --no-stream` during incidents.

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
├── cAdvisor        ───── Docker container CPU, RAM, network, processes
├── process-exporter ──── test API, async-worker, and static-server processes
├── blackbox-exporter ─── public test-mirror `/admin` availability and latency
├── Prometheus      ───── metric collection and 30-day local retention
└── Grafana         ───── dashboards and visual investigation

Existing services monitored through cAdvisor:
├── sis-postgres
├── redis-stack
├── sis-languagetool-1
└── sis-languagetool-2
```

The monitoring files are maintained in:

- `ops/monitoring/docker-compose.yml`
- `ops/monitoring/prometheus.yml`
- `ops/monitoring/grafana/provisioning/`
- `ops/monitoring/grafana/dashboards/`

Persistent Docker volumes:

- `monitoring_prometheus-data`
- `monitoring_grafana-data`

## Services and local endpoints

| Service | Local endpoint | Purpose |
| --- | ---: | --- |
| Grafana | `http://127.0.0.1:3030` | Dashboard UI |
| Prometheus | `http://127.0.0.1:9090` | Query and metric storage |
| cAdvisor | `http://127.0.0.1:8089` | Docker metrics |
| node-exporter | `http://127.0.0.1:9100` | Host metrics |
| process-exporter | `http://127.0.0.1:9256` | Test-mirror process metrics |
| blackbox-exporter | `http://127.0.0.1:9115` | Public HTTP(S) probe metrics |

All endpoints are bound to loopback. They are not public web services and should remain behind SSH access or an authenticated internal reverse proxy.

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

### 4. Alertmanager — recommended after exporters

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

The approved receiver is the dedicated Slack channel `#sis-alerts`, using an Incoming Webhook. The raw webhook URL is stored only in ignored `ops/monitoring/.env.alertmanager-slack-webhook` with mode `0600` and mounted read-only into Alertmanager. Never add the webhook URL to Git, a dashboard, a command history, or this documentation.

Routing policy:

| Severity | Route | Grouping | Repeat |
| --- | --- | --- | --- |
| `critical` | `#sis-alerts` | alert name, instance, job | 30 minutes while firing |
| `warning` | `#sis-alerts` | alert name, instance, job | 4 hours while firing |

Use a 30-second group wait and five-minute group interval so one incident is grouped without hiding distinct alerts. Resolved notifications remain enabled. Alertmanager will be bound to loopback and Prometheus will send firing/resolved alerts to it locally.

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
