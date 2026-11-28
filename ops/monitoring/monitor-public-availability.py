#!/usr/bin/env python3
"""Publish continuous, multi-region public HTTP checks as Prometheus textfile metrics."""

import concurrent.futures
import json
import os
import re
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


SITES = (
    ("eagles.edu.vn", "naked", "https://eagles.edu.vn/"),
    ("admin.eagles.edu.vn", "admin", "https://admin.eagles.edu.vn/admin"),
    ("test.eagles.edu.vn", "test", "https://test.eagles.edu.vn/admin"),
    ("ltd.eagles.vn", "ltd", "https://ltd.eagles.vn/"),
    ("ielts.eagles.edu.vn", "ielts", "https://ielts.eagles.edu.vn/"),
    ("thuvien.eagles.edu.vn", "thuvien", "https://thuvien.eagles.edu.vn/"),
    ("moodle.eagles.edu.vn", "moodle", "https://moodle.eagles.edu.vn/"),
)
COUNTRIES = ("VN", "US", "GB")
API = "https://api.globalping.io/v1/measurements"
USER_AGENT = "EaglesPublicAvailabilityMonitor/1.0"
TIMEOUT_SECONDS = 12
MAX_WAIT_SECONDS = 35
OUTPUT = Path(os.environ.get(
    "PUBLIC_AVAILABILITY_METRICS_FILE",
    "/home/eagles/dockerz/sis/runtime-data/prometheus/public-availability.prom",
))


def _request_json(url, data=None):
    headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    if data is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        url,
        data=json.dumps(data, separators=(",", ":")).encode("utf-8") if data is not None else None,
        headers=headers,
        method="POST" if data is not None else "GET",
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return json.load(response)


def _probe_site(site):
    domain, site_name, url = site
    parsed = urllib.parse.urlsplit(url)
    payload = {
        "type": "http",
        "target": parsed.hostname,
        "locations": [{"country": country} for country in COUNTRIES],
        "limit": len(COUNTRIES),
        "timeout": 20,
        "inProgressUpdates": True,
        "measurementOptions": {
            "protocol": "HTTPS",
            "request": {"method": "GET", "path": parsed.path or "/", **({"query": parsed.query} if parsed.query else {})},
        },
    }
    try:
        started = _request_json(API, payload)
        measurement_id = str(started.get("id") or "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{4,100}", measurement_id):
            raise ValueError("Globalping returned no valid measurement ID")
        result_url = f"{API}/{urllib.parse.quote(measurement_id, safe='')}"
        deadline = time.monotonic() + MAX_WAIT_SECONDS
        result = started
        while True:
            result = _request_json(result_url)
            if result.get("status") != "in-progress" or time.monotonic() >= deadline:
                break
            time.sleep(min(1, max(0, deadline - time.monotonic())))

        probes = {}
        for item in result.get("results", []):
            if not isinstance(item, dict):
                continue
            probe = item.get("probe") if isinstance(item.get("probe"), dict) else {}
            location = probe.get("location") if isinstance(probe.get("location"), dict) else probe
            result_data = item.get("result") if isinstance(item.get("result"), dict) else {}
            country = str(location.get("country") or "").upper()
            if country not in COUNTRIES:
                continue
            status = result_data.get("statusCode")
            try:
                status = int(status) if status is not None else 0
            except (TypeError, ValueError):
                status = 0
            state = str(result_data.get("status") or "in-progress")
            ok = state == "finished" and 200 <= status < 400
            state_code = 1 if ok else 0 if state in {"finished", "failed", "offline"} else -1
            timing = result_data.get("timings") if isinstance(result_data.get("timings"), dict) else {}
            duration_ms = timing.get("total")
            try:
                duration_ms = max(0.0, float(duration_ms)) if duration_ms is not None else 0.0
            except (TypeError, ValueError):
                duration_ms = 0.0
            probes[country] = {"success": int(ok), "state": state_code, "status": status, "duration_ms": duration_ms}
        for country in COUNTRIES:
            probes.setdefault(country, {"success": 0, "state": -1, "status": 0, "duration_ms": 0.0})
        completed = sum(1 for value in probes.values() if value["state"] >= 0)
        successes = sum(value["success"] for value in probes.values())
        state = "passed" if successes >= 2 else "failed" if completed == len(COUNTRIES) else "inconclusive"
        return {"domain": domain, "site": site_name, "probes": probes, "success": int(state == "passed"), "state": state}
    except (OSError, urllib.error.URLError, TimeoutError, ValueError, TypeError, json.JSONDecodeError) as error:
        return {
            "domain": domain,
            "site": site_name,
            "probes": {country: {"success": 0, "state": -1, "status": 0, "duration_ms": 0.0} for country in COUNTRIES},
            "success": 0,
            "state": "inconclusive",
            "error": str(error)[:160] or error.__class__.__name__,
        }


