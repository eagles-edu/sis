#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[2]
METRICS_DIRECTORY = ROOT / "runtime-data" / "prometheus"
METRICS_FILE = METRICS_DIRECTORY / "sis-vendor-health.prom"
ENVIRONMENTS = {
    "live": Path("/home/admin.eagles.edu.vn/sis/.env"),
    "test": Path("/home/test.eagles.edu.vn/sis/.env.test"),
}
REQUEST_TIMEOUT_SECONDS = 8
USER_AGENT = "SIS-read-only-health-monitor/1.0"
CONFIGURATION_ONLY_SERVICES = frozenset({"google_forms_grade_secret", "moodle_provisioning_secret"})


def read_environment(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    with path.open(encoding="utf-8") as env_file:
        for raw_line in env_file:
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[7:].lstrip()
            key, separator, raw_value = line.partition("=")
            if not separator:
                continue
            key = key.strip()
            if key not in {
                "BREVO_API_KEY",
                "MERRIAM_WEBSTER_COLLEGIATE_API_KEY",
                "MERRIAM_WEBSTER_LEARNERS_API_KEY",
                "GOOGLE_API_KEY",
                "GOOGLE_FORMS_GRADES_SECRET",
                "MOODLE_URL",
                "MOODLE_SIS_PROVISIONING_SECRET",
                "MEGS_HEALTH_URL",
            }:
                continue
            value = raw_value.strip()
            if value.startswith('"'):
                try:
                    value = json.loads(value)
                except json.JSONDecodeError as error:
                    raise ValueError(f"invalid quoted value for {key}") from error
            elif value.startswith("'"):
                end = value.find("'", 1)
                if end < 0:
                    raise ValueError(f"invalid quoted value for {key}")
                value = value[1:end]
            else:
                value = value.split(" #", 1)[0].rstrip()
            values[key] = value
    return values


def http_get(url: str, headers: dict[str, str] | None = None) -> tuple[bool, float, int]:
    request = Request(
        url,
        headers={"Accept": "application/json", "User-Agent": USER_AGENT, **(headers or {})},
        method="GET",
    )
    started = time.monotonic()
    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            response.read(8192)
            return 200 <= response.status < 300, time.monotonic() - started, response.status
    except HTTPError as error:
        return False, time.monotonic() - started, error.code
    except (URLError, TimeoutError, OSError, ValueError):
        return False, time.monotonic() - started, 0


def check_configured_http(environment: dict[str, str], key: str, url: str, headers: dict[str, str] | None = None) -> tuple[int, int, float, int]:
    credential = environment.get(key, "").strip()
    if not credential:
        return 0, 0, 0.0, 0
    available, duration, status = http_get(url, headers)
    return 1, int(available), duration, status


def check_brevo(environment: dict[str, str]) -> tuple[int, int, float, int]:
    key = environment.get("BREVO_API_KEY", "").strip()
    if not key:
        return 0, 0, 0.0, 0
    return check_configured_http(environment, "BREVO_API_KEY", "https://api.brevo.com/v3/account", {"api-key": key})


def check_merriam_webster(environment: dict[str, str], source: str, key_name: str) -> tuple[int, int, float, int]:
    key = environment.get(key_name, "").strip()
    if not key:
        return 0, 0, 0.0, 0
    query = urlencode({"key": key})
    endpoint = f"https://www.dictionaryapi.com/api/v3/references/{source}/json/{quote('monitor')}?{query}"
    available, duration, status = http_get(endpoint)
    return 1, int(available), duration, status


def check_google_forms(environment: dict[str, str]) -> tuple[int, int, float, int]:
    key = environment.get("GOOGLE_API_KEY", "").strip()
    if not key:
        return 0, 0, 0.0, 0
    return check_configured_http(
        environment,
        "GOOGLE_API_KEY",
        "https://forms.googleapis.com/$discovery/rest?version=v1",
        {"X-Goog-Api-Key": key},
    )


def check_optional_endpoint(environment: dict[str, str], key: str) -> tuple[int, int, float, int]:
    endpoint = environment.get(key, "").strip()
    if not endpoint:
        return 0, 0, 0.0, 0
    if not endpoint.startswith("https://"):
        return 1, 0, 0.0, 0
    available, duration, status = http_get(endpoint)
    return 1, int(available), duration, status


def local_checks(runtime_root: Path) -> list[tuple[str, int, int, float, int]]:
    cmu_path = runtime_root / "node_modules" / "cmu-pronouncing-dictionary" / "index.js"
    return [("cmu_pronunciation_dictionary", 1, int(cmu_path.is_file() and cmu_path.stat().st_size > 0), 0.0, 0)]


def vendor_checks(environment_name: str, values: dict[str, str], runtime_root: Path) -> list[tuple[str, int, int, float, int]]:
    configured_checks = [
        ("brevo_api", check_brevo, (values,)),
        ("merriam_webster_collegiate", check_merriam_webster, (values, "collegiate", "MERRIAM_WEBSTER_COLLEGIATE_API_KEY")),
        ("merriam_webster_learners", check_merriam_webster, (values, "learners", "MERRIAM_WEBSTER_LEARNERS_API_KEY")),
        ("google_forms_discovery", check_google_forms, (values,)),
        ("moodle_endpoint", check_optional_endpoint, (values, "MOODLE_URL")),
        ("megs_endpoint", check_optional_endpoint, (values, "MEGS_HEALTH_URL")),
    ]
    output: list[tuple[str, int, int, float, int]] = []
    with ThreadPoolExecutor(max_workers=len(configured_checks)) as executor:
        futures = [executor.submit(function, *arguments) for _, function, arguments in configured_checks]
        for (vendor, _, _), future in zip(configured_checks, futures, strict=True):
            try:
                configured, available, duration, status = future.result(timeout=REQUEST_TIMEOUT_SECONDS + 2)
            except Exception:
                configured, available, duration, status = 1, 0, 0.0, 0
            output.append((vendor, configured, available, duration, status))
    output.extend((
        ("google_forms_grade_secret", int(bool(values.get("GOOGLE_FORMS_GRADES_SECRET", "").strip())), 0, 0.0, 0),
        ("moodle_provisioning_secret", int(bool(values.get("MOODLE_SIS_PROVISIONING_SECRET", "").strip())), 0, 0.0, 0),
    ))
    output.extend(local_checks(runtime_root))
    return output


def environment_monitor_success(
    environment_readable: bool,
    checks: list[tuple[str, int, int, float, int]],
) -> bool:
    return environment_readable and all(
        available == 1
        for vendor, configured, available, _, _ in checks
        if configured and vendor not in CONFIGURATION_ONLY_SERVICES
    )


def render_metrics(
    checks: list[tuple[str, str, int, int, float, int]],
    checked_at: int,
    monitor_results: dict[str, bool] | None = None,
) -> str:
    lines = [
        "# HELP sis_external_service_configured Whether an environment-owned vendor endpoint or credential is configured.",
        "# TYPE sis_external_service_configured gauge",
        "# HELP sis_external_service_available Whether the configured external service answered its read-only health request.",
        "# TYPE sis_external_service_available gauge",
        "# HELP sis_external_service_check_duration_seconds Duration of the latest read-only external service health request.",
        "# TYPE sis_external_service_check_duration_seconds gauge",
        "# HELP sis_external_service_http_status HTTP status returned by the latest external service health request, or zero when no HTTP response was received.",
        "# TYPE sis_external_service_http_status gauge",
        "# HELP sis_external_service_last_check_timestamp_seconds Unix time of the latest external service health check.",
        "# TYPE sis_external_service_last_check_timestamp_seconds gauge",
        "# HELP sis_external_service_monitor_success Whether environment-owned vendor health checks completed and every configured endpoint responded.",
        "# TYPE sis_external_service_monitor_success gauge",
        "# HELP sis_external_service_monitor_last_check_timestamp_seconds Unix time of the latest environment-owned vendor health run.",
        "# TYPE sis_external_service_monitor_last_check_timestamp_seconds gauge",
    ]
    results = monitor_results or {}
    for environment in ENVIRONMENTS:
        lines.append(f'sis_external_service_monitor_success{{environment="{environment}"}} {int(results.get(environment, False))}')
        lines.append(f'sis_external_service_monitor_last_check_timestamp_seconds{{environment="{environment}"}} {checked_at}')
    for environment, vendor, configured, available, duration, status in checks:
        labels = f'environment="{environment}",service="{vendor}"'
        lines.append(f"sis_external_service_configured{{{labels}}} {configured}")
        if configured and vendor not in CONFIGURATION_ONLY_SERVICES:
            lines.append(f"sis_external_service_available{{{labels}}} {available}")
            lines.append(f"sis_external_service_check_duration_seconds{{{labels}}} {duration:.6f}")
            lines.append(f"sis_external_service_http_status{{{labels}}} {status}")
        lines.append(f"sis_external_service_last_check_timestamp_seconds{{{labels}}} {checked_at}")
    return "\n".join(lines) + "\n"


def main() -> int:
    checked_at = int(time.time())
    checks: list[tuple[str, str, int, int, float, int]] = []
    monitor_results: dict[str, bool] = {}
    for environment_name, env_path in ENVIRONMENTS.items():
        environment_readable = True
        try:
            values = read_environment(env_path)
        except (OSError, ValueError):
            values = {}
            environment_readable = False
        runtime_root = {
            "live": Path("/home/admin.eagles.edu.vn/sis"),
            "test": Path("/home/test.eagles.edu.vn/sis"),
        }[environment_name]
        environment_checks = [
            (environment_name, vendor, configured, available, duration, status)
            for vendor, configured, available, duration, status in vendor_checks(environment_name, values, runtime_root)
        ]
        checks.extend(environment_checks)
        monitor_results[environment_name] = environment_monitor_success(
            environment_readable,
            [(vendor, configured, available, duration, status) for _, vendor, configured, available, duration, status in environment_checks],
        )

    shared_checks = []
    for instance, endpoint in (("1", "http://127.0.0.1:8091/v2/healthcheck"), ("2", "http://127.0.0.1:8092/v2/healthcheck")):
        available, duration, status = http_get(endpoint)
        shared_checks.append(("shared", f"languagetool_{instance}", 1, int(available), duration, status))
    checks.extend(shared_checks)
    shared_success = all(available for _, _, configured, available, _, _ in shared_checks if configured)
    monitor_results = {environment: value and shared_success for environment, value in monitor_results.items()}

    METRICS_DIRECTORY.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_path = tempfile.mkstemp(prefix=".sis-vendor-health.", suffix=".prom", dir=METRICS_DIRECTORY)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as metrics_file:
            metrics_file.write(render_metrics(checks, checked_at, monitor_results))
        os.chmod(temporary_path, 0o644)
        os.replace(temporary_path, METRICS_FILE)
    except Exception:
        try:
            os.unlink(temporary_path)
        except OSError:
            pass
        raise
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
