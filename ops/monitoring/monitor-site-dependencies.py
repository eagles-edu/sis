#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[2]
METRICS_DIRECTORY = ROOT / "runtime-data" / "prometheus"
METRICS_FILE = METRICS_DIRECTORY / "site-dependencies.prom"
SIS_ENV_FILE = Path("/home/admin.eagles.edu.vn/sis/.env")
ERP_COMPOSE_FILE = Path("/home/eagles/dockerz/erpnext/docker-compose.yml")
POSTGRES_CONTAINER = "sis-postgres"
REDIS_CONTAINER = "redis-stack"
ERPNEXT_QUEUE_CONTAINER = "erpnext-queue-short-1"
TIMEOUT_SECONDS = 8
NGINX_BINARY = "/usr/sbin/nginx"
NGINX_CHECK_TIMEOUT_SECONDS = 15


def read_env_file(path: Path, required_keys: set[str]) -> dict[str, str]:
    values: dict[str, str] = {}
    with path.open(encoding="utf-8") as env_file:
        for raw_line in env_file:
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[7:].lstrip()
            key, separator, raw_value = line.partition("=")
            if not separator or key.strip() not in required_keys:
                continue
            key = key.strip()
            value = raw_value.strip()
            if value.startswith('"'):
                try:
                    value = json.loads(value)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"invalid quoted value for {key}") from exc
            elif value.startswith("'"):
                closing_quote = value.find("'", 1)
                if closing_quote < 0:
                    raise ValueError(f"invalid quoted value for {key}")
                value = value[1:closing_quote]
            else:
                value = re.split(r"\s+#", value, maxsplit=1)[0].rstrip()
            values[key] = value
    if required_keys - values.keys():
        raise ValueError("missing required environment settings")
    return values


def inspect_running(container: str) -> bool:
    result = subprocess.run(
        ["docker", "inspect", "--format", "{{.State.Running}}", container],
        check=False,
        capture_output=True,
        text=True,
        timeout=TIMEOUT_SECONDS,
    )
    return result.returncode == 0 and result.stdout.strip() == "true"


def nginx_configuration_check() -> tuple[bool, float]:
    started_at = time.monotonic()
    try:
        result = subprocess.run(
            [NGINX_BINARY, "-t", "-q"],
            check=False,
            capture_output=True,
            text=True,
            timeout=NGINX_CHECK_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.SubprocessError, TimeoutError):
        return False, time.monotonic() - started_at
    return result.returncode == 0, time.monotonic() - started_at


def postgres_query_ready(database_url: str, container_running: bool, expected_database: str) -> tuple[bool, float]:
    started_at = time.monotonic()
    if not container_running:
        return False, 0.0
    parsed = urlsplit(database_url)
    if parsed.scheme not in {"postgres", "postgresql"}:
        return False, 0.0
    username = unquote(parsed.username or "")
    password = unquote(parsed.password or "")
    database = unquote(parsed.path.lstrip("/"))
    if not username or not password or database != expected_database:
        return False, 0.0
    command = (
        'IFS= read -r PGPASSWORD; export PGPASSWORD; '
        'exec psql -w -h 127.0.0.1 -p 5432 -U "$PGUSER" -d "$PGDATABASE" '
        '-v ON_ERROR_STOP=1 -Atq -c "SELECT current_database(), 1"'
    )
    result = subprocess.run(
        [
            "docker", "exec", "-i", "-e", f"PGUSER={username}", "-e",
            f"PGDATABASE={database}", POSTGRES_CONTAINER, "sh", "-c", command,
        ],
        input=password + "\n",
        check=False,
        capture_output=True,
        text=True,
        timeout=TIMEOUT_SECONDS,
    )
    duration = time.monotonic() - started_at
    return result.returncode == 0 and result.stdout.strip() == f"{expected_database}|1", duration


