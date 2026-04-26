#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE_DIR="${SOURCE_ROOT}/ops/systemd"

RUNTIME_ROOT="${SIS_RUNTIME_ROOT:-/home/admin.eagles.edu.vn/sis}"
ENV_FILE="${SIS_ENV_FILE:-${RUNTIME_ROOT}/.env}"
USER_NAME="${SIS_SERVICE_USER:-eagles}"
GROUP_NAME="${SIS_SERVICE_GROUP:-eagles}"
NODE_BIN="${SIS_NODE_BIN:-$(command -v node)}"
INSTALL_DIR="${SIS_SYSTEMD_INSTALL_DIR:-/etc/systemd/system}"
REPORT_DIR="${SIS_MAINTENANCE_REPORT_DIR:-${RUNTIME_ROOT}/runtime-data/maintenance-reports}"
DB_HEALTH_OUTPUT="${SIS_DB_HEALTH_STATUS_FILE:-${RUNTIME_ROOT}/runtime-data/maintenance/db-health-status.json}"
BACKUP_LATEST_PATH="${SIS_DB_BACKUP_LATEST_FILE:-${RUNTIME_ROOT}/backups/postgres/latest.json}"
BACKUP_SCHEDULE="${SIS_DB_BACKUP_SCHEDULE:-02:30}"
VACUUM_SCHEDULE="${SIS_INCOMING_VACUUM_SCHEDULE:-03:17}"
HEALTH_SCHEDULE="${SIS_DB_HEALTH_SCHEDULE:-*:0/15}"
CHECK_ONLY=0
ENABLE_NOW=1

usage() {
  cat <<'EOF'
Usage: tools/install-maintenance-systemd.sh [options]

Options:
  --runtime-root PATH     Runtime root (default: /home/admin.eagles.edu.vn/sis)
  --env-file PATH         Environment file for units (default: <runtime-root>/.env)
  --user NAME             Service user (default: eagles)
  --group NAME            Service group (default: eagles)
  --node-bin PATH         Node binary path (default: command -v node)
  --install-dir PATH      systemd unit install dir (default: /etc/systemd/system)
  --template-dir PATH     Template dir (default: ops/systemd)
  --backup-schedule SPEC  Backup timer OnCalendar (default: 02:30)
  --vacuum-schedule SPEC  Incoming vacuum timer OnCalendar (default: 03:17)
  --health-schedule SPEC  DB health timer OnCalendar (default: *:0/15)
  --check-only            Print rendered units, no writes
  --no-enable             Install units but do not enable/start timers
  --help, -h              Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --runtime-root) RUNTIME_ROOT="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    --user) USER_NAME="${2:-}"; shift 2 ;;
    --group) GROUP_NAME="${2:-}"; shift 2 ;;
    --node-bin) NODE_BIN="${2:-}"; shift 2 ;;
    --install-dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    --template-dir) TEMPLATE_DIR="${2:-}"; shift 2 ;;
    --backup-schedule) BACKUP_SCHEDULE="${2:-}"; shift 2 ;;
    --vacuum-schedule) VACUUM_SCHEDULE="${2:-}"; shift 2 ;;
    --health-schedule) HEALTH_SCHEDULE="${2:-}"; shift 2 ;;
    --check-only) CHECK_ONLY=1; shift ;;
    --no-enable) ENABLE_NOW=0; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "[install-maintenance-systemd] unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "${NODE_BIN}" ]]; then
  echo "[install-maintenance-systemd] unable to resolve node binary" >&2
  exit 1
fi
if [[ ! -d "${TEMPLATE_DIR}" ]]; then
  echo "[install-maintenance-systemd] template dir not found: ${TEMPLATE_DIR}" >&2
  exit 1
fi

mkdir -p "${REPORT_DIR}" "$(dirname "${DB_HEALTH_OUTPUT}")"

escape_sed() {
  printf '%s' "$1" | sed -e 's/[\/&]/\\&/g'
}

render_template() {
  local input="$1"
  sed \
    -e "s/{{RUNTIME_ROOT}}/$(escape_sed "${RUNTIME_ROOT}")/g" \
    -e "s/{{ENV_FILE}}/$(escape_sed "${ENV_FILE}")/g" \
    -e "s/{{USER}}/$(escape_sed "${USER_NAME}")/g" \
    -e "s/{{GROUP}}/$(escape_sed "${GROUP_NAME}")/g" \
    -e "s/{{NODE_BIN}}/$(escape_sed "${NODE_BIN}")/g" \
    -e "s/{{REPORT_DIR}}/$(escape_sed "${REPORT_DIR}")/g" \
    -e "s/{{DB_HEALTH_OUTPUT}}/$(escape_sed "${DB_HEALTH_OUTPUT}")/g" \
    -e "s/{{BACKUP_LATEST_PATH}}/$(escape_sed "${BACKUP_LATEST_PATH}")/g" \
    -e "s/{{BACKUP_SCHEDULE}}/$(escape_sed "${BACKUP_SCHEDULE}")/g" \
    -e "s/{{VACUUM_SCHEDULE}}/$(escape_sed "${VACUUM_SCHEDULE}")/g" \
    -e "s/{{HEALTH_SCHEDULE}}/$(escape_sed "${HEALTH_SCHEDULE}")/g" \
    "${input}"
}

unit_files=(
  "sis-incoming-vacuum.service"
  "sis-incoming-vacuum.timer"
  "sis-db-backup.service"
  "sis-db-backup.timer"
  "sis-db-health.service"
  "sis-db-health.timer"
)

if [[ ${CHECK_ONLY} -eq 1 ]]; then
  for file in "${unit_files[@]}"; do
    echo "### ${INSTALL_DIR}/${file}"
    render_template "${TEMPLATE_DIR}/${file}"
    echo
  done
  exit 0
fi

if [[ ! -w "${INSTALL_DIR}" ]]; then
  echo "[install-maintenance-systemd] install dir is not writable: ${INSTALL_DIR}" >&2
  echo "[install-maintenance-systemd] rerun with elevated privileges or --check-only" >&2
  exit 1
fi

for file in "${unit_files[@]}"; do
  target="${INSTALL_DIR}/${file}"
  render_template "${TEMPLATE_DIR}/${file}" > "${target}"
done

systemctl daemon-reload

if [[ ${ENABLE_NOW} -eq 1 ]]; then
  systemctl enable --now sis-incoming-vacuum.timer sis-db-backup.timer sis-db-health.timer
  systemctl list-timers --all | grep -E "sis-incoming-vacuum|sis-db-backup|sis-db-health" || true
else
  echo "[install-maintenance-systemd] units installed but timers not enabled (--no-enable)"
fi

echo "[install-maintenance-systemd] installed from ${TEMPLATE_DIR} to ${INSTALL_DIR}"