def _escape_label(value):
    return str(value).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def render_metrics(results, checked_at):
    lines = [
        "# HELP eagles_external_public_site_success Public HTTP reachability from independent Globalping probes; at least two of VN, US, and GB must return 2xx or 3xx.",
        "# TYPE eagles_external_public_site_success gauge",
        "# HELP eagles_external_public_probe_success Result for one independent public probe location.",
        "# TYPE eagles_external_public_probe_success gauge",
        "# HELP eagles_external_public_probe_state Per-location state code: 1 passed, 0 completed but failed, -1 pending or inconclusive.",
        "# TYPE eagles_external_public_probe_state gauge",
        "# HELP eagles_external_public_probe_http_status HTTP status returned by one independent public probe, or 0 without a completed response.",
        "# TYPE eagles_external_public_probe_http_status gauge",
        "# HELP eagles_external_public_probe_duration_seconds HTTP duration measured by one independent public probe.",
        "# TYPE eagles_external_public_probe_duration_seconds gauge",
        "# HELP eagles_external_public_site_last_check_timestamp_seconds Unix time of the latest completed external probe attempt.",
        "# TYPE eagles_external_public_site_last_check_timestamp_seconds gauge",
        "# HELP eagles_external_public_site_state State code: 1 passed, 0 failed, -1 inconclusive.",
        "# TYPE eagles_external_public_site_state gauge",
        "# HELP eagles_external_public_monitor_last_run_timestamp_seconds Unix time when the latest public availability monitor run started.",
        "# TYPE eagles_external_public_monitor_last_run_timestamp_seconds gauge",
        f"eagles_external_public_monitor_last_run_timestamp_seconds {checked_at:.3f}",
    ]
    state_codes = {"passed": 1, "failed": 0, "inconclusive": -1}
    for result in results:
        labels = f'domain="{_escape_label(result["domain"])}",site="{_escape_label(result["site"])}",provider="globalping"'
        lines.append(f"eagles_external_public_site_success{{{labels}}} {result['success']}")
        lines.append(f"eagles_external_public_site_state{{{labels}}} {state_codes[result['state']]}")
        lines.append(f"eagles_external_public_site_last_check_timestamp_seconds{{{labels}}} {checked_at:.3f}")
        for country, probe in result["probes"].items():
            probe_labels = f'{labels},country="{_escape_label(country)}"'
            lines.append(f"eagles_external_public_probe_success{{{probe_labels}}} {probe['success']}")
            lines.append(f"eagles_external_public_probe_state{{{probe_labels}}} {probe['state']}")
            lines.append(f"eagles_external_public_probe_http_status{{{probe_labels}}} {probe['status']}")
            lines.append(f"eagles_external_public_probe_duration_seconds{{{probe_labels}}} {probe['duration_ms'] / 1000:.6f}")
    return "\n".join(lines) + "\n"


def write_metrics(output, content):
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_path = tempfile.mkstemp(prefix=f".{output.name}.", dir=output.parent, text=True)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary_path, 0o644)
        os.replace(temporary_path, output)
    except BaseException:
        try:
            os.unlink(temporary_path)
        except FileNotFoundError:
            pass
        raise


def main():
    checked_at = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(SITES)) as executor:
        results = list(executor.map(_probe_site, SITES))
    write_metrics(OUTPUT, render_metrics(results, checked_at))
    failed = [f"{result['domain']}={result['state']}" for result in results if result["state"] != "passed"]
    print(f"public availability: {len(results) - len(failed)}/{len(results)} passed" + (f"; {', '.join(failed)}" if failed else ""))


if __name__ == "__main__":
    main()