def postgres_readonly_integration_metrics(database_url: str, container_running: bool, expected_database: str) -> tuple[bool, list[tuple[str, str, int, int]]]:
    if not container_running:
        return False, []
    parsed = urlsplit(database_url)
    if parsed.scheme not in {"postgres", "postgresql"}:
        return False, []
    username = unquote(parsed.username or "")
    password = unquote(parsed.password or "")
    database = unquote(parsed.path.lstrip("/"))
    if not username or not password or database != expected_database:
        return False, []
    query = (
        "SELECT 'exercise_submission', COALESCE(\"sourceSystem\", 'other'), COUNT(*)::bigint, "
        "COALESCE(EXTRACT(EPOCH FROM MAX(\"createdAt\")), 0)::bigint "
        "FROM public.\"ExerciseSubmission\" GROUP BY \"sourceSystem\" "
        "UNION ALL "
        "SELECT 'grade_record', COALESCE(\"sourceSystem\", 'other'), COUNT(*)::bigint, "
        "COALESCE(EXTRACT(EPOCH FROM MAX(\"updatedAt\")), 0)::bigint "
        "FROM public.\"StudentGradeRecord\" GROUP BY \"sourceSystem\""
    )
    command = (
        'IFS= read -r PGPASSWORD; export PGPASSWORD; '
        'exec psql -w -h 127.0.0.1 -p 5432 -U "$PGUSER" -d "$PGDATABASE" '
        f'-v ON_ERROR_STOP=1 -F "|" -Atq -c {json.dumps(query)}'
    )
    result = subprocess.run(
        [
            "docker", "exec", "-i", "-e", f"PGUSER={username}", "-e",
            f"PGDATABASE={database}", POSTGRES_CONTAINER, "sh", "-c", command,
        ],
        input=password + "\n",
        check=False,
        capture_output=True,
        text=True,
        timeout=TIMEOUT_SECONDS,
    )
    if result.returncode != 0:
        return False, []
    exercise: dict[str, tuple[int, int]] = {"moodle": (0, 0), "google_forms": (0, 0), "other": (0, 0)}
    grades: dict[str, tuple[int, int]] = {"moodle": (0, 0), "google_forms": (0, 0), "other": (0, 0)}
    for line in result.stdout.splitlines():
        parts = line.split("|")
        if len(parts) != 4 or parts[0] not in {"exercise_submission", "grade_record"}:
            return False, []
        kind, source_name, raw_count, raw_timestamp = parts
        normalized_source = source_name.strip().lower().replace("-", "_").replace(" ", "_")
        if normalized_source not in {"moodle", "google_forms"}:
            normalized_source = "other"
        try:
            row_count = int(raw_count)
            latest_timestamp = int(raw_timestamp)
        except ValueError:
            return False, []
        target = exercise if kind == "exercise_submission" else grades
        target[normalized_source] = (
            target[normalized_source][0] + row_count,
            max(target[normalized_source][1], latest_timestamp),
        )
    return True, [
        ("exercise_submission", source, values[0], values[1])
        for source, values in exercise.items()
    ] + [
        ("grade_record", source, values[0], values[1])
        for source, values in grades.items()
    ]


def postgres_readonly_webhook_metrics(database_url: str, container_running: bool, expected_database: str) -> tuple[bool, int, int]:
    if not container_running:
        return False, 0, 0
    parsed = urlsplit(database_url)
    if parsed.scheme not in {"postgres", "postgresql"}:
        return False, 0, 0
    username = unquote(parsed.username or "")
    password = unquote(parsed.password or "")
    database = unquote(parsed.path.lstrip("/"))
    if not username or not password or database != expected_database:
        return False, 0, 0
    query = (
        'SELECT COUNT(*) FILTER (WHERE "processedAt" IS NULL)::bigint, '
        'COALESCE(EXTRACT(EPOCH FROM MAX("receivedAt")), 0)::bigint '
        'FROM public."BrevoEmailWebhookEvent"'
    )
    command = (
        'IFS= read -r PGPASSWORD; export PGPASSWORD; '
        'exec psql -w -h 127.0.0.1 -p 5432 -U "$PGUSER" -d "$PGDATABASE" '
        f'-v ON_ERROR_STOP=1 -F "|" -Atq -c {json.dumps(query)}'
    )
    result = subprocess.run(
        [
            "docker", "exec", "-i", "-e", f"PGUSER={username}", "-e",
            f"PGDATABASE={database}", POSTGRES_CONTAINER, "sh", "-c", command,
        ],
        input=password + "\n",
        check=False,
        capture_output=True,
        text=True,
        timeout=TIMEOUT_SECONDS,
    )
    if result.returncode != 0:
        return False, 0, 0
    try:
        unprocessed, latest = result.stdout.strip().split("|", 1)
        return True, int(unprocessed), int(latest)
    except (ValueError, TypeError):
        return False, 0, 0


def read_redis_line(connection: socket.socket) -> bytes:
    line = bytearray()
    while not line.endswith(b"\r\n"):
        chunk = connection.recv(1)
        if not chunk:
            raise ConnectionError("Redis closed the connection")
        line.extend(chunk)
        if len(line) > 8192:
            raise ConnectionError("Redis response exceeded the limit")
    return bytes(line)


