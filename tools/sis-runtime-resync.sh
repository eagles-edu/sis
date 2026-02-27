#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

RUNTIME_ROOT="${RUNTIME_ROOT:-/home/eagles/dockerz/megs}"
SERVICE_NAME="${SERVICE_NAME:-exercise-mailer.service}"
MAILER_PORT="${MAILER_PORT:-8787}"
RESTART_SERVICE=1
MODE="sync"
SCOPE="full"
RUN_HEALTH_CHECK=1

usage() {
  cat <<'USAGE'
Usage: sis-runtime-resync.sh [options]

Modes:
  (default)            Always sync selected scope.
  --check-only         Detect runtime drift and exit only.
  --sync-on-mismatch   Detect drift first, sync only when mismatch exists.

Scopes:
  --scope full         Compare/sync server/, schemas/, and admin HTML (default).
  --scope html         Compare/sync only web-asset/admin/student-admin.html.

Options:
  --runtime-root PATH  Runtime root (default: /home/eagles/dockerz/megs)
  --service NAME       systemd service name (default: exercise-mailer.service)
  --mailer-port PORT   Mailer port for post-sync checks (default: 8787)
  --no-restart         Do not restart service after sync.
  --skip-health-check  Skip post-sync /healthz and /api/admin/auth/me checks.
  -h, --help           Show this help text.

Examples:
  ./tools/sis-runtime-resync.sh --check-only --scope html
  ./tools/sis-runtime-resync.sh --sync-on-mismatch --scope html --no-restart
  ./tools/sis-runtime-resync.sh --sync-on-mismatch --scope full
USAGE
}

validate_scope() {
  case "${SCOPE}" in
    full|html) ;;
    *)
      echo "Invalid --scope value: ${SCOPE} (expected: full|html)" >&2
      exit 1
      ;;
  esac
}

DRIFT_FOUND=0
DRIFT_LINES=()

record_drift() {
  DRIFT_FOUND=1
  DRIFT_LINES+=("$1")
}

collect_dir_drift() {
  local source_dir="$1"
  local runtime_dir="$2"
  local label="$3"
  if [[ ! -d "${runtime_dir}" ]]; then
    record_drift "[${label}] missing runtime directory: ${runtime_dir}"
    return
  fi
  local diff_output
  diff_output="$(rsync -nrc --delete --itemize-changes "${source_dir}" "${runtime_dir}" | sed '/^$/d')"
  if [[ -n "${diff_output}" ]]; then
    record_drift "[${label}] content mismatch:"
    while IFS= read -r line; do
      record_drift "  ${line}"
    done <<< "${diff_output}"
  fi
}

collect_html_drift() {
  local source_file="${REPO_ROOT}/web-asset/admin/student-admin.html"
  local runtime_file="${RUNTIME_ROOT}/web-asset/admin/student-admin.html"
  if [[ ! -f "${runtime_file}" ]]; then
    record_drift "[admin-html] missing runtime file: ${runtime_file}"
    return
  fi
  if ! cmp -s "${source_file}" "${runtime_file}"; then
    record_drift "[admin-html] content mismatch: ${runtime_file}"
  fi
}

collect_drift() {
  DRIFT_FOUND=0
  DRIFT_LINES=()
  if [[ "${SCOPE}" == "full" ]]; then
    collect_dir_drift "${REPO_ROOT}/server/" "${RUNTIME_ROOT}/server/" "server"
    collect_dir_drift "${REPO_ROOT}/schemas/" "${RUNTIME_ROOT}/schemas/" "schemas"
  fi
  collect_html_drift
}

print_drift_report() {
  if [[ "${DRIFT_FOUND}" -eq 0 ]]; then
    echo "[drift] no mismatch detected for scope=${SCOPE}"
    return
  fi
  echo "[drift] mismatch detected for scope=${SCOPE}"
  for line in "${DRIFT_LINES[@]}"; do
    echo "${line}"
  done
}

