#!/usr/bin/env bash

set -euo pipefail

SOURCE_ROOT="/home/eagles/dockerz/sis"
RUNTIME_ROOT="/home/admin.eagles.edu.vn/sis"
SERVICE_NAME="exercise-mailer.service"
MAILER_PORT="${MAILER_PORT:-8787}"
MODE="sync-on-mismatch"
RESTART=1
HEALTH_CHECK=1
DRIFT_FOUND=0
DRIFT_LINES=()
RSYNC_EXCLUDES=(
  "--exclude=*.BAK-*"
  "--exclude=*~"
  "--exclude=.DS_Store"
)

usage() {
  cat <<'USAGE'
Usage: deploy-api-safe.sh [options]

Deploys API runtime code scope only (server/, schemas/, admin HTML, parent portal assets).
This script does not run DB migrations and does not restore DB.

Options:
  --check-only         Report drift and exit without syncing.
  --force-sync         Always sync (skip drift gate).
  --no-restart         Skip service restart.
  --skip-health-check  Skip /healthz and /api/admin/auth/me checks.
  -h, --help           Show help.

Fixed paths:
  SOURCE_ROOT=/home/eagles/dockerz/sis
  RUNTIME_ROOT=/home/admin.eagles.edu.vn/sis
  SERVICE_NAME=exercise-mailer.service
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check-only)
      MODE="check-only"
      shift
      ;;
    --force-sync)
      MODE="force-sync"
      shift
      ;;
    --no-restart)
      RESTART=0
      shift
      ;;
    --skip-health-check)
      HEALTH_CHECK=0
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

if [[ ! -d "${SOURCE_ROOT}" ]]; then
  echo "Source root not found: ${SOURCE_ROOT}" >&2
  exit 1
fi

if [[ ! -d "${RUNTIME_ROOT}" ]]; then
  echo "Runtime root not found: ${RUNTIME_ROOT}" >&2
  exit 1
fi

for required_dir in server schemas web-asset/admin; do
  if [[ ! -e "${SOURCE_ROOT}/${required_dir}" ]]; then
    echo "Missing source path: ${SOURCE_ROOT}/${required_dir}" >&2
    exit 1
  fi
  if [[ ! -e "${RUNTIME_ROOT}/${required_dir}" ]]; then
    echo "Missing runtime path: ${RUNTIME_ROOT}/${required_dir}" >&2
    exit 1
  fi
done

if [[ ! -e "${SOURCE_ROOT}/web-asset/parent" ]]; then
  echo "Missing source path: ${SOURCE_ROOT}/web-asset/parent" >&2
  exit 1
fi

record_drift() {
  DRIFT_FOUND=1
  DRIFT_LINES+=("$1")
}

collect_dir_drift() {
  local source_dir="$1"
  local runtime_dir="$2"
  local label="$3"
  local diff_output
  diff_output="$(rsync -nrc --itemize-changes "${RSYNC_EXCLUDES[@]}" "${source_dir}/" "${runtime_dir}/" | sed '/^$/d')"
  if [[ -n "${diff_output}" ]]; then
    record_drift "[${label}] content mismatch:"
    while IFS= read -r line; do
      record_drift "  ${line}"
    done <<< "${diff_output}"
  fi
}

collect_html_drift() {
  local source_file="${SOURCE_ROOT}/web-asset/admin/student-admin.html"
  local runtime_file="${RUNTIME_ROOT}/web-asset/admin/student-admin.html"
  if ! cmp -s "${source_file}" "${runtime_file}"; then
    record_drift "[admin-html] content mismatch: ${runtime_file}"
  fi
}

collect_parent_assets_drift() {
  local source_dir="${SOURCE_ROOT}/web-asset/parent"
  local runtime_dir="${RUNTIME_ROOT}/web-asset/parent"
  if [[ ! -d "${runtime_dir}" ]]; then
    record_drift "[parent-assets] missing runtime path: ${runtime_dir}"
    return
  fi
  collect_dir_drift "${source_dir}" "${runtime_dir}" "parent-assets"
}

collect_drift() {
  DRIFT_FOUND=0
  DRIFT_LINES=()
  collect_dir_drift "${SOURCE_ROOT}/server" "${RUNTIME_ROOT}/server" "server"
  collect_dir_drift "${SOURCE_ROOT}/schemas" "${RUNTIME_ROOT}/schemas" "schemas"
  collect_html_drift
  collect_parent_assets_drift
}

print_drift_report() {
  if [[ "${DRIFT_FOUND}" -eq 0 ]]; then
    echo "[drift] no mismatch detected"
    return
  fi
  echo "[drift] mismatch detected"
  for line in "${DRIFT_LINES[@]}"; do
    echo "${line}"
  done
}