def redis_command(connection: socket.socket, *arguments: str) -> bytes:
    encoded = [argument.encode("utf-8") for argument in arguments]
    request = [f"*{len(encoded)}\r\n".encode("ascii")]
    for argument in encoded:
        request.extend((f"${len(argument)}\r\n".encode("ascii"), argument, b"\r\n"))
    connection.sendall(b"".join(request))
    return read_redis_line(connection)


def redis_database_ready(redis_url: str) -> tuple[bool, float]:
    started_at = time.monotonic()
    parsed = urlsplit(redis_url)
    if parsed.scheme not in {"redis", "rediss"}:
        return False, 0.0
    host = parsed.hostname or ""
    port = parsed.port or (6380 if parsed.scheme == "rediss" else 6379)
    database = parsed.path.lstrip("/") or "0"
    password = unquote(parsed.password or "")
    username = unquote(parsed.username or "")
    if not host or not password or not database.isdigit() or parsed.scheme == "rediss":
        return False, 0.0
    with socket.create_connection((host, port), timeout=TIMEOUT_SECONDS) as connection:
        connection.settimeout(TIMEOUT_SECONDS)
        auth_response = (
            redis_command(connection, "AUTH", username, password)
            if username
            else redis_command(connection, "AUTH", password)
        )
        if not auth_response.startswith(b"+OK\r\n"):
            return False, time.monotonic() - started_at
        if not redis_command(connection, "SELECT", database).startswith(b"+OK\r\n"):
            return False, time.monotonic() - started_at
        ready = redis_command(connection, "PING").startswith(b"+PONG\r\n")
        return ready, time.monotonic() - started_at


def read_container_environment(container: str, required_keys: set[str]) -> dict[str, str]:
    result = subprocess.run(
        ["docker", "inspect", "--format", "{{range .Config.Env}}{{println .}}{{end}}", container],
        check=False,
        capture_output=True,
        text=True,
        timeout=TIMEOUT_SECONDS,
    )
    if result.returncode != 0:
        raise ValueError("could not inspect the active ERPNext Redis configuration")
    values: dict[str, str] = {}
    for line in result.stdout.splitlines():
        key, separator, value = line.partition("=")
        if separator and key in required_keys:
            values[key] = value
    if required_keys - values.keys():
        raise ValueError("active ERPNext Redis roles are missing")
    return values


def erpnext_redis_urls(container_environment: dict[str, str]) -> dict[str, str]:
    compose_text = ERP_COMPOSE_FILE.read_text(encoding="utf-8")
    urls: dict[str, str] = {}
    role_environment = {"cache": "FRAPPE_REDIS_CACHE", "queue": "FRAPPE_REDIS_QUEUE"}
    for role, environment_key in role_environment.items():
        parsed = urlsplit(container_environment[environment_key])
        if parsed.scheme not in {"redis", "rediss"} or not parsed.password:
            raise ValueError("active ERPNext Redis URL is invalid")
        user_info = parsed.netloc.rpartition("@")[0]
        auth = f"{user_info}@" if user_info else ""
        port = parsed.port or (6380 if parsed.scheme == "rediss" else 6379)
        urls[role] = f"{parsed.scheme}://{auth}127.0.0.1:{port}{parsed.path}"
    match = re.search(
        r"(?m)^\s*REDIS_SOCKETIO:\s*:\$REDIS_PASSWORD@redis-stack:6379/(\d+)\s*$",
        compose_text,
    )
    if not match:
        raise ValueError("ERPNext socketio Redis role configuration is missing")
    source = urlsplit(container_environment["FRAPPE_REDIS_CACHE"])
    user_info = source.netloc.rpartition("@")[0]
    auth = f"{user_info}@" if user_info else ""
    urls["socketio"] = f"{source.scheme}://{auth}127.0.0.1:6379/{match.group(1)}"
    return urls


def add_status(
    metrics: list[str],
    environment: str,
    domain: str,
    dependency: str,
    check: str,
    ready: bool,
) -> None:
    metrics.append(
        f'site_dependency_status{{environment="{environment}",domain="{domain}",dependency="{dependency}",check="{check}"}} '
        f"{1 if ready else 0}"
    )