perform_sync() {
  local timestamp="$1"
  echo "[sync] runtime root: ${RUNTIME_ROOT}"
  echo "[sync] backup timestamp: ${timestamp}"
  echo "[sync] scope: ${SCOPE}"

  mkdir -p "${RUNTIME_ROOT}/web-asset/admin"

  if [[ "${SCOPE}" == "full" ]]; then
    mkdir -p "${RUNTIME_ROOT}/server" "${RUNTIME_ROOT}/schemas"
    mkdir -p "${RUNTIME_ROOT}/server.BAK-${timestamp}" "${RUNTIME_ROOT}/schemas.BAK-${timestamp}" "${RUNTIME_ROOT}/web-asset/admin.BAK-${timestamp}"

    rsync -a --delete "${RUNTIME_ROOT}/server/" "${RUNTIME_ROOT}/server.BAK-${timestamp}/"
    rsync -a --delete "${RUNTIME_ROOT}/schemas/" "${RUNTIME_ROOT}/schemas.BAK-${timestamp}/"
    rsync -a --delete "${RUNTIME_ROOT}/web-asset/admin/" "${RUNTIME_ROOT}/web-asset/admin.BAK-${timestamp}/"

    rsync -a "${REPO_ROOT}/server/" "${RUNTIME_ROOT}/server/"
    rsync -a "${REPO_ROOT}/schemas/" "${RUNTIME_ROOT}/schemas/"
  else
    mkdir -p "${RUNTIME_ROOT}/web-asset/admin.BAK-${timestamp}"
    if [[ -f "${RUNTIME_ROOT}/web-asset/admin/student-admin.html" ]]; then
      cp "${RUNTIME_ROOT}/web-asset/admin/student-admin.html" "${RUNTIME_ROOT}/web-asset/admin.BAK-${timestamp}/student-admin.html"
    fi
  fi

  rsync -a "${REPO_ROOT}/web-asset/admin/student-admin.html" "${RUNTIME_ROOT}/web-asset/admin/student-admin.html"
  echo "[sync] runtime files updated"
}

restart_if_requested() {
  if [[ "${RESTART_SERVICE}" -ne 1 ]]; then
    echo "[sync] service restart skipped (--no-restart)"
    return
  fi
  echo "[sync] restarting ${SERVICE_NAME}"
  sudo -n systemctl restart "${SERVICE_NAME}"
  systemctl is-active "${SERVICE_NAME}" >/dev/null
}

run_health_checks() {
  if [[ "${RUN_HEALTH_CHECK}" -ne 1 ]]; then
    echo "[check] skipped (--skip-health-check)"
    return
  fi

  echo "[check] local health and auth routes"
  HEALTH_CODE="$(curl -sS -o /tmp/sis-health.out -w '%{http_code}' "http://127.0.0.1:${MAILER_PORT}/healthz")"
  ME_CODE="$(curl -sS -o /tmp/sis-auth-me.out -w '%{http_code}' "http://127.0.0.1:${MAILER_PORT}/api/admin/auth/me")"

  echo "  /healthz => ${HEALTH_CODE}"
  echo "  /api/admin/auth/me => ${ME_CODE}"

  if [[ "${HEALTH_CODE}" != "200" ]]; then
    echo "Health check failed; expected 200, got ${HEALTH_CODE}" >&2
    exit 1
  fi

  if [[ "${ME_CODE}" != "401" ]]; then
    echo "Admin route check failed; expected 401 (unauthenticated), got ${ME_CODE}" >&2
    exit 1
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --runtime-root)
      RUNTIME_ROOT="$2"
      shift 2
      ;;
    --service)
      SERVICE_NAME="$2"
      shift 2
      ;;
    --mailer-port)
      MAILER_PORT="$2"
      shift 2
      ;;
    --scope)
      SCOPE="$2"
      shift 2
      ;;
    --check-only)
      MODE="check"
      shift
      ;;
    --sync-on-mismatch)
      MODE="sync_on_mismatch"
      shift
      ;;
    --no-restart)
      RESTART_SERVICE=0
      shift
      ;;
    --skip-health-check)
      RUN_HEALTH_CHECK=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

validate_scope

collect_drift

if [[ "${MODE}" == "check" ]]; then
  print_drift_report
  if [[ "${DRIFT_FOUND}" -eq 0 ]]; then
    exit 0
  fi
  exit 2
fi

if [[ "${MODE}" == "sync_on_mismatch" ]]; then
  print_drift_report
  if [[ "${DRIFT_FOUND}" -eq 0 ]]; then
    echo "[ok] runtime already in sync"
    exit 0
  fi
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
perform_sync "${TIMESTAMP}"
restart_if_requested
run_health_checks

echo "[ok] runtime sync complete (scope=${SCOPE}, mode=${MODE})"
