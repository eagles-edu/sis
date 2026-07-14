#!/usr/bin/env bash
set -euo pipefail

SCHEDULE="${SIS_CONFIG_REPAIR_CRON:-*/15 * * * *}"
RUNTIME_ROOT="${SIS_RUNTIME_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${SIS_ENV_FILE:-${RUNTIME_ROOT}/.env}"
LOG_DIR="${SIS_LOG_DIR:-${RUNTIME_ROOT}/runtime-data/maintenance-reports}"
NODE_BIN="${SIS_NODE_BIN:-$(command -v node 2>/dev/null || true)}"
CHECK_ONLY=0
CRONTAB_OWNER="${SUDO_USER:-}"

usage() {
  cat <<'EOF'
Usage: tools/install-sis-config-cron.sh [options]

Options:
  --schedule EXPR       Cron schedule (default: "*/15 * * * *")
  --runtime-root PATH   Runtime root containing package.json/tools (default: repo root)
  --env-file PATH       Env file used by dotenv/config (default: <runtime-root>/.env)
  --log-dir PATH        Directory for cron log file (default: <runtime-root>/runtime-data/maintenance-reports)
  --check-only          Print target cron entry without installing
  --help, -h            Show help
EOF
}

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
      usage
      exit 0
      ;;
    *)
      echo "[install-sis-config-cron] unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${SCHEDULE}" ]]; then
  echo "[install-sis-config-cron] schedule is required" >&2
  exit 1
fi

if [[ -z "${NODE_BIN}" ]]; then
  echo "[install-sis-config-cron] node binary not found" >&2
  exit 1
fi

if [[ -z "${CRONTAB_OWNER}" ]]; then
  CRONTAB_OWNER="$(id -un)"
fi

crontab_read() {
  if [[ -n "${SUDO_USER:-}" && "${CRONTAB_OWNER}" != "$(id -un)" ]]; then
    sudo crontab -u "${CRONTAB_OWNER}" -l 2>/dev/null || true
  else
    crontab -l 2>/dev/null || true
  fi
}

crontab_write() {
  if [[ -n "${SUDO_USER:-}" && "${CRONTAB_OWNER}" != "$(id -un)" ]]; then
    sudo crontab -u "${CRONTAB_OWNER}" -
  else
    crontab -
  fi
}

mkdir -p "${LOG_DIR}"
CRON_LOG="${LOG_DIR}/sis-config-repair-cron.log"
RUNNER="${RUNTIME_ROOT}/tools/run-sis-config-repair-cron.sh"
MARKER="# sis-config-repair"
CRON_CMD="${RUNNER} ${RUNTIME_ROOT} ${ENV_FILE} ${NODE_BIN} ${CRON_LOG}"
ENTRY="${SCHEDULE} ${CRON_CMD} ${MARKER}"

if [[ ${CHECK_ONLY} -eq 1 ]]; then
  echo "${ENTRY}"
  exit 0
fi

CURRENT_CRON="$(crontab_read)"
FILTERED_CRON="$(printf '%s\n' "${CURRENT_CRON}" | sed '/# sis-config-repair$/d')"
if [[ -n "${FILTERED_CRON}" ]]; then
  printf '%s\n%s\n' "${FILTERED_CRON}" "${ENTRY}" | crontab_write
else
  printf '%s\n' "${ENTRY}" | crontab_write
fi

echo "[install-sis-config-cron] installed"
echo "${ENTRY}"
echo "[install-sis-config-cron] crontab owner: ${CRONTAB_OWNER}"
