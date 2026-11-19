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


def postgres_query_ready(database_url: str, container_running: bool) -> bool:
    if not container_running:
        return False
    parsed = urlsplit(database_url)
    if parsed.scheme not in {"postgres", "postgresql"}:
        return False
    username = unquote(parsed.username or "")
    password = unquote(parsed.password or "")
    database = unquote(parsed.path.lstrip("/"))
    if not username or not password or not database:
        return False
    command = (
        'IFS= read -r PGPASSWORD; export PGPASSWORD; '
        'exec psql -w -h 127.0.0.1 -p 5432 -U "$PGUSER" -d "$PGDATABASE" '
        '-v ON_ERROR_STOP=1 -Atq -c "SELECT 1"'
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
    return result.returncode == 0 and result.stdout.strip() == "1"


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


def redis_database_ready(redis_url: str) -> bool:
    parsed = urlsplit(redis_url)
    if parsed.scheme not in {"redis", "rediss"}:
        return False
    host = parsed.hostname or ""
    port = parsed.port or (6380 if parsed.scheme == "rediss" else 6379)
    database = parsed.path.lstrip("/") or "0"
    password = unquote(parsed.password or "")
    username = unquote(parsed.username or "")
    if not host or not password or not database.isdigit() or parsed.scheme == "rediss":
        return False
    with socket.create_connection((host, port), timeout=TIMEOUT_SECONDS) as connection:
        connection.settimeout(TIMEOUT_SECONDS)
        auth_response = (
            redis_command(connection, "AUTH", username, password)
            if username
            else redis_command(connection, "AUTH", password)
        )
        if not auth_response.startswith(b"+OK\r\n"):
            return False
        if not redis_command(connection, "SELECT", database).startswith(b"+OK\r\n"):
            return False
        return redis_command(connection, "PING").startswith(b"+PONG\r\n")


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


def add_status(metrics: list[str], domain: str, dependency: str, check: str, ready: bool) -> None:
    metrics.append(
        f'site_dependency_status{{domain="{domain}",dependency="{dependency}",check="{check}"}} '
        f"{1 if ready else 0}"
    )


def main() -> int:
    METRICS_DIRECTORY.mkdir(parents=True, exist_ok=True)
    metrics = [
        "# HELP site_dependency_status Read-only availability check for a live-site dependency.",
        "# TYPE site_dependency_status gauge",
        "# HELP site_dependency_monitor_last_check_success Whether all configured dependency checks completed.",
        "# TYPE site_dependency_monitor_last_check_success gauge",
        "# HELP site_dependency_monitor_last_check_timestamp_seconds Unix time of the latest dependency check.",
        "# TYPE site_dependency_monitor_last_check_timestamp_seconds gauge",
    ]
    check_success = 1
    try:
        sis_values = read_env_file(
            SIS_ENV_FILE, {"DATABASE_URL", "REDIS_URL", "REDIS_SESSION_URL", "REDIS_CACHE_URL"}
        )
        postgres_running = inspect_running(POSTGRES_CONTAINER)
        add_status(metrics, "admin.eagles.edu.vn", "sis-postgres", "container-running", postgres_running)
        add_status(
            metrics, "admin.eagles.edu.vn", "sis-postgres", "authenticated-select-1",
            postgres_query_ready(sis_values["DATABASE_URL"], postgres_running),
        )

        redis_running = inspect_running(REDIS_CONTAINER)
        for dependency, key in (
            ("sis-app", "REDIS_URL"),
            ("sis-sessions", "REDIS_SESSION_URL"),
            ("sis-cache", "REDIS_CACHE_URL"),
        ):
            add_status(metrics, "admin.eagles.edu.vn", dependency, "container-running", redis_running)
            add_status(
                metrics, "admin.eagles.edu.vn", dependency, "authenticated-ping",
                redis_running and redis_database_ready(sis_values[key]),
            )

        erp_environment = read_container_environment(
            ERPNEXT_QUEUE_CONTAINER, {"FRAPPE_REDIS_CACHE", "FRAPPE_REDIS_QUEUE"}
        )
        for role, redis_url in erpnext_redis_urls(erp_environment).items():
            dependency = f"erpnext-redis-{role}"
            add_status(metrics, "ltd.eagles.vn", dependency, "container-running", redis_running)
            add_status(
                metrics, "ltd.eagles.vn", dependency, "authenticated-ping",
                redis_running and redis_database_ready(redis_url),
            )
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