def add_probe_duration(
    metrics: list[str], environment: str, dependency: str, check: str, duration_seconds: float
) -> None:
    metrics.append(
        f'site_dependency_probe_duration_seconds{{environment="{environment}",dependency="{dependency}",check="{check}"}} '
        f"{max(0.0, duration_seconds):.6f}"
    )


def parse_container_size(value: str) -> float:
    match = re.fullmatch(r"\s*([0-9]+(?:\.[0-9]+)?)\s*(B|kB|MB|GB|TB|KiB|MiB|GiB|TiB)\s*", value)
    if not match:
        raise ValueError("docker stats returned an unsupported memory unit")
    multipliers = {
        "B": 1,
        "kB": 1000,
        "MB": 1000**2,
        "GB": 1000**3,
        "TB": 1000**4,
        "KiB": 1024,
        "MiB": 1024**2,
        "GiB": 1024**3,
        "TiB": 1024**4,
    }
    return float(match.group(1)) * multipliers[match.group(2)]


def add_database_container_stats(metrics: list[str]) -> None:
    containers = {"sis-postgres": "postgres", "redis-stack": "redis"}
    result = subprocess.run(
        [
            "docker", "stats", "--no-stream", "--format",
            "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}", *containers,
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=TIMEOUT_SECONDS,
    )
    observed: set[str] = set()
    if result.returncode == 0:
        for line in result.stdout.splitlines():
            name, separator, values = line.partition("|")
            if not separator or name not in containers:
                continue
            cpu_text, separator, memory_text = values.partition("|")
            if not separator or not cpu_text.strip().endswith("%"):
                continue
            memory_used, separator, memory_limit = memory_text.partition("/")
            if not separator:
                continue
            try:
                cpu_percent = float(cpu_text.strip().removesuffix("%"))
                memory_used_bytes = parse_container_size(memory_used)
                memory_limit_bytes = parse_container_size(memory_limit)
            except ValueError:
                continue
            container = containers[name]
            metrics.extend(
                (
                    f'site_dependency_container_metrics_available{{container="{container}"}} 1',
                    f'site_dependency_container_cpu_percent{{container="{container}"}} {cpu_percent:.6f}',
                    f'site_dependency_container_memory_used_bytes{{container="{container}"}} {memory_used_bytes:.0f}',
                    f'site_dependency_container_memory_limit_bytes{{container="{container}"}} {memory_limit_bytes:.0f}',
                )
            )
            observed.add(container)
    for container in containers.values():
        if container not in observed:
            metrics.append(f'site_dependency_container_metrics_available{{container="{container}"}} 0')


def main() -> int:
    METRICS_DIRECTORY.mkdir(parents=True, exist_ok=True)
    metrics = [
        "# HELP site_dependency_status Read-only availability check for a live-site dependency.",
        "# TYPE site_dependency_status gauge",
        "# HELP site_dependency_monitor_last_check_success Whether all configured dependency checks completed.",
        "# TYPE site_dependency_monitor_last_check_success gauge",
        "# HELP site_dependency_monitor_last_check_timestamp_seconds Unix time of the latest dependency check.",
        "# TYPE site_dependency_monitor_last_check_timestamp_seconds gauge",
        "# HELP site_dependency_probe_duration_seconds Wall-clock duration of an authenticated read-only dependency probe.",
        "# TYPE site_dependency_probe_duration_seconds gauge",
        "# HELP site_dependency_environment_monitor_success Whether the latest database and Redis checks passed for an environment.",
        "# TYPE site_dependency_environment_monitor_success gauge",
        "# HELP site_dependency_environment_monitor_last_check_timestamp_seconds Unix time of the latest environment dependency check.",
        "# TYPE site_dependency_environment_monitor_last_check_timestamp_seconds gauge",
        "# HELP sis_grade_feed_readonly_data_available Whether read-only exercise and grade aggregate queries completed for an environment.",
        "# TYPE sis_grade_feed_readonly_data_available gauge",
        "# HELP sis_grade_feed_exercise_submission_rows Number of exercise submissions grouped by fixed source category.",
        "# TYPE sis_grade_feed_exercise_submission_rows gauge",
        "# HELP sis_grade_feed_grade_rows Number of grade rows grouped by fixed source category.",
        "# TYPE sis_grade_feed_grade_rows gauge",
        "# HELP sis_grade_feed_exercise_submission_latest_ingested_timestamp_seconds Latest exercise submission creation time by fixed source category.",
        "# TYPE sis_grade_feed_exercise_submission_latest_ingested_timestamp_seconds gauge",
        "# HELP sis_grade_feed_grade_latest_updated_timestamp_seconds Latest grade update time by fixed source category.",
        "# TYPE sis_grade_feed_grade_latest_updated_timestamp_seconds gauge",
        "# HELP sis_engagement_webhook_readonly_data_available Whether the read-only Brevo webhook aggregate query completed for an environment.",
        "# TYPE sis_engagement_webhook_readonly_data_available gauge",
        "# HELP sis_engagement_webhook_unprocessed_events Number of email webhook events without a processed timestamp.",
        "# TYPE sis_engagement_webhook_unprocessed_events gauge",
        "# HELP sis_engagement_webhook_last_received_timestamp_seconds Unix timestamp of the most recently received email webhook event, or zero when none exists.",
        "# TYPE sis_engagement_webhook_last_received_timestamp_seconds gauge",
        "# HELP site_dependency_container_metrics_available Whether Docker returned a resource snapshot for the shared dependency container.",
        "# TYPE site_dependency_container_metrics_available gauge",
        "# HELP site_dependency_container_cpu_percent Docker CPU usage percentage for a shared dependency container.",
        "# TYPE site_dependency_container_cpu_percent gauge",
        "# HELP site_dependency_container_memory_used_bytes Docker memory working set for a shared dependency container.",
        "# TYPE site_dependency_container_memory_used_bytes gauge",
        "# HELP site_dependency_container_memory_limit_bytes Docker memory limit for a shared dependency container.",
        "# TYPE site_dependency_container_memory_limit_bytes gauge",
        "# HELP site_dependency_nginx_config_valid Whether the full host Nginx configuration passes nginx -t.",
        "# TYPE site_dependency_nginx_config_valid gauge",
        "# HELP site_dependency_nginx_config_test_duration_seconds Wall-clock duration of the host Nginx configuration test.",
        "# TYPE site_dependency_nginx_config_test_duration_seconds gauge",
        "# HELP site_dependency_nginx_config_test_timestamp_seconds Unix time of the latest host Nginx configuration test.",
        "# TYPE site_dependency_nginx_config_test_timestamp_seconds gauge",
    ]
    nginx_valid, nginx_duration = nginx_configuration_check()
    nginx_test_timestamp = int(time.time())
    metrics.extend((
        f'site_dependency_nginx_config_valid{{scope="shared_host"}} {int(nginx_valid)}',
        f'site_dependency_nginx_config_test_duration_seconds{{scope="shared_host"}} {nginx_duration:.6f}',
        f'site_dependency_nginx_config_test_timestamp_seconds{{scope="shared_host"}} {nginx_test_timestamp}',
    ))
    check_success = 1
    for environment, env_file in (("live", SIS_ENV_FILE), ("test", ROOT / ".env.test")):
        env_success = 1
        try:
            sis_values = read_env_file(
                env_file, {"DATABASE_URL", "REDIS_URL", "REDIS_SESSION_URL", "REDIS_CACHE_URL"}
            )
            domain = "admin.eagles.edu.vn" if environment == "live" else "test.eagles.edu.vn"
            postgres_running = inspect_running(POSTGRES_CONTAINER)
            add_status(metrics, environment, domain, "sis-postgres", "container-running", postgres_running)
            expected_database = "sis" if environment == "live" else "sis-test"
            try:
                postgres_ready, postgres_duration = postgres_query_ready(
                    sis_values["DATABASE_URL"], postgres_running, expected_database
                )
            except (OSError, subprocess.SubprocessError, TimeoutError, ConnectionError):
                postgres_ready, postgres_duration = False, 0.0
            add_status(metrics, environment, domain, "sis-postgres", "authenticated-select-1", postgres_ready)
            add_probe_duration(metrics, environment, "sis-postgres", "authenticated-select-1", postgres_duration)
            env_success &= int(postgres_running and postgres_ready)

            grades_available, grade_rows = postgres_readonly_integration_metrics(
                sis_values["DATABASE_URL"], postgres_running and postgres_ready, expected_database
            )
            metrics.append(f'sis_grade_feed_readonly_data_available{{environment="{environment}"}} {int(grades_available)}')
            if grades_available and environment == "live":
                for kind, source, row_count, latest_timestamp in grade_rows:
                    if kind == "exercise_submission":
                        metrics.extend((
                            f'sis_grade_feed_exercise_submission_rows{{environment="{environment}",source="{source}"}} {row_count}',
                            f'sis_grade_feed_exercise_submission_latest_ingested_timestamp_seconds{{environment="{environment}",source="{source}"}} {latest_timestamp}',
                        ))
                    else:
                        metrics.extend((
                            f'sis_grade_feed_grade_rows{{environment="{environment}",source="{source}"}} {row_count}',
                            f'sis_grade_feed_grade_latest_updated_timestamp_seconds{{environment="{environment}",source="{source}"}} {latest_timestamp}',
                        ))

            webhook_available, webhook_unprocessed, webhook_last_received = postgres_readonly_webhook_metrics(
                sis_values["DATABASE_URL"], postgres_running and postgres_ready, expected_database
            )
            metrics.append(f'sis_engagement_webhook_readonly_data_available{{environment="{environment}"}} {int(webhook_available)}')
            if environment == "live":
                metrics.extend((
                    f'sis_engagement_webhook_unprocessed_events{{environment="{environment}"}} {webhook_unprocessed}',
                    f'sis_engagement_webhook_last_received_timestamp_seconds{{environment="{environment}"}} {webhook_last_received}',
                ))

            redis_running = inspect_running(REDIS_CONTAINER)
            for dependency, key in (
                ("sis-app", "REDIS_URL"),
                ("sis-sessions", "REDIS_SESSION_URL"),
                ("sis-cache", "REDIS_CACHE_URL"),
            ):
                add_status(metrics, environment, domain, dependency, "container-running", redis_running)
                try:
                    redis_ready, redis_duration = redis_database_ready(sis_values[key])
                except (OSError, TimeoutError, ConnectionError, ValueError):
                    redis_ready, redis_duration = False, 0.0
                add_status(metrics, environment, domain, dependency, "authenticated-ping", redis_running and redis_ready)
                add_probe_duration(metrics, environment, dependency, "authenticated-ping", redis_duration)
                env_success &= int(redis_running and redis_ready)
        except (KeyError, OSError, ValueError, subprocess.SubprocessError, TimeoutError, ConnectionError):
            env_success = 0
        metrics.append(f'site_dependency_environment_monitor_success{{environment="{environment}"}} {env_success}')
        metrics.append(f'site_dependency_environment_monitor_last_check_timestamp_seconds{{environment="{environment}"}} {int(time.time())}')
        if not env_success:
            check_success = 0

    try:
        add_database_container_stats(metrics)
    except (OSError, subprocess.SubprocessError, TimeoutError):
        metrics.extend(
            (
                'site_dependency_container_metrics_available{container="postgres"} 0',
                'site_dependency_container_metrics_available{container="redis"} 0',
            )
        )

    try:
        erp_environment = read_container_environment(
            ERPNEXT_QUEUE_CONTAINER, {"FRAPPE_REDIS_CACHE", "FRAPPE_REDIS_QUEUE"}
        )
        for role, redis_url in erpnext_redis_urls(erp_environment).items():
            dependency = f"erpnext-redis-{role}"
            redis_running = inspect_running(REDIS_CONTAINER)
            add_status(metrics, "live", "ltd.eagles.vn", dependency, "container-running", redis_running)
            try:
                redis_ready, redis_duration = redis_database_ready(redis_url)
            except (OSError, TimeoutError, ConnectionError, ValueError):
                redis_ready, redis_duration = False, 0.0
            add_status(metrics, "live", "ltd.eagles.vn", dependency, "authenticated-ping", redis_running and redis_ready)
            add_probe_duration(metrics, "live", dependency, "authenticated-ping", redis_duration)
            if not (redis_running and redis_ready):
                check_success = 0
    except (KeyError, OSError, ValueError, subprocess.SubprocessError, TimeoutError, ConnectionError):
        check_success = 0

    metrics.extend(
        (
            f"site_dependency_monitor_last_check_success {check_success}",
            f"site_dependency_monitor_last_check_timestamp_seconds {int(time.time())}",
        )
    )
    descriptor, temporary_path = tempfile.mkstemp(
        prefix=".site-dependencies.", suffix=".prom", dir=METRICS_DIRECTORY
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as metrics_file:
            metrics_file.write("\n".join(metrics) + "\n")
        os.chmod(temporary_path, 0o644)
        os.replace(temporary_path, METRICS_FILE)
    except Exception:
        try:
            os.unlink(temporary_path)
        except OSError:
            pass
        raise
    return 0 if check_success else 1


if __name__ == "__main__":
    raise SystemExit(main())