perform_sync() {
  local timestamp
  timestamp="$(date +%Y%m%d-%H%M%S)"

  echo "[sync] backup timestamp=${timestamp}"
  mkdir -p \
    "${RUNTIME_ROOT}/server.BAK-${timestamp}" \
    "${RUNTIME_ROOT}/schemas.BAK-${timestamp}" \
    "${RUNTIME_ROOT}/web-asset/admin.BAK-${timestamp}" \
    "${RUNTIME_ROOT}/web-asset/parent.BAK-${timestamp}"

  rsync -a --delete "${RUNTIME_ROOT}/server/" "${RUNTIME_ROOT}/server.BAK-${timestamp}/"
  rsync -a --delete "${RUNTIME_ROOT}/schemas/" "${RUNTIME_ROOT}/schemas.BAK-${timestamp}/"
  rsync -a --delete "${RUNTIME_ROOT}/web-asset/admin/" "${RUNTIME_ROOT}/web-asset/admin.BAK-${timestamp}/"
  if [[ -d "${RUNTIME_ROOT}/web-asset/parent" ]]; then
    rsync -a --delete "${RUNTIME_ROOT}/web-asset/parent/" "${RUNTIME_ROOT}/web-asset/parent.BAK-${timestamp}/"
  fi

  rsync -a "${RSYNC_EXCLUDES[@]}" "${SOURCE_ROOT}/server/" "${RUNTIME_ROOT}/server/"
  rsync -a "${RSYNC_EXCLUDES[@]}" "${SOURCE_ROOT}/schemas/" "${RUNTIME_ROOT}/schemas/"
  rsync -a "${SOURCE_ROOT}/web-asset/admin/student-admin.html" "${RUNTIME_ROOT}/web-asset/admin/student-admin.html"
  mkdir -p "${RUNTIME_ROOT}/web-asset/parent"
  rsync -a "${RSYNC_EXCLUDES[@]}" "${SOURCE_ROOT}/web-asset/parent/" "${RUNTIME_ROOT}/web-asset/parent/"
}

restart_if_requested() {
  if [[ "${RESTART}" -ne 1 ]]; then
    echo "[sync] service restart skipped (--no-restart)"
    return
  fi
  echo "[sync] restarting ${SERVICE_NAME}"
  sudo -n systemctl restart "${SERVICE_NAME}"
  systemctl is-active "${SERVICE_NAME}" >/dev/null
}

run_health_checks() {
  if [[ "${HEALTH_CHECK}" -ne 1 ]]; then
    echo "[check] skipped (--skip-health-check)"
    return
  fi

  fetch_http_code_with_retry() {
    local url="$1"
    local output_file="$2"
    local attempts="${3:-15}"
    local wait_seconds="${4:-1}"
    local code="000"
    local attempt=1
    while [[ "${attempt}" -le "${attempts}" ]]; do
      code="$(curl -sS -o "${output_file}" -w '%{http_code}' "${url}" || true)"
      if [[ "${code}" =~ ^[0-9]{3}$ && "${code}" != "000" ]]; then
        echo "${code}"
        return 0
      fi
      sleep "${wait_seconds}"
      attempt=$((attempt + 1))
    done
    echo "${code}"
    return 0
  }

  echo "[check] local health and auth routes"
  health_code="$(fetch_http_code_with_retry "http://127.0.0.1:${MAILER_PORT}/healthz" /tmp/sis-health.out 15 1)"
  me_code="$(fetch_http_code_with_retry "http://127.0.0.1:${MAILER_PORT}/api/admin/auth/me" /tmp/sis-auth-me.out 15 1)"
  echo "  /healthz => ${health_code}"
  echo "  /api/admin/auth/me => ${me_code}"

  if [[ "${health_code}" != "200" ]]; then
    echo "Health check failed; expected 200, got ${health_code}" >&2
    exit 1
  fi

  if [[ "${me_code}" != "401" ]]; then
    echo "Admin route check failed; expected 401 (unauthenticated), got ${me_code}" >&2
    exit 1
  fi
}

echo "[deploy-api-safe] source=${SOURCE_ROOT}"
echo "[deploy-api-safe] runtime=${RUNTIME_ROOT}"
echo "[deploy-api-safe] mode=${MODE} restart=${RESTART} health_check=${HEALTH_CHECK}"
echo "[deploy-api-safe] note=DB unchanged (no migrate, no restore)"

collect_drift

if [[ "${MODE}" == "check-only" ]]; then
  print_drift_report
  if [[ "${DRIFT_FOUND}" -eq 0 ]]; then
    exit 0
  fi
  exit 2
fi

if [[ "${MODE}" == "sync-on-mismatch" ]]; then
  print_drift_report
  if [[ "${DRIFT_FOUND}" -eq 0 ]]; then
    echo "[ok] runtime already in sync"
    exit 0
  fi
fi

perform_sync
restart_if_requested
run_health_checks

echo "[ok] API deploy sync complete"
