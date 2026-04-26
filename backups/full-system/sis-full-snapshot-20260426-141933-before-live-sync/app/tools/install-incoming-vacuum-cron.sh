#!/usr/bin/env bash
set -euo pipefail

echo "[install-incoming-vacuum-cron] deprecated: prefer tools/install-maintenance-systemd.sh" >&2
echo "[install-incoming-vacuum-cron] keeping cron path as fallback only" >&2

SCHEDULE="${SIS_INCOMING_VACUUM_CRON:-17 3 * * *}"
RUNTIME_ROOT="${SIS_RUNTIME_ROOT:-/home/admin.eagles.edu.vn/sis}"
ENV_FILE="${SIS_ENV_FILE:-${RUNTIME_ROOT}/.env}"
LOG_DIR="${SIS_LOG_DIR:-${RUNTIME_ROOT}/runtime-data/maintenance-reports}"
CHECK_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --schedule)
      SCHEDULE="${2:-}"
      shift 2
      ;;
    --runtime-root)
      RUNTIME_ROOT="${2:-}"
      shift 2
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --log-dir)
      LOG_DIR="${2:-}"
      shift 2
      ;;
    --check-only)
      CHECK_ONLY=1
      shift
      ;;
    --help|-h)
      cat <<'EOF'
Usage: tools/install-incoming-vacuum-cron.sh [options]

Deprecated fallback installer (cron).
Preferred path: tools/install-maintenance-systemd.sh

Options:
  --schedule EXPR       Cron schedule (default: "17 3 * * *")
  --runtime-root PATH   Runtime root containing package.json/tools (default: /home/admin.eagles.edu.vn/sis)
  --env-file PATH       Env file used by dotenv/config (default: <runtime-root>/.env)
  --log-dir PATH        Directory for cron log file (default: <runtime-root>/runtime-data/maintenance-reports)
  --check-only          Print target cron entry without installing
  --help, -h            Show help
EOF
      exit 0
      ;;
    *)
      echo "[install-incoming-vacuum-cron] unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${SCHEDULE}" ]]; then
  echo "[install-incoming-vacuum-cron] schedule is required" >&2
  exit 1
fi

mkdir -p "${LOG_DIR}"
CRON_LOG="${LOG_DIR}/incoming-vacuum-cron.log"
MARKER="# sis-incoming-vacuum"
CRON_CMD="cd ${RUNTIME_ROOT} && DOTENV_CONFIG_PATH=${ENV_FILE} node -r dotenv/config tools/vacuum-incoming-exercise-results.mjs --apply --report-dir ${LOG_DIR} >> ${CRON_LOG} 2>&1"
ENTRY="${SCHEDULE} ${CRON_CMD} ${MARKER}"

if [[ ${CHECK_ONLY} -eq 1 ]]; then
  echo "${ENTRY}"
  exit 0
fi

CURRENT_CRON="$(crontab -l 2>/dev/null || true)"
FILTERED_CRON="$(printf '%s\n' "${CURRENT_CRON}" | sed '/# sis-incoming-vacuum$/d')"
if [[ -n "${FILTERED_CRON}" ]]; then
  printf '%s\n%s\n' "${FILTERED_CRON}" "${ENTRY}" | crontab -
else
  printf '%s\n' "${ENTRY}" | crontab -
fi

echo "[install-incoming-vacuum-cron] installed"
echo "${ENTRY}"
